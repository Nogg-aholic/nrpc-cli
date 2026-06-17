import * as ts from 'typescript';
import * as path from 'node:path';
import * as fs from 'node:fs';
import {
	collectRpcMethods,
	createProgram,
	type CollectedRpcMethod,
	type CodecPolicies,
	type VirtualProgramSource,
	defaultPolicies,
	getTypeFromExportedAlias,
} from './codec-generator.js';
import type { TypeNodeShape } from './codec-generator/types.js';
import { generateScalarConfig, writeScalarConfig } from './generate-scalar-config.js';

export type CodeReference = {
	name: string;
	kind: 'function' | 'method' | 'class' | 'interface' | 'type' | 'variable' | 'import';
	filePath: string;
	lineNumber?: number;
	description?: string;
	code?: string;
	external: boolean;
	packageName?: string;
};

export type MethodMdDoc = {
	name: string;
	httpPath?: string;
	httpMethod?: 'get' | 'post';
	description?: string;
	signature: string;
	parameters: Array<{
		name: string;
		type: string;
		required: boolean;
		description?: string;
	}>;
	returns: {
		type: string;
		description?: string;
	};
	implementation?: string;
	dependencies: CodeReference[];
	location: {
		file: string;
		line: number;
	};
};

export type TypeMdDoc = {
	name: string;
	kind: 'interface' | 'type' | 'class' | 'enum';
	description?: string;
	properties?: Array<{
		name: string;
		type: string;
		required: boolean;
		description?: string;
	}>;
	code: string;
	location: {
		file: string;
		line: number;
	};
	dependencies: CodeReference[];
};

export type GenerateMdDocsOptions = {
	entryFile: string;
	rootType: string;
	outputDir: string;
	basePath?: string;
	includeImplementation?: boolean;
	includeExternalDeps?: boolean;
	maxDependencyDepth?: number;
	virtualSources?: readonly VirtualProgramSource[];
	policies?: CodecPolicies;
};

export type GeneratedMdDocs = {
	methods: MethodMdDoc[];
	types: TypeMdDoc[];
	indexContent: string;
};

function ensureDirectoryExists(dirPath: string): void {
	if (!fs.existsSync(dirPath)) {
		fs.mkdirSync(dirPath, { recursive: true });
	}
}

function relativePath(fullPath: string, baseDir: string): string {
	return path.relative(baseDir, fullPath).replace(/\\/g, '/');
}

function extractPackageName(filePath: string): string | undefined {
	const nodeModulesIndex = filePath.indexOf('node_modules');
	if (nodeModulesIndex === -1) return undefined;
	const afterNodeModules = filePath.slice(nodeModulesIndex + 'node_modules'.length + 1);
	const parts = afterNodeModules.split(path.sep);
	if (parts[0]?.startsWith('@')) {
		return `${parts[0]}/${parts[1]}`;
	}
	return parts[0];
}

function getSymbolKind(symbol: ts.Symbol, declaration: ts.Declaration): CodeReference['kind'] {
	if (ts.isFunctionDeclaration(declaration) || ts.isMethodDeclaration(declaration) || ts.isMethodSignature(declaration)) {
		return 'function';
	}
	if (ts.isClassDeclaration(declaration)) {
		return 'class';
	}
	if (ts.isInterfaceDeclaration(declaration)) {
		return 'interface';
	}
	if (ts.isTypeAliasDeclaration(declaration)) {
		return 'type';
	}
	if (ts.isVariableDeclaration(declaration)) {
		return 'variable';
	}
	if (ts.isImportDeclaration(declaration.parent) || ts.isImportSpecifier(declaration) || ts.isImportClause(declaration.parent)) {
		return 'import';
	}
	return 'variable';
}

