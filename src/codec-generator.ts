import path from "node:path";
import * as ts from "typescript";

export type CodecPolicies = {
	date?: "iso-string" | "epoch-ms" | "reject";
	map?: "entries" | "object" | "reject";
	set?: "array" | "reject";
};

export type GenerateRpcCodecOptions = {
	entryFile: string;
	methodName: string;
	argsType: string;
	resultType: string;
	outputImportPath: string;
	runtimeImportPath?: string;
	moduleSpecifier?: string;
	policies?: CodecPolicies;
};

export type GenerateRpcSurfaceCodecOptions = {
	entryFile: string;
	rootType: string;
	outputImportPath: string;
	moduleSpecifier?: string;
	runtimeImportPath?: string;
	policies?: CodecPolicies;
};

export type VirtualProgramSource = {
	filePath: string;
	content: string;
};

export type ProgramInput = {
	entryFile: string;
	virtualSources?: readonly VirtualProgramSource[];
};

export type GeneratedRpcSurfaceCodecModule = {
	methodName: string;
	exportBase: string;
	code: string;
};

type PrimitiveKind = "string" | "number" | "boolean";
type NumericKind = "f64" | "u32" | "i32";
type TypedArrayKind =
	| "Int8Array"
	| "Uint8Array"
	| "Uint8ClampedArray"
	| "Int16Array"
	| "Uint16Array"
	| "Int32Array"
	| "Uint32Array"
	| "Float32Array"
	| "Float64Array"
	| "BigInt64Array"
	| "BigUint64Array";

export type TypeNodeShape =
	| { kind: "primitive"; primitive: PrimitiveKind; numericKind?: NumericKind }
	| { kind: "bigint" }
	| { kind: "unknown" }
	| { kind: "null" }
	| { kind: "literal"; value: string | number | boolean }
	| { kind: "undefined" }
	| { kind: "optional"; inner: TypeNodeShape }
	| { kind: "date"; policy: NonNullable<CodecPolicies["date"]> }
	| { kind: "map"; key: TypeNodeShape; value: TypeNodeShape; policy: NonNullable<CodecPolicies["map"]> }
	| { kind: "record"; value: TypeNodeShape }
	| { kind: "set"; element: TypeNodeShape; policy: NonNullable<CodecPolicies["set"]> }
	| { kind: "union"; variants: TypeNodeShape[] }
	| {
			kind: "discriminated-union";
			discriminator: string;
			variants: Array<{ tagValue: string | number | boolean; shape: Extract<TypeNodeShape, { kind: "object" }> }>;
	  }
	| { kind: "typed-array"; arrayType: TypedArrayKind }
	| { kind: "array"; element: TypeNodeShape }
	| { kind: "tuple"; elements: TypeNodeShape[] }
	| { kind: "object"; properties: Array<{ name: string; shape: TypeNodeShape; description?: string }> };

const typedArrayNames = new Set<TypedArrayKind>([
	"Int8Array",
	"Uint8Array",
	"Uint8ClampedArray",
	"Int16Array",
	"Uint16Array",
	"Int32Array",
	"Uint32Array",
	"Float32Array",
	"Float64Array",
	"BigInt64Array",
	"BigUint64Array"
]);

export function createProgram(entryFileOrInput: string | ProgramInput): ts.Program {
	const input = typeof entryFileOrInput === "string"
		? { entryFile: entryFileOrInput }
		: entryFileOrInput;
	const compilerOptions: ts.CompilerOptions = {
		target: ts.ScriptTarget.ES2022,
		module: ts.ModuleKind.ESNext,
		moduleResolution: ts.ModuleResolutionKind.Bundler,
		strict: true,
		skipLibCheck: true,
	};
	const defaultHost = ts.createCompilerHost(compilerOptions, true);
	const toCanonicalPath = (value: string) => {
		const normalized = path.normalize(value);
		const canonical = defaultHost.getCanonicalFileName(normalized);
		return ts.sys.useCaseSensitiveFileNames ? canonical : canonical.toLowerCase();
	};
	const virtualSources = new Map((input.virtualSources ?? []).map((source) => [toCanonicalPath(source.filePath), source] as const));
	if (virtualSources.size === 0) {
		return ts.createProgram({
			rootNames: [input.entryFile],
			options: compilerOptions,
		});
	}

	const host: ts.CompilerHost = {
		...defaultHost,
		fileExists(fileName) {
			return virtualSources.has(toCanonicalPath(fileName)) || defaultHost.fileExists(fileName);
		},
		readFile(fileName) {
			const virtualSource = virtualSources.get(toCanonicalPath(fileName));
			if (virtualSource) return virtualSource.content;
			return defaultHost.readFile(fileName);
		},
		getSourceFile(fileName, languageVersionOrOptions, onError, shouldCreateNewSourceFile) {
			const virtualSource = virtualSources.get(toCanonicalPath(fileName));
			if (virtualSource) {
				return ts.createSourceFile(fileName, virtualSource.content, languageVersionOrOptions, true, ts.ScriptKind.TS);
			}
			return defaultHost.getSourceFile(fileName, languageVersionOrOptions, onError, shouldCreateNewSourceFile);
		},
		resolveModuleNames(moduleNames, containingFile, _reusedNames, redirectedReference, options) {
			return moduleNames.map((moduleName) => {
				const resolved = ts.resolveModuleName(moduleName, containingFile, options, {
					fileExists: host.fileExists,
					readFile: host.readFile,
					realpath: defaultHost.realpath,
					directoryExists: defaultHost.directoryExists?.bind(defaultHost),
					getCurrentDirectory: defaultHost.getCurrentDirectory,
					getDirectories: defaultHost.getDirectories?.bind(defaultHost),
				}).resolvedModule;
				return resolved;
			});
		},
	};

	return ts.createProgram({
		rootNames: [input.entryFile],
		options: compilerOptions,
		host,
	});
}

export function defaultPolicies(policies?: CodecPolicies): Required<CodecPolicies> {
	return {
		date: policies?.date ?? "iso-string",
		map: policies?.map ?? "entries",
		set: policies?.set ?? "reject"
	};
}

