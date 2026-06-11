import * as ts from "typescript";

import { unwrapPromiseLikeType } from "./program.js";
import type { CodecPolicies, TypeNodeShape } from "./types.js";

const typedArrayNames = new Set([
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

const arrayLikeTypeNames = new Set([
	"Array",
	"ReadonlyArray",
	"NodeArray",
	"SortedArray",
	"SortedReadonlyArray",
]);

const maxLiteralUnionVariants = 24;

function isIntegerLikeName(name: string): boolean {
	const normalized = name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
	return /(^|_|-)(id|count|index|length|size|offset|version|timestamp|ms)$/.test(normalized);
}

function getSymbolDescription(symbol: ts.Symbol, checker: ts.TypeChecker): string | undefined {
	const text = ts.displayPartsToString(symbol.getDocumentationComment(checker)).trim();
	return text.length > 0 ? text : undefined;
}

function isEscapedCompilerPropertyName(name: string): boolean {
	return /^__@.+@\d+$/.test(name);
}

function getTypeSchemaName(type: ts.Type, checker: ts.TypeChecker): string | undefined {
	const symbolName = type.aliasSymbol?.getName() ?? type.getSymbol()?.getName();
	if (symbolName && symbolName !== "__type" && symbolName !== "__object") {
		return symbolName.replace(/[^A-Za-z0-9_]/g, "_");
	}

	const text = checker.typeToString(type, undefined, ts.TypeFormatFlags.NoTruncation);
	const compact = text.replace(/\s+/g, " ").trim();
	if (!compact || compact.includes("=>") || compact.length > 120) {
		return undefined;
	}

	return compact.replace(/[^A-Za-z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "") || undefined;
}

function getArrayLikeElementType(type: ts.Type, checker: ts.TypeChecker): ts.Type | undefined {
	if (checker.isTupleType(type)) {
		return undefined;
	}

	if (checker.isArrayType(type)) {
		const [element] = checker.getTypeArguments(type as ts.TypeReference);
		return element;
	}

	const symbolName = type.getSymbol()?.getName() ?? type.aliasSymbol?.getName();
	if (!symbolName || !arrayLikeTypeNames.has(symbolName)) {
		return undefined;
	}

	const [element] = checker.getTypeArguments(type as ts.TypeReference);
	return element;
}

function collapseLargeLiteralUnion(union: ts.UnionType): TypeNodeShape | undefined {
	if (union.types.every((entry) => (entry.flags & ts.TypeFlags.BooleanLiteral) !== 0)) {
		return { kind: "primitive", primitive: "boolean" };
	}

	if (union.types.length <= maxLiteralUnionVariants) {
		return undefined;
	}

	if (union.types.every((entry) => (entry.flags & ts.TypeFlags.StringLiteral) !== 0)) {
		return { kind: "primitive", primitive: "string" };
	}

	if (union.types.every((entry) => (entry.flags & ts.TypeFlags.NumberLiteral) !== 0)) {
		return { kind: "primitive", primitive: "number", numericKind: "f64" };
	}

	return undefined;
}

function normalizeUnionMembers(
	members: readonly ts.Type[],
	checker: ts.TypeChecker,
	policies: Required<CodecPolicies>,
	propertyName: string | undefined,
	context: NormalizeContext,
): TypeNodeShape {
	const syntheticUnion = { types: [...members] } as ts.UnionType;
	const collapsedLiteralUnion = collapseLargeLiteralUnion(syntheticUnion);
	if (collapsedLiteralUnion) {
		return collapsedLiteralUnion;
	}

	if (members.every((entry) => (entry.flags & (ts.TypeFlags.StringLiteral | ts.TypeFlags.NumberLiteral | ts.TypeFlags.BooleanLiteral)) !== 0)) {
		return {
			kind: "union",
			variants: members.map((entry) => normalizeTypeInternal(entry, checker, policies, propertyName, context))
		};
	}

	const normalizedVariants = members.map((entry) => normalizeTypeInternal(entry, checker, policies, propertyName, context));
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

type NormalizeContext = {
	activeTypeIds: Set<number>;
	cache: Map<number, TypeNodeShape>;
};

function createNormalizeContext(): NormalizeContext {
	return {
		activeTypeIds: new Set<number>(),
		cache: new Map<number, TypeNodeShape>(),
	};
}

const checkerToIdMap = new WeakMap<ts.TypeChecker, Map<number, number>>();

function getDeterministicTypeId(typeId: number, checker: ts.TypeChecker): number {
	let idMap = checkerToIdMap.get(checker);
	if (!idMap) {
		idMap = new Map<number, number>();
		checkerToIdMap.set(checker, idMap);
	}
	let detId = idMap.get(typeId);
	if (detId === undefined) {
		detId = idMap.size + 1;
		idMap.set(typeId, detId);
	}
	return detId;
}

function normalizeTypeInternal(
	type: ts.Type,
	checker: ts.TypeChecker,
	policies: Required<CodecPolicies>,
	propertyName: string | undefined,
	context: NormalizeContext,
): TypeNodeShape {
	type = unwrapPromiseLikeType(type, checker);
	const rawTypeId = typeof (type as ts.Type & { id?: unknown }).id === "number"
		? ((type as ts.Type & { id?: number }).id as number)
		: undefined;
	const typeId = rawTypeId !== undefined ? getDeterministicTypeId(rawTypeId, checker) : undefined;
	const finish = (shape: TypeNodeShape): TypeNodeShape => {
		if (typeId !== undefined) {
			context.cache.set(typeId, shape);
		}
		return shape;
	};
	if (typeId !== undefined) {
		const cached = context.cache.get(typeId);
		if (cached) {
			return cached;
		}
		if (context.activeTypeIds.has(typeId)) {
			return { kind: "unknown" };
		}
		context.activeTypeIds.add(typeId);
	}

	try {
		if ((type.flags & ts.TypeFlags.Union) !== 0) {
			const union = type as ts.UnionType;
			const nonUndefined = union.types.filter((entry) => (entry.flags & ts.TypeFlags.Undefined) === 0);
			if (nonUndefined.length !== union.types.length) {
				if (nonUndefined.length === 0) {
					return finish({ kind: "undefined" });
				}
				return finish({
					kind: "optional",
					inner: normalizeUnionMembers(nonUndefined, checker, policies, propertyName, context),
				});
			}

			return finish(normalizeUnionMembers(union.types, checker, policies, propertyName, context));
		}

		if ((type.flags & ts.TypeFlags.BigIntLike) !== 0) return finish({ kind: "bigint" });
		if ((type.flags & ts.TypeFlags.Null) !== 0) return finish({ kind: "null" });
		if ((type.flags & ts.TypeFlags.TypeParameter) !== 0) return finish({ kind: "unknown" });
		if ((type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Never)) !== 0) return finish({ kind: "unknown" });
		if ((type.flags & ts.TypeFlags.Undefined) !== 0 || (type.flags & ts.TypeFlags.Void) !== 0) return finish({ kind: "undefined" });
		if ((type.flags & ts.TypeFlags.StringLiteral) !== 0) return finish({ kind: "literal", value: (type as ts.StringLiteralType).value });
		if ((type.flags & ts.TypeFlags.NumberLiteral) !== 0) return finish({ kind: "literal", value: (type as ts.NumberLiteralType).value });
		if ((type.flags & ts.TypeFlags.BooleanLiteral) !== 0) return finish({ kind: "literal", value: checker.typeToString(type) === "true" });
		if (type.isStringLiteral() || (type.flags & ts.TypeFlags.StringLike) !== 0) return finish({ kind: "primitive", primitive: "string" });
		if ((type.flags & ts.TypeFlags.NumberLike) !== 0) {
			return finish({
				kind: "primitive",
				primitive: "number",
				numericKind: propertyName && isIntegerLikeName(propertyName) ? "u32" : "f64"
			});
		}
		if ((type.flags & ts.TypeFlags.BooleanLike) !== 0) return finish({ kind: "primitive", primitive: "boolean" });

		const symbolName = type.getSymbol()?.getName() ?? type.aliasSymbol?.getName();
		if (symbolName && typedArrayNames.has(symbolName)) {
			return finish({ kind: "typed-array", arrayType: symbolName as Extract<TypeNodeShape, { kind: "typed-array" }>['arrayType'] });
		}
		if (symbolName === "Date") {
			if (policies.date === "reject") throw new Error("Date encountered but date policy is reject.");
			return finish({ kind: "date", policy: policies.date });
		}
		if (symbolName === "Map") {
			if (policies.map === "reject") throw new Error("Map encountered but map policy is reject.");
			const [keyType, valueType] = checker.getTypeArguments(type as ts.TypeReference);
			if (!keyType || !valueType) throw new Error("Map missing key/value types.");
			return finish({
				kind: "map",
				key: normalizeTypeInternal(keyType, checker, policies, undefined, context),
				value: normalizeTypeInternal(valueType, checker, policies, undefined, context),
				policy: policies.map
			});
		}
		if (symbolName === "Set") {
			if (policies.set === "reject") throw new Error("Set encountered but set policy is reject.");
			const [elementType] = checker.getTypeArguments(type as ts.TypeReference);
			if (!elementType) throw new Error("Set missing element type.");
			return finish({ kind: "set", element: normalizeTypeInternal(elementType, checker, policies, undefined, context), policy: policies.set });
		}

		if (checker.isTupleType(type)) {
			const tuple = type as ts.TupleType;
			const elements = checker.getTypeArguments(tuple as ts.TypeReference);
			return finish({ kind: "tuple", elements: elements.map((entry) => normalizeTypeInternal(entry, checker, policies, undefined, context)) });
		}
		const arrayLikeElementType = getArrayLikeElementType(type, checker);
		if (arrayLikeElementType) {
			return finish({ kind: "array", element: normalizeTypeInternal(arrayLikeElementType, checker, policies, propertyName, context) });
		}

		const stringIndexType = checker.getIndexTypeOfType(type, ts.IndexKind.String);
		if (stringIndexType) {
			return finish({
				kind: "record",
				value: normalizeTypeInternal(stringIndexType, checker, policies, undefined, context),
			});
		}

		const properties = checker.getPropertiesOfType(type);
		if (properties.length > 0) {
			const normalizedProperties: Array<{ name: string; shape: TypeNodeShape; description?: string }> = [];
			for (const property of properties) {
				if (isEscapedCompilerPropertyName(property.name)) {
					continue;
				}
				const declaration = property.valueDeclaration ?? property.declarations?.[0];
				if (!declaration) throw new Error(`Missing declaration for property ${property.name}.`);
				const propertyType = checker.getTypeOfSymbolAtLocation(property, declaration);
				if (checker.getSignaturesOfType(propertyType, ts.SignatureKind.Call).length > 0) {
					continue;
				}
				const description = getSymbolDescription(property, checker);
				normalizedProperties.push({
					name: property.name,
					shape: normalizeTypeInternal(propertyType, checker, policies, property.name, context),
					...(description ? { description } : {}),
				});
			}
			return finish({
				kind: "object",
				properties: normalizedProperties,
				...(typeId !== undefined ? { schemaId: `type-${typeId}` } : {}),
				...(getTypeSchemaName(type, checker) ? { schemaName: getTypeSchemaName(type, checker) } : {}),
			});
		}

		throw new Error(`Unsupported type for codec generation: ${checker.typeToString(type)}`);
	} finally {
		if (typeId !== undefined) {
			context.activeTypeIds.delete(typeId);
		}
	}
}

export function normalizeType(type: ts.Type, checker: ts.TypeChecker, policies: Required<CodecPolicies>, propertyName?: string): TypeNodeShape {
	return normalizeTypeInternal(type, checker, policies, propertyName, createNormalizeContext());
}