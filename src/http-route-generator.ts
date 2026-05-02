import type { CodecPolicies, VirtualProgramSource } from "./codec-generator.js";
import { camelize, collectRpcMethods, createProgram, defaultPolicies, getTypeFromExportedAlias } from "./codec-generator.js";
import type { HttpProtocolMode, HttpRouteManifest, HttpRouteManifestEntry } from "@nogg-aholic/nrpc/http-route-runtime";

export type GenerateHttpRouteManifestOptions = {
	entryFile: string;
	rootType: string;
	rootPath?: string[];
	basePath?: string;
	protocolMode?: HttpProtocolMode;
	policies?: CodecPolicies;
	virtualSources?: readonly VirtualProgramSource[];
};

export type GeneratedHttpRouteManifestEntry = HttpRouteManifestEntry;

export type GeneratedHttpRouteManifest = HttpRouteManifest;

export function generateHttpRouteManifest(options: GenerateHttpRouteManifestOptions): GeneratedHttpRouteManifest {
	const policies = defaultPolicies(options.policies);
	const program = createProgram({
		entryFile: options.entryFile,
		virtualSources: options.virtualSources,
	});
	const checker = program.getTypeChecker();
	const sourceFile = program.getSourceFile(options.entryFile);
	if (!sourceFile) throw new Error(`Could not load source file ${options.entryFile}`);
	const rootType = getTypeFromExportedAlias(sourceFile, checker, options.rootType);
	const rootPath = options.rootPath ?? [camelize(options.rootType)];
	const basePath = normalizeBasePath(options.basePath ?? "/");
	const protocolMode = options.protocolMode ?? "binary";
	const methods = collectRpcMethods(rootType, checker, policies);

	return {
		id: rootPath[rootPath.length - 1] ?? camelize(options.rootType),
		rootPath,
		basePath,
		protocolMode,
		routes: methods.map((method) => {
			const trimmedMethodPath = rootPath.length > 0 && method.path[0] === rootPath[rootPath.length - 1]
				? method.path.slice(1)
				: method.path;
			const pathParts = [...rootPath, ...trimmedMethodPath];
			const rootAccessor = method.path.reduce((expression, part) => `${expression}[${JSON.stringify(part)}]`, options.rootType);
			return {
				methodName: method.methodName,
				pathParts,
				httpPath: joinHttpPath(basePath, pathParts),
				codecLookupKey: method.methodName,
				protocolMode,
				argsTypeReference: `Parameters<${rootAccessor}>`,
				resultTypeReference: `Awaited<ReturnType<${rootAccessor}>>`,
			};
		}),
	};
}

function normalizeBasePath(value: string): string {
	const normalized = value.replace(/\\/g, "/").trim();
	if (!normalized || normalized === "/") return "";
	const withLeadingSlash = normalized.startsWith("/") ? normalized : `/${normalized}`;
	return withLeadingSlash.endsWith("/") ? withLeadingSlash.slice(0, -1) : withLeadingSlash;
}

function joinHttpPath(basePath: string, pathParts: string[]): string {
	return `${basePath}/${pathParts.join("/")}`.replace(/\/+/g, "/");
}