export function getTypeFromExportedAlias(sourceFile: ts.SourceFile, checker: ts.TypeChecker, name: string): ts.Type {
	for (const statement of sourceFile.statements) {
		if ((ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement)) && statement.name.text === name) {
			return checker.getTypeAtLocation(statement.name);
		}
	}
	throw new Error(`Could not find exported type or interface named ${name}.`);
}

function isIntegerLikeName(name: string): boolean {
	const normalized = name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
	return /(^|_|-)(id|count|index|length|size|offset|version|timestamp|ms)$/.test(normalized);
}

export function normalizeType(type: ts.Type, checker: ts.TypeChecker, policies: Required<CodecPolicies>, propertyName?: string, seen = new Set<number>()): TypeNodeShape {
	type = unwrapPromiseLikeType(type, checker);
	const typeId = typeof (type as ts.Type & { id?: unknown }).id === "number"
		? ((type as ts.Type & { id?: number }).id as number)
		: undefined;
	if (typeId !== undefined) {
		if (seen.has(typeId)) {
			return { kind: "unknown" };
		}
		seen.add(typeId);
	}

	if ((type.flags & ts.TypeFlags.Union) !== 0) {
		const union = type as ts.UnionType;
		const nonUndefined = union.types.filter((entry) => (entry.flags & ts.TypeFlags.Undefined) === 0);
		if (nonUndefined.length === 1 && nonUndefined.length !== union.types.length) {
			return { kind: "optional", inner: normalizeType(nonUndefined[0]!, checker, policies, propertyName, seen) };
		}

		if (union.types.every((entry) => (entry.flags & (ts.TypeFlags.StringLiteral | ts.TypeFlags.NumberLiteral | ts.TypeFlags.BooleanLiteral)) !== 0)) {
			return {
				kind: "union",
				variants: union.types.map((entry) => normalizeType(entry, checker, policies, propertyName, new Set(seen)))
			};
		}

		const normalizedVariants = union.types.map((entry) => normalizeType(entry, checker, policies, propertyName, new Set(seen)));
		const objectVariants = normalizedVariants.filter((entry): entry is Extract<TypeNodeShape, { kind: "object" }> => entry.kind === "object");
		if (objectVariants.length === normalizedVariants.length) {
			const discriminator = findDiscriminator(objectVariants);
			if (discriminator) {
				return {
					kind: "discriminated-union",
					discriminator,
					variants: objectVariants.map((variant) => {
						const property = variant.properties.find((entry) => entry.name === discriminator);
						if (!property || property.shape.kind !== "literal") {
							throw new Error(`Discriminator ${discriminator} must be a literal.`);
						}
						return { tagValue: property.shape.value, shape: variant };
					})
				};
			}
		}

		return { kind: "union", variants: normalizedVariants };
	}

	if ((type.flags & ts.TypeFlags.BigIntLike) !== 0) {
		return { kind: "bigint" };
	}
	if ((type.flags & ts.TypeFlags.Null) !== 0) {
		return { kind: "null" };
	}
	if ((type.flags & ts.TypeFlags.TypeParameter) !== 0) {
		return { kind: "unknown" };
	}
	if ((type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Never)) !== 0) {
		return { kind: "unknown" };
	}
	if ((type.flags & ts.TypeFlags.Undefined) !== 0 || (type.flags & ts.TypeFlags.Void) !== 0) {
		return { kind: "undefined" };
	}
	if ((type.flags & ts.TypeFlags.StringLiteral) !== 0) {
		return { kind: "literal", value: (type as ts.StringLiteralType).value };
	}
	if ((type.flags & ts.TypeFlags.NumberLiteral) !== 0) {
		return { kind: "literal", value: (type as ts.NumberLiteralType).value };
	}
	if ((type.flags & ts.TypeFlags.BooleanLiteral) !== 0) {
		return { kind: "literal", value: checker.typeToString(type) === "true" };
	}
	if (type.isStringLiteral() || (type.flags & ts.TypeFlags.StringLike) !== 0) {
		return { kind: "primitive", primitive: "string" };
	}
	if ((type.flags & ts.TypeFlags.NumberLike) !== 0) {
		return {
			kind: "primitive",
			primitive: "number",
			numericKind: propertyName && isIntegerLikeName(propertyName) ? "u32" : "f64"
		};
	}
	if ((type.flags & ts.TypeFlags.BooleanLike) !== 0) {
		return { kind: "primitive", primitive: "boolean" };
	}

	const symbolName = type.getSymbol()?.getName() ?? type.aliasSymbol?.getName();
	if (symbolName && typedArrayNames.has(symbolName as TypedArrayKind)) {
		return { kind: "typed-array", arrayType: symbolName as TypedArrayKind };
	}
	if (symbolName === "Date") {
		if (policies.date === "reject") throw new Error("Date encountered but date policy is reject.");
		return { kind: "date", policy: policies.date };
	}
	if (symbolName === "Map") {
		if (policies.map === "reject") throw new Error("Map encountered but map policy is reject.");
		const [keyType, valueType] = checker.getTypeArguments(type as ts.TypeReference);
		if (!keyType || !valueType) throw new Error("Map missing key/value types.");
		return {
			kind: "map",
			key: normalizeType(keyType, checker, policies, undefined, new Set(seen)),
			value: normalizeType(valueType, checker, policies, undefined, new Set(seen)),
			policy: policies.map
		};
	}
	if (symbolName === "Set") {
		if (policies.set === "reject") throw new Error("Set encountered but set policy is reject.");
		const [elementType] = checker.getTypeArguments(type as ts.TypeReference);
		if (!elementType) throw new Error("Set missing element type.");
		return { kind: "set", element: normalizeType(elementType, checker, policies, undefined, new Set(seen)), policy: policies.set };
	}

	if (checker.isTupleType(type)) {
		const tuple = type as ts.TupleType;
		const elements = checker.getTypeArguments(tuple as ts.TypeReference);
		return { kind: "tuple", elements: elements.map((entry) => normalizeType(entry, checker, policies, undefined, new Set(seen))) };
	}
	if (checker.isArrayType(type)) {
		const [element] = checker.getTypeArguments(type as ts.TypeReference);
		if (!element) throw new Error("Array type missing element type.");
		return { kind: "array", element: normalizeType(element, checker, policies, propertyName, new Set(seen)) };
	}

	const stringIndexType = checker.getIndexTypeOfType(type, ts.IndexKind.String);
	if (stringIndexType) {
		return {
			kind: "record",
			value: normalizeType(stringIndexType, checker, policies, undefined, new Set(seen)),
		};
	}

	const properties = checker.getPropertiesOfType(type);
	if (properties.length > 0) {
		const normalizedProperties: Array<{ name: string; shape: TypeNodeShape; description?: string }> = [];
		for (const property of properties) {
			const declaration = property.valueDeclaration ?? property.declarations?.[0];
			if (!declaration) throw new Error(`Missing declaration for property ${property.name}.`);
			const propertyType = checker.getTypeOfSymbolAtLocation(property, declaration);
			if (checker.getSignaturesOfType(propertyType, ts.SignatureKind.Call).length > 0) {
				continue;
			}
			const description = getSymbolDescription(property, checker);
			normalizedProperties.push({
				name: property.name,
				shape: normalizeType(propertyType, checker, policies, property.name, new Set(seen)),
				...(description ? { description } : {}),
			});
		}
		return {
			kind: "object",
			properties: normalizedProperties
		};
	}

	throw new Error(`Unsupported type for codec generation: ${checker.typeToString(type)}`);
}

