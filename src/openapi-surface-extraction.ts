import fs from 'node:fs';
import { parse as parseYaml } from 'yaml';

export type JsonSchema = {
  $ref?: string;
  type?: string;
  format?: string;
  description?: string;
  enum?: Array<string | number | boolean | null>;
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  allOf?: JsonSchema[];
  nullable?: boolean;
};

export type OpenApiParameter = {
  $ref?: string;
  name?: string;
  in?: 'path' | 'query' | 'header' | 'cookie';
  required?: boolean;
  description?: string;
  schema?: JsonSchema;
};

export type OpenApiMediaType = {
  schema?: JsonSchema;
};

export type OpenApiRequestBody = {
  $ref?: string;
  required?: boolean;
  content?: Record<string, OpenApiMediaType>;
};

export type OpenApiResponse = {
  $ref?: string;
  description?: string;
  content?: Record<string, OpenApiMediaType>;
};

export type OpenApiOperation = {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: OpenApiParameter[];
  requestBody?: OpenApiRequestBody;
  responses?: Record<string, OpenApiResponse>;
  'x-nrpc-graphql-operation'?: {
    operationType?: string;
    operationName?: string;
    rootFieldNames?: string[];
    query?: string;
  };
  'x-nrpc-effects'?: {
    receiverMutability?: 'none' | 'immutable' | 'mutable';
    mutatesReceiver?: boolean;
    externalSideEffects?: boolean;
    executionPurity?: 'pure' | 'impure' | 'unknown';
    reason?: string;
  };
  'x-nrpc-type'?: {
    genericTypeParameters?: string[];
    parameterNames?: string[];
    parameterOptionalFlags?: boolean[];
    parameterTypeTexts?: string[];
    resultTypeText?: string;
    symbolSemanticFlags?: {
      symbolKind?: 'unknown' | 'function' | 'method' | 'property' | 'accessor' | 'constructor' | 'class' | 'interface' | 'typeAlias' | 'typeParameter' | 'enum' | 'enumMember' | 'module' | 'namespace' | 'signature' | 'alias' | 'prototype' | 'objectLiteral' | 'typeLiteral';
      spaces?: Array<'value' | 'type' | 'namespace'>;
      isAlias?: boolean;
      isOptional?: boolean;
      isTypeOnly?: boolean;
      isValueLike?: boolean;
      isTypeLike?: boolean;
      isNamespaceLike?: boolean;
    };
    memberAbiFlags?: {
      static?: boolean;
      async?: boolean;
      readonly?: boolean;
      abstract?: boolean;
      visibility?: 'public' | 'protected' | 'private';
      override?: boolean;
      deprecated?: boolean;
      export?: boolean;
    };
    nodeAbiFlags?: {
      containsThis?: boolean;
      hasAsyncFunctions?: boolean;
      awaitContext?: boolean;
      optionalChain?: boolean;
      hasImplicitReturn?: boolean;
      hasExplicitReturn?: boolean;
    };
  };
};

export type OpenApiPathItem = Record<string, unknown> & {
  parameters?: OpenApiParameter[];
};

export type OpenApiDocumentLike = {
  openapi?: string;
  swagger?: string;
  info?: {
    title?: string;
    version?: string;
    description?: string;
  };
  paths?: Record<string, OpenApiPathItem>;
  components?: {
    schemas?: Record<string, JsonSchema>;
    parameters?: Record<string, OpenApiParameter>;
    requestBodies?: Record<string, OpenApiRequestBody>;
    responses?: Record<string, OpenApiResponse>;
  };
  docsManifest?: Array<{
    methodName: string;
    httpMethod: string;
    httpPath: string;
    effects?: OpenApiSurfaceMethodSource['effects'];
    genericTypeParameters?: string[];
    parameterNames?: string[];
    parameterOptionalFlags?: boolean[];
    parameterTypeTexts?: string[];
    resultTypeText?: string;
    symbolSemanticFlags?: Partial<OpenApiSurfaceMethodSource['symbolSemanticFlags']>;
    memberAbiFlags?: Partial<OpenApiSurfaceMethodSource['memberAbiFlags']>;
    nodeAbiFlags?: Partial<OpenApiSurfaceMethodSource['nodeAbiFlags']>;
  }>;
};

