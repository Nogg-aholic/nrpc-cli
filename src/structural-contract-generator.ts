import * as ts from "typescript";
import { defaultPolicies, normalizeType, unwrapPromiseLikeType, type CodecPolicies, type TypeNodeShape } from "./codec-generator.js";

export interface StructuralContractTree {
	[key: string]: StructuralContractTree | string;
}

export type StructuralContractGeneratorOptions = {
	checker: ts.TypeChecker;
	sourceFile: ts.SourceFile;
	policies?: CodecPolicies;
	methodDeclarationResolver: (symbol: string) => ts.FunctionDeclaration;
};

export function buildStructuralContractTree(symbols: string[], trimLeadingPath = true): StructuralContractTree {
	const root: StructuralContractTree = {};
	for (const symbol of symbols) {
		const parts = symbol.split(".");
		if (trimLeadingPath && parts.length > 1) parts.shift();
		let cursor = root;
		for (let index = 0; index < parts.length - 1; index += 1) {
			const key = parts[index]!;
			const existing = cursor[key];
			if (!existing || typeof existing === "string") {
				cursor[key] = {};
			}
			cursor = cursor[key] as StructuralContractTree;
		}
		cursor[parts[parts.length - 1]!] = symbol;
	}
	return root;
}

export function renderStructuralContractType(typeName: string, tree: StructuralContractTree, options: StructuralContractGeneratorOptions): string {
	return [
		"// AUTO-GENERATED FILE. DO NOT EDIT.",
		`export type ${typeName} = {`,
		...renderStructuralTree(tree, options, 1),
		"};",
		"",
	].join("\n");
}

export function renderMethodStructuralType(symbol: string, options: StructuralContractGeneratorOptions): string {
	const declaration = options.methodDeclarationResolver(symbol);
	const signature = options.checker.getSignatureFromDeclaration(declaration);
	if (!signature) throw new Error(`Missing signature for ${symbol}`);

	const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
	const genericParameters = declaration.typeParameters?.map((parameter) => printer.printNode(ts.EmitHint.Unspecified, parameter, options.sourceFile).trim()) ?? [];
	const parameters = signature.getParameters().map((parameter) => renderParameterStructurally(parameter, options));
	const returnType = renderReturnTypeStructurally(signature, options);
	const typeParameterPrefix = genericParameters.length > 0 ? `<${genericParameters.join(", ")}>` : "";
	return `${typeParameterPrefix}(${parameters.join(", ")}) => ${returnType}`;
}

export function ensureMethodStructurallyRenderable(symbol: string, options: StructuralContractGeneratorOptions): void {
	const declaration = options.methodDeclarationResolver(symbol);
	if (!isDeclarationLikelyCodecSafe(declaration, options.checker)) {
		throw new Error(`Rejected codec-unsafe declaration for ${symbol}`);
	}

	const signature = options.checker.getSignatureFromDeclaration(declaration);
	if (!signature) throw new Error(`Missing signature for ${symbol}`);

	const policies = defaultPolicies(options.policies);
	for (const parameter of signature.getParameters()) {
		const parameterDeclaration = parameter.valueDeclaration ?? parameter.declarations?.[0];
		if (!parameterDeclaration) {
			throw new Error(`Missing declaration for parameter ${parameter.name} in ${symbol}`);
		}
		const parameterType = options.checker.getTypeOfSymbolAtLocation(parameter, parameterDeclaration);
		const parameterShape = normalizeType(parameterType, options.checker, policies, parameter.name);
		assertShapeRenderable(parameterShape, `${symbol} parameter ${parameter.name}`);
	}

	const resultType = options.checker.getReturnTypeOfSignature(signature);
	const resultShape = normalizeType(unwrapPromiseLikeType(resultType, options.checker), options.checker, policies);
	assertShapeRenderable(resultShape, `${symbol} return`);
}

