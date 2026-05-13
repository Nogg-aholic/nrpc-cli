import {
  analyzeRpcSurface,
  type RpcAnalysisScaffold,
} from '../http-route-generator.js';
import {
  normalizeType,
  type CollectedRpcMethod,
  type CodecPolicies,
  type SurfaceTraversalOptions,
  type TypeNodeShape,
  type VirtualProgramSource,
  unwrapPromiseLikeType,
} from '../codec-generator.js';
import ts from 'typescript';
import type { OpenApiMethodDocs } from '../openapi-types.js';
import type { NrpcHttpBinding, NrpcSurfaceManifest, NrpcSurfaceMethodManifest } from './types.js';

export type GenerateNrpcSurfaceManifestOptions = {
  entryFile: string;
  rootType: string;
  rootPath?: string[];
  basePath?: string;
  policies?: CodecPolicies;
  docs?: Record<string, OpenApiMethodDocs>;
  virtualSources?: readonly VirtualProgramSource[];
  traversal?: SurfaceTraversalOptions;
  surfaceName?: string;
};

export function generateNrpcSurfaceManifest(options: GenerateNrpcSurfaceManifestOptions): NrpcSurfaceManifest {
  const analysis = analyzeRpcSurface(options);
  const methods = analysis.methods
    .map((method) => buildNrpcSurfaceMethodManifest(method, analysis, options))
    .sort((left, right) => left.methodName.localeCompare(right.methodName));
  const httpBindings = analysis.methods
    .map((method) => buildNrpcHttpBinding(method, analysis.rootPath, options.basePath))
    .sort((left, right) => left.methodName.localeCompare(right.methodName));

  return {
    version: 1,
    surfaceName: options.surfaceName ?? analysis.rootPath[analysis.rootPath.length - 1] ?? options.rootType,
    rootType: options.rootType,
    rootPath: analysis.rootPath,
    methods,
    bindings: {
      http: httpBindings,
    },
  };
}

function buildNrpcSurfaceMethodManifest(
  method: CollectedRpcMethod,
  analysis: RpcAnalysisScaffold,
  options: GenerateNrpcSurfaceManifestOptions,
): NrpcSurfaceMethodManifest {
  const callablePropertyMethod = isCallablePropertyMethod(method);
  const manifestMethod = callablePropertyMethod ? stripSyntheticReceiver(method) : method;
  const docs = options.docs?.[method.methodName];

  let inputShape: import('./types.js').NrpcRuntimeShape;
  let resultShape: import('./types.js').NrpcRuntimeShape;

  try {
    const requestShape = manifestMethod.argsShape.kind === 'tuple'
      ? tupleToRequestObjectShape(manifestMethod.parameterNames, manifestMethod.argsShape)
      : manifestMethod.argsShape;
    const normalizedResultShape = normalizeMethodResultShape(manifestMethod, analysis.checker, analysis.policies);
    const inputShapeWithDocs = applyShapeParamDescriptions(requestShape, docs?.params);
    inputShape = toNrpcRuntimeShape(inputShapeWithDocs);
    resultShape = toNrpcRuntimeShape(normalizedResultShape);
  } catch {
    inputShape = fallbackInputShape(manifestMethod, docs?.params);
    resultShape = { kind: 'unknown' };
  }

  return {
    methodName: method.methodName,
    propertyPath: [...method.path],
    signature: {
      genericTypeParameters: [...manifestMethod.genericTypeParameters],
      parameterNames: [...manifestMethod.parameterNames],
      parameterOptionalFlags: [...manifestMethod.parameterOptionalFlags],
      parameterRestFlags: [...manifestMethod.parameterRestFlags],
      parameterTypeTexts: [...manifestMethod.parameterTypeTexts],
      resultTypeText: manifestMethod.resultTypeText,
    },
    semantic: {
      effects: method.effects,
      symbolSemanticFlags: method.symbolSemanticFlags,
      symbolRelations: method.symbolRelations,
      memberAbiFlags: method.memberAbiFlags,
      nodeAbiFlags: method.nodeAbiFlags,
    },
    runtime: {
      inputShape,
      resultShape,
      requestRequired: manifestMethod.argsShape.kind === 'tuple' && manifestMethod.argsShape.elements.some((shape) => !isOptionalShape(shape)),
    },
    ...(docs ? { docs } : {}),
  };
}