export type RequestBodyKind = 'none' | 'json' | 'form' | 'binary' | 'text';

export type ResolvedRequestBody = {
  required: boolean;
  contentType: string;
  bodyKind: Exclude<RequestBodyKind, 'none'>;
  schema?: JsonSchema;
};

export type ResolvedResponse = {
  statusCode: string;
  contentType?: string;
  schema?: JsonSchema;
};

export type OpenApiSurfaceMethodSource = {
  methodName: string;
  propertyPath: string[];
  symbolSemanticFlags: {
    symbolKind: 'unknown' | 'function' | 'method' | 'property' | 'accessor' | 'constructor' | 'class' | 'interface' | 'typeAlias' | 'typeParameter' | 'enum' | 'enumMember' | 'module' | 'namespace' | 'signature' | 'alias' | 'prototype' | 'objectLiteral' | 'typeLiteral';
    spaces: Array<'value' | 'type' | 'namespace'>;
    isAlias: boolean;
    isOptional: boolean;
    isTypeOnly: boolean;
    isValueLike: boolean;
    isTypeLike: boolean;
    isNamespaceLike: boolean;
  };
  httpMethod: string;
  httpPath: string;
  effects?: {
    receiverMutability: 'none' | 'immutable' | 'mutable';
    mutatesReceiver: boolean;
    externalSideEffects: boolean;
    executionPurity: 'pure' | 'impure' | 'unknown';
    reason: string;
  };
  genericTypeParameters?: string[];
  parameterNames?: string[];
  parameterOptionalFlags?: boolean[];
  parameterTypeTexts?: string[];
  resultTypeText?: string;
  memberAbiFlags: {
    static: boolean;
    async: boolean;
    readonly: boolean;
    abstract: boolean;
    visibility: 'public' | 'protected' | 'private';
    override: boolean;
    deprecated: boolean;
    export: boolean;
  };
  nodeAbiFlags: {
    containsThis: boolean;
    hasAsyncFunctions: boolean;
    awaitContext: boolean;
    optionalChain: boolean;
    hasImplicitReturn: boolean;
    hasExplicitReturn: boolean;
  };
  requestContentType?: string;
  requestBodyKind: RequestBodyKind;
  responseContentType?: string;
  summary?: string;
  description?: string;
  tags: string[];
  graphqlOperationName?: string;
  graphqlRootFieldNames?: string[];
  graphqlQuery?: string;
  parameters: OpenApiParameter[];
  requestBody?: ResolvedRequestBody;
  response?: ResolvedResponse;
};

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

function defaultMemberAbiFlags(): OpenApiSurfaceMethodSource['memberAbiFlags'] {
  return {
    static: false,
    async: false,
    readonly: false,
    abstract: false,
    visibility: 'public',
    override: false,
    deprecated: false,
    export: false,
  };
}

function defaultSymbolSemanticFlags(): OpenApiSurfaceMethodSource['symbolSemanticFlags'] {
  return {
    symbolKind: 'unknown',
    spaces: ['value'],
    isAlias: false,
    isOptional: false,
    isTypeOnly: false,
    isValueLike: true,
    isTypeLike: false,
    isNamespaceLike: false,
  };
}

function defaultNodeAbiFlags(): OpenApiSurfaceMethodSource['nodeAbiFlags'] {
  return {
    containsThis: false,
    hasAsyncFunctions: false,
    awaitContext: false,
    optionalChain: false,
    hasImplicitReturn: false,
    hasExplicitReturn: false,
  };
}

