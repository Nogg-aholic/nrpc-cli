import { renderScalarHtml } from './scalar-html.js';
import type { OpenApiDocument, OpenApiMethodProjection } from './openapi-types.js';

export type GeneratedDocsRuntimeArtifacts = {
	json: {
		openapi: string;
		info: {
			title: string;
			version: string;
			description?: string;
		};
	};
	html: string;
	methods: ReadonlyMap<string, {
		methodName: string;
		httpPath: string;
		requestSchema: unknown;
		responseSchema: unknown;
		requestRequired: boolean;
		components?: {
			schemas: Record<string, unknown>;
		};
		docs?: {
			summary?: string;
			description?: string;
			returnsDescription?: string;
			tags?: string[];
			params?: Record<string, string>;
		};
	}>;
};

export type ResolveGeneratedDocsResponseOptions = {
	method: string;
	requestUrl: URL;
	acceptHeader?: string;
	routeMethodName?: string | null;
	namespacePath: string;
	artifacts: GeneratedDocsRuntimeArtifacts;
	buildMethodTitle?: (methodName: string) => string;
	buildMethodDescription?: (methodName: string) => string;
	methodVersion?: string;
};

export type GeneratedDocsResponse = {
	status: number;
	kind: 'json' | 'html';
	body: unknown;
};

export function resolveGeneratedDocsResponse(
	options: ResolveGeneratedDocsResponseOptions,
): GeneratedDocsResponse | null {
	const normalizedMethod = options.method.toUpperCase();
	if (normalizedMethod !== 'GET') {
		return null;
	}

	const docsJsonPath = `${trimTrailingSlash(options.namespacePath)}/__docs/openapi.json`;
	if (options.requestUrl.pathname === docsJsonPath) {
		return {
			status: 200,
			kind: 'json',
			body: options.artifacts.json,
		};
	}

	const docsHtmlPath = `${trimTrailingSlash(options.namespacePath)}/__docs/scalar`;
	if (options.requestUrl.pathname === docsHtmlPath) {
		return {
			status: 200,
			kind: 'html',
			body: options.artifacts.html,
		};
	}

	if (!options.routeMethodName) {
		return null;
	}

	const projection = options.artifacts.methods.get(options.routeMethodName);
	if (!projection) {
		return {
			status: 404,
			kind: 'json',
			body: { ok: false, error: `No generated docs found for ${options.routeMethodName}.` },
		};
	}

	const document = buildOpenApiMethodDocumentFromProjection(projection as OpenApiMethodProjection, {
		title: options.buildMethodTitle?.(options.routeMethodName) ?? options.routeMethodName,
		version: options.methodVersion ?? options.artifacts.json.info.version,
		description: options.buildMethodDescription?.(options.routeMethodName)
			?? `Generated method documentation for ${options.routeMethodName}.`,
	});

	if (resolveDocsFormat(options.requestUrl, options.acceptHeader) === 'json') {
		return {
			status: 200,
			kind: 'json',
			body: document,
		};
	}

	return {
		status: 200,
		kind: 'html',
		body: renderScalarHtml(document, {
			pageTitle: options.buildMethodTitle?.(options.routeMethodName) ?? options.routeMethodName,
		}),
	};
}

function buildOpenApiMethodDocumentFromProjection(
	projection: OpenApiMethodProjection,
	options: { title: string; version: string; description?: string },
): OpenApiDocument {
	const tagNames = projection.docs?.tags?.length
		? projection.docs.tags
		: inferTags(projection.methodName);

	return {
		openapi: '3.1.0',
		info: {
			title: options.title,
			version: options.version,
			...(options.description ? { description: options.description } : {}),
		},
		...(tagNames.length > 0 ? { tags: tagNames.map((name) => ({ name })) } : {}),
		paths: {
			[projection.httpPath]: {
				post: {
					operationId: projection.methodName,
					...(projection.docs?.summary ? { summary: projection.docs.summary } : {}),
					...(projection.docs?.description ? { description: projection.docs.description } : {}),
					...(projection.docs?.tags?.length ? { tags: projection.docs.tags } : { tags: inferTags(projection.methodName) }),
					requestBody: {
						required: projection.requestRequired,
						content: {
							'application/json': {
								schema: projection.requestSchema,
							},
						},
					},
					responses: {
						'200': {
							description: projection.docs?.returnsDescription ?? `Result of ${projection.methodName}.`,
							content: {
								'application/json': {
									schema: projection.responseSchema,
								},
							},
						},
					},
				},
			},
		},
		...(projection.components?.schemas ? { components: { schemas: projection.components.schemas } } : {}),
	};
}

function inferTags(methodName: string): string[] {
	const firstDot = methodName.indexOf('.');
	if (firstDot <= 0) {
		return ['rpc'];
	}
	return [methodName.slice(0, firstDot)];
}

function resolveDocsFormat(requestUrl: URL, acceptHeader: string | undefined): 'json' | 'html' {
	const explicit = requestUrl.searchParams.get('__docs')?.toLowerCase();
	if (explicit === 'json') return 'json';
	if (explicit === 'html') return 'html';
	if (acceptHeader?.includes('application/vnd.nrpc.openapi+json')) return 'json';
	return 'html';
}

function trimTrailingSlash(value: string): string {
	return value.endsWith('/') ? value.slice(0, -1) : value;
}