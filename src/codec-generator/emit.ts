import type { RenderInlineRpcCodecMethodOptions, RenderRpcCodecModuleOptions, TypeNodeShape } from "./types.js";
import { camelize } from "./utils.js";

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
			return `${accessor} !== null && typeof ${accessor} === "object" && ${JSON.stringify(shape.discriminator)} in ${accessor}`;
	}
	return "true";
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
		case "map": {
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
		}
		case "record": {
			const recordValueIdentifierName = mapValueIdentifier(accessor);
			return [
				`const __recordEntries = Object.entries(${accessor});`,
				`writer.writeU32(__recordEntries.length);`,
				`for (const [entryKey, ${recordValueIdentifierName}] of __recordEntries) {`,
				`\twriter.writeString(entryKey);`,
				...emitWriteExpression(shape.value, recordValueIdentifierName).map((line) => `\t${line}`),
				`}`
			];
		}
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

export function renderInlineRpcCodecExpression(options: Omit<RenderInlineRpcCodecMethodOptions, "methodRefName" | "codecName">): string {
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