function getSymbolDescription(symbol: ts.Symbol, checker: ts.TypeChecker): string | undefined {
	const text = ts.displayPartsToString(symbol.getDocumentationComment(checker)).trim();
	return text.length > 0 ? text : undefined;
}

function findDiscriminator(variants: Array<Extract<TypeNodeShape, { kind: "object" }>>): string | undefined {
	const candidates = variants[0]?.properties.map((entry) => entry.name) ?? [];
	for (const name of candidates) {
		const values = variants.map((variant) => variant.properties.find((entry) => entry.name === name)?.shape);
		if (values.every((entry): entry is Extract<TypeNodeShape, { kind: "literal" }> => entry?.kind === "literal")) {
			const distinct = new Set(values.map((entry) => JSON.stringify(entry.value)));
			if (distinct.size === values.length) return name;
		}
	}
	return undefined;
}

export function findDiscriminatorProperty(variants: Array<Extract<TypeNodeShape, { kind: "object" }>>): string | undefined {
	return findDiscriminator(variants);
}

function literalToPrimitiveShape(shape: Extract<TypeNodeShape, { kind: "literal" }>): TypeNodeShape {
	if (typeof shape.value === "string") return { kind: "primitive", primitive: "string" };
	if (typeof shape.value === "number") return { kind: "primitive", primitive: "number", numericKind: Number.isInteger(shape.value) ? "u32" : "f64" };
	return { kind: "primitive", primitive: "boolean" };
}

function sanitizeIdentifier(value: string): string {
	const normalized = value.replace(/[^a-zA-Z0-9_]/g, "_");
	return normalized.length > 0 ? normalized : "value";
}

function loopItemIdentifier(accessor: string): string {
	const base = sanitizeIdentifier(accessor.split(".").at(-1) ?? "entry");
	return `__${base}Item`;
}

function mapValueIdentifier(accessor: string): string {
	const base = sanitizeIdentifier(accessor.split(".").at(-1) ?? "mapValue");
	return `__${base}MapValue`;
}

function unionMatchIdentifier(accessor: string): string {
	return `__matched_${sanitizeIdentifier(accessor)}`;
}

function propertyAccessor(base: string, propertyName: string): string {
	return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(propertyName)
		? `${base}.${propertyName}`
		: `${base}[${JSON.stringify(propertyName)}]`;
}

function propertyKey(propertyName: string): string {
	return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(propertyName)
		? propertyName
		: JSON.stringify(propertyName);
}

export function emitWriteExpression(shape: TypeNodeShape, accessor: string): string[] {
	switch (shape.kind) {
		case "primitive":
			if (shape.primitive === "string") return [`writer.writeString(${accessor});`];
			if (shape.primitive === "number") {
				if (shape.numericKind === "u32") return [`writer.writeU32(${accessor});`];
				if (shape.numericKind === "i32") return [`writer.writeI32(${accessor});`];
				return [`writer.writeF64(${accessor});`];
			}
			return [`writer.writeBool(${accessor});`];
		case "undefined":
			return [];
		case "bigint":
			return [`writer.writeBigInt64(${accessor});`];
		case "unknown":
			return [`writer.writeString(JSON.stringify(${accessor} ?? null));`];
		case "null":
			return [];
		case "literal":
			return emitWriteExpression(literalToPrimitiveShape(shape), accessor);
		case "optional":
			return [
				`writer.writeOptionalMarker(${accessor} !== undefined);`,
				`if (${accessor} !== undefined) {`,
				...emitWriteExpression(shape.inner, accessor).map((line) => `\t${line}`),
				`}`
			];
		case "date":
			return shape.policy === "epoch-ms"
				? [`writer.writeF64(${accessor}.getTime());`]
				: [`writer.writeString(${accessor}.toISOString());`];
		case "map":
			const mapValueIdentifierName = mapValueIdentifier(accessor);
			if (shape.policy === "entries") {
				return [
					`writer.writeU32(${accessor}.size);`,
					`for (const [entryKey, ${mapValueIdentifierName}] of ${accessor}.entries()) {`,
					...emitWriteExpression(shape.key, "entryKey").map((line) => `\t${line}`),
					...emitWriteExpression(shape.value, mapValueIdentifierName).map((line) => `\t${line}`),
					`}`
				];
			}
			return [
				`writer.writeU32(${accessor}.size);`,
				`for (const [entryKey, ${mapValueIdentifierName}] of ${accessor}.entries()) {`,
				`\twriter.writeString(entryKey);`,
				...emitWriteExpression(shape.value, mapValueIdentifierName).map((line) => `\t${line}`),
				`}`
			];
		case "record":
			const recordValueIdentifierName = mapValueIdentifier(accessor);
			return [
				`const __recordEntries = Object.entries(${accessor});`,
				`writer.writeU32(__recordEntries.length);`,
				`for (const [entryKey, ${recordValueIdentifierName}] of __recordEntries) {`,
				`\twriter.writeString(entryKey);`,
				...emitWriteExpression(shape.value, recordValueIdentifierName).map((line) => `\t${line}`),
				`}`
			];
		case "set":
			return [
				`writer.writeU32(${accessor}.size);`,
				`for (const entry of ${accessor}.values()) {`,
				...emitWriteExpression(shape.element, "entry").map((line) => `\t${line}`),
				`}`
			];
		case "union":
			return emitUnionWriteExpression(shape, accessor);
		case "discriminated-union":
			return emitDiscriminatedUnionWriteExpression(shape, accessor);
		case "typed-array":
			return [`writer.writeTypedArray(${accessor});`];
		case "array":
			if (shape.element.kind === "primitive") {
				if (shape.element.primitive === "string") return [`writer.writeStringArray(${accessor});`];
				if (shape.element.primitive === "number") {
					if (shape.element.numericKind === "u32") return [`writer.writeU32Array(${accessor});`];
					if (shape.element.numericKind === "i32") return [`writer.writeI32Array(${accessor});`];
					return [`writer.writeNumberArray(${accessor});`];
				}
				return [`writer.writeBooleanArray(${accessor});`];
			}
			const itemIdentifier = loopItemIdentifier(accessor);
			return [
				`writer.writeU32(${accessor}.length);`,
				`for (const ${itemIdentifier} of ${accessor}) {`,
				...emitWriteExpression(shape.element, itemIdentifier).map((line) => `\t${line}`),
				`}`
			];
		case "tuple":
			return shape.elements.flatMap((element, index) => emitWriteExpression(element, `(${accessor} as any)[${index}]`));
		case "object":
			return shape.properties.flatMap((property) => emitWriteExpression(property.shape, propertyAccessor(accessor, property.name)));
	}
}

