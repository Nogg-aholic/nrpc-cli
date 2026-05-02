import type * as ts from "typescript";
import {
	collectRpcMethods,
	createProgram,
	defaultPolicies,
	getTypeFromExportedAlias,
	normalizeType,
	type CodecPolicies,
	type TypeNodeShape,
	type VirtualProgramSource,
	unwrapPromiseLikeType,
} from "./codec-generator.js";
import { generateHttpRouteManifest } from "./http-route-generator.js";
import { renderScalarHtml, type RenderScalarHtmlOptions } from "./scalar-html.js";
import type { OpenApiDocument, OpenApiMethodDocs, OpenApiMethodProjection, OpenApiSchema } from "./openapi-types.js";

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
};

export type GenerateOpenApiArtifactsOptions = GenerateOpenApiDocumentOptions & {
	scalar?: RenderScalarHtmlOptions;
};

export type GeneratedOpenApiArtifacts = {
	document: OpenApiDocument;
	html: string;
	projections: OpenApiMethodProjection[];
};

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
	const policies = defaultPolicies(options.policies);
	const program = createProgram({
		entryFile: options.entryFile,
		virtualSources: options.virtualSources,
	});
	const checker = program.getTypeChecker();
	const sourceFile = program.getSourceFile(options.entryFile);
	if (!sourceFile) throw new Error(`Could not load source file ${options.entryFile}`);

	const rootType = getTypeFromExportedAlias(sourceFile, checker, options.rootType);
	const methods = collectRpcMethods(rootType, checker, policies);
	const manifest = generateHttpRouteManifest({
		entryFile: options.entryFile,
		rootType: options.rootType,
		rootPath: options.rootPath,
		basePath: options.basePath,
		protocolMode: "both",
		policies: options.policies,
		virtualSources: options.virtualSources,
	});
	const routeByMethod = new Map(manifest.routes.map((route) => [route.methodName, route]));

	return methods.map((method) => {
		const route = routeByMethod.get(method.methodName);
		if (!route) throw new Error(`No HTTP route found for method ${method.methodName}`);

		const components = new Map<string, OpenApiSchema>();
		const requestShape = method.argsShape.kind === "tuple"
			? tupleToRequestObjectShape(method.parameterNames, method.argsShape)
			: method.argsShape;
		const requestSchema = typeShapeToOpenApiSchema(requestShape, checker, components, policies);
		const responseSchema = typeShapeToOpenApiSchema(
			normalizeType(unwrapPromiseLikeType(method.resultType, checker), checker, policies),
			checker,
			components,
			policies,
		);
		const docs = options.docs?.[method.methodName];

		applyParamDescriptions(requestSchema, docs?.params);

		return {
			methodName: method.methodName,
			httpPath: route.httpPath,
			requestSchema,
			responseSchema,
			requestRequired: method.argsShape.kind === "tuple" && method.argsShape.elements.some((shape) => !isOptionalShape(shape)),
			...(components.size > 0 ? { components: { schemas: Object.fromEntries(components) } } : {}),
			...(docs ? { docs } : {}),
		};
	}).sort((left, right) => left.methodName.localeCompare(right.methodName));
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
				post: {
					operationId: projection.methodName,
					...(projection.docs?.summary ? { summary: projection.docs.summary } : {}),
					...(projection.docs?.description ? { description: projection.docs.description } : {}),
					...(projection.docs?.tags?.length ? { tags: projection.docs.tags } : { tags: inferTags(projection.methodName) }),
					requestBody: {
						required: projection.requestRequired,
						content: {
							"application/json": {
								schema: projection.requestSchema,
							},
						},
					},
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
				},
			},
		])),
		...(Object.keys(componentSchemas).length > 0 ? { components: { schemas: componentSchemas } } : {}),
	};
}

function tupleToRequestObjectShape(parameterNames: readonly string[], tupleShape: Extract<TypeNodeShape, { kind: "tuple" }>): TypeNodeShape {
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
	}
	return {};
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

function mergeComponents(projections: readonly OpenApiMethodProjection[]): Record<string, OpenApiSchema> {
	return Object.assign({}, ...projections.map((projection) => projection.components?.schemas ?? {}));
}