function inferPropertyLikeSymbolFlags(method: {
  symbolSemanticFlags: OpenApiSurfaceMethodSource['symbolSemanticFlags'];
  parameterNames?: string[];
  parameterTypeTexts?: string[];
  effects?: OpenApiSurfaceMethodSource['effects'];
}): OpenApiSurfaceMethodSource['symbolSemanticFlags'] {
  const flags = method.symbolSemanticFlags;
  if (flags.symbolKind !== 'unknown') {
    return flags;
  }

  const hasParameters = (method.parameterNames?.length ?? 0) > 0 || (method.parameterTypeTexts?.length ?? 0) > 0;
  const isPurePropertyAccess = method.effects?.reason === 'property access';

  if (!hasParameters && isPurePropertyAccess) {
    return {
      ...flags,
      symbolKind: 'property',
      isValueLike: true,
      isTypeLike: false,
      isNamespaceLike: false,
    };
  }

  return flags;
}

export function readOpenApiDocument(filePath: string): OpenApiDocumentLike {
  const raw = fs.readFileSync(filePath, 'utf8');
  const isYaml = /\.ya?ml$/i.test(filePath);

  if (isYaml) {

// Legacy/import compatibility path:
// This parser exists for arbitrary OpenAPI inputs and older NRPC-generated specs
// that may still embed NRPC-specific metadata or a docs-sidecar manifest.
// The package-target generation path is now manifest-first and should not depend on
// this extraction step for canonical semantic information.
    return parseYaml(raw) as OpenApiDocumentLike;
  }

  try {
    return JSON.parse(raw) as OpenApiDocumentLike;
  } catch {
    return parseYaml(raw) as OpenApiDocumentLike;
  }
}

