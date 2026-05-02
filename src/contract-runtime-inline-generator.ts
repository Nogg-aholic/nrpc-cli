import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";

type RuntimeSourceSpec = {
	path: string;
	names: string[];
};

let cachedContractRuntimePrelude: string | undefined;
const require = createRequire(import.meta.url);

const runtimePackageSpecifierBySourcePath: Record<string, string> = {
	"types.ts": "@nogg-aholic/nrpc/types",
	"rpc-method-ref.ts": "@nogg-aholic/nrpc/rpc-method-ref",
	"http-route-runtime.ts": "@nogg-aholic/nrpc/http-route-runtime",
	"encoding.ts": "@nogg-aholic/nrpc/encoding",
	"generated-codec-runtime.ts": "@nogg-aholic/nrpc/generated-codec-runtime",
};

const preludeSourceSpecs: RuntimeSourceSpec[] = [
	{
		path: "types.ts",
		names: ["TypedArrayTypes", "TypedArrayType", "RpcPayloadCodec", "RpcMethodCodec"],
	},
	{
		path: "rpc-method-ref.ts",
		names: ["NRPC_METHOD_REF", "NRPC_METHOD_CODEC", "NRPC_METHOD_CALLER", "RpcMethodCaller", "RpcMethodRefMetadata", "RpcMethodRef"],
	},
	{
		path: "http-route-runtime.ts",
		names: ["HttpProtocolMode", "HttpRouteManifestEntry", "HttpRouteManifest"],
	},
	{
		path: "encoding.ts",
		names: ["getTypedArrayType", "toUint8Array", "createTypedArray"],
	},
	{
		path: "generated-codec-runtime.ts",
		names: [
			"GeneratedCodecLiteral",
			"GeneratedCodecNumericKind",
			"GeneratedCodecPrimitiveKind",
			"GeneratedCodecTypedArrayKind",
			"GeneratedCodecShape",
			"textEncoder",
			"textDecoder",
			"generatedCodecLiteralToPrimitiveShape",
			"isGeneratedCodecTypedArrayInstance",
			"GeneratedCodecWriter",
			"GeneratedCodecReader",
			"writeGeneratedCodecShape",
			"readGeneratedCodecShape",
			"isGeneratedCodecShapeMatch",
			"createGeneratedPayloadCodec",
			"createGeneratedRpcMethodCodec",
		],
	},
];

export function renderInlinedContractRuntimePrelude(): string {
	if (cachedContractRuntimePrelude) {
		return cachedContractRuntimePrelude;
	}

	const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
	const statements = preludeSourceSpecs.flatMap((spec) => extractStatementsForPrelude(spec));
	cachedContractRuntimePrelude = statements
		.map((statement) => printStatementWithoutExports(statement, printer))
		.filter(Boolean)
		.join("\n\n");
	return cachedContractRuntimePrelude;
}

function extractStatementsForPrelude(spec: RuntimeSourceSpec): ts.Statement[] {
	const sourceFiles = loadSourceCandidates(spec.path);
	const statementEntries = new Map<string, Array<{ statement: ts.Statement; sourceFile: ts.SourceFile }>>();

	for (const sourceFile of sourceFiles) {
		for (const statement of sourceFile.statements) {
			const statementName = getStatementName(statement);
			if (!statementName) {
				continue;
			}

			const existing = statementEntries.get(statementName);
			if (existing) {
				existing.push({ statement, sourceFile });
				continue;
			}

			statementEntries.set(statementName, [{ statement, sourceFile }]);
		}
	}

	return spec.names.map((name) => {
		const entries = statementEntries.get(name) ?? [];
		const preferred = entries.find(({ statement, sourceFile }) => statementHasRuntimeImplementation(statement, sourceFile));
		const resolved = preferred ?? entries[0];
		if (!resolved) {
			throw new Error(`Could not find ${name} in any runtime source candidate for ${spec.path}.`);
		}
		return resolved.statement;
	});
}