export function isDeclarationLikelyCodecSafe(
	statement: ts.FunctionDeclaration,
	checker: ts.TypeChecker,
	unwrapPromise = false,
	seen = new Set<number>(),
): boolean {
	const signature = checker.getSignatureFromDeclaration(statement);
	if (!signature) return false;
	const declarationSignatures = checker.getSignaturesOfType(checker.getTypeAtLocation(statement.name ?? statement), ts.SignatureKind.Call);
	if (declarationSignatures.length !== 1) return false;
	for (const parameter of signature.getParameters()) {
		const declaration = parameter.valueDeclaration ?? parameter.declarations?.[0];
		if (!declaration) return false;
		const parameterType = checker.getTypeOfSymbolAtLocation(parameter, declaration);
		if (!isTypeLikelyCodecSafe(parameterType, checker, false, seen)) return false;
	}
	const resultType = checker.getReturnTypeOfSignature(signature);
	return isTypeLikelyCodecSafe(resultType, checker, true, seen);
}

export function isTypeLikelyCodecSafe(type: ts.Type, checker: ts.TypeChecker, unwrapPromise = false, seen = new Set<number>()): boolean {
	const typeId = typeof (type as ts.Type & { id?: unknown }).id === "number" ? ((type as ts.Type & { id?: number }).id as number) : undefined;
	if (typeId !== undefined) {
		if (seen.has(typeId)) return true;
		seen.add(typeId);
	}

	if (unwrapPromise) {
		const symbolName = type.getSymbol()?.getName() ?? type.aliasSymbol?.getName();
		if (symbolName === "Promise" || symbolName === "PromiseLike" || symbolName === "Thenable") {
			const [inner] = checker.getTypeArguments(type as ts.TypeReference);
			if (!inner) return false;
			return isTypeLikelyCodecSafe(inner, checker, false, seen);
		}
	}

	if (type.flags & ts.TypeFlags.Never) return false;
	if (type.getCallSignatures().length > 0) return false;
	if (type.flags & ts.TypeFlags.TypeParameter) return true;
	if ((type.flags & ts.TypeFlags.Union) !== 0) {
		return (type as ts.UnionType).types.every((entry) => isTypeLikelyCodecSafe(entry, checker, false, seen));
	}
	if (checker.isArrayType(type) || checker.isTupleType(type)) {
		return checker.getTypeArguments(type as ts.TypeReference).every((entry) => isTypeLikelyCodecSafe(entry, checker, false, seen));
	}

	const properties = checker.getPropertiesOfType(type);
	if (properties.length > 0) {
		for (const property of properties) {
			const declaration = property.valueDeclaration ?? property.declarations?.[0];
			if (!declaration) return false;
			const propertyType = checker.getTypeOfSymbolAtLocation(property, declaration);
			if (checker.getSignaturesOfType(propertyType, ts.SignatureKind.Call).length > 0) continue;
			if (!isTypeLikelyCodecSafe(propertyType, checker, false, seen)) return false;
		}
		return true;
	}

	const text = checker.typeToString(type);
	if (
		text.includes("=>") ||
		text.includes("ProviderResult") ||
		text.includes("Thenable<Thenable") ||
		text.includes("Event<") ||
		/Provider\b/.test(text) ||
		/Handler\b/.test(text) ||
		/Serializer\b/.test(text)
	) {
		return false;
	}
	return true;
}

function renderStructuralTree(tree: StructuralContractTree, options: StructuralContractGeneratorOptions, depth: number): string[] {
	const indent = "  ".repeat(depth);
	return Object.entries(tree)
		.sort(([a], [b]) => a.localeCompare(b))
		.flatMap(([key, value]) => {
			if (typeof value === "string") {
				return [`${indent}${key}: ${renderMethodStructuralType(value, options)};`];
			}
			return [
				`${indent}${key}: {`,
				...renderStructuralTree(value, options, depth + 1),
				`${indent}};`,
			];
		});
}

function renderParameterStructurally(parameter: ts.Symbol, options: StructuralContractGeneratorOptions): string {
	const declaration = parameter.valueDeclaration ?? parameter.declarations?.[0];
	if (!declaration) {
		throw new Error(`Missing declaration for parameter ${parameter.name}.`);
	}
	const parameterType = options.checker.getTypeOfSymbolAtLocation(parameter, declaration);
	const normalized = normalizeType(parameterType, options.checker, defaultPolicies(options.policies), parameter.name);
	const isOptionalParameter = ts.isParameter(declaration)
		? !!declaration.questionToken || !!declaration.dotDotDotToken
		: false;
	const isRest = ts.isParameter(declaration) && !!declaration.dotDotDotToken;
	const prefix = isRest ? "..." : "";
	const suffix = isOptionalParameter && !isRest ? "?" : "";
	const typeText = renderShapeStructurally(normalized, 0);
	return `${prefix}${parameter.name}${suffix}: ${typeText}`;
}