export function symbolToCodeReference(
	symbol: ts.Symbol,
	checker: ts.TypeChecker,
	options: GenerateMdDocsOptions,
	baseDir: string
): CodeReference | null {
	const declarations = symbol.getDeclarations();
	if (!declarations || declarations.length === 0) return null;

	const declaration = declarations[0]!;
	const sourceFile = declaration.getSourceFile();
	const filePath = sourceFile.fileName;

	// Skip node_modules unless explicitly included
	if (!options.includeExternalDeps && filePath.includes('node_modules')) {
		return null;
	}

	const name = symbol.getName();
	const description = ts.displayPartsToString(
		symbol.getDocumentationComment(checker)
	).trim();

	const kind = getSymbolKind(symbol, declaration);
	const { line } = sourceFile.getLineAndCharacterOfPosition(declaration.getStart());
	const lineNumber = line + 1;

	const external = filePath.includes('node_modules');
	const packageName = external ? extractPackageName(filePath) : undefined;

	// Get code snippet if available
	let code: string | undefined;
	if (options.includeImplementation && !external) {
		try {
			// If it's an import, just show the name
			if (ts.isImportSpecifier(declaration) || ts.isImportClause(declaration.parent)) {
				code = name;
			}
			// If it's a property pointing to a function, try to find the actual function declaration
			else if (ts.isPropertyAssignment(declaration) || ts.isShorthandPropertyAssignment(declaration)) {
				const initializer = ts.isPropertyAssignment(declaration) ? declaration.initializer : declaration;
				const valueType = checker.getTypeAtLocation(initializer);
				const valueSymbol = valueType.getSymbol() ?? valueType.aliasSymbol;
				const actualDecl = valueSymbol?.getDeclarations()?.[0];
				if (actualDecl) {
					code = actualDecl.getText();
				} else {
					code = declaration.getText();
				}
			} else {
				code = declaration.getText();
			}
		} catch {
			// Ignore errors in code extraction
		}
	}

	return {
		name,
		kind,
		filePath: external ? `${packageName}/${name}` : relativePath(filePath, baseDir),
		lineNumber,
		description: description || undefined,
		code,
		external,
		packageName,
	};
}

export function analyzeMethodDependencies(
	method: CollectedRpcMethod,
	methodNode: ts.Node | undefined,
	checker: ts.TypeChecker,
	options: GenerateMdDocsOptions,
	baseDir: string
): CodeReference[] {
	const references: CodeReference[] = [];
	const seen = new Set<string>();

	if (methodNode) {
		// Find the actual implementation node if methodNode is a property assignment
		let implementationNode = methodNode;
		if (ts.isPropertyAssignment(methodNode) || ts.isShorthandPropertyAssignment(methodNode)) {
			const initializer = ts.isPropertyAssignment(methodNode) ? methodNode.initializer : methodNode;
			const valueType = checker.getTypeAtLocation(initializer);
			const valueSymbol = valueType.getSymbol() ?? valueType.aliasSymbol;
			const actualDecl = valueSymbol?.getDeclarations()?.[0];
			if (actualDecl) {
				implementationNode = actualDecl;
			}
		}

		const methodDeclarations = new Set<ts.Node>();
		methodDeclarations.add(methodNode);
		methodDeclarations.add(implementationNode);

		// Walk the AST of the implementation node to find references
		const visit = (node: ts.Node) => {
			if (ts.isIdentifier(node)) {
				// Skip if it's a property access (e.g. 'value' in 'input.value')
				if (ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) {
					return;
				}

				const symbol = checker.getSymbolAtLocation(node);
				if (symbol) {
					// Skip if it's the method itself
					const declarations = symbol.getDeclarations();
					if (declarations?.some(d => methodDeclarations.has(d))) {
						// If this is the name of the function declaration, skip it but visit children
						if (node.parent === implementationNode && (implementationNode as any).name === node) {
							ts.forEachChild(node, visit);
							return;
						}
						// If it's a recursive call, we might want to show it, but for now let's skip to avoid noise
						return;
					}

					// Skip local variables/parameters defined within the method
					if (declarations?.some(d => {
						let curr: ts.Node | undefined = d;
						while (curr) {
							if (curr === implementationNode) return true;
							curr = curr.parent;
						}
						return false;
					})) {
						return;
					}

					const ref = symbolToCodeReference(symbol, checker, options, baseDir);
					if (ref && !seen.has(`${ref.name}:${ref.filePath}`)) {
						references.push(ref);
						seen.add(`${ref.name}:${ref.filePath}`);
					}
				}
			}
			ts.forEachChild(node, visit);
		};
		
		// Start visiting from children of the implementation node
		ts.forEachChild(implementationNode, visit);
	}

	// Add parameter types from shape
	if (method.argsShape.kind === 'object') {
		for (const prop of method.argsShape.properties) {
			if (prop.description && !seen.has(`${prop.name}:unknown`)) {
				references.push({
					name: prop.name,
					kind: 'type',
					filePath: 'unknown',
					description: prop.description,
					external: false,
				});
				seen.add(`${prop.name}:unknown`);
			}
		}
	}

	// Add return type from shape
	if (method.resultTypeText && !seen.has(`${method.resultTypeText}:unknown`)) {
		references.push({
			name: method.resultTypeText,
			kind: 'type',
			filePath: 'unknown',
			description: 'Return type',
			external: false,
		});
		seen.add(`${method.resultTypeText}:unknown`);
	}

	return references;
}