export function collectOpenApiSurfaceMethodSources(document: OpenApiDocumentLike): OpenApiSurfaceMethodSource[] {
  const methods: OpenApiSurfaceMethodSource[] = [];
  const usedMethodNames = new Set<string>();
  const paths = document.paths ?? {};
  const manifestByRoute = new Map(
    (document.docsManifest || []).map((entry) => [`${entry.httpMethod.toUpperCase()} ${entry.httpPath}`, entry] as const),
  );

  for (const [httpPath, pathItem] of Object.entries(paths)) {
    for (const httpMethod of HTTP_METHODS) {
      const operation = asObjectRecord(pathItem[httpMethod]) as OpenApiOperation | undefined;
      if (!operation || Object.keys(operation).length === 0) {
        continue;
      }

      const parameters = resolveOperationParameters(pathItem, operation, document);
      const requestBody = pickPreferredRequestBody(operation, document);
      const response = pickPrimaryResponse(operation, document);
      const manifestEntry = manifestByRoute.get(`${httpMethod.toUpperCase()} ${httpPath}`);
      const propertyPath = ensureUniquePropertyPath(
        derivePropertyPath(httpPath, httpMethod, operation.tags ?? [], operation.operationId),
        usedMethodNames,
      );

      const symbolSemanticFlags = inferPropertyLikeSymbolFlags({
        symbolSemanticFlags: {
        ...defaultSymbolSemanticFlags(),
        ...(manifestEntry?.symbolSemanticFlags ?? {}),
        ...(operation['x-nrpc-type']?.symbolSemanticFlags ?? {}),
        },
        parameterNames: Array.isArray(manifestEntry?.parameterNames)
        ? manifestEntry!.parameterNames!.filter((entry): entry is string => typeof entry === 'string')
        : Array.isArray(operation['x-nrpc-type']?.parameterNames)
        ? operation['x-nrpc-type']!.parameterNames!.filter((entry): entry is string => typeof entry === 'string')
        : undefined,
        parameterTypeTexts: Array.isArray(manifestEntry?.parameterTypeTexts)
        ? manifestEntry!.parameterTypeTexts!.filter((entry): entry is string => typeof entry === 'string')
        : Array.isArray(operation['x-nrpc-type']?.parameterTypeTexts)
        ? operation['x-nrpc-type']!.parameterTypeTexts!.filter((entry): entry is string => typeof entry === 'string')
        : undefined,
        effects: manifestEntry?.effects?.receiverMutability
        ? manifestEntry.effects
        : operation['x-nrpc-effects']?.receiverMutability
        ? {
          receiverMutability: operation['x-nrpc-effects'].receiverMutability,
          mutatesReceiver: operation['x-nrpc-effects'].mutatesReceiver === true,
          externalSideEffects: operation['x-nrpc-effects'].externalSideEffects === true,
          executionPurity: operation['x-nrpc-effects'].executionPurity ?? 'unknown',
          reason: operation['x-nrpc-effects'].reason ?? 'no reason provided',
          }
        : undefined,
      });

      methods.push({
        methodName: propertyPath.join('.'),
        propertyPath,
      symbolSemanticFlags,
        httpMethod: httpMethod.toUpperCase(),
        httpPath,
        effects: manifestEntry?.effects?.receiverMutability
          ? manifestEntry.effects
          : operation['x-nrpc-effects']?.receiverMutability
          ? {
              receiverMutability: operation['x-nrpc-effects'].receiverMutability,
              mutatesReceiver: operation['x-nrpc-effects'].mutatesReceiver === true,
              externalSideEffects: operation['x-nrpc-effects'].externalSideEffects === true,
              executionPurity: operation['x-nrpc-effects'].executionPurity ?? 'unknown',
              reason: operation['x-nrpc-effects'].reason ?? 'no reason provided',
            }
          : undefined,
        genericTypeParameters: Array.isArray(manifestEntry?.genericTypeParameters)
          ? manifestEntry!.genericTypeParameters!.filter((entry): entry is string => typeof entry === 'string')
          : Array.isArray(operation['x-nrpc-type']?.genericTypeParameters)
          ? operation['x-nrpc-type']!.genericTypeParameters!.filter((entry): entry is string => typeof entry === 'string')
          : undefined,
        parameterNames: Array.isArray(manifestEntry?.parameterNames)
          ? manifestEntry!.parameterNames!.filter((entry): entry is string => typeof entry === 'string')
          : Array.isArray(operation['x-nrpc-type']?.parameterNames)
          ? operation['x-nrpc-type']!.parameterNames!.filter((entry): entry is string => typeof entry === 'string')
          : undefined,
        parameterOptionalFlags: Array.isArray(manifestEntry?.parameterOptionalFlags)
          ? manifestEntry!.parameterOptionalFlags!.map((entry) => entry === true)
          : Array.isArray(operation['x-nrpc-type']?.parameterOptionalFlags)
          ? operation['x-nrpc-type']!.parameterOptionalFlags!.map((entry) => entry === true)
          : undefined,
        parameterTypeTexts: Array.isArray(manifestEntry?.parameterTypeTexts)
          ? manifestEntry!.parameterTypeTexts!.filter((entry): entry is string => typeof entry === 'string')
          : Array.isArray(operation['x-nrpc-type']?.parameterTypeTexts)
          ? operation['x-nrpc-type']!.parameterTypeTexts!.filter((entry): entry is string => typeof entry === 'string')
          : undefined,
        resultTypeText: typeof manifestEntry?.resultTypeText === 'string'
          ? manifestEntry.resultTypeText
          : typeof operation['x-nrpc-type']?.resultTypeText === 'string'
          ? operation['x-nrpc-type']!.resultTypeText
          : undefined,
        requestContentType: requestBody?.contentType,
        requestBodyKind: requestBody?.bodyKind ?? 'none',
        responseContentType: response?.contentType,
        summary: operation.summary,
        description: operation.description,
        tags: operation.tags ?? [],
        graphqlOperationName: operation['x-nrpc-graphql-operation']?.operationName,
        graphqlRootFieldNames: operation['x-nrpc-graphql-operation']?.rootFieldNames,
        graphqlQuery: operation['x-nrpc-graphql-operation']?.query,
        parameters,
        requestBody,
        response,
        memberAbiFlags: {
          ...defaultMemberAbiFlags(),
          ...(manifestEntry?.memberAbiFlags ?? {}),
          ...(operation['x-nrpc-type']?.memberAbiFlags ?? {}),
        },
        nodeAbiFlags: {
          ...defaultNodeAbiFlags(),
          ...(manifestEntry?.nodeAbiFlags ?? {}),
          ...(operation['x-nrpc-type']?.nodeAbiFlags ?? {}),
        },
      });
    }
  }

  return methods.sort((left, right) => left.methodName.localeCompare(right.methodName));
}