export function emitReadExpression(shape: TypeNodeShape): string {
	switch (shape.kind) {
		case "primitive":
			if (shape.primitive === "string") return "reader.readString()";
			if (shape.primitive === "number") {
				if (shape.numericKind === "u32") return "reader.readU32()";
				if (shape.numericKind === "i32") return "reader.readI32()";
				return "reader.readF64()";
			}
			return "reader.readBool()";
		case "undefined":
			return "undefined";
		case "bigint":
			return "reader.readBigInt64()";
		case "unknown":
			return "JSON.parse(reader.readString())";
		case "null":
			return "null";
		case "literal":
			if (typeof shape.value === "string") {
				return `(() => { const value = reader.readString(); if (value !== ${JSON.stringify(shape.value)}) throw new Error('Generated codec literal mismatch.'); return value; })()`;
			}
			if (typeof shape.value === "number") {
				const primitiveShape = literalToPrimitiveShape(shape);
				return `(() => { const value = ${emitReadExpression(primitiveShape)}; if (value !== ${JSON.stringify(shape.value)}) throw new Error('Generated codec literal mismatch.'); return value; })()`;
			}
			return `(() => { const value = reader.readBool(); if (value !== ${String(shape.value)}) throw new Error('Generated codec literal mismatch.'); return value; })()`;
		case "optional":
			return `(reader.readOptionalMarker() ? ${emitReadExpression(shape.inner)} : undefined)`;
		case "date":
			return shape.policy === "epoch-ms" ? "new Date(reader.readF64())" : "new Date(reader.readString())";
		case "map":
			if (shape.policy === "entries") {
				return `(() => { const count = reader.readU32(); const map = new Map(); for (let index = 0; index < count; index += 1) map.set(${emitReadExpression(shape.key)}, ${emitReadExpression(shape.value)}); return map; })()`;
			}
			return `(() => { const count = reader.readU32(); const map = new Map(); for (let index = 0; index < count; index += 1) map.set(reader.readString(), ${emitReadExpression(shape.value)}); return map; })()`;
		case "record":
			return `(() => { const count = reader.readU32(); const value: Record<string, unknown> = {}; for (let index = 0; index < count; index += 1) value[reader.readString()] = ${emitReadExpression(shape.value)}; return value; })()`;
		case "set":
			return `(() => { const count = reader.readU32(); const value = new Set(); for (let index = 0; index < count; index += 1) value.add(${emitReadExpression(shape.element)}); return value; })()`;
		case "union":
			return emitUnionReadExpression(shape);
		case "discriminated-union":
			return emitDiscriminatedUnionReadExpression(shape);
		case "typed-array":
			return "reader.readTypedArray()";
		case "array":
			if (shape.element.kind === "primitive") {
				if (shape.element.primitive === "string") return "reader.readStringArray()";
				if (shape.element.primitive === "number") {
					if (shape.element.numericKind === "u32") return "reader.readU32Array()";
					if (shape.element.numericKind === "i32") return "reader.readI32Array()";
					return "reader.readNumberArray()";
				}
				return "reader.readBooleanArray()";
			}
			return `(() => { const count = reader.readU32(); const values = new Array(count); for (let index = 0; index < count; index += 1) values[index] = ${emitReadExpression(shape.element)}; return values; })()`;
		case "tuple":
			return `[${shape.elements.map((element) => emitReadExpression(element)).join(", ")}]`;
		case "object":
			return `{ ${shape.properties.map((property) => `${propertyKey(property.name)}: ${emitReadExpression(property.shape)}`).join(", ")} }`;
	}
	throw new Error("Unsupported shape.");
}

