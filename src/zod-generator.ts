import * as ts from "typescript";

import {
	analyzeRpcSurface,
	type RpcAnalysisContext,
} from "./http-route-generator.js";
import {
	camelize,
	normalizeType,
	type CodecPolicies,
	type SurfaceTraversalOptions,
	type TypeNodeShape,
	type VirtualProgramSource,
	unwrapPromiseLikeType,
} from "./codec-generator.js";

export type GenerateZodSchemaModuleOptions = {
	entryFile: string;
	rootType: string;
	outputImportPath: string;
	exportName?: string;
	zodImportPath?: string;
	policies?: CodecPolicies;
	virtualSources?: readonly VirtualProgramSource[];
	traversal?: SurfaceTraversalOptions;
};

export type GeneratedZodSchemaModuleResult = {
	code: string;
};

type ZodMethodEntry = {
	methodName: string;
	pathParts: string[];
	inputSchemaName: string;
	resultSchemaName: string;
	inputShape: TypeNodeShape;
	resultShape: TypeNodeShape;
};

type NamedSchemaEntry = {
	name: string;
	shape: Extract<TypeNodeShape, { kind: "object" }>;
};

type NamedSchemaRegistry = {
	entries: NamedSchemaEntry[];
	nameByKey: Map<string, string>;
	usedNames: Set<string>;
};

export function generateZodSchemaModule(
	options: GenerateZodSchemaModuleOptions,
): GeneratedZodSchemaModuleResult {
	const analysis = analyzeRpcSurface(options);
	const exportName = options.exportName ?? `${camelize(options.rootType)}ZodSchemas`;
	const zodImportPath = options.zodImportPath ?? "zod";
	const methodEntries = analysis.methods
		.filter((method) => method.effects.reason !== "property access")
		.map((method) => buildZodMethodEntry(method, analysis))
		.sort((left, right) => left.methodName.localeCompare(right.methodName));
	const namedSchemaRegistry = createNamedSchemaRegistry(methodEntries);

	const code = renderGeneratedZodModule({
		zodImportPath,
		exportName,
		methodEntries,
		namedSchemaRegistry,
	});

	return { code };
}

function buildZodMethodEntry(
	method: RpcAnalysisContext["methods"][number],
	analysis: RpcAnalysisContext,
): ZodMethodEntry {
	const inputShape =
		method.argsShape.kind === "tuple"
			? tupleToRequestObjectShape(method.parameterNames, method.argsShape)
			: method.argsShape;
	const resultShape = normalizeZodMethodResultType(
		method,
		analysis.checker,
		analysis.policies,
	);
	const typeBaseName = renderZodTypeBaseName(method.methodName);

	return {
		methodName: method.methodName,
		pathParts: [...method.path],
		inputSchemaName: `${typeBaseName}InputSchema`,
		resultSchemaName: `${typeBaseName}ResultSchema`,
		inputShape,
		resultShape,
	};
}

function normalizeZodMethodResultType(
	method: RpcAnalysisContext["methods"][number],
	checker: ts.TypeChecker,
	policies: Required<CodecPolicies>,
): TypeNodeShape {
	const callableSignatures = checker.getSignaturesOfType(
		method.resultType,
		ts.SignatureKind.Call,
	);
	const signature = callableSignatures[0];
	const resultType = signature
		? checker.getReturnTypeOfSignature(signature)
		: method.resultType;
	return normalizeType(unwrapPromiseLikeType(resultType, checker), checker, policies);
}

function tupleToRequestObjectShape(
	parameterNames: readonly string[],
	tupleShape: Extract<TypeNodeShape, { kind: "tuple" }>,
): TypeNodeShape {
	if (tupleShape.elements.length === 1) {
		return tupleShape.elements[0] ?? { kind: "object", properties: [] };
	}

	return {
		kind: "object",
		properties: tupleShape.elements.map((shape, index) => ({
			name: parameterNames[index] ?? `arg${index}`,
			shape,
		})),
	};
}