export function buildMethodMdDoc(
	method: CollectedRpcMethod,
	checker: ts.TypeChecker,
	program: ts.Program,
	options: GenerateMdDocsOptions,
	baseDir: string
): MethodMdDoc {
	const sourceFile = program.getSourceFile(options.entryFile);
	let description: string | undefined;
	let location = { file: 'unknown', line: 0 };
	let implementation: string | undefined;
	let methodNode: ts.Node | undefined;

	if (sourceFile) {
		location.file = relativePath(sourceFile.fileName, baseDir);
		
		// Try to find the specific function declaration by following the symbol
		const methodName = method.path[method.path.length - 1];
		
		// Use the checker to find the symbol for the method
		const rootType = getTypeFromExportedAlias(sourceFile, checker, options.rootType);
		let methodSymbol: ts.Symbol | undefined;
		
		if (rootType) {
			// Traverse the path to find the method symbol
			let currentType: ts.Type | undefined = rootType;
			for (const part of method.path) {
				const property = currentType?.getProperty(part);
				if (property) {
					methodSymbol = property;
					currentType = checker.getTypeOfSymbolAtLocation(property, property.valueDeclaration ?? property.declarations?.[0] ?? sourceFile);
				} else {
					methodSymbol = undefined;
					break;
				}
			}
		}

		if (methodSymbol) {
			const declarations = methodSymbol.getDeclarations();
			const declaration = declarations?.[0];
			
			if (declaration) {
				methodNode = declaration;
				description = ts.displayPartsToString(methodSymbol.getDocumentationComment(checker)).trim();
				
				const declSourceFile = declaration.getSourceFile();
				const { line } = declSourceFile.getLineAndCharacterOfPosition(declaration.getStart());
				location.file = relativePath(declSourceFile.fileName, baseDir);
				location.line = line + 1;

				if (options.includeImplementation) {
					// If it's a property pointing to a function, try to find the actual function declaration
					if (ts.isPropertyAssignment(declaration) || ts.isShorthandPropertyAssignment(declaration)) {
						const initializer = ts.isPropertyAssignment(declaration) ? declaration.initializer : declaration;
						const valueType = checker.getTypeAtLocation(initializer);
						const valueSymbol = valueType.getSymbol() ?? valueType.aliasSymbol;
						const actualDecl = valueSymbol?.getDeclarations()?.[0];
						if (actualDecl) {
							implementation = actualDecl.getText();
						} else {
							implementation = declaration.getText();
						}
					} else {
						implementation = declaration.getText();
					}
				}
			}
		}
	}

	// Build signature
	const params = method.parameterNames
		.map((name, i) => {
			const type = method.parameterTypeTexts[i] || 'unknown';
			const optional = method.parameterOptionalFlags[i] ? '?' : '';
			return `${name}${optional}: ${type}`;
		})
		.join(', ');
	const signature = `async function ${method.methodName}(${params}): Promise<${method.resultTypeText}>`;

	// Build parameters
	const parameters = method.parameterNames.map((name, i) => ({
		name,
		type: method.parameterTypeTexts[i] || 'unknown',
		required: !method.parameterOptionalFlags[i],
		description: undefined,
	}));

	return {
		name: method.methodName,
		httpPath: `/api/${method.path.join('/')}`,
		httpMethod: 'post',
		description,
		signature,
		parameters,
		returns: {
			type: method.resultTypeText,
			description: 'Return value',
		},
		implementation,
		dependencies: analyzeMethodDependencies(method, methodNode, checker, options, baseDir),
		location,
	};
}