function emitUnionWriteExpression(shape: Extract<TypeNodeShape, { kind: "union" }>, accessor: string): string[] {
	const matchedIdentifier = unionMatchIdentifier(accessor);
	const lines = [`let ${matchedIdentifier} = false;`];
	shape.variants.forEach((variant, index) => {
		lines.push(`${index === 0 ? "if" : "else if"} (${emitTypeGuard(variant, accessor)}) {`);
		lines.push(`\twriter.writeVariantIndex(${index});`);
		if (variant.kind === "null") {
			// Null is encoded by variant index only.
		} else if (variant.kind === "literal") {
			if (typeof variant.value === "string") {
				lines.push(`\tconst __literalValue = ${accessor} as string;`);
				lines.push(...emitWriteExpression(variant, "__literalValue").map((line) => `\t${line}`));
			} else if (typeof variant.value === "number") {
				lines.push(`\tconst __literalValue = ${accessor} as number;`);
				lines.push(...emitWriteExpression(variant, "__literalValue").map((line) => `\t${line}`));
			} else {
				lines.push(`\tconst __literalValue = ${accessor} as boolean;`);
				lines.push(...emitWriteExpression(variant, "__literalValue").map((line) => `\t${line}`));
			}
		} else {
			lines.push(...emitWriteExpression(variant, accessor).map((line) => `\t${line}`));
		}
		lines.push(`\t${matchedIdentifier} = true;`);
		lines.push("}");
	});
	lines.push(`if (!${matchedIdentifier}) throw new Error('Union value did not match any generated codec variant.');`);
	return lines;
}

function emitUnionReadExpression(shape: Extract<TypeNodeShape, { kind: "union" }>): string {
	return `(() => { switch (reader.readVariantIndex()) { ${shape.variants.map((variant, index) => `case ${index}: return ${emitReadExpression(variant)};`).join(" ")} default: throw new Error('Unknown generated union variant.'); } })()`;
}

function emitDiscriminatedUnionWriteExpression(shape: Extract<TypeNodeShape, { kind: "discriminated-union" }>, accessor: string): string[] {
	const matchedIdentifier = unionMatchIdentifier(`${accessor}_${shape.discriminator}`);
	const lines = [`let ${matchedIdentifier} = false;`];
	shape.variants.forEach((variant, index) => {
		lines.push(`${index === 0 ? "if" : "else if"} (${accessor}.${shape.discriminator} === ${JSON.stringify(variant.tagValue)}) {`);
		lines.push(`\twriter.writeVariantIndex(${index});`);
		lines.push(
			...emitWriteExpression(
				{
					kind: "object",
					properties: variant.shape.properties.filter((property) => property.name !== shape.discriminator)
				},
				accessor
			).map((line) => `\t${line}`)
		);
		lines.push(`\t${matchedIdentifier} = true;`);
		lines.push("}");
	});
	lines.push(`if (!${matchedIdentifier}) throw new Error('Discriminated union value did not match any generated codec variant.');`);
	return lines;
}

function emitDiscriminatedUnionReadExpression(shape: Extract<TypeNodeShape, { kind: "discriminated-union" }>): string {
	return `(() => { switch (reader.readVariantIndex()) { ${shape.variants
		.map((variant, index) => {
			const properties = variant.shape.properties
				.filter((property) => property.name !== shape.discriminator)
				.map((property) => `${property.name}: ${emitReadExpression(property.shape)}`);
			return `case ${index}: return { ${shape.discriminator}: ${JSON.stringify(variant.tagValue)}${properties.length > 0 ? ", " : ""}${properties.join(", ")} };`;
		})
		.join(" ")} default: throw new Error('Unknown generated union variant.'); } })()`;
}

function emitTypeGuard(shape: TypeNodeShape, accessor: string): string {
	switch (shape.kind) {
		case "primitive":
			if (shape.primitive === "number") return `typeof ${accessor} === \"number\"`;
			return `typeof ${accessor} === \"${shape.primitive}\"`;
		case "undefined":
			return `${accessor} === undefined`;
		case "bigint":
			return `typeof ${accessor} === \"bigint\"`;
		case "unknown":
			return "true";
		case "null":
			return `${accessor} === null`;
		case "literal":
			return `${accessor} === ${JSON.stringify(shape.value)}`;
		case "optional":
			return `${accessor} === undefined || (${emitTypeGuard(shape.inner, accessor)})`;
		case "date":
			return `${accessor} instanceof Date`;
		case "map":
			return `${accessor} instanceof Map`;
		case "record":
			return `${accessor} !== null && typeof ${accessor} === "object" && !Array.isArray(${accessor}) && !(${accessor} instanceof Map) && !(${accessor} instanceof Set)`;
		case "set":
			return `${accessor} instanceof Set`;
		case "typed-array":
			return `${accessor} instanceof ${shape.arrayType}`;
		case "array":
			return `Array.isArray(${accessor})`;
		case "tuple":
			return `Array.isArray(${accessor}) && ${accessor}.length === ${shape.elements.length}`;
		case "object":
			return `${accessor} !== null && typeof ${accessor} === \"object\"`;
		case "union":
			return shape.variants.map((variant) => `(${emitTypeGuard(variant, accessor)})`).join(" || ");
		case "discriminated-union":
			return `${accessor} !== null && typeof ${accessor} === \"object\" && ${JSON.stringify(shape.discriminator)} in ${accessor}`;
	}
	return "true";
}

function toModuleRelativeImport(fromFile: string, targetFile: string): string {
	const relative = path.relative(path.dirname(fromFile), targetFile).replace(/\\/g, "/");
	return relative.startsWith(".") ? relative : `./${relative}`;
}

export function generateRpcCodecModule(options: GenerateRpcCodecOptions): string {
	const policies = defaultPolicies(options.policies);
	const program = createProgram(options.entryFile);
	const checker = program.getTypeChecker();
	const sourceFile = program.getSourceFile(options.entryFile);
	if (!sourceFile) throw new Error(`Could not load source file ${options.entryFile}`);

	const argsType = getTypeFromExportedAlias(sourceFile, checker, options.argsType);
	const resultType = getTypeFromExportedAlias(sourceFile, checker, options.resultType);
	const argsShape = normalizeType(argsType, checker, policies);
	const resultShape = normalizeType(resultType, checker, policies);
	const sourceImportPath = options.moduleSpecifier ?? toModuleRelativeImport(options.outputImportPath, options.entryFile).replace(/\.ts$/, ".js");
	return renderRpcCodecModule({
		methodName: options.methodName,
		argsTypeReference: options.argsType,
		resultTypeReference: options.resultType,
		argsShape,
		resultShape,
		typeImportNames: [options.argsType, options.resultType],
		typeImportPath: sourceImportPath,
		runtimeImportPath: options.runtimeImportPath ?? "../src/generated-codec-runtime.js"
	});
}


