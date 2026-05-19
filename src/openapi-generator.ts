import * as ts from "typescript";
import {
	normalizeType,
	type CodecPolicies,
	type CollectedRpcMethod,
	type SurfaceTraversalOptions,
	type TypeNodeShape,
	type VirtualProgramSource,
	visitRpcMethods,
	unwrapPromiseLikeType,
} from "./codec-generator.js";
import { analyzeRpcSurface, createRpcAnalysisScaffold, generateHttpRouteManifest, type RpcAnalysisScaffold } from "./http-route-generator.js";
import { renderScalarHtml, type RenderScalarHtmlOptions } from "./scalar-html.js";
import type { OpenApiDocument, OpenApiHttpMethod, OpenApiMethodDocs, OpenApiMethodProjection, OpenApiOperation, OpenApiSchema } from "./openapi-types.js";

export type GenerateOpenApiDocumentOptions = {
	entryFile: string;
	rootType: string;
	rootPath?: string[];
	basePath?: string;
	title?: string;
	version?: string;
	description?: string;
	policies?: CodecPolicies;
	docs?: Record<string, OpenApiMethodDocs>;
	virtualSources?: readonly VirtualProgramSource[];
	traversal?: SurfaceTraversalOptions;
};

export type GenerateOpenApiArtifactsOptions = GenerateOpenApiDocumentOptions & {
	scalar?: RenderScalarHtmlOptions;
};

export type GeneratedOpenApiArtifacts = {
	document: OpenApiDocument;
	html: string;
	projections: OpenApiMethodProjection[];
};

export type OpenApiDocumentShard = {
	shardKey: string;
	document: OpenApiDocument;
	projections: OpenApiMethodProjection[];
};

export type OpenApiProjectionVisitor = (projection: OpenApiMethodProjection) => void;

export function generateOpenApiDocument(options: GenerateOpenApiDocumentOptions): OpenApiDocument {
	return buildOpenApiDocumentFromProjections(generateOpenApiMethodProjections(options), options);
}

export function generateOpenApiArtifacts(options: GenerateOpenApiArtifactsOptions): GeneratedOpenApiArtifacts {
	const projections = generateOpenApiMethodProjections(options);
	const document = buildOpenApiDocumentFromProjections(projections, options);
	const html = renderScalarHtml(document, {
		pageTitle: options.scalar?.pageTitle ?? options.title ?? document.info.title,
		cdnScriptUrl: options.scalar?.cdnScriptUrl,
		customCss: options.scalar?.customCss,
	});
	return { document, html, projections };
}

export function buildOpenApiMethodDocument(
	projection: OpenApiMethodProjection,
	options: Pick<GenerateOpenApiDocumentOptions, "title" | "version" | "description"> = {},
): OpenApiDocument {
	return buildOpenApiDocumentFromProjections([projection], {
		entryFile: "",
		rootType: "",
		title: options.title ?? projection.methodName,
		version: options.version ?? "1.0.0",
		description: options.description,
	});
}

export function generateOpenApiMethodProjections(options: GenerateOpenApiDocumentOptions): OpenApiMethodProjection[] {
	const analysis = analyzeRpcSurface(options);
	return buildMethodProjections(analysis, options).sort((left, right) => left.methodName.localeCompare(right.methodName));
}

export function generateOpenApiDocumentShards(
	options: GenerateOpenApiDocumentOptions,
	groupBy: (projection: OpenApiMethodProjection) => string = inferNamespaceShardKey,
): OpenApiDocumentShard[] {
	const analysis = analyzeRpcSurface(options);
	const projections = buildMethodProjections(analysis, options).sort((left, right) => left.methodName.localeCompare(right.methodName));
	const shards = new Map<string, OpenApiMethodProjection[]>();

	for (const projection of projections) {
		const shardKey = groupBy(projection);
		const bucket = shards.get(shardKey) ?? [];
		bucket.push(projection);
		shards.set(shardKey, bucket);
	}

	return [...shards.entries()]
		.sort((left, right) => left[0].localeCompare(right[0]))
		.map(([shardKey, shardProjections]) => ({
			shardKey,
			projections: shardProjections,
			document: buildOpenApiDocumentFromProjections(shardProjections, {
				...options,
				title: options.title ? `${options.title} (${shardKey})` : `${options.rootType} API (${shardKey})`,
			}),
		}));
}

