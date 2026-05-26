import path from "node:path";
import * as ts from "typescript";
import {
	normalizeType,
	type TypeNodeShape,
	type VirtualProgramSource,
	unwrapPromiseLikeType,
	type CodecPolicies,
	type SurfaceTraversalOptions,
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
	traversal?: SurfaceTraversalOptions;
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
		traversal: options.traversal,
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

type InlineMethodEntry = {
	methodName: string;
	argsAliasName: string;
	resultAliasName: string;
	argsTypeReference: string;
	resultTypeReference: string;
	signature: string;
	parameterNames: string[];
	argsShape: TypeNodeShape;
	resultShape: TypeNodeShape;
	pathParts: string[];
};

type NamedObjectRegistryEntry = {
	name: string;
	shape: Extract<TypeNodeShape, { kind: "object" }>;
};

type NamedObjectRegistry = {
	entries: NamedObjectRegistryEntry[];
	nameByKey: Map<string, string>;
	usedNames: Set<string>;
};

function renderGeneratedContractModule(options: RenderGeneratedContractModuleOptions): string {
	const callableMethods = options.methods.filter((method) => method.effects.reason !== "property access");
	const moduleSpecifier = options.moduleSpecifier ?? "@nogg-aholic/nrpc";
	const runtimeImportPath = options.runtimeImportPath ?? "@nogg-aholic/nrpc/generated-codec-runtime";
	const baseInlineMethods = callableMethods
		.map((method) => {
			const typeBaseName = renderGeneratedMethodTypeBaseName(method.methodName);
			const argsAliasName = `${typeBaseName}Args`;
			const resultAliasName = `${typeBaseName}Result`;
			return {
				methodName: method.methodName,
				argsAliasName,
				resultAliasName,
				parameterNames: method.parameterNames,
				argsShape: method.argsShape,
				resultShape: normalizeEndpointMethodResultType(method, options.checker, options.policies),
				pathParts: method.path,
			};
		})
		.sort((a, b) => a.methodName.localeCompare(b.methodName));
	const namedObjectRegistry = createNamedObjectRegistry(baseInlineMethods);
	const namedObjectDeclarations = renderNamedObjectInterfaces(namedObjectRegistry, options.policies);
	const inlineMethods: InlineMethodEntry[] = baseInlineMethods.map((entry) => ({
		...entry,
		argsTypeReference: renderTypeNode(entry.argsShape, options.policies, 0, namedObjectRegistry),
		resultTypeReference: renderTypeNode(entry.resultShape, options.policies, 0, namedObjectRegistry),
		signature: renderRpcMethodImplementationSignature(entry.argsShape, entry.parameterNames, options.policies, entry.argsAliasName),
	}));
	return [
		"// AUTO-GENERATED FILE. DO NOT EDIT.",
		`import {`,
		`\tNRPC_METHOD_CALLER,`,
		`\tNRPC_METHOD_CODEC,`,
		`\tNRPC_METHOD_REF,`,
		`\ttype HttpRouteManifest,`,
		`\ttype RpcMethodCodec,`,
		`\ttype RpcMethodRef,`,
		`\ttype RpcMethodCodecFromRef,`,
		`\ttype RpcMethodCallerFromCallable,`,
		`\ttype RpcMethodRefFromCallable,`,
		`\tattachRpcMethodMetadata,`,
		`\tdefineRpcMethodRef,`,
		`\tmountRpcNamespace,`,
		`\twithRpcMethodCodec,`,
		`} from ${JSON.stringify(moduleSpecifier)};`,
		`import {`,
		`\tcreateGeneratedRpcMethodCodec,`,
		`\ttype GeneratedCodecShape,`,
		`} from ${JSON.stringify(runtimeImportPath)};`,
		`const createRpcCodecRegistry = (entries: ReadonlyArray<readonly [string, RpcMethodCodec<any[], any>]>) => { const registry = new Map<string, RpcMethodCodec<any[], any>>(entries); return (methodName: string) => registry.get(methodName); };`,
		"",
		namedObjectDeclarations,
		namedObjectDeclarations ? "" : "",
		renderInlineMethodTypeAliases(inlineMethods, options.policies),
		"",
		`export const ${options.globalName}RpcDefinition = ${renderInlineSurfaceDefinition(inlineMethods, 0)};`,
		"",
		renderInlineCodecRegistryAttachment(options.globalName, inlineMethods),
		"",
		renderInlineSurfaceMetadataAttachment(options.globalName, inlineMethods),
		"",
		`export const ${options.globalName}HttpRouteManifest: HttpRouteManifest = ${JSON.stringify(stripRouteManifestTypeRefs(options.routeManifest), null, 2)};`,
		"",
		renderNamespaceInstaller(options.globalName),
		"",
	].join("\n");
}

function renderNamespaceInstaller(globalName: string): string {
	const installName = `install${renderGeneratedMethodTypeBaseName(globalName)}Namespace`;
	return [
		`export function ${installName}<TTarget extends Record<string, unknown>, TSurface>(`,
		`\ttarget: TTarget,`,
		`\tsurface: TSurface,`,
		`): TTarget {`,
		`\treturn mountRpcNamespace(target, ${globalName}HttpRouteManifest, surface);`,
		`}`,
	].join("\n");
}


function createNamedObjectRegistry(entries: Array<{ argsShape: TypeNodeShape; resultShape: TypeNodeShape }>): NamedObjectRegistry {
	const registry: NamedObjectRegistry = {
		entries: [],
		nameByKey: new Map<string, string>(),
		usedNames: new Set<string>(),
	};
	for (const entry of entries) {
		collectNamedObjectShapes(entry.argsShape, registry);
		collectNamedObjectShapes(entry.resultShape, registry);
	}
	return registry;
}

function collectNamedObjectShapes(shape: TypeNodeShape, registry: NamedObjectRegistry): void {
	switch (shape.kind) {
		case "optional":
			collectNamedObjectShapes(shape.inner, registry);
			return;
		case "map":
			collectNamedObjectShapes(shape.key, registry);
			collectNamedObjectShapes(shape.value, registry);
			return;
		case "record":
			collectNamedObjectShapes(shape.value, registry);
			return;
		case "set":
		case "array":
			collectNamedObjectShapes(shape.element, registry);
			return;
		case "union":
			for (const variant of shape.variants) collectNamedObjectShapes(variant, registry);
			return;
		case "discriminated-union":
			for (const variant of shape.variants) collectNamedObjectShapes(variant.shape, registry);
			return;
		case "tuple":
			for (const element of shape.elements) collectNamedObjectShapes(element, registry);
			return;
		case "object": {
			const registryKey = getNamedObjectRegistryKey(shape);
			if (registryKey && !registry.nameByKey.has(registryKey)) {
				const baseName = getNamedObjectBaseName(shape);
				const name = reserveNamedObjectName(baseName, registry);
				registry.nameByKey.set(registryKey, name);
				registry.entries.push({ name, shape });
			}
			for (const property of shape.properties) collectNamedObjectShapes(property.shape, registry);
			return;
		}
		default:
			return;
	}
}

function renderNamedObjectInterfaces(registry: NamedObjectRegistry, policies: Required<CodecPolicies>): string {
	return registry.entries
		.map((entry) => {
			const body = renderObjectShape(entry.shape, policies, 0, undefined, undefined, registry, entry.name);
			return `export interface ${entry.name} ${body}`;
		})
		.join("\n\n");
}

function getNamedObjectRegistryKey(shape: Extract<TypeNodeShape, { kind: "object" }>): string | undefined {
	return shape.schemaId ?? shape.schemaName;
}

function getNamedObjectBaseName(shape: Extract<TypeNodeShape, { kind: "object" }>): string {
	if (shape.schemaName) {
		return renderGeneratedMethodTypeBaseName(shape.schemaName);
	}
	if (shape.schemaId) {
		return renderGeneratedMethodTypeBaseName(shape.schemaId.replace(/[^A-Za-z0-9_$]+/g, " "));
	}
	return "GeneratedObject";
}

function reserveNamedObjectName(baseName: string, registry: NamedObjectRegistry): string {
	let candidate = baseName;
	let counter = 2;
	while (registry.usedNames.has(candidate)) {
		candidate = `${baseName}${counter}`;
		counter += 1;
	}
	registry.usedNames.add(candidate);
	return candidate;
}

function getRegisteredNamedObject(shape: Extract<TypeNodeShape, { kind: "object" }>, registry?: NamedObjectRegistry): string | undefined {
	if (!registry) return undefined;
	const key = getNamedObjectRegistryKey(shape);
	return key ? registry.nameByKey.get(key) : undefined;
}
function stripRouteManifestTypeRefs(manifest: ReturnType<typeof generateHttpRouteManifest>) {
	return {
		...manifest,
		routes: manifest.routes.map((route: ReturnType<typeof generateHttpRouteManifest>["routes"][number]) => {
			const {
				argsTypeReference: _argsTypeReference,
				resultTypeReference: _resultTypeReference,
				...rest
			} = route;
			return rest;
		}),
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
	const resultType = renderTypeNode(normalizeEndpointMethodResultType(method, checker, policies), policies, 0);
	return {
		argsTupleType,
		resultType,
		methodGenericArgs: `${argsTupleType}, ${resultType}`,
	};
}

function normalizeEndpointMethodResultType(
	method: RpcAnalysisContext["methods"][number],
	checker: ts.TypeChecker,
	policies: Required<CodecPolicies>,
): TypeNodeShape {
	const callableSignatures = checker.getSignaturesOfType(method.resultType, ts.SignatureKind.Call);
	const signature = callableSignatures[0];
	const resultType = signature
		? checker.getReturnTypeOfSignature(signature)
		: method.resultType;
	return normalizeType(unwrapPromiseLikeType(resultType, checker), checker, policies);
}

function renderInlineSurfaceDefinition(
	entries: Array<{
		methodName: string;
		argsAliasName: string;
		resultAliasName: string;
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
		const descendantEntries = groupEntries.filter((entry) => entry.pathParts.length > pathPrefix.length + 1);
		if (directEntry) {
			if (descendantEntries.length > 0) {
				lines.push(
					`${childIndent}${JSON.stringify(group)}: Object.assign(${renderInlineRpcMethod(directEntry, depth + 1)}, ${renderInlineSurfaceDefinition(descendantEntries, depth + 1, [...pathPrefix, group])}),`,
				);
				continue;
			}
			lines.push(`${childIndent}${JSON.stringify(group)}: ${renderInlineRpcMethod(directEntry, depth + 1)},`);
			continue;
		}
		lines.push(`${childIndent}${JSON.stringify(group)}: ${renderInlineSurfaceDefinition(descendantEntries, depth + 1, [...pathPrefix, group])},`);
	}
	lines.push(`${indent}}`);
	return lines.join("\n");
}

function renderInlineMethodTypeAliases(entries: Array<{
	methodName: string;
	argsAliasName: string;
	resultAliasName: string;
	argsTypeReference: string;
	resultTypeReference: string;
	argsShape: TypeNodeShape;
}>, policies: Required<CodecPolicies>): string {
	return entries
		.flatMap((entry) => [
			renderPublicArgsAlias(entry.argsAliasName, entry.argsShape, entry.argsTypeReference, policies),
			`export type ${entry.resultAliasName} = ${entry.resultTypeReference};`,
		])
		.join("\n");
}

function renderPublicArgsAlias(
	argsAliasName: string,
	argsShape: TypeNodeShape,
	argsTypeReference: string,
	policies: Required<CodecPolicies>,
): string {
	if (argsShape.kind === "tuple" && argsShape.elements.length === 1) {
		return `export type ${argsAliasName} = ${renderTypeNode(argsShape.elements[0]!, policies, 0)};`;
	}

	return `export type ${argsAliasName} = ${argsTypeReference};`;
}

function renderInlineRpcMethod(entry: {
	methodName: string;
	argsAliasName: string;
	resultAliasName: string;
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
		`defineRpcMethodRef(async function ${methodIdentifier}(${entry.signature}): Promise<${entry.resultAliasName}> {`,
		`${childIndent}const methodRef = ${methodIdentifier} as RpcMethodRefFromCallable<${callableType}>;`,
		`${childIndent}const caller = methodRef[NRPC_METHOD_CALLER] as undefined | RpcMethodCallerFromCallable<${callableType}>;`,
		`${childIndent}if (!caller) {`,
		`${childIndent}\tthrow new Error(${JSON.stringify(`${entry.methodName} cannot be invoked directly. Resolve it through your RPC caller.`)});`,
		`${childIndent}}`,
		`${childIndent}return caller(methodRef, ...(${tupleArgs} as Parameters<${callableType}>));`,
		`${indent}})`
	].join("\n");
}

function renderInlineSurfaceMetadataAttachment(
	globalName: string,
	entries: Array<{
		methodName: string;
		argsAliasName: string;
		resultAliasName: string;
		argsTypeReference: string;
		resultTypeReference: string;
		signature: string;
		parameterNames: string[];
		argsShape: TypeNodeShape;
		resultShape: TypeNodeShape;
		pathParts: string[];
	}>,
): string {
	const metadataEntries = entries.map((entry) => {
		const accessor = `${globalName}RpcDefinition${entry.pathParts.map((part) => `[${JSON.stringify(part)}]`).join("")}`;
		return `\t[${accessor}, ${JSON.stringify(entry.methodName)}] as const,`;
	});
	return [
		`const attachGeneratedRpcMethodMetadata = <TMethod extends RpcMethodRef<any[], any>>(target: TMethod, methodName: string): TMethod => {`,
		`\tattachRpcMethodMetadata(target, methodName);`,
		`\twithRpcMethodCodec(target, ${globalName}CodecRegistry(methodName) as RpcMethodCodecFromRef<TMethod>);`,
		`\treturn target;`,
		`};`,
		"",
		`const ${globalName}MethodMetadataEntries = [`,
		...metadataEntries,
		`] as const;`,
		"",
		`for (const [target, methodName] of ${globalName}MethodMetadataEntries) {`,
		`\tattachGeneratedRpcMethodMetadata(target, methodName);`,
		`}`,
	].join("\n");
}

function renderInlineCodecRegistryAttachment(
	globalName: string,
	entries: Array<{
		methodName: string;
		argsAliasName: string;
		resultAliasName: string;
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
			return `\t[${JSON.stringify(entry.methodName)}, { args: ${JSON.stringify(stripCodecShapeMetadata(entry.argsShape))}, result: ${JSON.stringify(stripCodecShapeMetadata(entry.resultShape))} }] as const,`;
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

function stripCodecShapeMetadata(shape: TypeNodeShape): TypeNodeShape {
	switch (shape.kind) {
		case "optional":
			return { ...shape, inner: stripCodecShapeMetadata(shape.inner) };
		case "map":
			return {
				...shape,
				key: stripCodecShapeMetadata(shape.key),
				value: stripCodecShapeMetadata(shape.value),
			};
		case "record":
			return { ...shape, value: stripCodecShapeMetadata(shape.value) };
		case "set":
		case "array":
			return { ...shape, element: stripCodecShapeMetadata(shape.element) };
		case "union":
			return { ...shape, variants: shape.variants.map((variant) => stripCodecShapeMetadata(variant)) };
		case "discriminated-union":
			return {
				...shape,
				variants: shape.variants.map((variant) => ({
					...variant,
					shape: stripCodecShapeMetadata(variant.shape) as Extract<TypeNodeShape, { kind: "object" }>,
				})),
			};
		case "tuple":
			return { ...shape, elements: shape.elements.map((element) => stripCodecShapeMetadata(element)) };
		case "object": {
			const { schemaId: _schemaId, schemaName: _schemaName, ...rest } = shape;
			return {
				...rest,
				properties: shape.properties.map((property) => ({
					...property,
					shape: stripCodecShapeMetadata(property.shape),
				})),
			};
		}
		default:
			return shape;
	}
}

function renderRpcMethodImplementationSignature(
	argsShape: TypeNodeShape,
	parameterNames: string[],
	policies: Required<CodecPolicies>,
	argsAliasName?: string,
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
			const singleArgumentAlias = argsAliasName && argsShape.elements.length === 1;
			const renderedType = argsAliasName
				? singleArgumentAlias
					? argsAliasName
					: `${argsAliasName}[${index}]`
				: canUseOptionalSyntax
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

function renderGeneratedMethodTypeBaseName(methodName: string): string {
	const sanitized = pascalize(methodName).replace(/[^A-Za-z0-9_$]/g, "");
	const prefixed = /^[A-Za-z_$]/.test(sanitized) ? sanitized : `Method${sanitized}`;
	return prefixed.length > 0 ? prefixed : "GeneratedMethod";
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

function renderTypeNode(shape: TypeNodeShape, policies: Required<CodecPolicies>, depth: number, registry?: NamedObjectRegistry): string {
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
			return `${renderTypeNode(shape.inner, policies, depth, registry)} | undefined`;
		case "date":
			return policies.date === "reject" ? "never" : "Date";
		case "map":
			return `Map<${renderTypeNode(shape.key, policies, depth, registry)}, ${renderTypeNode(shape.value, policies, depth, registry)}>`;
		case "record":
			return `Record<string, ${renderTypeNode(shape.value, policies, depth, registry)}>`;
		case "set":
			return `Set<${renderTypeNode(shape.element, policies, depth, registry)}>`;
		case "union":
			return shape.variants.map((variant) => renderTypeNode(variant, policies, depth, registry)).join(" | ");
		case "discriminated-union":
			return shape.variants.map((variant) => renderObjectShape(variant.shape, policies, depth, shape.discriminator, variant.tagValue, registry)).join(" | ");
		case "typed-array":
			return shape.arrayType;
		case "array":
			return `Array<${renderTypeNode(shape.element, policies, depth, registry)}>`;
		case "tuple":
			return `[${shape.elements.map((element) => renderTypeNode(element, policies, depth, registry)).join(", ")}]`;
		case "object":
			return getRegisteredNamedObject(shape, registry) ?? renderObjectShape(shape, policies, depth, undefined, undefined, registry);
	}
	return "unknown";
}


function renderObjectShape(
	shape: Extract<TypeNodeShape, { kind: "object" }>,
	policies: Required<CodecPolicies>,
	depth: number,
	discriminator?: string,
	tagValue?: string | number | boolean,
	registry?: NamedObjectRegistry,
	currentObjectName?: string,
): string {
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
		const propertyShape = optionalShape ? optionalShape.inner : property.shape;
		const namedObject = propertyShape.kind === "object" ? getRegisteredNamedObject(propertyShape, registry) : undefined;
		const typeText = namedObject && namedObject !== currentObjectName
			? namedObject
			: renderTypeNode(propertyShape, policies, depth + 1, registry);
		lines.push(`${childIndent}${propertyName}${optionalShape ? "?" : ""}: ${typeText};`);
	}
	lines.push(`${indent}}`);
	return lines.join("\n");
}

function pascalize(value: string): string {
	return value.replace(/(^|[^a-zA-Z0-9]+)([a-zA-Z0-9])/g, (_match, _sep, chr: string) => chr.toUpperCase());
}