function renderGeneratedZodModule(input: {
	zodImportPath: string;
	exportName: string;
	methodEntries: ZodMethodEntry[];
	namedSchemaRegistry: NamedSchemaRegistry;
}): string {
	const lines = [
		"// AUTO-GENERATED FILE. DO NOT EDIT.",
		`import { z } from ${JSON.stringify(input.zodImportPath)};`,
		"",
		...renderNamedSchemaDeclarations(input.namedSchemaRegistry),
		...(input.namedSchemaRegistry.entries.length > 0 ? [""] : []),
		...input.methodEntries.flatMap((entry) => [
			`export const ${entry.inputSchemaName} = ${renderZodExpression(entry.inputShape, input.namedSchemaRegistry)};`,
			`export const ${entry.resultSchemaName} = ${renderZodExpression(entry.resultShape, input.namedSchemaRegistry)};`,
			"",
		]),
		`export const ${input.exportName} = ${renderSchemaTree(input.methodEntries)} as const;`,
		"",
		`export const ${input.exportName}Map = new Map([`,
		...input.methodEntries.map(
			(entry) =>
				`\t[${JSON.stringify(entry.methodName)}, { input: ${entry.inputSchemaName}, result: ${entry.resultSchemaName} }] as const,`,
		),
		`]) as ReadonlyMap<string, { input: z.ZodTypeAny; result: z.ZodTypeAny }>;`,
		"",
	].filter((line, index, array) => !(line === "" && array[index - 1] === ""));

	return `${lines.join("\n")}\n`;
}

function renderSchemaTree(entries: ZodMethodEntry[]): string {
	return renderSchemaTreeNode(entries, [], 0);
}

function renderSchemaTreeNode(
	entries: ZodMethodEntry[],
	pathPrefix: string[],
	depth: number,
): string {
	const grouped = new Map<string, ZodMethodEntry[]>();
	for (const entry of entries) {
		const segment = entry.pathParts[pathPrefix.length];
		if (!segment) continue;
		const bucket = grouped.get(segment) ?? [];
		bucket.push(entry);
		grouped.set(segment, bucket);
	}

	const indent = "\t".repeat(depth);
	const childIndent = "\t".repeat(depth + 1);
	const lines = ["{"];
	for (const [segment, groupEntries] of [...grouped.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
		const directEntry = groupEntries.find((entry) => entry.pathParts.length === pathPrefix.length + 1);
		if (directEntry) {
			lines.push(
				`${childIndent}${JSON.stringify(segment)}: { input: ${directEntry.inputSchemaName}, result: ${directEntry.resultSchemaName} },`,
			);
			continue;
		}

		const nested = renderSchemaTreeNode(groupEntries, [...pathPrefix, segment], depth + 1);
		const nestedLines = nested.split("\n");
		const [firstLine, ...restLines] = nestedLines;
		lines.push(`${childIndent}${JSON.stringify(segment)}: ${firstLine}`);
		for (const line of restLines) {
			lines.push(line);
		}
		lines[lines.length - 1] = `${lines[lines.length - 1]},`;
	}
	lines.push(`${indent}}`);
	return lines.join("\n");
}

function createNamedSchemaRegistry(entries: ZodMethodEntry[]): NamedSchemaRegistry {
	const registry: NamedSchemaRegistry = {
		entries: [],
		nameByKey: new Map<string, string>(),
		usedNames: new Set<string>(),
	};

	for (const entry of entries) {
		collectNamedObjectShapes(entry.inputShape, registry);
		collectNamedObjectShapes(entry.resultShape, registry);
	}

	return registry;
}

function collectNamedObjectShapes(shape: TypeNodeShape, registry: NamedSchemaRegistry): void {
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
			const key = getNamedObjectRegistryKey(shape);
			if (key && !registry.nameByKey.has(key)) {
				const name = reserveNamedSchemaName(`${getNamedObjectBaseName(shape)}Schema`, registry);
				registry.nameByKey.set(key, name);
				registry.entries.push({ name, shape });
			}
			for (const property of shape.properties) collectNamedObjectShapes(property.shape, registry);
			return;
		}
		default:
			return;
	}
}

function getNamedObjectRegistryKey(
	shape: Extract<TypeNodeShape, { kind: "object" }>,
): string | undefined {
	return shape.schemaId ?? shape.schemaName;
}

function getNamedObjectBaseName(
	shape: Extract<TypeNodeShape, { kind: "object" }>,
): string {
	if (shape.schemaName) {
		return renderZodTypeBaseName(shape.schemaName);
	}
	if (shape.schemaId) {
		return renderZodTypeBaseName(shape.schemaId.replace(/[^A-Za-z0-9_$]+/g, " "));
	}
	return "GeneratedObject";
}

