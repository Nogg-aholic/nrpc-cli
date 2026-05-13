import type { OpenApiDocumentLike } from './extraction.js';
import type { OpenApiSurfaceMethod } from './renderer-shared.js';
import type { NrpcSurfaceManifest } from '../nrpc-surface/types.js';

type SurfaceMethodManifestEntry = {
  methodName: string;
  httpMethod: string;
  httpPath: string;
  effects: OpenApiSurfaceMethod['effects'];
  genericTypeParameters: OpenApiSurfaceMethod['genericTypeParameters'];
  parameterNames: OpenApiSurfaceMethod['parameterNames'];
  parameterOptionalFlags: OpenApiSurfaceMethod['parameterOptionalFlags'];
  parameterTypeTexts: OpenApiSurfaceMethod['parameterTypeTexts'];
  resultTypeText: OpenApiSurfaceMethod['resultTypeSourceText'];
  symbolSemanticFlags: OpenApiSurfaceMethod['symbolSemanticFlags'];
  memberAbiFlags: OpenApiSurfaceMethod['memberAbiFlags'];
  nodeAbiFlags: OpenApiSurfaceMethod['nodeAbiFlags'];
};

function stripCustomNrpcFields(document: OpenApiDocumentLike): OpenApiDocumentLike {
  const nextPaths = Object.fromEntries(
    Object.entries(document.paths || {}).map(([pathKey, pathItem]) => {
      const nextPathItem = { ...(pathItem || {}) } as Record<string, unknown>;
      const postOperation = nextPathItem.post && typeof nextPathItem.post === 'object'
        ? { ...(nextPathItem.post as Record<string, unknown>) }
        : undefined;

      if (postOperation) {
        delete postOperation['x-nrpc-effects'];
        delete postOperation['x-nrpc-type'];
        nextPathItem.post = postOperation;
      }

      return [pathKey, nextPathItem];
    }),
  );

  return {
    ...document,
    paths: nextPaths,
  };
}

function buildSurfaceManifest(methods: OpenApiSurfaceMethod[]): SurfaceMethodManifestEntry[] {
  return methods.map((method) => ({
    methodName: method.methodName,
    httpMethod: method.httpMethod,
    httpPath: method.httpPath,
    effects: method.effects,
    genericTypeParameters: method.genericTypeParameters,
    parameterNames: method.parameterNames,
    parameterOptionalFlags: method.parameterOptionalFlags,
    parameterTypeTexts: method.parameterTypeTexts,
    resultTypeText: method.resultTypeSourceText,
    symbolSemanticFlags: method.symbolSemanticFlags,
    memberAbiFlags: method.memberAbiFlags,
    nodeAbiFlags: method.nodeAbiFlags,
  }));
}

export function renderOpenApiSurfaceDocs(input: { document: OpenApiDocumentLike; methods: OpenApiSurfaceMethod[] }): string {
  const sanitizedDocument = stripCustomNrpcFields(input.document);
  const docsMethods = input.methods.map((method) => ({
    methodName: method.methodName,
    httpMethod: method.httpMethod,
    httpPath: method.httpPath,
    requestContentType: method.requestContentType,
    requestBodyKind: method.requestBodyKind,
    responseContentType: method.responseContentType,
    summary: method.summary,
    description: method.description,
    tags: method.tags,
    graphqlOperationName: method.graphqlOperationName,
  }));
  const docsManifest = buildSurfaceManifest(input.methods);
  return [
    '// AUTO-GENERATED FILE. DO NOT EDIT.',
    `export const docsJson = ${JSON.stringify(sanitizedDocument, null, 2)};`,
    '',
    `export const docsMethods = ${JSON.stringify(docsMethods, null, 2)};`,
    '',
    `export const docsManifest = ${JSON.stringify(docsManifest, null, 2)};`,
    '',
  ].join('\n');
}

export function renderNrpcSurfaceDocs(input: { document: OpenApiDocumentLike; methods: OpenApiSurfaceMethod[]; manifest: NrpcSurfaceManifest }): string {
  const sanitizedDocument = stripCustomNrpcFields(input.document);
  const docsMethods = input.methods.map((method) => ({
    methodName: method.methodName,
    httpMethod: method.httpMethod,
    httpPath: method.httpPath,
    requestContentType: method.requestContentType,
    requestBodyKind: method.requestBodyKind,
    responseContentType: method.responseContentType,
    summary: method.summary,
    description: method.description,
    tags: method.tags,
    graphqlOperationName: method.graphqlOperationName,
  }));

  return [
    '// AUTO-GENERATED FILE. DO NOT EDIT.',
    `export const docsJson = ${JSON.stringify(sanitizedDocument, null, 2)};`,
    '',
    `export const docsMethods = ${JSON.stringify(docsMethods, null, 2)};`,
    '',
    `export const docsManifest = ${JSON.stringify(input.manifest, null, 2)};`,
    '',
  ].join('\n');
}