function buildNrpcHttpBinding(
  method: CollectedRpcMethod,
  rootPath: string[],
  basePath: string | undefined,
): NrpcHttpBinding {
  const route = buildGeneratedRoute(method, rootPath, basePath);
  return {
    methodName: method.methodName,
    propertyPath: [...method.path],
    transport: {
      protocol: 'nrpc-http',
      entrypoint: {
        kind: 'invoke',
        method: 'POST',
        path: route.httpPath,
        requestContentType: 'application/json',
        responseContentType: 'application/json',
      },
    },
  };
}

function tupleToRequestObjectShape(parameterNames: readonly string[], tupleShape: Extract<TypeNodeShape, { kind: 'tuple' }>): TypeNodeShape {
  return {
    kind: 'object',
    properties: tupleShape.elements.map((shape, index) => ({
      name: parameterNames[index] ?? `arg${index}`,
      shape,
    })),
  };
}

function toNrpcRuntimeShape(shape: TypeNodeShape): import('./types.js').NrpcRuntimeShape {
  switch (shape.kind) {
    case 'primitive':
      return { kind: 'primitive', primitive: shape.primitive, ...(shape.numericKind ? { numericKind: shape.numericKind } : {}) };
    case 'bigint':
      return { kind: 'bigint' };
    case 'unknown':
      return { kind: 'unknown' };
    case 'null':
      return { kind: 'null' };
    case 'literal':
      return { kind: 'literal', literalValue: shape.value };
    case 'undefined':
      return { kind: 'undefined' };
    case 'optional':
      return { kind: 'optional', inner: toNrpcRuntimeShape(shape.inner) };
    case 'date':
      return { kind: 'date', datePolicy: shape.policy };
    case 'map':
      return {
        kind: 'map',
        mapPolicy: shape.policy,
        keyShape: toNrpcRuntimeShape(shape.key),
        valueShape: toNrpcRuntimeShape(shape.value),
      };
    case 'record':
      return { kind: 'record', valueShape: toNrpcRuntimeShape(shape.value) };
    case 'set':
      return { kind: 'set', setPolicy: shape.policy, valueShape: toNrpcRuntimeShape(shape.element) };
    case 'union':
      return { kind: 'union', variants: shape.variants.map((variant) => toNrpcRuntimeShape(variant)) };
    case 'discriminated-union':
      return {
        kind: 'discriminated-union',
        discriminator: shape.discriminator,
        variants: shape.variants.map((variant) => toNrpcRuntimeShape(variant.shape)),
      };
    case 'typed-array':
      return { kind: 'typed-array', arrayType: shape.arrayType };
    case 'array':
      return { kind: 'array', valueShape: toNrpcRuntimeShape(shape.element) };
    case 'tuple':
      return {
        kind: 'tuple',
        elements: shape.elements.map((entry) => toNrpcRuntimeShape(entry)),
      };
    case 'object':
      const runtimeProperties = shape.properties.flatMap((property) => {
        if (isCallableShape(property.shape)) {
          return [];
        }

        try {
          return [{
            name: property.name,
            ...(property.description ? { description: property.description } : {}),
            shape: toNrpcRuntimeShape(property.shape),
          }];
        } catch {
          return [{
            name: property.name,
            ...(property.description ? { description: property.description } : {}),
            shape: { kind: 'unknown' } as const,
          }];
        }
      });
      return {
        kind: 'object',
        ...(shape.schemaId ? { schemaId: shape.schemaId } : {}),
        ...(shape.schemaName ? { schemaName: shape.schemaName } : {}),
        required: runtimeProperties
          .filter((property) => property.shape.kind !== 'optional')
          .map((property) => property.name),
        properties: runtimeProperties,
      };
  }
}