export function shapeToTypeString(shape: TypeNodeShape): string {
	switch (shape.kind) {
		case 'primitive': return shape.primitive;
		case 'bigint': return 'bigint';
		case 'unknown': return 'unknown';
		case 'null': return 'null';
		case 'literal': return typeof shape.value === 'string' ? `'${shape.value}'` : String(shape.value);
		case 'undefined': return 'undefined';
		case 'optional': return `${shapeToTypeString(shape.inner)} | undefined`;
		case 'date': return 'Date';
		case 'map': return `Map<${shapeToTypeString(shape.key)}, ${shapeToTypeString(shape.value)}>`;
		case 'record': return `Record<string, ${shapeToTypeString(shape.value)}>`;
		case 'set': return `Set<${shapeToTypeString(shape.element)}>`;
		case 'union': return shape.variants.map(v => shapeToTypeString(v)).join(' | ');
		case 'discriminated-union': return shape.variants.map(v => shapeToTypeString(v.shape)).join(' | ');
		case 'typed-array': return shape.arrayType;
		case 'array': return `${shapeToTypeString(shape.element)}[]`;
		case 'tuple': return `[${shape.elements.map(e => shapeToTypeString(e)).join(', ')}]`;
		case 'object': return shape.schemaName || 'object';
		default: return 'unknown';
	}
}

export function renderMethodMarkdown(doc: MethodMdDoc): string {
	const sections: string[] = [];

	sections.push(`# ${doc.name}`);
	sections.push('');

	const metadataLines = [];
	if (doc.httpPath) {
		metadataLines.push(`**HTTP:** \`${doc.httpMethod?.toUpperCase()} ${doc.httpPath}\``);
	}
	metadataLines.push(`**Type:** \`${doc.signature}\``);
	if (doc.location.file !== 'unknown') {
		metadataLines.push(`**Location:** [\`${doc.location.file}:${doc.location.line}\`](${doc.location.file}:${doc.location.line})`);
	}
	sections.push(`> ${metadataLines.join(' | ')}`);
	sections.push('');

	if (doc.description) {
		sections.push('## Description');
		sections.push('');
		sections.push(doc.description);
		sections.push('');
	}

	sections.push('## Signature');
	sections.push('');
	sections.push('```typescript');
	sections.push(doc.signature);
	sections.push('```');
	sections.push('');

	if (doc.parameters.length > 0) {
		sections.push('## Parameters');
		sections.push('');
		sections.push('| Name | Type | Required | Description |');
		sections.push('|------|------|----------|-------------|');
		for (const param of doc.parameters) {
			const desc = param.description ? param.description.replace(/\|/g, '\\|') : '-';
			sections.push(`| \`${param.name}\` | \`${param.type}\` | ${param.required ? 'Yes' : 'No'} | ${desc} |`);
		}
		sections.push('');
	}

	sections.push('## Returns');
	sections.push('');
	sections.push(`\`${doc.returns.type}\``);
	if (doc.returns.description) {
		sections.push('');
		sections.push(doc.returns.description);
	}
	sections.push('');

	if (doc.implementation) {
		sections.push('## Implementation');
		sections.push('');
		sections.push('```typescript');
		sections.push(doc.implementation);
		sections.push('```');
		sections.push('');
	}

	if (doc.dependencies.length > 0) {
		sections.push('## Dependencies');
		sections.push('');

		const internalDeps = doc.dependencies.filter(d => !d.external);
		const externalDeps = doc.dependencies.filter(d => d.external);

		if (internalDeps.length > 0) {
			sections.push('### Internal');
			sections.push('');
			for (const dep of internalDeps) {
				// Skip if it's just a property access on a parameter or local
				if (dep.kind === 'variable' && dep.filePath === 'unknown') continue;
				
				sections.push(`#### \`${dep.name}\` (${dep.kind})`);
				if (dep.filePath !== 'unknown') {
					sections.push(`> **Location:** [\`${dep.filePath}:${dep.lineNumber}\`](${dep.filePath}:${dep.lineNumber})`);
				}
				if (dep.description) {
					sections.push('');
					sections.push(`**Description:** ${dep.description}`);
				}
				if (dep.code) {
					sections.push('');
					sections.push('```typescript');
					sections.push(dep.code);
					sections.push('```');
				}
				sections.push('');
			}
		}

		if (externalDeps.length > 0) {
			sections.push('### External');
			sections.push('');
			for (const dep of externalDeps) {
				sections.push(`#### \`${dep.name}\` (${dep.kind})`);
				sections.push(`> **Source:** \`${dep.packageName}\` (external library)`);
				if (dep.description) {
					sections.push('');
					sections.push(`**Description:** ${dep.description}`);
				}
				sections.push('');
			}
		}
	}

	return sections.join('\n');
}