export function derivePropertyPath(httpPath: string, httpMethod: string, tags: string[], operationId?: string): string[] {
  if (operationId && operationId.trim().length > 0) {
    return trimNoisePrefix(dedupePathParts(operationId.split(/[./]/g).map(camelize).filter(Boolean)));
  }

  const tagParts = deriveTagParts(tags);
  const normalizedSegments = httpPath
    .split('/')
    .filter(Boolean)
    .filter((segment) => !/^v\d+$/i.test(segment))
    .map(parsePathSegment)
    .filter((segment) => segment.kind === 'literal');

  const literalSegments = normalizedSegments.map((segment) => segment.value);
  const namespaceParts = deriveNamespaceParts(literalSegments, tagParts);
  const methodPart = inferMethodName(httpPath, literalSegments, httpMethod, namespaceParts);
  return trimNoisePrefix(dedupePathParts([...tagParts, ...namespaceParts, methodPart].filter(Boolean)));
}

export function resolveDocumentRef<T>(ref: string, document: OpenApiDocumentLike): T | undefined {
  const parts = ref.replace(/^#\//, '').split('/');
  let cursor: unknown = document;
  for (const part of parts) {
    if (!cursor || typeof cursor !== 'object') {
      return undefined;
    }
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor as T | undefined;
}

function inferMethodName(httpPath: string, segments: string[], httpMethod: string, namespaceParts: string[]): string {
  const pathSegments = httpPath.split('/').filter(Boolean);
  const parameterNames = pathSegments
    .filter((segment) => segment.startsWith('{') && segment.endsWith('}'))
    .map((segment) => camelize(segment.slice(1, -1)));
  const last = segments[segments.length - 1] ?? namespaceParts[namespaceParts.length - 1] ?? 'resource';
  const singularLast = singularize(last);
  const qualifier = parameterNames.length > 0
    ? `By${parameterNames.map(pascalize).join('And')}`
    : '';

  switch (httpMethod) {
    case 'get':
      return qualifier ? `get${pascalize(singularLast)}${qualifier}` : `list${pascalize(last)}`;
    case 'post':
      return `create${pascalize(singularLast)}`;
    case 'patch':
      return `update${pascalize(singularLast)}${qualifier}`;
    case 'delete':
      return `delete${pascalize(singularLast)}${qualifier}`;
    case 'put':
      return `replace${pascalize(singularLast)}${qualifier}`;
    default:
      return `${camelize(httpMethod)}${pascalize(singularLast)}${qualifier}`;
  }
}

function deriveTagParts(tags: string[]): string[] {
  const primaryTag = tags[0]?.trim();
  if (!primaryTag) {
    return [];
  }

  const parts = primaryTag
    .split(/[/:>|.-]+/g)
    .map(camelize)
    .filter(Boolean)
    .filter((part) => !isNoiseSegment(part));

  return dedupePathParts(parts);
}

function deriveNamespaceParts(segments: string[], tagParts: string[]): string[] {
  const filtered = segments.filter((segment) => !isNoiseSegment(segment));
  if (filtered.length <= 1) {
    return [];
  }

  const namespace = filtered.slice(0, -1).filter((segment) => !tagParts.includes(segment));
  return dedupePathParts(namespace);
}

function parsePathSegment(segment: string): { kind: 'literal' | 'param'; value: string } {
  if (segment.startsWith('{') && segment.endsWith('}')) {
    return {
      kind: 'param',
      value: camelize(segment.slice(1, -1)),
    };
  }

  return {
    kind: 'literal',
    value: camelize(segment),
  };
}

function ensureUniquePropertyPath(propertyPath: string[], usedMethodNames: Set<string>): string[] {
  const basePath = propertyPath.length > 0 ? propertyPath : ['api', 'call'];
  let candidate = [...basePath];
  let suffix = 2;

  while (usedMethodNames.has(candidate.join('.'))) {
    candidate = [...basePath.slice(0, -1), `${basePath[basePath.length - 1]}${suffix}`];
    suffix += 1;
  }

  usedMethodNames.add(candidate.join('.'));
  return candidate;
}

function dedupePathParts(parts: string[]): string[] {
  const result: string[] = [];
  for (const part of parts) {
    if (!part) {
      continue;
    }
    if (result[result.length - 1] === part) {
      continue;
    }
    result.push(part);
  }
  return result;
}

function trimNoisePrefix(parts: string[]): string[] {
  let index = 0;
  while (index < parts.length - 1 && isNoiseSegment(parts[index]!)) {
    index += 1;
  }
  return parts.slice(index);
}

function singularize(value: string): string {
  if (value.endsWith('ies') && value.length > 3) {
    return `${value.slice(0, -3)}y`;
  }
  if (value.endsWith('ses') && value.length > 3) {
    return value.slice(0, -2);
  }
  if (value.endsWith('s') && !value.endsWith('ss') && value.length > 1) {
    return value.slice(0, -1);
  }
  return value;
}

function isNoiseSegment(value: string): boolean {
  return value === 'api' || value === 'rest' || value === 'service';
}

function resolveOperationParameters(pathItem: OpenApiPathItem, operation: OpenApiOperation, document: OpenApiDocumentLike): OpenApiParameter[] {
  const merged = new Map<string, OpenApiParameter>();

  for (const parameter of [...(pathItem.parameters ?? []), ...(operation.parameters ?? [])]) {
    const resolved = resolveParameter(parameter, document);
    if (!resolved?.name || !resolved.in) {
      continue;
    }
    merged.set(`${resolved.in}:${resolved.name}`, resolved);
  }

  return [...merged.values()];
}

function resolveParameter(parameter: OpenApiParameter | undefined, document: OpenApiDocumentLike, seen = new Set<string>()): OpenApiParameter | undefined {
  if (!parameter) {
    return undefined;
  }

  if (parameter.$ref) {
    if (seen.has(parameter.$ref)) {
      return undefined;
    }
    seen.add(parameter.$ref);
    return resolveParameter(resolveDocumentRef<OpenApiParameter>(parameter.$ref, document), document, seen);
  }

  return parameter;
}

function resolveRequestBody(requestBody: OpenApiRequestBody | undefined, document: OpenApiDocumentLike, seen = new Set<string>()): OpenApiRequestBody | undefined {
  if (!requestBody) {
    return undefined;
  }

  if (requestBody.$ref) {
    if (seen.has(requestBody.$ref)) {
      return undefined;
    }
    seen.add(requestBody.$ref);
    return resolveRequestBody(resolveDocumentRef<OpenApiRequestBody>(requestBody.$ref, document), document, seen);
  }

  return requestBody;
}

function resolveResponse(response: OpenApiResponse | undefined, document: OpenApiDocumentLike, seen = new Set<string>()): OpenApiResponse | undefined {
  if (!response) {
    return undefined;
  }

  if (response.$ref) {
    if (seen.has(response.$ref)) {
      return undefined;
    }
    seen.add(response.$ref);
    return resolveResponse(resolveDocumentRef<OpenApiResponse>(response.$ref, document), document, seen);
  }

  return response;
}

function pickPreferredRequestBody(operation: OpenApiOperation, document: OpenApiDocumentLike): ResolvedRequestBody | undefined {
  const requestBody = resolveRequestBody(operation.requestBody, document);
  const content = requestBody?.content;
  if (!content) {
    return undefined;
  }

  const preferred = pickPreferredContentEntry(content, [
    'application/json',
    'application/*+json',
    'application/x-www-form-urlencoded',
    'text/plain',
    'application/octet-stream',
    'image/',
    '*/*',
  ]);
  if (!preferred) {
    return undefined;
  }

  return {
    required: requestBody?.required === true,
    contentType: preferred.contentType,
    bodyKind: inferRequestBodyKind(preferred.contentType, preferred.mediaType.schema),
    schema: preferred.mediaType.schema,
  };
}

function pickPrimaryResponse(operation: OpenApiOperation, document: OpenApiDocumentLike): ResolvedResponse | undefined {
  const responses = operation.responses ?? {};
  const ordered = Object.entries(responses).sort(compareResponseStatus);

  for (const [statusCode, responseLike] of ordered) {
    const response = resolveResponse(responseLike, document);
    if (!response) {
      continue;
    }

    const content = response.content;
    if (!content || Object.keys(content).length === 0) {
      return { statusCode };
    }

    const preferred = pickPreferredContentEntry(content, [
      'application/json',
      'application/*+json',
      'text/',
      'application/octet-stream',
      'image/',
      '*/*',
    ]);

    return {
      statusCode,
      contentType: preferred?.contentType,
      schema: preferred?.mediaType.schema,
    };
  }

  return undefined;
}

function compareResponseStatus(left: [string, OpenApiResponse], right: [string, OpenApiResponse]): number {
  return responseStatusRank(left[0]) - responseStatusRank(right[0]);
}

function responseStatusRank(statusCode: string): number {
  if (statusCode === '200') return 0;
  if (statusCode === '201') return 1;
  if (statusCode === '202') return 2;
  if (statusCode === '204') return 3;
  if (/^2\d\d$/.test(statusCode)) return 10 + Number.parseInt(statusCode, 10);
  if (statusCode === 'default') return 1000;
  return 500 + Number.parseInt(statusCode, 10);
}

function pickPreferredContentEntry(content: Record<string, OpenApiMediaType>, priorities: string[]): { contentType: string; mediaType: OpenApiMediaType } | undefined {
  const entries = Object.entries(content);
  if (entries.length === 0) {
    return undefined;
  }

  for (const priority of priorities) {
    const match = entries.find(([contentType]) => contentTypeMatchesPriority(contentType, priority));
    if (match) {
      return {
        contentType: match[0],
        mediaType: match[1],
      };
    }
  }

  const [contentType, mediaType] = entries[0]!;
  return { contentType, mediaType };
}

function contentTypeMatchesPriority(contentType: string, priority: string): boolean {
  if (priority === '*/*') {
    return true;
  }
  if (priority.endsWith('/')) {
    return contentType.startsWith(priority);
  }
  if (priority === 'application/*+json') {
    return contentType === priority || contentType.endsWith('+json');
  }
  return contentType === priority;
}

function inferRequestBodyKind(contentType: string, schema?: JsonSchema): Exclude<RequestBodyKind, 'none'> {
  if (contentType === 'application/x-www-form-urlencoded') {
    return 'form';
  }
  if (contentType === 'text/plain') {
    return 'text';
  }
  if (contentType === 'application/octet-stream' || contentType.startsWith('image/')) {
    return 'binary';
  }
  if (contentType === '*/*' && schema?.type === 'string' && (schema.format === 'byte' || schema.format === 'binary')) {
    return 'binary';
  }
  return 'json';
}

function camelize(value: string): string {
  const normalized = value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/\{([^}]+)\}/g, ' $1 ')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim();
  if (!normalized) {
    return 'value';
  }
  const parts = normalized.split(/\s+/g);
  return parts[0]!.toLowerCase() + parts.slice(1).map((part) => pascalize(part)).join('');
}

function pascalize(value: string): string {
  const camel = camelize(value);
  return camel.charAt(0).toUpperCase() + camel.slice(1);
}

function asObjectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
