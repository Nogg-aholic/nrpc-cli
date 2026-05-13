import path from "node:path";
import * as ts from "typescript";
import {
	normalizeType,
	type TypeNodeShape,
	type VirtualProgramSource,
	unwrapPromiseLikeType,
	type CodecPolicies
} from "./codec-generator.js";
import { analyzeRpcSurface, generateHttpRouteManifest, type RpcAnalysisContext } from "./http-route-generator.js";

export type GenerateEndpointSurfaceOptions = {
	entryFile: string;
	rootType: string;
	outputImportPath: string;
	moduleSpecifier?: string;
	runtimeImportPath?: string;
	rootPath?: string[];
	globalName?: string;
	declarationTypeName?: string;
	policies?: CodecPolicies;
	virtualSources?: readonly VirtualProgramSource[];
};

export type GeneratedEndpointSurfaceResult = {
	contractText: string;
};

export type GenerateEndpointGlobalDeclarationOptions = {
	entryFile: string;
	rootType: string;
	rootPath?: string[];
	declarationTypeName: string;
	globalName: string;
	policies?: CodecPolicies;
	virtualSources?: readonly VirtualProgramSource[];
};

export function generateEndpointSurface(options: GenerateEndpointSurfaceOptions): GeneratedEndpointSurfaceResult {
	const analysis = analyzeRpcSurface(options);
	const globalName = options.globalName ?? analysis.rootPath[analysis.rootPath.length - 1] ?? analysis.rootPath[0] ?? options.rootType;
	const routeManifest = generateHttpRouteManifest({
		entryFile: options.entryFile,
		rootType: options.rootType,
		rootPath: analysis.rootPath,
		basePath: "/",
		protocolMode: "both",
		policies: options.policies,
		virtualSources: options.virtualSources,
	});
	const contractText = renderGeneratedContractModule({
		rootType: options.rootType,
		rootPath: analysis.rootPath,
		globalName,
		moduleSpecifier: options.moduleSpecifier,
		runtimeImportPath: options.runtimeImportPath,
		routeManifest,
		checker: analysis.checker,
		policies: analysis.policies,
		methods: analysis.methods,
	});
	return {
		contractText,
	};
}

type RenderGeneratedContractModuleOptions = {
	rootType: string;
	rootPath: string[];
	globalName: string;
	moduleSpecifier?: string;
	runtimeImportPath?: string;
	routeManifest: ReturnType<typeof generateHttpRouteManifest>;
	checker: ts.TypeChecker;
	policies: Required<CodecPolicies>;
	methods: RpcAnalysisContext["methods"];
};

function renderGeneratedContractModule(options: RenderGeneratedContractModuleOptions): string {
	const moduleSpecifier = options.moduleSpecifier ?? "@nogg-aholic/nrpc";
	const runtimeImportPath = options.runtimeImportPath ?? "@nogg-aholic/nrpc/generated-codec-runtime";
	const inlineMethods = options.methods
		.map((method) => {
			const methodTypeLiteral = renderRpcMethodLiteral(method, options.checker, options.policies);
			const signature = renderRpcMethodImplementationSignature(method.argsShape, method.parameterNames, options.policies);
			return {
				methodName: method.methodName,
				argsTypeReference: methodTypeLiteral.argsTupleType,
				resultTypeReference: methodTypeLiteral.resultType,
				signature,
				parameterNames: method.parameterNames,
				argsShape: method.argsShape,
				resultShape: normalizeType(unwrapPromiseLikeType(method.resultType, options.checker), options.checker, options.policies),
				pathParts: method.path,
			};
		})
		.sort((a, b) => a.methodName.localeCompare(b.methodName));
	return [
		"// AUTO-GENERATED FILE. DO NOT EDIT.",
		`import {`,
		`\tNRPC_METHOD_CALLER,`,
		`\tNRPC_METHOD_CODEC,`,
		`\tNRPC_METHOD_REF,`,
		`\ttype HttpRouteManifest,`,
		`\ttype RpcMethodCodec,`,
		`\ttype RpcMethodCodecFromRef,`,
		`\ttype RpcMethodCallerFromCallable,`,
		`\ttype RpcMethodRefFromCallable,`,
		`\tdefineRpcMethodRef,`,
		`} from ${JSON.stringify(moduleSpecifier)};`,
		`import {`,
		`\tcreateGeneratedRpcMethodCodec,`,
		`\ttype GeneratedCodecShape,`,
		`} from ${JSON.stringify(runtimeImportPath)};`,
		`const createRpcCodecRegistry = (entries: ReadonlyArray<readonly [string, RpcMethodCodec<any[], any>]>) => { const registry = new Map<string, RpcMethodCodec<any[], any>>(entries); return (methodName: string) => registry.get(methodName); };`,
		"",
		`export const ${options.globalName}RpcDefinition = ${renderInlineSurfaceDefinition(inlineMethods, 0)};`,
		"",
		renderInlineCodecRegistryAttachment(options.globalName, inlineMethods),
		"",
		renderInlineSurfaceMetadataAttachment(options.globalName, inlineMethods),
		"",
		`export const ${options.globalName}HttpRouteManifest: HttpRouteManifest = ${JSON.stringify(stripRouteManifestTypeRefs(options.routeManifest), null, 2)};`,
		"",
	].join("\n");
}