export function renderIndexMarkdown(methods: MethodMdDoc[]): string {
	const sections: string[] = [];

	sections.push('# API Documentation');
	sections.push('');
	sections.push('Auto-generated documentation for the nRPC API surface.');
	sections.push('');

	sections.push('## Methods');
	sections.push('');
	sections.push('| Method | HTTP | Description |');
	sections.push('|--------|------|-------------|');
	for (const method of methods.sort((a, b) => a.name.localeCompare(b.name))) {
		const desc = method.description ? method.description.replace(/\|/g, '\\|') : '-';
		sections.push(`| [${method.name}](./methods/${method.name}.md) | \`${method.httpMethod?.toUpperCase()} ${method.httpPath}\` | ${desc} |`);
	}
	sections.push('');

	return sections.join('\n');
}

export function generateMdDocs(options: GenerateMdDocsOptions): GeneratedMdDocs {
	const program = createProgram({
		entryFile: options.entryFile,
		virtualSources: options.virtualSources,
	});
	const checker = program.getTypeChecker();
	const policies = defaultPolicies(options.policies);

	const sourceFile = program.getSourceFile(options.entryFile);
	if (!sourceFile) throw new Error(`Could not load source file ${options.entryFile}`);

	const rootType = getTypeFromExportedAlias(sourceFile, checker, options.rootType);
	const methods = collectRpcMethods(rootType, checker, policies, [], {
		allowedSourceFiles: options.virtualSources?.map(v => v.filePath),
	});

	const methodDocs: MethodMdDoc[] = [];
	for (const method of methods) {
		try {
			const doc = buildMethodMdDoc(method, checker, program, options, options.outputDir);
			methodDocs.push(doc);
		} catch (error) {
			console.warn(`Failed to generate docs for method ${method.methodName}:`, error);
		}
	}

	const indexContent = renderIndexMarkdown(methodDocs);

	return {
		methods: methodDocs,
		types: [], // TODO: Implement type docs if needed
		indexContent,
	};
}

export function writeMdDocsToDisk(options: GenerateMdDocsOptions): void {
	const docs = generateMdDocs(options);

	const methodsDir = path.join(options.outputDir, 'methods');
	ensureDirectoryExists(methodsDir);

	for (const method of docs.methods) {
		const filePath = path.join(methodsDir, `${method.name}.md`);
		fs.writeFileSync(filePath, renderMethodMarkdown(method), 'utf-8');
	}

	const indexPath = path.join(options.outputDir, 'index.md');
	fs.writeFileSync(indexPath, docs.indexContent, 'utf-8');

	// Write scalar config
	const scalarConfig = generateScalarConfig({
		outputDir: options.outputDir,
		title: options.rootType,
		methods: docs.methods.map(m => m.name),
	});
	writeScalarConfig(scalarConfig, options.outputDir);
}
