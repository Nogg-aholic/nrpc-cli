import path from "node:path";
import * as ts from "typescript";

import type { CodecPolicies, ProgramInput } from "./types.js";

function loadCompilerOptions(entryFile: string): ts.CompilerOptions {
	const configPath = ts.findConfigFile(path.dirname(entryFile), ts.sys.fileExists, "tsconfig.json");
	if (!configPath) {
		return {
			target: ts.ScriptTarget.ES2022,
			module: ts.ModuleKind.ESNext,
			moduleResolution: ts.ModuleResolutionKind.Bundler,
			strict: true,
			skipLibCheck: true,
		};
	}

	const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
	if (configFile.error) {
		throw new Error(ts.flattenDiagnosticMessageText(configFile.error.messageText, "\n"));
	}

	const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(configPath), undefined, configPath);
	if (parsed.errors.length > 0) {
		throw new Error(parsed.errors.map((error) => ts.flattenDiagnosticMessageText(error.messageText, "\n")).join("\n"));
	}

	return {
		...parsed.options,
		noEmit: true,
	};
}

export function createProgram(entryFileOrInput: string | ProgramInput): ts.Program {
	const input = typeof entryFileOrInput === "string"
		? { entryFile: entryFileOrInput }
		: entryFileOrInput;
	const compilerOptions = loadCompilerOptions(input.entryFile);
	const defaultHost = ts.createCompilerHost(compilerOptions, true);
	const toCanonicalPath = (value: string) => {
		const normalized = path.normalize(value);
		const canonical = defaultHost.getCanonicalFileName(normalized);
		return ts.sys.useCaseSensitiveFileNames ? canonical : canonical.toLowerCase();
	};
	const virtualSources = new Map((input.virtualSources ?? []).map((source) => [toCanonicalPath(source.filePath), source] as const));
	if (virtualSources.size === 0) {
		return ts.createProgram({
			rootNames: [input.entryFile],
			options: compilerOptions,
		});
	}

	const host: ts.CompilerHost = {
		...defaultHost,
		fileExists(fileName) {
			return virtualSources.has(toCanonicalPath(fileName)) || defaultHost.fileExists(fileName);
		},
		readFile(fileName) {
			const virtualSource = virtualSources.get(toCanonicalPath(fileName));
			if (virtualSource) return virtualSource.content;
			return defaultHost.readFile(fileName);
		},
		getSourceFile(fileName, languageVersionOrOptions, onError, shouldCreateNewSourceFile) {
			const virtualSource = virtualSources.get(toCanonicalPath(fileName));
			if (virtualSource) {
				return ts.createSourceFile(fileName, virtualSource.content, languageVersionOrOptions, true, ts.ScriptKind.TS);
			}
			return defaultHost.getSourceFile(fileName, languageVersionOrOptions, onError, shouldCreateNewSourceFile);
		},
		resolveModuleNames(moduleNames, containingFile, _reusedNames, redirectedReference, options) {
			return moduleNames.map((moduleName) => {
				const resolved = ts.resolveModuleName(moduleName, containingFile, options, {
					fileExists: host.fileExists,
					readFile: host.readFile,
					realpath: defaultHost.realpath,
					directoryExists: defaultHost.directoryExists?.bind(defaultHost),
					getCurrentDirectory: defaultHost.getCurrentDirectory,
					getDirectories: defaultHost.getDirectories?.bind(defaultHost),
				}).resolvedModule;
				return resolved;
			});
		},
	};

	return ts.createProgram({
		rootNames: [input.entryFile],
		options: compilerOptions,
		host,
	});
}

export function defaultPolicies(policies?: CodecPolicies): Required<CodecPolicies> {
	return {
		date: policies?.date ?? "iso-string",
		map: policies?.map ?? "entries",
		set: policies?.set ?? "reject"
	};
}

export function getTypeFromExportedAlias(sourceFile: ts.SourceFile, checker: ts.TypeChecker, name: string): ts.Type {
	for (const statement of sourceFile.statements) {
		if ((ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement)) && statement.name.text === name) {
			return checker.getTypeAtLocation(statement.name);
		}
	}
	throw new Error(`Could not find exported type or interface named ${name}.`);
}

export function unwrapPromiseLikeType(type: ts.Type, checker: ts.TypeChecker): ts.Type {
	const symbolName = type.getSymbol()?.getName() ?? type.aliasSymbol?.getName();
	if (symbolName === "Promise" || symbolName === "PromiseLike" || symbolName === "Thenable") {
		const [inner] = checker.getTypeArguments(type as ts.TypeReference);
		if (inner) return inner;
	}
	return type;
}