export function generateRpcSurfaceCodecModules(options: GenerateRpcSurfaceCodecOptions): GeneratedRpcSurfaceCodecModule[] {
	const policies = defaultPolicies(options.policies);
	const program = createProgram(options.entryFile);
	const checker = program.getTypeChecker();
	const sourceFile = program.getSourceFile(options.entryFile);
	if (!sourceFile) throw new Error(`Could not load source file ${options.entryFile}`);
	const rootType = getTypeFromExportedAlias(sourceFile, checker, options.rootType);
	const sourceImportPath = options.moduleSpecifier ?? toModuleRelativeImport(options.outputImportPath, options.entryFile).replace(/\.ts$/, ".js");
	return collectRpcMethods(rootType, checker, policies).map((method) => {
		const argsShape = method.argsShape;
		const resultShape = normalizeType(unwrapPromiseLikeType(method.resultType, checker), checker, policies);
		const rootAccessor = method.path.reduce((expression, part) => `${expression}[${JSON.stringify(part)}]`, options.rootType);
		const argsTypeReference = `Parameters<${rootAccessor}>`;
		const resultTypeReference = `Awaited<ReturnType<${rootAccessor}>>`;
		const code = renderRpcCodecModule({
			methodName: method.methodName,
			argsTypeReference,
			resultTypeReference,
			argsShape,
			resultShape,
			typeImportNames: [options.rootType],
			typeImportPath: sourceImportPath,
			runtimeImportPath: options.runtimeImportPath ?? "@nogg-aholic/nrpc/generated-codec-runtime"
		});
		return { methodName: method.methodName, exportBase: camelize(method.methodName), code };
	});
}

export type RenderRpcCodecModuleOptions = {
	methodName: string;
	argsTypeReference: string;
	resultTypeReference: string;
	argsShape: TypeNodeShape;
	resultShape: TypeNodeShape;
	typeImportNames: string[];
	typeImportPath: string;
	runtimeImportPath: string;
};

export type RenderInlineRpcCodecMethodOptions = Omit<RenderRpcCodecModuleOptions, 'typeImportNames' | 'typeImportPath' | 'runtimeImportPath'> & {
	methodRefName?: string;
	codecName?: string;
};

export function renderRpcCodecModule(options: RenderRpcCodecModuleOptions): string {
	const exportBase = camelize(options.methodName);
	const methodStub = [
		"Object.defineProperties(",
		`\t(async (..._args: ${options.argsTypeReference}) => {`,
		`\t\tthrow new Error(${JSON.stringify(`${options.methodName} cannot be invoked directly. Resolve it through your RPC caller.`)});`,
		`\t}) as RpcMethodRef<${options.argsTypeReference}, ${options.resultTypeReference}>,`,
		"\t{",
		`\t\t__nrpcMethodName: { value: ${JSON.stringify(options.methodName)}, enumerable: false, configurable: false, writable: false },`,
		"\t\t[NRPC_METHOD_REF]: { value: true, enumerable: false, configurable: false, writable: false },",
		"\t}",
		")"
	].join("\n");
	return [
		"// AUTO-GENERATED FILE. DO NOT EDIT.",
		`import { NRPC_METHOD_REF, withRpcMethodCodec, type RpcMethodCodec, type RpcMethodRef, type RpcPayloadCodec } from "@nogg-aholic/nrpc";`,
		`import { GeneratedCodecReader, GeneratedCodecWriter } from \"${options.runtimeImportPath}\";`,
		`import type { ${options.typeImportNames.join(", ")} } from \"${options.typeImportPath}\";`,
		"",
		`const argsCodec: RpcPayloadCodec<${options.argsTypeReference}> = {`,
		"\tencode(value) {",
		"\t\tconst writer = new GeneratedCodecWriter();",
		...emitWriteExpression(options.argsShape, "value").map((line) => `\t\t${line}`),
		"\t\treturn writer.finish();",
		"\t},",
		"\tdecode(data, offset = 0) {",
		"\t\tconst reader = new GeneratedCodecReader(data, offset);",
		`\t\tconst value = ${emitReadExpression(options.argsShape)} as ${options.argsTypeReference};`,
		"\t\treturn [value, reader.offset];",
		"\t}",
		"};",
		"",
		`const resultCodec: RpcPayloadCodec<${options.resultTypeReference}> = {`,
		"\tencode(value) {",
		"\t\tconst writer = new GeneratedCodecWriter();",
		...emitWriteExpression(options.resultShape, "value").map((line) => `\t\t${line}`),
		"\t\treturn writer.finish();",
		"\t},",
		"\tdecode(data, offset = 0) {",
		"\t\tconst reader = new GeneratedCodecReader(data, offset);",
		`\t\tconst value = ${emitReadExpression(options.resultShape)} as ${options.resultTypeReference};`,
		"\t\treturn [value, reader.offset];",
		"\t}",
		"};",
		"",
		`export const ${exportBase}Codec: RpcMethodCodec<${options.argsTypeReference}, ${options.resultTypeReference}> = {`,
		"\targs: argsCodec,",
		"\tresult: resultCodec",
		"};",
		"",
		`export const ${exportBase}MethodRef = withRpcMethodCodec(`,
		...methodStub.split("\n").map((line) => `\t${line}`),
		`\t, ${exportBase}Codec`,
		");",
		""
	].join("\n");
}

