import * as ts from "typescript";

import { collectRpcMethods as collectRpcMethodsInternal, visitRpcMethods as visitRpcMethodsInternal } from "./codec-generator/collect.js";
import { emitReadExpression, emitWriteExpression, renderInlineRpcCodecExpression, renderInlineRpcCodecMethod, renderRpcCodecModule } from "./codec-generator/emit.js";
import { findDiscriminatorProperty, normalizeType } from "./codec-generator/normalize.js";
import { createProgram, defaultPolicies, getTypeFromExportedAlias, unwrapPromiseLikeType } from "./codec-generator/program.js";
import type {
CodecPolicies,
CollectedRpcMethod,
GenerateRpcCodecOptions,
GeneratedRpcSurfaceCodecModule,
GenerateRpcSurfaceCodecOptions,
ProgramInput,
RpcMethodEffects,
SurfaceTraversalOptions,
TypeNodeShape,
VirtualProgramSource,
} from "./codec-generator/types.js";
import { camelize, toModuleRelativeImport } from "./codec-generator/utils.js";

export type {
CodecPolicies,
CollectedRpcMethod,
GenerateRpcCodecOptions,
GeneratedRpcSurfaceCodecModule,
GenerateRpcSurfaceCodecOptions,
ProgramInput,
RpcMethodEffects,
SurfaceTraversalOptions,
TypeNodeShape,
VirtualProgramSource,
};

export {
camelize,
createProgram,
defaultPolicies,
getTypeFromExportedAlias,
normalizeType,
unwrapPromiseLikeType,
};

export function collectRpcMethods(
rootType: ts.Type,
checker: ts.TypeChecker,
policies: Required<CodecPolicies>,
pathParts: string[] = [],
options: { allowedSourceFiles?: readonly string[]; propertyValueTraversal?: "raw" | "stop-primitive-drilldown"; skipMethodPrefixes?: readonly string[]; seenTypeIds?: ReadonlySet<number>; seenMethodNames?: ReadonlySet<string> } = {}
): CollectedRpcMethod[] {
return collectRpcMethodsInternal(rootType, checker, policies, pathParts, options);
}

export function visitRpcMethods(
rootType: ts.Type,
checker: ts.TypeChecker,
policies: Required<CodecPolicies>,
visitor: (method: CollectedRpcMethod) => void,
pathParts: string[] = [],
options: { allowedSourceFiles?: readonly string[]; propertyValueTraversal?: "raw" | "stop-primitive-drilldown"; skipMethodPrefixes?: readonly string[]; seenTypeIds?: ReadonlySet<number>; seenMethodNames?: ReadonlySet<string> } = {}
): void {
visitRpcMethodsInternal(rootType, checker, policies, visitor, pathParts, options);
}

export function generateRpcCodecModule(options: GenerateRpcCodecOptions): string {
const policies = defaultPolicies(options.policies);
const program = createProgram(options.entryFile);
const checker = program.getTypeChecker();
const sourceFile = program.getSourceFile(options.entryFile);
if (!sourceFile) throw new Error(`Could not load source file ${options.entryFile}`);

const argsType = getTypeFromExportedAlias(sourceFile, checker, options.argsType);
const resultType = getTypeFromExportedAlias(sourceFile, checker, options.resultType);
const argsShape = normalizeType(argsType, checker, policies);
const resultShape = normalizeType(resultType, checker, policies);
const sourceImportPath = options.moduleSpecifier ?? toModuleRelativeImport(options.outputImportPath, options.entryFile).replace(/\.ts$/, ".js");
return renderRpcCodecModule({
methodName: options.methodName,
argsTypeReference: options.argsType,
resultTypeReference: options.resultType,
argsShape,
resultShape,
typeImportNames: [options.argsType, options.resultType],
typeImportPath: sourceImportPath,
runtimeImportPath: options.runtimeImportPath ?? "../src/generated-codec-runtime.js"
});
}

export function generateRpcSurfaceCodecModules(options: GenerateRpcSurfaceCodecOptions): GeneratedRpcSurfaceCodecModule[] {
const policies = defaultPolicies(options.policies);
const program = createProgram(options.entryFile);
const checker = program.getTypeChecker();
const sourceFile = program.getSourceFile(options.entryFile);
if (!sourceFile) throw new Error(`Could not load source file ${options.entryFile}`);
const rootType = getTypeFromExportedAlias(sourceFile, checker, options.rootType);
const sourceImportPath = options.moduleSpecifier ?? toModuleRelativeImport(options.outputImportPath, options.entryFile).replace(/\.ts$/, ".js");
return collectRpcMethodsInternal(rootType, checker, policies).map((method) => {
const argsShape = method.argsShape;
const resultShape = normalizeType(unwrapPromiseLikeType(method.resultType, checker), checker, policies);
const rootAccessor = method.path.reduce((expression, part) => `${expression}[${JSON.stringify(part)}]`, options.rootType);
const argsTypeReference = `Parameters<${rootAccessor}>`;
const resultTypeReference = `Awaited<ReturnType<${rootAccessor}>>`;
const code = renderRpcCodecModule({
methodName: method.methodName,
argsTypeReference,
resultTypeReference,
argsShape,
resultShape,
typeImportNames: [options.rootType],
typeImportPath: sourceImportPath,
runtimeImportPath: options.runtimeImportPath ?? "@nogg-aholic/nrpc/generated-codec-runtime"
});
return { methodName: method.methodName, exportBase: camelize(method.methodName), code };
});
}