function stripRouteManifestTypeRefs(manifest: ReturnType<typeof generateHttpRouteManifest>) {
	return {
		...manifest,
		routes: manifest.routes.map(({ argsTypeReference: _argsTypeReference, resultTypeReference: _resultTypeReference, ...route }) => route),
	};
}

function renderRpcMethodLiteral(
	method: RpcAnalysisContext["methods"][number],
	checker: ts.TypeChecker,
	policies: Required<CodecPolicies>,
): { argsTupleType: string; resultType: string; methodGenericArgs: string } {
	if (method.argsShape.kind !== "tuple") {
		throw new Error(`Expected tuple args shape for ${method.methodName}.`);
	}
	const argsTupleType = `[${method.argsShape.elements.map((shape: TypeNodeShape) => renderTypeNode(shape, policies, 0)).join(", ")}]`;
	const resultType = renderTypeNode(normalizeType(unwrapPromiseLikeType(method.resultType, checker), checker, policies), policies, 0);
	return {
		argsTupleType,
		resultType,
		methodGenericArgs: `${argsTupleType}, ${resultType}`,
	};
}

function renderInlineSurfaceDefinition(
	entries: Array<{
		methodName: string;
		argsTypeReference: string;
		resultTypeReference: string;
		signature: string;
		parameterNames: string[];
		argsShape: TypeNodeShape;
		resultShape: TypeNodeShape;
		pathParts: string[];
	}>,
	depth: number,
	pathPrefix: string[] = [],
): string {
	const indent = "\t".repeat(depth);
	const childIndent = "\t".repeat(depth + 1);
	const lines: string[] = ["{"];
	const grouped = new Map<string, typeof entries>();
	for (const entry of entries) {
		const [head, ...rest] = entry.pathParts.slice(pathPrefix.length);
		if (!head) continue;
		const nextEntry = rest.length === 0
			? entry
			: {
				...entry,
				pathParts: [...pathPrefix, head, ...rest],
			};
		const bucket = grouped.get(head);
		if (bucket) bucket.push(nextEntry);
		else grouped.set(head, [nextEntry]);
	}
	for (const [group, groupEntries] of [...grouped.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
		const directEntry = groupEntries.find((entry) => entry.pathParts.length === pathPrefix.length + 1);
		if (directEntry) {
			lines.push(`${childIndent}${JSON.stringify(group)}: ${renderInlineRpcMethod(directEntry, depth + 1)},`);
			continue;
		}
		lines.push(`${childIndent}${JSON.stringify(group)}: ${renderInlineSurfaceDefinition(groupEntries, depth + 1, [...pathPrefix, group])},`);
	}
	lines.push(`${indent}}`);
	return lines.join("\n");
}

function renderInlineRpcMethod(entry: {
	methodName: string;
	argsTypeReference: string;
	resultTypeReference: string;
	signature: string;
	parameterNames: string[];
	argsShape: TypeNodeShape;
	resultShape: TypeNodeShape;
}, depth: number): string {
	const methodIdentifier = renderGeneratedMethodIdentifier(entry.methodName);
	const tupleArgs = `[${entry.parameterNames.join(", ")}]`;
	const indent = "\t".repeat(depth);
	const childIndent = "\t".repeat(depth + 1);
	const callableType = `typeof ${methodIdentifier}`;
	return [
		`defineRpcMethodRef(async function ${methodIdentifier}(${entry.signature}): Promise<${entry.resultTypeReference}> {`,
		`${childIndent}const caller = (${methodIdentifier} as any)[NRPC_METHOD_CALLER] as undefined | RpcMethodCallerFromCallable<${callableType}>;`,
		`${childIndent}if (!caller) {`,
		`${childIndent}\tthrow new Error(${JSON.stringify(`${entry.methodName} cannot be invoked directly. Resolve it through your RPC caller.`)});`,
		`${childIndent}}`,
		`${childIndent}return caller(${methodIdentifier} as RpcMethodRefFromCallable<${callableType}>, ...(${tupleArgs} as Parameters<${callableType}>));`,
		`${indent}})`
	].join("\n");
}

function renderInlineSurfaceMetadataAttachment(
	globalName: string,
	entries: Array<{
		methodName: string;
		argsTypeReference: string;
		resultTypeReference: string;
		signature: string;
		parameterNames: string[];
		argsShape: TypeNodeShape;
		resultShape: TypeNodeShape;
		pathParts: string[];
	}>,
): string {
	const lines: string[] = [];
	for (const entry of entries) {
		const accessor = `${globalName}RpcDefinition${entry.pathParts.map((part) => `[${JSON.stringify(part)}]`).join("")}`;
		lines.push(`(${accessor} as any).__nrpcMethodName = ${JSON.stringify(entry.methodName)};`);
		lines.push(`(${accessor} as any)[NRPC_METHOD_REF] = true;`);
		lines.push(`(${accessor} as any)[NRPC_METHOD_CODEC] = ${globalName}CodecRegistry(${JSON.stringify(entry.methodName)}) as RpcMethodCodecFromRef<typeof ${accessor}>;`);
	}
	return lines.join("\n\n");
}

function renderInlineCodecRegistryAttachment(
	globalName: string,
	entries: Array<{
		methodName: string;
		argsTypeReference: string;
		resultTypeReference: string;
		signature: string;
		parameterNames: string[];
		argsShape: TypeNodeShape;
		resultShape: TypeNodeShape;
		pathParts: string[];
	}>,
): string {
	const entryLines = entries
		.slice()
		.sort((a, b) => a.methodName.localeCompare(b.methodName))
		.map((entry) => {
			return `\t[${JSON.stringify(entry.methodName)}, { args: ${JSON.stringify(entry.argsShape)}, result: ${JSON.stringify(entry.resultShape)} }] as const,`;
		});
	return [
		`export const ${globalName}CodecShapeEntries: ReadonlyArray<readonly [string, { args: GeneratedCodecShape; result: GeneratedCodecShape }]> = [`,
		...entryLines,
		`] as const;`,
		"",
		`export const ${globalName}CodecEntries = ${globalName}CodecShapeEntries.map(([methodName, shape]) => [methodName, createGeneratedRpcMethodCodec(shape.args, shape.result)] as const);`,
		"",
		`export const ${globalName}CodecRegistry = createRpcCodecRegistry(${globalName}CodecEntries as ReadonlyArray<readonly [string, RpcMethodCodec<any[], any>]>);`,
	].join("\n");
}

function renderRpcMethodImplementationSignature(
	argsShape: TypeNodeShape,
	parameterNames: string[],
	policies: Required<CodecPolicies>,
): string {
	if (argsShape.kind !== "tuple") {
		throw new Error("Expected tuple args shape for RPC method implementation signature.");
	}
	let trailingOptionalStart = argsShape.elements.length;
	for (let index = argsShape.elements.length - 1; index >= 0; index -= 1) {
		if (argsShape.elements[index]?.kind === "optional") {
			trailingOptionalStart = index;
			continue;
		}
		break;
	}
	return argsShape.elements
		.map((element, index) => {
			const isOptional = element.kind === "optional";
			const canUseOptionalSyntax = isOptional && index >= trailingOptionalStart;
			const renderedType = canUseOptionalSyntax
				? renderTypeNode(element.inner, policies, 0)
				: renderTypeNode(element, policies, 0);
			return `${parameterNames[index] ?? `arg${index}`}${canUseOptionalSyntax ? "?" : ""}: ${renderedType}`;
		})
		.join(", ");
}

function renderGeneratedMethodIdentifier(methodName: string): string {
	const sanitized = methodName.replace(/[^A-Za-z0-9_$]/g, "_");
	const prefixed = /^[A-Za-z_$]/.test(sanitized) ? sanitized : `_${sanitized}`;
	return prefixed.length > 0 ? prefixed : "_nrpcMethod";
}

export function generateEndpointGlobalDeclaration(options: GenerateEndpointGlobalDeclarationOptions): string {
	const analysis = analyzeRpcSurface(options);
	const aliasBody = renderRpcApiTypeLiteral(analysis.rootType, analysis.checker, analysis.policies, 0);
	return [
		`type ${options.declarationTypeName} = ${aliasBody};`,
		"",
		"declare global {",
		`  var ${options.globalName}: ${options.declarationTypeName};`,
		"}",
		"",
		"export {};",
	].join("\n");
}

function renderRpcApiTypeLiteral(type: ts.Type, checker: ts.TypeChecker, policies: Required<CodecPolicies>, depth: number): string {
	const indent = "  ".repeat(depth);
	const childIndent = "  ".repeat(depth + 1);
	const lines: string[] = ["{"];
	for (const property of checker.getPropertiesOfType(type)) {
		const declaration = property.valueDeclaration ?? property.declarations?.[0];
		if (!declaration) continue;
		const propertyType = checker.getTypeOfSymbolAtLocation(property, declaration);
		const signatures = checker.getSignaturesOfType(propertyType, ts.SignatureKind.Call);
		if (signatures.length > 0) {
			const signature = signatures[0]!;
			const parameters = signature.getParameters().map((parameter) => renderParameterDeclaration(parameter, checker, policies));
			const returnType = renderTypeNode(
				normalizeType(unwrapPromiseLikeType(checker.getReturnTypeOfSignature(signature), checker), checker, policies),
				policies,
				depth + 1,
			);
			lines.push(`${childIndent}${property.name}(${parameters.join(", ")}): Promise<${returnType}>;`);
			continue;
		}
		lines.push(`${childIndent}${property.name}: ${renderRpcApiTypeLiteral(propertyType, checker, policies, depth + 1)};`);
	}
	lines.push(`${indent}}`);
	return lines.join("\n");
}

function renderParameterDeclaration(parameter: ts.Symbol, checker: ts.TypeChecker, policies: Required<CodecPolicies>): string {
	const declaration = parameter.valueDeclaration ?? parameter.declarations?.[0];
	if (!declaration) {
		return `${parameter.name}: unknown`;
	}
	const type = checker.getTypeOfSymbolAtLocation(parameter, declaration);
	const normalized = normalizeType(type, checker, policies, parameter.name);
	const isOptionalParameter = ts.isParameter(declaration)
		? !!declaration.questionToken || !!declaration.initializer || !!declaration.dotDotDotToken
		: false;
	return `${parameter.name}${isOptionalParameter ? "?" : ""}: ${renderTypeNode(normalized, policies, 0)}`;
}

function renderTypeNode(shape: TypeNodeShape, policies: Required<CodecPolicies>, depth: number): string {
	switch (shape.kind) {
		case "primitive":
			return shape.primitive;
		case "bigint":
			return "bigint";
		case "null":
			return "null";
		case "unknown":
			return "unknown";
		case "literal":
			return JSON.stringify(shape.value);
		case "undefined":
			return "undefined";
		case "optional":
			return `${renderTypeNode(shape.inner, policies, depth)} | undefined`;
		case "date":
			return policies.date === "reject" ? "never" : "Date";
		case "map":
			return `Map<${renderTypeNode(shape.key, policies, depth)}, ${renderTypeNode(shape.value, policies, depth)}>`;
		case "record":
			return `Record<string, ${renderTypeNode(shape.value, policies, depth)}>`;
		case "set":
			return `Set<${renderTypeNode(shape.element, policies, depth)}>`;
		case "union":
			return shape.variants.map((variant) => renderTypeNode(variant, policies, depth)).join(" | ");
		case "discriminated-union":
			return shape.variants.map((variant) => renderObjectShape(variant.shape, policies, depth, shape.discriminator, variant.tagValue)).join(" | ");
		case "typed-array":
			return shape.arrayType;
		case "array":
			return `Array<${renderTypeNode(shape.element, policies, depth)}>`;
		case "tuple":
			return `[${shape.elements.map((element) => renderTypeNode(element, policies, depth)).join(", ")}]`;
		case "object":
			return renderObjectShape(shape, policies, depth);
	}
	return "unknown";
}


function renderObjectShape(shape: Extract<TypeNodeShape, { kind: "object" }>, policies: Required<CodecPolicies>, depth: number, discriminator?: string, tagValue?: string | number | boolean): string {
	const indent = "  ".repeat(depth);
	const childIndent = "  ".repeat(depth + 1);
	const lines: string[] = ["{"];
	for (const property of shape.properties) {
		const propertyName = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(property.name) ? property.name : JSON.stringify(property.name);
		if (discriminator && property.name === discriminator) {
			lines.push(`${childIndent}${propertyName}: ${JSON.stringify(tagValue)};`);
			continue;
		}
		const optionalShape = property.shape.kind === "optional" ? property.shape : undefined;
		const typeText = renderTypeNode(optionalShape ? optionalShape.inner : property.shape, policies, depth + 1);
		lines.push(`${childIndent}${propertyName}${optionalShape ? "?" : ""}: ${typeText};`);
	}
	lines.push(`${indent}}`);
	return lines.join("\n");
}

function pascalize(value: string): string {
	return value.replace(/(^|[^a-zA-Z0-9]+)([a-zA-Z0-9])/g, (_match, _sep, chr: string) => chr.toUpperCase());
}