export function visitOpenApiMethodProjections(
	options: GenerateOpenApiDocumentOptions,
	visitor: OpenApiProjectionVisitor,
): void {
	const scaffold = createRpcAnalysisScaffold(options);
	visitRpcMethods(scaffold.rootType, scaffold.checker, scaffold.policies, (method) => {
		if (!shouldProjectMethodAsEndpoint(method)) {
			return;
		}
		visitor(buildMethodProjectionFromMethod(method, scaffold, options));
	}, [], {
		allowedSourceFiles: options.traversal?.allowedSourceFiles,
		propertyValueTraversal: options.traversal?.propertyValueTraversal,
		skipMethodPrefixes: options.traversal?.skipMethodPrefixes,
	});
}

export function buildOpenApiDocumentFromProjections(
	projections: readonly OpenApiMethodProjection[],
	options: Pick<GenerateOpenApiDocumentOptions, "title" | "version" | "description" | "entryFile" | "rootType">,
): OpenApiDocument {
	const componentSchemas = mergeComponents(projections);
	const tagNames = [...new Set(projections.flatMap((projection) => projection.docs?.tags ?? inferTags(projection.methodName)))];

	return {
		openapi: "3.1.0",
		info: {
			title: options.title ?? `${options.rootType} API`,
			version: options.version ?? "1.0.0",
			...(options.description ? { description: options.description } : {}),
		},
		...(tagNames.length > 0 ? { tags: tagNames.map((name) => ({ name })) } : {}),
		paths: Object.fromEntries(projections.map((projection) => [
			projection.httpPath,
			{
				[projection.httpMethod]: buildOpenApiOperation(projection),
			},
		])),
		...(Object.keys(componentSchemas).length > 0 ? { components: { schemas: componentSchemas } } : {}),
	};
}

function buildOpenApiOperation(projection: OpenApiMethodProjection): OpenApiOperation {
	return {
		operationId: projection.methodName,
		...(projection.docs?.summary ? { summary: projection.docs.summary } : {}),
		...(projection.docs?.description ? { description: projection.docs.description } : {}),
		...(projection.docs?.tags?.length ? { tags: projection.docs.tags } : { tags: inferTags(projection.methodName) }),
		...(projection.httpMethod === "post" ? {
			requestBody: {
				required: projection.requestRequired,
				content: {
					"application/json": {
						schema: projection.requestSchema,
					},
				},
			},
		} : {}),
		responses: {
			"200": {
				description: projection.docs?.returnsDescription ?? `Result of ${projection.methodName}.`,
				content: {
					"application/json": {
						schema: projection.responseSchema,
					},
				},
			},
		},
	};
}

