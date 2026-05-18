import type { CodecPolicies, SurfaceTraversalOptions, VirtualProgramSource } from "./codec-generator.js";
import { camelize, collectRpcMethods, createProgram, defaultPolicies, getTypeFromExportedAlias } from "./codec-generator.js";
import type { HttpProtocolMode, HttpRouteManifest, HttpRouteManifestEntry } from "@nogg-aholic/nrpc/http-route-runtime";

export type RpcAnalysisScaffold = {
	policies: Required<CodecPolicies>;
	program: ReturnType<typeof createProgram>;
	checker: ReturnType<ReturnType<typeof createProgram>["getTypeChecker"]>;
	sourceFile: NonNullable<ReturnType<ReturnType<typeof createProgram>["getSourceFile"]>>;
	rootType: ReturnType<typeof getTypeFromExportedAlias>;
	rootPath: string[];
};

export type RpcAnalysisContext = RpcAnalysisScaffold & {
	methods: ReturnType<typeof collectRpcMethods>;
};

export type GenerateHttpRouteManifestOptions = {
	entryFile: string;
	rootType: string;
	rootPath?: string[];
	basePath?: string;
	protocolMode?: HttpProtocolMode;
	policies?: CodecPolicies;
	virtualSources?: readonly VirtualProgramSource[];
	traversal?: SurfaceTraversalOptions;
};

export type GeneratedHttpRouteManifestEntry = HttpRouteManifestEntry;

export type GeneratedHttpRouteManifest = HttpRouteManifest;

export function createRpcAnalysisScaffold(
	options: Pick<GenerateHttpRouteManifestOptions, "entryFile" | "rootType" | "rootPath" | "policies" | "virtualSources">,
): RpcAnalysisScaffold {
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

	return {
		policies,
		program,
		checker,
		sourceFile,
		rootType,
		rootPath,
	};
}

export function analyzeRpcSurface(
	options: Pick<GenerateHttpRouteManifestOptions, "entryFile" | "rootType" | "rootPath" | "policies" | "virtualSources" | "traversal">,
): RpcAnalysisContext {
	const scaffold = createRpcAnalysisScaffold(options);
	const methods = collectRpcMethods(scaffold.rootType, scaffold.checker, scaffold.policies, [], {
		allowedSourceFiles: options.traversal?.allowedSourceFiles,
		propertyValueTraversal: options.traversal?.propertyValueTraversal,
		skipMethodPrefixes: options.traversal?.skipMethodPrefixes,
	});

	return {
		...scaffold,
		methods,
	};
}

export function generateHttpRouteManifest(options: GenerateHttpRouteManifestOptions): GeneratedHttpRouteManifest {
	const analysis = analyzeRpcSurface(options);
	const basePath = normalizeBasePath(options.basePath ?? "/");
	const protocolMode = options.protocolMode ?? "binary";

	return {
		id: analysis.rootPath[analysis.rootPath.length - 1] ?? camelize(options.rootType),
		rootPath: analysis.rootPath,
		basePath,
		protocolMode,
		routes: analysis.methods.filter((method) => method.effects.reason !== "property access").map((method) => {
			const trimmedMethodPath = analysis.rootPath.length > 0 && method.path[0] === analysis.rootPath[analysis.rootPath.length - 1]
				? method.path.slice(1)
				: method.path;
			const pathParts = [...analysis.rootPath, ...trimmedMethodPath];
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