function applyShapeParamDescriptions(shape: TypeNodeShape, paramDescriptions?: Record<string, string>): TypeNodeShape {
  if (!paramDescriptions || shape.kind !== 'object') {
    return shape;
  }

  return {
    ...shape,
    properties: shape.properties.map((property) => ({
      ...property,
      ...(paramDescriptions[property.name] ? { description: paramDescriptions[property.name] } : {}),
    })),
  };
}

function isOptionalShape(shape: TypeNodeShape): boolean {
  return shape.kind === 'optional';
}

function isCallableShape(shape: TypeNodeShape): boolean {
  if (shape.kind === 'optional' && shape.inner) {
    return isCallableShape(shape.inner);
  }

  return shape.kind === 'object'
    && (shape.schemaName === 'Function' || shape.properties.some((property) => property.name === 'apply' || property.name === 'call'));
}

function buildGeneratedRoute(method: CollectedRpcMethod, rootPath: string[], basePath: string | undefined): { httpPath: string } {
  const normalizedBasePath = normalizeOpenApiBasePath(basePath ?? '/');
  const trimmedMethodPath = rootPath.length > 0 && method.path[0] === rootPath[rootPath.length - 1]
    ? method.path.slice(1)
    : method.path;
  const pathParts = [...rootPath, ...trimmedMethodPath];
  return {
    httpPath: `${normalizedBasePath}/${pathParts.join('/')}`.replace(/\/+/g, '/'),
  };
}

function normalizeOpenApiBasePath(value: string): string {
  const normalized = value.replace(/\\/g, '/').trim();
  if (!normalized || normalized === '/') return '';
  const withLeadingSlash = normalized.startsWith('/') ? normalized : `/${normalized}`;
  return withLeadingSlash.endsWith('/') ? withLeadingSlash.slice(0, -1) : withLeadingSlash;
}

function normalizeMethodResultShape(
  method: CollectedRpcMethod,
  checker: ts.TypeChecker,
  policies: CodecPolicies | undefined,
): TypeNodeShape {
  const normalizedPolicies = {
    date: policies?.date ?? 'iso-string',
    map: policies?.map ?? 'entries',
    set: policies?.set ?? 'array',
  } as const;

  const callableSignatures = checker.getSignaturesOfType(method.resultType, ts.SignatureKind.Call);
  if (callableSignatures.length > 0 && method.parameterNames.length > 0) {
    const signature = callableSignatures[0];
    if (signature) {
      try {
        return normalizeType(unwrapPromiseLikeType(checker.getReturnTypeOfSignature(signature), checker), checker, normalizedPolicies);
      } catch {
        return { kind: 'unknown' };
      }
    }
  }

  try {
    return normalizeType(unwrapPromiseLikeType(method.resultType, checker), checker, normalizedPolicies);
  } catch (error) {
    if (callableSignatures.length > 0) {
      return { kind: 'unknown' };
    }
    throw error;
  }
}

function fallbackInputShape(
  method: CollectedRpcMethod,
  paramDescriptions?: Record<string, string>,
): import('./types.js').NrpcRuntimeShape {
  return {
    kind: 'object',
    required: method.parameterNames.filter((_, index) => !method.parameterOptionalFlags[index]),
    properties: method.parameterNames.map((name, index) => ({
      name,
      ...(paramDescriptions?.[name] ? { description: paramDescriptions[name] } : {}),
      shape: { kind: 'unknown' } as const,
    })),
  };
}

function isCallablePropertyMethod(method: CollectedRpcMethod): boolean {
  return method.parameterNames[0] === 'receiver'
    && method.symbolSemanticFlags.symbolKind === 'property';
}

function stripSyntheticReceiver(method: CollectedRpcMethod): CollectedRpcMethod {
  if (method.argsShape.kind !== 'tuple') {
    return method;
  }

  return {
    ...method,
    parameterNames: method.parameterNames.slice(1),
    parameterOptionalFlags: method.parameterOptionalFlags.slice(1),
    parameterRestFlags: method.parameterRestFlags.slice(1),
    parameterTypeTexts: method.parameterTypeTexts.slice(1),
    argsShape: {
      kind: 'tuple',
      elements: method.argsShape.elements.slice(1),
    },
  };
}