function renderReturnTypeStructurally(signature: ts.Signature, options: StructuralContractGeneratorOptions): string {
	const returnType = unwrapPromiseLikeType(options.checker.getReturnTypeOfSignature(signature), options.checker);
	const normalized = normalizeType(returnType, options.checker, defaultPolicies(options.policies));
	return renderShapeStructurally(normalized, 0);
}

function renderShapeStructurally(shape: TypeNodeShape, depth: number): string {
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
			return `${renderShapeStructurally(shape.inner, depth)} | undefined`;
		case "date":
			return shape.policy === "epoch-ms" ? "number" : "string";
		case "map":
			return shape.policy === "object"
				? `{ [key: string]: ${renderShapeStructurally(shape.value, depth)} }`
				: `Array<[${renderShapeStructurally(shape.key, depth)}, ${renderShapeStructurally(shape.value, depth)}]>`;
		case "set":
			return `Array<${renderShapeStructurally(shape.element, depth)}>`;
		case "union":
			return shape.variants.map((variant) => renderShapeStructurally(variant, depth)).join(" | ");
		case "discriminated-union":
			return shape.variants
				.map((variant) => renderObjectShape(variant.shape, depth, shape.discriminator, variant.tagValue))
				.join(" | ");
		case "typed-array":
			return "Array<number>";
		case "array":
			return `Array<${renderShapeStructurally(shape.element, depth)}>`;
		case "tuple":
			return `[${shape.elements.map((element) => renderShapeStructurally(element, depth)).join(", ")}]`;
		case "object":
			return renderObjectShape(shape, depth);
	}
	return "unknown";
}

function renderObjectShape(
	shape: Extract<TypeNodeShape, { kind: "object" }>,
	depth: number,
	discriminator?: string,
	tagValue?: string | number | boolean,
): string {
	const indent = "  ".repeat(depth);
	const childIndent = "  ".repeat(depth + 1);
	const lines = ["{"];
	for (const property of shape.properties) {
		const propertyName = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(property.name) ? property.name : JSON.stringify(property.name);
		if (discriminator && property.name === discriminator) {
			lines.push(`${childIndent}${propertyName}: ${JSON.stringify(tagValue)};`);
			continue;
		}
		const optionalShape = property.shape.kind === "optional" ? property.shape : undefined;
		const typeText = renderShapeStructurally(optionalShape ? optionalShape.inner : property.shape, depth + 1);
		lines.push(`${childIndent}${propertyName}${optionalShape ? "?" : ""}: ${typeText};`);
	}
	lines.push(`${indent}}`);
	return lines.join("\n");
}

function assertShapeRenderable(shape: TypeNodeShape, context: string): void {
	switch (shape.kind) {
		case "object":
			if (shape.properties.length === 0) {
				throw new Error(`Unsupported type for codec generation: empty object in ${context}`);
			}
			for (const property of shape.properties) {
				assertShapeRenderable(property.shape, `${context}.${property.name}`);
			}
			return;
		case "array":
			assertShapeRenderable(shape.element, `${context}[]`);
			return;
		case "tuple":
			shape.elements.forEach((element, index) => assertShapeRenderable(element, `${context}[${index}]`));
			return;
		case "optional":
			assertShapeRenderable(shape.inner, context);
			return;
		case "union":
			shape.variants.forEach((variant, index) => assertShapeRenderable(variant, `${context}|${index}`));
			return;
		case "discriminated-union":
			shape.variants.forEach((variant, index) => assertShapeRenderable(variant.shape, `${context}#${index}`));
			return;
		case "map":
			assertShapeRenderable(shape.key, `${context}.key`);
			assertShapeRenderable(shape.value, `${context}.value`);
			return;
		case "set":
			assertShapeRenderable(shape.element, `${context}.element`);
			return;
		default:
			return;
	}
}