export function renderInlineRpcCodecMethod(options: RenderInlineRpcCodecMethodOptions): string {
	const exportBase = camelize(options.methodName);
	const codecName = options.codecName ?? `${exportBase}Codec`;
	const methodRefName = options.methodRefName ?? `${exportBase}MethodRef`;
	const methodStub = [
		"Object.defineProperties(",
		`\t(async (..._args: ${options.argsTypeReference}) => {`,
		`\t\tthrow new Error(${JSON.stringify(`${options.methodName} cannot be invoked directly. Resolve it through your RPC caller.`)});`,
		`\t}) as RpcMethodRef<${options.argsTypeReference}, ${options.resultTypeReference}>,`,
		"\t{",
		`\t\t__nrpcMethodName: { value: ${JSON.stringify(options.methodName)}, enumerable: false, configurable: false, writable: false },`,
		"\t\t[NRPC_METHOD_REF]: { value: true, enumerable: false, configurable: false, writable: false },",
		"\t}",
		")"
	].join("\n");
	return [
		`const ${codecName}: RpcMethodCodec<${options.argsTypeReference}, ${options.resultTypeReference}> = {`,
		"\targs: {",
		"\t\tencode(value) {",
		"\t\t\tconst writer = new GeneratedCodecWriter();",
		...emitWriteExpression(options.argsShape, "value").map((line) => `\t\t\t${line}`),
		"\t\t\treturn writer.finish();",
		"\t\t},",
		"\t\tdecode(data, offset = 0) {",
		"\t\t\tconst reader = new GeneratedCodecReader(data, offset);",
		`\t\t\tconst value = ${emitReadExpression(options.argsShape)} as ${options.argsTypeReference};`,
		"\t\t\treturn [value, reader.offset];",
		"\t\t}",
		"\t},",
		"\tresult: {",
		"\t\tencode(value) {",
		"\t\t\tconst writer = new GeneratedCodecWriter();",
		...emitWriteExpression(options.resultShape, "value").map((line) => `\t\t\t${line}`),
		"\t\t\treturn writer.finish();",
		"\t\t},",
		"\t\tdecode(data, offset = 0) {",
		"\t\t\tconst reader = new GeneratedCodecReader(data, offset);",
		`\t\t\tconst value = ${emitReadExpression(options.resultShape)} as ${options.resultTypeReference};`,
		"\t\t\treturn [value, reader.offset];",
		"\t\t}",
		"\t}",
		"};",
		"",
		`const ${methodRefName} = withRpcMethodCodec(`,
		...methodStub.split("\n").map((line) => `\t${line}`),
		`\t, ${codecName}`,
		");",
	].join("\n");
}

export function renderInlineRpcCodecExpression(options: Omit<RenderInlineRpcCodecMethodOptions, 'methodRefName' | 'codecName'>): string {
	const indentBlock = (text: string, indent: string): string => text.split("\n").map((line) => `${indent}${line}`).join("\n");
	const argsEncode = [
		"encode(value) {",
		"\tconst writer = new GeneratedCodecWriter();",
		...emitWriteExpression(options.argsShape, "value").map((line) => `\t${line}`),
		"\treturn writer.finish();",
		"}"
	].join("\n");
	const argsDecode = [
		"decode(data, offset = 0) {",
		"\tconst reader = new GeneratedCodecReader(data, offset);",
		`\tconst value = ${emitReadExpression(options.argsShape)} as ${options.argsTypeReference};`,
		"\treturn [value, reader.offset];",
		"}"
	].join("\n");
	const resultEncode = [
		"encode(value) {",
		"\tconst writer = new GeneratedCodecWriter();",
		...emitWriteExpression(options.resultShape, "value").map((line) => `\t${line}`),
		"\treturn writer.finish();",
		"}"
	].join("\n");
	const resultDecode = [
		"decode(data, offset = 0) {",
		"\tconst reader = new GeneratedCodecReader(data, offset);",
		`\tconst value = ${emitReadExpression(options.resultShape)} as ${options.resultTypeReference};`,
		"\treturn [value, reader.offset];",
		"}"
	].join("\n");
	const methodCodec = [
		`({`,
		"\targs: {",
		indentBlock(argsEncode, "\t\t\t"),
		"\t\t,",
		indentBlock(argsDecode, "\t\t\t"),
		"\t\t},",
		"\tresult: {",
		indentBlock(resultEncode, "\t\t\t"),
		"\t\t,",
		indentBlock(resultDecode, "\t\t\t"),
		"\t\t}",
		`}) as RpcMethodCodec<${options.argsTypeReference}, ${options.resultTypeReference}>`,
	].join("\n");
	return [
		"Object.defineProperties(",
		`\t(async (..._args: ${options.argsTypeReference}) => {`,
		`\t\tthrow new Error(${JSON.stringify(`${options.methodName} cannot be invoked directly. Resolve it through your RPC caller.`)});`,
		`\t}) as RpcMethodRef<${options.argsTypeReference}, ${options.resultTypeReference}>,`,
		"\t{",
		`\t\t__nrpcMethodName: { value: ${JSON.stringify(options.methodName)}, enumerable: false, configurable: false, writable: false },`,
		"\t\t[NRPC_METHOD_REF]: { value: true, enumerable: false, configurable: false, writable: false },",
		"\t\t[NRPC_METHOD_CODEC]: {",
		"\t\t\tvalue: ",
		indentBlock(methodCodec, "\t\t\t\t"),
		"\t\t\t,",
		"\t\t\tenumerable: false,",
		"\t\t\tconfigurable: false,",
		"\t\t\twritable: false,",
		"\t\t},",
		"\t}",
		")",
	].join("\n");
}

export type CollectedRpcMethod = {
	path: string[];
	methodName: string;
	argsShape: TypeNodeShape;
	parameterNames: string[];
	resultType: ts.Type;
};

function collectDeclaredChildSymbols(symbol: ts.Symbol, checker: ts.TypeChecker): ts.Symbol[] {
	const seen = new Map<string, ts.Symbol>();
	const declarations = symbol.declarations ?? [];
	for (const declaration of declarations) {
		if (ts.isModuleDeclaration(declaration)) {
			const moduleSymbol = checker.getSymbolAtLocation(declaration.name);
			for (const candidate of moduleSymbol?.exports?.values() ?? []) {
				seen.set(candidate.getName(), candidate);
			}
			continue;
		}

		if (ts.isSourceFile(declaration)) {
			const moduleSymbol = checker.getSymbolAtLocation(declaration);
			for (const candidate of moduleSymbol?.exports?.values() ?? []) {
				seen.set(candidate.getName(), candidate);
			}
			continue;
		}

		if (ts.isVariableDeclaration(declaration) || ts.isPropertyDeclaration(declaration) || ts.isPropertySignature(declaration) || ts.isPropertyAssignment(declaration) || ts.isShorthandPropertyAssignment(declaration)) {
			const initializer = ts.isShorthandPropertyAssignment(declaration)
				? declaration.name
				: ts.isVariableDeclaration(declaration) || ts.isPropertyDeclaration(declaration) || ts.isPropertyAssignment(declaration)
					? declaration.initializer
					: undefined;
			if (initializer) {
				const initializerType = checker.getTypeAtLocation(initializer);
				for (const candidate of checker.getPropertiesOfType(initializerType)) {
					seen.set(candidate.getName(), candidate);
				}
			}
			continue;
		}

		if (ts.isTypeLiteralNode(declaration) || ts.isInterfaceDeclaration(declaration)) {
			for (const member of declaration.members) {
				const memberSymbol = member.name ? checker.getSymbolAtLocation(member.name) : undefined;
				if (memberSymbol) {
					seen.set(memberSymbol.getName(), memberSymbol);
				}
			}
		}
	}
	return [...seen.values()];
}