function loadSourceCandidates(relativeSourcePath: string): ts.SourceFile[] {
	const candidatePaths = resolveSourceCandidates(relativeSourcePath);
	const sourceFiles: ts.SourceFile[] = [];
	for (const candidatePath of candidatePaths) {
		if (!fs.existsSync(candidatePath)) continue;
		sourceFiles.push(ts.createSourceFile(candidatePath, fs.readFileSync(candidatePath, "utf8"), ts.ScriptTarget.Latest, true, scriptKindForPath(candidatePath)));
	}
	if (sourceFiles.length === 0) {
		throw new Error(`Could not locate runtime source for ${relativeSourcePath}.`);
	}
	return sourceFiles;
}

function resolveSourceCandidates(relativeSourcePath: string): string[] {
	const currentFilePath = fileURLToPath(import.meta.url);
	const currentDir = path.dirname(currentFilePath);
	const ext = path.extname(relativeSourcePath);
	const baseName = relativeSourcePath.slice(0, -ext.length);
	const runtimeSpecifier = runtimePackageSpecifierBySourcePath[relativeSourcePath];
	const runtimePackageCandidates = runtimeSpecifier ? resolveRuntimePackageCandidates(runtimeSpecifier) : [];
	const workspaceFallbackCandidates = [
		path.resolve(currentDir, "..", "..", "nRPC", "src", relativeSourcePath),
		path.resolve(currentDir, "..", "..", "nRPC", "dist", baseName + ".d.ts"),
		path.resolve(currentDir, "..", "..", "nRPC", "dist", baseName + ".js"),
	];
	return Array.from(new Set([
		...runtimePackageCandidates,
		...workspaceFallbackCandidates,
	]));
}

function resolveRuntimePackageCandidates(specifier: string): string[] {
	try {
		const resolvedJsPath = require.resolve(specifier);
		return resolvedJsPath.endsWith(".js")
			? [resolvedJsPath.replace(/\.js$/u, ".d.ts"), resolvedJsPath]
			: [resolvedJsPath];
	} catch {
		return [];
	}
}

function statementHasRuntimeImplementation(statement: ts.Statement, sourceFile: ts.SourceFile): boolean {
	if (sourceFile.isDeclarationFile) {
		return false;
	}

	if (ts.isFunctionDeclaration(statement)) {
		return statement.body != null;
	}

	if (ts.isVariableStatement(statement)) {
		return statement.declarationList.declarations.every((declaration) => declaration.initializer != null);
	}

	if (ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement)) {
		return true;
	}

	return false;
}

function scriptKindForPath(filePath: string): ts.ScriptKind {
	if (filePath.endsWith(".d.ts")) return ts.ScriptKind.TS;
	if (filePath.endsWith(".ts")) return ts.ScriptKind.TS;
	if (filePath.endsWith(".js")) return ts.ScriptKind.JS;
	return ts.ScriptKind.Unknown;
}

function getStatementName(statement: ts.Statement): string | undefined {
	if (ts.isTypeAliasDeclaration(statement)) return statement.name.text;
	if (ts.isEnumDeclaration(statement)) return statement.name.text;
	if (ts.isClassDeclaration(statement)) return statement.name?.text;
	if (ts.isFunctionDeclaration(statement)) return statement.name?.text;
	if (ts.isVariableStatement(statement)) {
		if (statement.declarationList.declarations.length !== 1) return undefined;
		const declaration = statement.declarationList.declarations[0];
		return declaration && ts.isIdentifier(declaration.name) ? declaration.name.text : undefined;
	}
	return undefined;
}

function printStatementWithoutExports(statement: ts.Statement, printer: ts.Printer): string {
	const sourceFile = statement.getSourceFile();
	const printed = printer.printNode(ts.EmitHint.Unspecified, statement, sourceFile).trim();
	return printed
		.replace(/^export\s+declare\s+/u, "")
		.replace(/^export\s+/u, "")
		.replace(/^declare\s+/u, "");
}