function tupleToRequestObjectShape(parameterNames: readonly string[], tupleShape: Extract<TypeNodeShape, { kind: "tuple" }>): TypeNodeShape {
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

function typeShapeToOpenApiSchema(
	shape: TypeNodeShape,
	checker: ts.TypeChecker,
	components: Map<string, OpenApiSchema>,
	policies: Required<CodecPolicies>,
): OpenApiSchema {
	switch (shape.kind) {
		case "primitive":
			return { type: shape.primitive === "boolean" ? "boolean" : shape.primitive === "string" ? "string" : "number" };
		case "bigint":
			return { type: "string", title: "bigint" };
		case "unknown":
			return {};
		case "null":
			return { nullable: true };
		case "literal":
			return { enum: [shape.value], type: typeof shape.value === "boolean" ? "boolean" : typeof shape.value === "number" ? "number" : "string" };
		case "undefined":
			return {};
		case "optional": {
			const inner = typeShapeToOpenApiSchema(shape.inner, checker, components, policies);
			return { ...inner, nullable: inner.nullable ?? undefined };
		}
		case "date":
			return shape.policy === "epoch-ms"
				? { type: "number", title: "Date" }
				: { type: "string", title: "Date" };
		case "map":
			if (shape.policy === "object" && shape.key.kind === "primitive" && shape.key.primitive === "string") {
				return {
					type: "object",
					additionalProperties: typeShapeToOpenApiSchema(shape.value, checker, components, policies),
				};
			}
			return {
				type: "array",
				items: {
					type: "object",
					properties: {
						key: typeShapeToOpenApiSchema(shape.key, checker, components, policies),
						value: typeShapeToOpenApiSchema(shape.value, checker, components, policies),
					},
					required: ["key", "value"],
				},
			};
		case "record":
			return {
				type: "object",
				additionalProperties: typeShapeToOpenApiSchema(shape.value, checker, components, policies),
			};
		case "set":
			return { type: "array", items: typeShapeToOpenApiSchema(shape.element, checker, components, policies) };
		case "union":
			return { anyOf: shape.variants.map((variant) => typeShapeToOpenApiSchema(variant, checker, components, policies)) };
		case "discriminated-union":
			return {
				anyOf: shape.variants.map((variant) => typeShapeToOpenApiSchema(variant.shape, checker, components, policies)),
			};
		case "typed-array":
			return { type: "array", items: { type: "number" }, title: shape.arrayType };
		case "array":
			return { type: "array", items: typeShapeToOpenApiSchema(shape.element, checker, components, policies) };
		case "tuple":
			return {
				type: "array",
				items: shape.elements.length > 0 ? { anyOf: shape.elements.map((entry) => typeShapeToOpenApiSchema(entry, checker, components, policies)) } : {},
			};
		case "object": {
			if (shape.schemaId) {
				const componentKey = shape.schemaName ? `${shape.schemaName}_${shape.schemaId}` : shape.schemaId;
				const existing = components.get(componentKey);
				if (existing) {
					return { $ref: `#/components/schemas/${componentKey}` };
				}

				// Seed before descending so self-references and repeated graph nodes resolve via $ref.
				components.set(componentKey, {});
				const objectSchema = buildInlineObjectSchema(shape, checker, components, policies);
				components.set(componentKey, objectSchema);
				return { $ref: `#/components/schemas/${componentKey}` };
			}

			return buildInlineObjectSchema(shape, checker, components, policies);
		}
	}
	return {};
}

function buildInlineObjectSchema(
	shape: Extract<TypeNodeShape, { kind: "object" }>,
	checker: ts.TypeChecker,
	components: Map<string, OpenApiSchema>,
	policies: Required<CodecPolicies>,
): OpenApiSchema {
	const properties = Object.fromEntries(shape.properties.map((property) => {
		const propertySchema = typeShapeToOpenApiSchema(property.shape, checker, components, policies);
		if (property.description && !propertySchema.description) {
			propertySchema.description = property.description;
		}
		return [property.name, propertySchema] as const;
	}));
	const required = shape.properties.filter((property) => !isOptionalShape(property.shape)).map((property) => property.name);
	return {
		type: "object",
		...(Object.keys(properties).length > 0 ? { properties } : {}),
		...(required.length > 0 ? { required } : {}),
	};
}

function isOptionalShape(shape: TypeNodeShape): boolean {
	return shape.kind === "optional" || shape.kind === "undefined";
}

function applyParamDescriptions(schema: OpenApiSchema, paramDocs: Record<string, string> | undefined): void {
	if (!paramDocs || !schema.properties) {
		return;
	}

	for (const [name, description] of Object.entries(paramDocs)) {
		const property = schema.properties[name];
		if (property) {
			property.description = description;
		}
	}
}

function inferTags(methodName: string): string[] {
	const parts = methodName.split(".");
	return parts.length > 1 ? [parts.slice(0, -1).join(".")] : [];
}

function inferNamespaceShardKey(projection: OpenApiMethodProjection): string {
	const parts = projection.methodName.split(".");
	if (parts.length <= 1) {
		return parts[0] ?? "root";
	}

	return parts.join(".");
}

export function getOpenApiProjectionShardKey(projection: OpenApiMethodProjection): string {
	return inferNamespaceShardKey(projection);
}

function mergeComponents(projections: readonly OpenApiMethodProjection[]): Record<string, OpenApiSchema> {
	const merged: Record<string, OpenApiSchema> = {};
	for (const projection of projections) {
		const schemas = projection.components?.schemas;
		if (!schemas) {
			continue;
		}
		for (const [key, schema] of Object.entries(schemas)) {
			merged[key] = schema;
		}
	}
	return merged;
}

function buildMethodProjections(
	analysis: ReturnType<typeof analyzeRpcSurface>,
	options: GenerateOpenApiDocumentOptions,
): OpenApiMethodProjection[] {
	const projections: OpenApiMethodProjection[] = [];

	for (const method of analysis.methods) {
		if (!shouldProjectMethodAsEndpoint(method)) {
			continue;
		}
		projections.push(buildMethodProjectionFromMethod(method, analysis, options));
	}

	return projections;
}

function shouldProjectMethodAsEndpoint(method: CollectedRpcMethod): boolean {
	return method.effects.reason !== "property access";
}

function buildMethodProjectionFromMethod(
	method: CollectedRpcMethod,
	analysis: RpcAnalysisScaffold,
	options: GenerateOpenApiDocumentOptions,
): OpenApiMethodProjection {
	const route = buildGeneratedRoute(method, analysis.rootPath, options.basePath);
	const components = new Map<string, OpenApiSchema>();
	const requestShape = method.argsShape.kind === "tuple"
		? tupleToRequestObjectShape(method.parameterNames, method.argsShape)
		: method.argsShape;
	const requestSchema = typeShapeToOpenApiSchema(requestShape, analysis.checker, components, analysis.policies);
	const responseSchema = typeShapeToOpenApiSchema(
		normalizeOpenApiMethodResultType(method, analysis.checker, analysis.policies),
		analysis.checker,
		components,
		analysis.policies,
	);
	const docs = options.docs?.[method.methodName];

function normalizeOpenApiMethodResultType(
	method: CollectedRpcMethod,
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

	applyParamDescriptions(requestSchema, docs?.params);

	return {
		methodName: method.methodName,
		httpMethod: inferOpenApiHttpMethod(method, responseSchema),
		httpPath: route.httpPath,
		requestSchema,
		responseSchema,
		requestRequired: method.argsShape.kind === "tuple" && method.argsShape.elements.some((shape) => !isOptionalShape(shape)),
		effects: method.effects,
		genericTypeParameters: [...method.genericTypeParameters],
		parameterNames: [...method.parameterNames],
		parameterOptionalFlags: [...method.parameterOptionalFlags],
		parameterRestFlags: [...method.parameterRestFlags],
		parameterTypeTexts: [...method.parameterTypeTexts],
		resultTypeText: method.resultTypeText,
		symbolSemanticFlags: method.symbolSemanticFlags,
		symbolRelations: method.symbolRelations,
		memberAbiFlags: method.memberAbiFlags,
		nodeAbiFlags: method.nodeAbiFlags,
		...(components.size > 0 ? { components: { schemas: Object.fromEntries(components) } } : {}),
		...(docs ? { docs } : {}),
	};
}

function inferOpenApiHttpMethod(method: CollectedRpcMethod, responseSchema: OpenApiSchema): OpenApiHttpMethod {
	const hasInput = method.argsShape.kind !== "tuple" || method.argsShape.elements.length > 0;
	if (hasInput) {
		return "post";
	}

	return isEmptyOutputSchema(responseSchema) ? "post" : "get";
}

function isEmptyOutputSchema(schema: OpenApiSchema): boolean {
	return Object.keys(schema).length === 0;
}

function buildGeneratedRoute(method: CollectedRpcMethod, rootPath: string[], basePath: string | undefined): { httpPath: string } {
	const normalizedBasePath = normalizeOpenApiBasePath(basePath ?? "/");
	const trimmedMethodPath = rootPath.length > 0 && method.path[0] === rootPath[rootPath.length - 1]
		? method.path.slice(1)
		: method.path;
	const pathParts = [...rootPath, ...trimmedMethodPath];
	return {
		httpPath: `${normalizedBasePath}/${pathParts.join("/")}`.replace(/\/+/g, "/"),
	};
}

function normalizeOpenApiBasePath(value: string): string {
	const normalized = value.replace(/\\/g, "/").trim();
	if (!normalized || normalized === "/") return "";
	const withLeadingSlash = normalized.startsWith("/") ? normalized : `/${normalized}`;
	return withLeadingSlash.endsWith("/") ? withLeadingSlash.slice(0, -1) : withLeadingSlash;
}