export function collectRpcMethods(
	rootType: ts.Type,
	checker: ts.TypeChecker,
	policies: Required<CodecPolicies>,
	pathParts: string[] = []
): CollectedRpcMethod[] {
	const out: CollectedRpcMethod[] = [];
	const declaredProperties = rootType.getSymbol() ? collectDeclaredChildSymbols(rootType.getSymbol()!, checker) : [];
	const resolvedProperties = checker.getPropertiesOfType(rootType);
	const properties = new Map<string, ts.Symbol>();
	for (const property of declaredProperties) {
		properties.set(property.getName(), property);
	}
	for (const property of resolvedProperties) {
		properties.set(property.getName(), property);
	}
	for (const property of properties.values()) {
		if (property.name === "__nrpcMethodName") continue;
		if (property.name === "then") continue;
		const declaration = property.valueDeclaration ?? property.declarations?.[0];
		if (!declaration) continue;
		if (ts.isPropertySignature(declaration) || ts.isMethodSignature(declaration) || ts.isPropertyDeclaration(declaration) || ts.isMethodDeclaration(declaration) || ts.isVariableDeclaration(declaration)) {
			const declaredTypeNode = declaration.type;
			if (declaredTypeNode && ts.isFunctionTypeNode(declaredTypeNode)) {
				const declaredSignature = checker.getSignatureFromDeclaration(declaredTypeNode);
				if (declaredSignature) {
					const nextPath = [...pathParts, property.name];
					out.push({
						path: nextPath,
						methodName: nextPath.join("."),
						parameterNames: declaredSignature.getParameters().map((parameter, index) => {
							const rawName = parameter.name || `arg${index}`;
							const sanitized = rawName.replace(/[^A-Za-z0-9_$]/g, "_");
							return sanitized.length > 0 ? sanitized : `arg${index}`;
						}),
						argsShape: {
							kind: "tuple",
							elements: declaredSignature.getParameters().map((parameter, index) => {
								const parameterDeclaration = parameter.valueDeclaration ?? parameter.declarations?.[0];
								if (!parameterDeclaration) throw new Error(`Missing declaration for parameter ${parameter.name}.`);
								const parameterType = checker.getTypeOfSymbolAtLocation(parameter, parameterDeclaration);
								const normalized = normalizeType(parameterType, checker, policies, parameter.name);
								const isOptionalParameter = ts.isParameter(parameterDeclaration)
									? !!parameterDeclaration.questionToken || !!parameterDeclaration.initializer || !!parameterDeclaration.dotDotDotToken
									: false;
								return isOptionalParameter && normalized.kind !== "optional"
									? { kind: "optional", inner: normalized }
									: normalized;
							})
						},
						resultType: checker.getReturnTypeOfSignature(declaredSignature)
					});
					continue;
				}
			}
		}
		const propertyType = checker.getTypeOfSymbolAtLocation(property, declaration);
		const nextPath = [...pathParts, property.name];
		const signatures = checker.getSignaturesOfType(propertyType, ts.SignatureKind.Call);
		if (signatures.length > 0) {
			const signature = signatures[0]!;
			try {
				out.push({
					path: nextPath,
					methodName: nextPath.join("."),
					parameterNames: signature.getParameters().map((parameter, index) => {
						const rawName = parameter.name || `arg${index}`;
						const sanitized = rawName.replace(/[^A-Za-z0-9_$]/g, "_");
						return sanitized.length > 0 ? sanitized : `arg${index}`;
					}),
					argsShape: {
						kind: "tuple",
						elements: signature.getParameters().map((parameter, index) => {
							const parameterDeclaration = parameter.valueDeclaration ?? parameter.declarations?.[0];
							if (!parameterDeclaration) throw new Error(`Missing declaration for parameter ${parameter.name}.`);
							const parameterType = checker.getTypeOfSymbolAtLocation(parameter, parameterDeclaration);
							const normalized = normalizeType(parameterType, checker, policies, parameter.name);
							const isOptionalParameter = ts.isParameter(parameterDeclaration)
								? !!parameterDeclaration.questionToken || !!parameterDeclaration.initializer || !!parameterDeclaration.dotDotDotToken
								: false;
							return isOptionalParameter && normalized.kind !== "optional"
								? { kind: "optional", inner: normalized }
								: normalized;
						})
					},
					resultType: checker.getReturnTypeOfSignature(signature)
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				throw new Error(`Failed to collect RPC method ${nextPath.join(".")}: ${message}`);
			}
			continue;
		}
		out.push(...collectRpcMethods(propertyType, checker, policies, nextPath));
	}
	return out;
}

export function unwrapPromiseLikeType(type: ts.Type, checker: ts.TypeChecker): ts.Type {
	const symbolName = type.getSymbol()?.getName() ?? type.aliasSymbol?.getName();
	if (symbolName === "Promise" || symbolName === "PromiseLike" || symbolName === "Thenable") {
		const [inner] = checker.getTypeArguments(type as ts.TypeReference);
		if (inner) return inner;
	}
	return type;
}
export function camelize(value: string): string {
	return value
		.replace(/[^a-zA-Z0-9]+(.)/g, (_match, chr: string) => chr.toUpperCase())
		.replace(/^[A-Z]/, (chr) => chr.toLowerCase());
}