function reserveNamedSchemaName(
	baseName: string,
	registry: NamedSchemaRegistry,
): string {
	let candidate = baseName;
	let suffix = 2;
	while (registry.usedNames.has(candidate)) {
		candidate = `${baseName}${suffix}`;
		suffix += 1;
	}
	registry.usedNames.add(candidate);
	return candidate;
}

function renderNamedSchemaDeclarations(registry: NamedSchemaRegistry): string[] {
	return registry.entries.map(
		(entry) =>
			`const ${entry.name}: z.ZodTypeAny = z.lazy(() => ${renderInlineObjectZod(entry.shape, registry)});`,
	);
}

function renderZodExpression(
	shape: TypeNodeShape,
	registry: NamedSchemaRegistry,
	options: {
		discriminator?: string;
		tagValue?: string | number | boolean;
		inlineObject?: boolean;
	} = {},
): string {
	switch (shape.kind) {
		case "primitive":
			return shape.primitive === "string"
				? "z.string()"
				: shape.primitive === "boolean"
					? "z.boolean()"
					: "z.number()";
		case "bigint":
			return "z.bigint()";
		case "unknown":
			return "z.unknown()";
		case "null":
			return "z.null()";
		case "literal":
			return `z.literal(${JSON.stringify(shape.value)})`;
		case "undefined":
			return "z.undefined()";
		case "optional":
			return `${renderZodExpression(shape.inner, registry, options)}.optional()`;
		case "date":
			return shape.policy === "epoch-ms" ? "z.number()" : "z.string()";
		case "map":
			return shape.policy === "object" && shape.key.kind === "primitive" && shape.key.primitive === "string"
				? `z.record(${renderZodExpression(shape.value, registry)})`
				: `z.array(z.tuple([${renderZodExpression(shape.key, registry)}, ${renderZodExpression(shape.value, registry)}]))`;
		case "record":
			return `z.record(${renderZodExpression(shape.value, registry)})`;
		case "set":
			return `z.array(${renderZodExpression(shape.element, registry)})`;
		case "union": {
			const variants = shape.variants.map((variant) => renderZodExpression(variant, registry));
			return variants.length === 1 ? variants[0] ?? "z.unknown()" : `z.union([${variants.join(", ")}])`;
		}
		case "discriminated-union": {
			const variants = shape.variants.map((variant) =>
				renderZodExpression(variant.shape, registry, {
					discriminator: shape.discriminator,
					tagValue: variant.tagValue,
					inlineObject: true,
				}),
			);
			return variants.length === 1
				? variants[0] ?? "z.unknown()"
				: `z.discriminatedUnion(${JSON.stringify(shape.discriminator)}, [${variants.join(", ")}])`;
		}
		case "typed-array":
			return `z.instanceof(${shape.arrayType})`;
		case "array":
			return `z.array(${renderZodExpression(shape.element, registry)})`;
		case "tuple":
			return `z.tuple([${shape.elements.map((element) => renderZodExpression(element, registry)).join(", ")}])`;
		case "object": {
			const key = getNamedObjectRegistryKey(shape);
			if (key && !options.inlineObject) {
				const registered = registry.nameByKey.get(key);
				if (registered) {
					return registered;
				}
			}

			return renderInlineObjectZod(shape, registry, options);
		}
	}
}

function renderInlineObjectZod(
	shape: Extract<TypeNodeShape, { kind: "object" }>,
	registry: NamedSchemaRegistry,
	options: {
		discriminator?: string;
		tagValue?: string | number | boolean;
	} = {},
): string {
	const properties = shape.properties.map((property) => {
		const propertyName = JSON.stringify(property.name);
		if (options.discriminator && property.name === options.discriminator) {
			return `${propertyName}: z.literal(${JSON.stringify(options.tagValue)})`;
		}

		const zodExpression = renderZodExpression(property.shape, registry);
		return `${propertyName}: ${withDescription(zodExpression, property.description)}`;
	});
	return `z.object({ ${properties.join(", ")} })`;
}

function withDescription(expression: string, description: string | undefined): string {
	return description ? `${expression}.describe(${JSON.stringify(description)})` : expression;
}

function renderZodTypeBaseName(value: string): string {
	const words = value
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.replace(/[^A-Za-z0-9_$]+/g, " ")
		.trim()
		.split(/\s+/)
		.filter(Boolean);
	return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join("") || "Generated";
}
