import {
	generateOpenApiArtifacts,
	type GenerateOpenApiArtifactsOptions,
} from './openapi-generator.js';
import type { OpenApiDocument, OpenApiMethodProjection } from './openapi-types.js';
export {
	resolveGeneratedDocsResponse,
	type GeneratedDocsResponse,
	type GeneratedDocsRuntimeArtifacts,
	type ResolveGeneratedDocsResponseOptions,
} from './docs-runtime.js';

export type GenerateDocsArtifactsOptions = GenerateOpenApiArtifactsOptions;

export type GeneratedDocsArtifacts = {
	json: OpenApiDocument;
	html: string;
	methods: OpenApiMethodProjection[];
};

export type RenderGeneratedDocsArtifactsModuleOptions = {
	jsonExportName?: string;
	htmlExportName?: string;
	methodsExportName?: string;
};

export function generateDocsArtifacts(options: GenerateDocsArtifactsOptions): GeneratedDocsArtifacts {
	const artifacts = generateOpenApiArtifacts(options);
	return {
		json: artifacts.document,
		html: artifacts.html,
		methods: artifacts.projections,
	};
}

export function renderGeneratedDocsArtifactsModule(
	artifacts: GeneratedDocsArtifacts,
	options: RenderGeneratedDocsArtifactsModuleOptions = {},
): string {
	const jsonExportName = options.jsonExportName ?? 'docsJson';
	const htmlExportName = options.htmlExportName ?? 'docsHtml';
	const methodsExportName = options.methodsExportName ?? 'docsMethods';

	return [
		'// AUTO-GENERATED FILE. DO NOT EDIT.',
		'',
		`export const ${jsonExportName} = ${JSON.stringify(artifacts.json, null, 2)};`,
		'',
		`export const ${htmlExportName} = ${JSON.stringify(artifacts.html)};`,
		'',
		`export const ${methodsExportName} = new Map(${JSON.stringify(artifacts.methods.map((projection) => [projection.methodName, projection]), null, 2)});`,
		'',
	].join('\n');
}
