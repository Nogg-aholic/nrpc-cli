import fs from 'node:fs';
import { parse as parseYaml } from 'yaml';

type JsonSchema = {
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

type OpenApiParameter = {
  $ref?: string;
  name?: string;
  in?: 'path' | 'query' | 'header' | 'cookie';
  required?: boolean;
  description?: string;
  schema?: JsonSchema;
};

type OpenApiMediaType = {
  schema?: JsonSchema;
};

type OpenApiRequestBody = {
  $ref?: string;
  required?: boolean;
  content?: Record<string, OpenApiMediaType>;
};

type OpenApiResponse = {
  $ref?: string;
  description?: string;
  content?: Record<string, OpenApiMediaType>;
};

type OpenApiOperation = {
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
};

type OpenApiPathItem = Record<string, unknown> & {
  parameters?: OpenApiParameter[];
};

type OpenApiDocumentLike = {
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
};

type RequestBodyKind = 'none' | 'json' | 'form' | 'binary' | 'text';

type ResolvedRequestBody = {
  required: boolean;
  contentType: string;
  bodyKind: Exclude<RequestBodyKind, 'none'>;
  schema?: JsonSchema;
};

type ResolvedResponse = {
  statusCode: string;
  contentType?: string;
  schema?: JsonSchema;
};

type OpenApiSurfaceMethod = {
  methodName: string;
  propertyPath: string[];
  httpMethod: string;
  httpPath: string;
  inputTypeName: string;
  resultTypeName: string;
  inputTypeText: string;
  resultTypeText: string;
  inputJsonSchema: Record<string, unknown>;
  requestContentType?: string;
  requestBodyKind: RequestBodyKind;
  responseContentType?: string;
  summary?: string;
  description?: string;
  tags: string[];
  graphqlOperationName?: string;
  graphqlRootFieldNames?: string[];
  graphqlQuery?: string;
};

export type GenerateOpenApiSurfaceOptions = {
  openApiFile: string;
  outputImportPath: string;
  rootTypeName?: string;
  globalName?: string;
  rootPath?: string[];
};

export type GeneratedOpenApiSurfaceResult = {
  contractText: string;
  docsText: string;
  mcpToolsText: string;
};

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

export function generateOpenApiSurface(options: GenerateOpenApiSurfaceOptions): GeneratedOpenApiSurfaceResult {
  const document = readOpenApiDocument(options.openApiFile);
  const methods = collectOpenApiSurfaceMethods(document);
  const globalName = options.globalName ?? 'openApi';
  const rootTypeName = options.rootTypeName ?? 'OpenApiSurface';
  const rootPath = options.rootPath ?? [globalName];

  const contractText = renderOpenApiSurfaceContract({
    methods,
    globalName,
    rootTypeName,
    rootPath,
  });

  const docsText = renderOpenApiSurfaceDocs({
    document,
    methods,
  });

  const mcpToolsText = renderOpenApiMcpTools({
    globalName,
    methods,
  });

  return { contractText, docsText, mcpToolsText };
}

function readOpenApiDocument(filePath: string): OpenApiDocumentLike {
  const raw = fs.readFileSync(filePath, 'utf8');
  const isYaml = /\.ya?ml$/i.test(filePath);

  if (isYaml) {
    return parseYaml(raw) as OpenApiDocumentLike;
  }

  try {
    return JSON.parse(raw) as OpenApiDocumentLike;
  } catch {
    return parseYaml(raw) as OpenApiDocumentLike;
  }
}

function collectOpenApiSurfaceMethods(document: OpenApiDocumentLike): OpenApiSurfaceMethod[] {
  const methods: OpenApiSurfaceMethod[] = [];
  const usedMethodNames = new Set<string>();
  const paths = document.paths ?? {};

  for (const [httpPath, pathItem] of Object.entries(paths)) {
    for (const httpMethod of HTTP_METHODS) {
      const operation = asObjectRecord(pathItem[httpMethod]) as OpenApiOperation | undefined;
      if (!operation || Object.keys(operation).length === 0) {
        continue;
      }

      const parameters = resolveOperationParameters(pathItem, operation, document);
      const requestBody = pickPreferredRequestBody(operation, document);
      const response = pickPrimaryResponse(operation, document);
      const propertyPath = ensureUniquePropertyPath(
        derivePropertyPath(httpPath, httpMethod, operation.tags ?? [], operation.operationId),
        usedMethodNames,
      );
      const methodName = propertyPath.join('.');
      const typeBase = propertyPath.map(pascalize).join('');

      methods.push({
        methodName,
        propertyPath,
        httpMethod: httpMethod.toUpperCase(),
        httpPath,
        inputTypeName: `${typeBase}Input`,
        resultTypeName: `${typeBase}Result`,
        inputTypeText: renderOperationInputType(parameters, requestBody, document),
        resultTypeText: renderOperationResultType(response, document),
        inputJsonSchema: buildOperationInputJsonSchema(parameters, requestBody, document),
        requestContentType: requestBody?.contentType,
        requestBodyKind: requestBody?.bodyKind ?? 'none',
        responseContentType: response?.contentType,
        summary: operation.summary,
        description: operation.description,
        tags: operation.tags ?? [],
        graphqlOperationName: operation['x-nrpc-graphql-operation']?.operationName,
        graphqlRootFieldNames: operation['x-nrpc-graphql-operation']?.rootFieldNames,
        graphqlQuery: operation['x-nrpc-graphql-operation']?.query,
      });
    }
  }

  return methods.sort((left, right) => left.methodName.localeCompare(right.methodName));
}

function derivePropertyPath(httpPath: string, httpMethod: string, tags: string[], operationId?: string): string[] {
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

function renderOperationInputType(parameters: OpenApiParameter[], requestBody: ResolvedRequestBody | undefined, document: OpenApiDocumentLike): string {
  const fields: string[] = [];
  const grouped = new Map<string, OpenApiParameter[]>();

  for (const parameter of parameters) {
    if (!parameter.in) {
      continue;
    }
    const bucket = grouped.get(parameter.in) ?? [];
    bucket.push(parameter);
    grouped.set(parameter.in, bucket);
  }

  for (const [location, entries] of grouped.entries()) {
    const objectLines = entries.map((entry) => {
      const propertyName = safePropertyName(entry.name ?? 'value');
      const propertyType = schemaToTypeText(entry.schema, document);
      return `${propertyName}${entry.required ? '' : '?'}: ${propertyType};`;
    });
    fields.push(`${location}: { ${objectLines.join(' ')} };`);
  }

  if (requestBody) {
    fields.push(`body${requestBody.required ? '' : '?'}: ${renderRequestBodyType(requestBody, document)};`);
  }

  if (fields.length === 0) {
    return 'undefined';
  }

  return `{
  ${fields.join('\n  ')}
}`;
}

function renderRequestBodyType(requestBody: ResolvedRequestBody, document: OpenApiDocumentLike): string {
  if (requestBody.bodyKind === 'binary') {
    return 'Uint8Array | ArrayBuffer | Blob | string';
  }
  if (requestBody.bodyKind === 'text') {
    return 'string';
  }
  return schemaToTypeText(requestBody.schema, document);
}

function renderOperationResultType(response: ResolvedResponse | undefined, document: OpenApiDocumentLike): string {
  if (!response) {
    return 'unknown';
  }
  if (response.statusCode === '204' || response.statusCode === '205') {
    return 'undefined';
  }
  if (!response.contentType) {
    return 'unknown';
  }
  if (response.contentType.includes('application/json') || response.contentType.endsWith('+json') || response.contentType === '*/*') {
    return schemaToTypeText(response.schema, document);
  }
  if (response.contentType.startsWith('text/')) {
    return 'string';
  }
  if (response.contentType === 'application/octet-stream' || response.contentType.startsWith('image/')) {
    return 'Uint8Array';
  }
  return response.schema ? schemaToTypeText(response.schema, document) : 'unknown';
}

function buildOperationInputJsonSchema(parameters: OpenApiParameter[], requestBody: ResolvedRequestBody | undefined, document: OpenApiDocumentLike): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  const grouped = new Map<string, OpenApiParameter[]>();

  for (const parameter of parameters) {
    if (!parameter.in) {
      continue;
    }
    const bucket = grouped.get(parameter.in) ?? [];
    bucket.push(parameter);
    grouped.set(parameter.in, bucket);
  }

  for (const [location, entries] of grouped.entries()) {
    const childProperties: Record<string, unknown> = {};
    const childRequired: string[] = [];

    for (const entry of entries) {
      const name = entry.name ?? 'value';
      childProperties[name] = schemaToJsonSchema(entry.schema, document);
      if (entry.required) {
        childRequired.push(name);
      }
    }

    properties[location] = {
      type: 'object',
      properties: childProperties,
      additionalProperties: false,
      ...(childRequired.length > 0 ? { required: childRequired } : {}),
    };

    if (childRequired.length > 0) {
      required.push(location);
    }
  }

  if (requestBody) {
    properties.body = requestBodyToJsonSchema(requestBody, document);
    if (requestBody.required) {
      required.push('body');
    }
  }

  return {
    type: 'object',
    properties,
    additionalProperties: false,
    ...(required.length > 0 ? { required } : {}),
  };
}

function requestBodyToJsonSchema(requestBody: ResolvedRequestBody, document: OpenApiDocumentLike): Record<string, unknown> {
  if (requestBody.bodyKind === 'binary') {
    return {
      type: 'string',
      description: `Binary request body for ${requestBody.contentType}`,
    };
  }
  if (requestBody.bodyKind === 'text') {
    return {
      type: 'string',
      description: `Text request body for ${requestBody.contentType}`,
    };
  }
  return schemaToJsonSchema(requestBody.schema, document);
}

function schemaToTypeText(schema: JsonSchema | undefined, document: OpenApiDocumentLike, seen = new Set<string>()): string {
  if (!schema) {
    return 'unknown';
  }

  if (schema.$ref) {
    const resolved = resolveDocumentRef<JsonSchema>(schema.$ref, document);
    if (!resolved) {
      return 'unknown';
    }
    if (seen.has(schema.$ref)) {
      return 'unknown';
    }
    seen.add(schema.$ref);
    return schemaToTypeText(resolved, document, seen);
  }

  if (schema.enum?.length) {
    return schema.enum.map((value) => JSON.stringify(value)).join(' | ');
  }

  if (schema.oneOf?.length) {
    return schema.oneOf.map((entry) => schemaToTypeText(entry, document, new Set(seen))).join(' | ');
  }

  if (schema.anyOf?.length) {
    return schema.anyOf.map((entry) => schemaToTypeText(entry, document, new Set(seen))).join(' | ');
  }

  if (schema.allOf?.length) {
    return schema.allOf.map((entry) => schemaToTypeText(entry, document, new Set(seen))).join(' & ');
  }

  let base: string;
  switch (schema.type) {
    case 'string':
      base = 'string';
      break;
    case 'integer':
    case 'number':
      base = 'number';
      break;
    case 'boolean':
      base = 'boolean';
      break;
    case 'array':
      base = `Array<${schemaToTypeText(schema.items, document, new Set(seen))}>`;
      break;
    case 'object':
      if (schema.properties) {
        const required = new Set(schema.required ?? []);
        const entries = Object.entries(schema.properties).map(([name, value]) => {
          const optional = required.has(name) ? '' : '?';
          return `${safePropertyName(name)}${optional}: ${schemaToTypeText(value, document, new Set(seen))};`;
        });
        if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
          entries.push(`[key: string]: ${schemaToTypeText(schema.additionalProperties, document, new Set(seen))};`);
        }
        base = `{
  ${entries.join('\n  ')}
}`;
      } else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        base = `{ [key: string]: ${schemaToTypeText(schema.additionalProperties, document, new Set(seen))} }`;
      } else {
        base = 'Record<string, unknown>';
      }
      break;
    default:
      if (schema.properties) {
        return schemaToTypeText({ ...schema, type: 'object' }, document, seen);
      }
      base = 'unknown';
      break;
  }

  return schema.nullable ? `${base} | null` : base;
}

function schemaToJsonSchema(schema: JsonSchema | undefined, document: OpenApiDocumentLike, seen = new Set<string>()): Record<string, unknown> {
  if (!schema) {
    return {};
  }

  if (schema.$ref) {
    const resolved = resolveDocumentRef<JsonSchema>(schema.$ref, document);
    if (!resolved || seen.has(schema.$ref)) {
      return {};
    }
    seen.add(schema.$ref);
    return schemaToJsonSchema(resolved, document, seen);
  }

  const result: Record<string, unknown> = {};

  if (schema.type) result.type = schema.type;
  if (schema.format) result.format = schema.format;
  if (schema.description) result.description = schema.description;
  if (schema.enum) result.enum = schema.enum;
  if (schema.nullable) result.nullable = true;
  if (schema.items) result.items = schemaToJsonSchema(schema.items, document, new Set(seen));
  if (schema.required?.length) result.required = schema.required;
  if (schema.anyOf?.length) result.anyOf = schema.anyOf.map((entry) => schemaToJsonSchema(entry, document, new Set(seen)));
  if (schema.oneOf?.length) result.oneOf = schema.oneOf.map((entry) => schemaToJsonSchema(entry, document, new Set(seen)));
  if (schema.allOf?.length) result.allOf = schema.allOf.map((entry) => schemaToJsonSchema(entry, document, new Set(seen)));

  if (schema.properties) {
    result.type ??= 'object';
    result.properties = Object.fromEntries(
      Object.entries(schema.properties).map(([name, value]) => [name, schemaToJsonSchema(value, document, new Set(seen))]),
    );
  }

  if (schema.additionalProperties === true || schema.additionalProperties === false) {
    result.additionalProperties = schema.additionalProperties;
  } else if (schema.additionalProperties) {
    result.additionalProperties = schemaToJsonSchema(schema.additionalProperties, document, new Set(seen));
  }

  return result;
}

function resolveDocumentRef<T>(ref: string, document: OpenApiDocumentLike): T | undefined {
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

function renderOpenApiSurfaceContract(input: {
  methods: OpenApiSurfaceMethod[];
  globalName: string;
  rootTypeName: string;
  rootPath: string[];
}): string {
  const methodsByType = input.methods.flatMap((method) => [
    `export type ${method.inputTypeName} = ${method.inputTypeText};`,
    `export type ${method.resultTypeName} = ${method.resultTypeText};`,
  ]);

  const rootType = renderSurfaceType(input.rootTypeName, input.methods);
  const runtimeSurface = renderRuntimeSurface(input.globalName, input.rootTypeName, input.methods, input.rootPath);
  const manifest = renderRouteManifest(input.globalName, input.methods, input.rootPath);
  const caller = renderCallerFactory(input.globalName);

  return [
    '// AUTO-GENERATED FILE. DO NOT EDIT.',
    "import { createEndpointSurface, type Rpcify } from '@nogg-aholic/nrpc';",
    '',
    ...methodsByType,
    '',
    rootType,
    '',
    caller,
    '',
    runtimeSurface,
    '',
    manifest,
    '',
  ].join('\n');
}

function renderSurfaceType(rootTypeName: string, methods: OpenApiSurfaceMethod[]): string {
  const tree = new Map<string, unknown>();
  for (const method of methods) {
    let cursor = tree;
    for (let index = 0; index < method.propertyPath.length - 1; index += 1) {
      const part = method.propertyPath[index]!;
      if (!cursor.has(part)) {
        cursor.set(part, new Map<string, unknown>());
      }
      cursor = cursor.get(part) as Map<string, unknown>;
    }
    cursor.set(method.propertyPath[method.propertyPath.length - 1]!, method);
  }

  return `export type ${rootTypeName} = ${renderTreeType(tree, 0)};`;
}

function renderTreeType(tree: Map<string, unknown>, depth: number): string {
  const indent = '  '.repeat(depth);
  const childIndent = '  '.repeat(depth + 1);
  const lines = ['{'];
  for (const [key, value] of [...tree.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (value instanceof Map) {
      lines.push(`${childIndent}${safePropertyName(key)}: ${renderTreeType(value, depth + 1)};`);
      continue;
    }
    const method = value as OpenApiSurfaceMethod;
    lines.push(`${childIndent}${safePropertyName(key)}: (input: ${method.inputTypeName}) => Promise<${method.resultTypeName}>;`);
  }
  lines.push(`${indent}}`);
  return lines.join('\n');
}

function renderCallerFactory(globalName: string): string {
  return [
    'export type OpenApiFetchOptions = {',
    '  baseUrl: string;',
    '  fetch?: typeof fetch;',
    '  defaultHeaders?: Record<string, string>;',
    '};',
    '',
    'type GeneratedOpenApiRoute = {',
    '  httpMethod: string;',
    '  httpPath: string;',
    '  requestContentType?: string;',
    '  requestBodyKind: "none" | "json" | "form" | "binary" | "text";',
    '  responseContentType?: string;',
    '  graphqlOperationName?: string;',
    '  graphqlRootFieldNames?: string[];',
    '  graphqlQuery?: string;',
    '};',
    '',
    'function toFormUrlEncoded(value: unknown): string {',
    '  if (!value || typeof value !== "object") {',
    '    return "";',
    '  }',
    '  const params = new URLSearchParams();',
    '  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {',
    '    if (entry === undefined || entry === null) continue;',
    '    if (Array.isArray(entry)) {',
    '      for (const item of entry) {',
    '        params.append(key, String(item));',
    '      }',
    '      continue;',
    '    }',
    '    params.set(key, String(entry));',
    '  }',
    '  return params.toString();',
    '}',
    '',
    'function toBinaryBody(value: unknown): BodyInit {',
    '  if (value instanceof Uint8Array) return value;',
    '  if (value instanceof ArrayBuffer) return value;',
    '  if (value instanceof Blob) return value;',
    '  if (typeof value === "string") return value;',
    '  return JSON.stringify(value);',
    '}',
    '',
    `export function create${pascalize(globalName)}Caller(options: OpenApiFetchOptions) {`,
    '  const fetchImpl = options.fetch ?? fetch;',
    '  return async function call(methodName: string, route: GeneratedOpenApiRoute, input: any): Promise<any> {',
    '    const url = new URL(route.httpPath, options.baseUrl);',
    '    const headers: Record<string, string> = { ...(options.defaultHeaders ?? {}) };',
    '    const init: RequestInit = {',
    '      method: route.httpMethod,',
    '      headers,',
    '    };',
    '',
    '    if (input && typeof input === "object") {',
    '      if (input.path && typeof input.path === "object") {',
    '        for (const [key, value] of Object.entries(input.path)) {',
    '          url.pathname = url.pathname.replace(`{${key}}`, encodeURIComponent(String(value)));',
    '        }',
    '      }',
    '      if (input.query && typeof input.query === "object") {',
    '        for (const [key, value] of Object.entries(input.query)) {',
    '          if (value === undefined || value === null) continue;',
    '          if (Array.isArray(value)) {',
    '            for (const item of value) {',
    '              url.searchParams.append(key, String(item));',
    '            }',
    '            continue;',
    '          }',
    '          url.searchParams.set(key, String(value));',
    '        }',
    '      }',
    '      if (input.header && typeof input.header === "object") {',
    '        Object.assign(headers, input.header);',
    '      }',
    '      if (input.body !== undefined && route.requestBodyKind !== "none") {',
    '        switch (route.requestBodyKind) {',
    '          case "form":',
    '            init.body = toFormUrlEncoded(input.body);',
    '            headers["content-type"] = route.requestContentType ?? "application/x-www-form-urlencoded";',
    '            break;',
    '          case "binary":',
    '            init.body = toBinaryBody(input.body);',
    '            if (route.requestContentType) headers["content-type"] = route.requestContentType;',
    '            break;',
    '          case "text":',
    '            init.body = typeof input.body === "string" ? input.body : String(input.body);',
    '            headers["content-type"] = route.requestContentType ?? "text/plain";',
    '            break;',
    '          case "json":',
    '          default:',
    '            init.body = JSON.stringify(input.body);',
    '            headers["content-type"] = route.requestContentType ?? "application/json";',
    '            break;',
    '        }',
    '      }',
    '      if (route.graphqlOperationName) {',
    '        const graphQlVariables = input && typeof input === "object" && input.body !== undefined',
    '          ? input.body',
    '          : input;',
    '        init.body = JSON.stringify({',
    '          operationName: route.graphqlOperationName,',
    '          query: route.graphqlQuery,',
    '          ...(graphQlVariables && typeof graphQlVariables === "object" ? graphQlVariables : { variables: graphQlVariables }),',
    '        });',
    '        headers["content-type"] = route.requestContentType ?? "application/json";',
    '      }',
    '    }',
    '',
    '    const response = await fetchImpl(url, init);',
    '    if (!response.ok) {',
    '      throw new Error(`OpenAPI wrapper call failed for ${methodName}: ${response.status} ${response.statusText}`);',
    '    }',
    '    if (response.status === 204 || response.status === 205) {',
    '      return undefined;',
    '    }',
    '    const contentType = response.headers.get("content-type") ?? route.responseContentType ?? "";',
    '    if (contentType.includes("application/json") || contentType.endsWith("+json")) {',
    '      const parsed = await response.json();',
    '      if (route.graphqlOperationName && parsed && typeof parsed === "object") {',
    '        const data = (parsed as { data?: unknown }).data;',
    '        if (!route.graphqlRootFieldNames || route.graphqlRootFieldNames.length === 0) {',
    '          return data;',
    '        }',
    '        if (route.graphqlRootFieldNames.length === 1 && data && typeof data === "object") {',
    '          return (data as Record<string, unknown>)[route.graphqlRootFieldNames[0]!];',
    '        }',
    '        return data;',
    '      }',
    '      return parsed;',
    '    }',
    '    if (contentType.startsWith("text/")) {',
    '      return await response.text();',
    '    }',
    '    if (contentType.includes("application/octet-stream") || contentType.startsWith("image/")) {',
    '      return new Uint8Array(await response.arrayBuffer());',
    '    }',
    '    const raw = await response.text();',
    '    if (!raw) {',
    '      return undefined;',
    '    }',
    '    try {',
    '      return JSON.parse(raw);',
    '    } catch {',
    '      return raw;',
    '    }',
    '  };',
    '}',
  ].join('\n');
}

function renderRuntimeSurface(globalName: string, rootTypeName: string, methods: OpenApiSurfaceMethod[], rootPath: string[]): string {
  const routes = methods.map((method) => ({
    methodName: method.methodName,
    httpMethod: method.httpMethod,
    httpPath: method.httpPath,
    propertyPath: method.propertyPath,
    requestContentType: method.requestContentType,
    requestBodyKind: method.requestBodyKind,
    responseContentType: method.responseContentType,
    graphqlOperationName: method.graphqlOperationName,
    graphqlRootFieldNames: method.graphqlRootFieldNames,
    graphqlQuery: method.graphqlQuery,
  }));
  return [
    `export const ${globalName}Routes = ${JSON.stringify(routes, null, 2)} as const;`,
    '',
    `export function create${pascalize(globalName)}Surface(options: OpenApiFetchOptions): Rpcify<${rootTypeName}> {`,
    `  const call = create${pascalize(globalName)}Caller(options);`,
    `  const routeMap = new Map(${globalName}Routes.map((route) => [route.methodName, route] as const));`,
    `  return createEndpointSurface(${JSON.stringify(rootPath)}, {`,
    '    caller: async (method, ...args) => {',
    '      const methodName = (method as { __nrpcMethodName?: string }).__nrpcMethodName;',
    '      if (!methodName) {',
    '        throw new Error("OpenAPI wrapper method is missing __nrpcMethodName metadata.");',
    '      }',
    '      const route = routeMap.get(methodName);',
    '      if (!route) {',
    '        throw new Error(`Missing generated OpenAPI route for ${methodName}.`);',
    '      }',
    '      return call(methodName, route, args[0]);',
    '    },',
    `  }) as Rpcify<${rootTypeName}>;`,
    '}',
  ].join('\n');
}

function renderRouteManifest(globalName: string, methods: OpenApiSurfaceMethod[], rootPath: string[]): string {
  return `export const ${globalName}OpenApiManifest = ${JSON.stringify({
    id: rootPath[rootPath.length - 1] ?? globalName,
    rootPath,
    routes: methods.map((method) => ({
      methodName: method.methodName,
      propertyPath: method.propertyPath,
      httpMethod: method.httpMethod,
      httpPath: method.httpPath,
      requestContentType: method.requestContentType,
      requestBodyKind: method.requestBodyKind,
      responseContentType: method.responseContentType,
      summary: method.summary,
      description: method.description,
      tags: method.tags,
      inputTypeName: method.inputTypeName,
      resultTypeName: method.resultTypeName,
      graphqlOperationName: method.graphqlOperationName,
      graphqlRootFieldNames: method.graphqlRootFieldNames,
      graphqlQuery: method.graphqlQuery,
    })),
  }, null, 2)} as const;`;
}

function renderOpenApiSurfaceDocs(input: { document: OpenApiDocumentLike; methods: OpenApiSurfaceMethod[] }): string {
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
    `export const docsJson = ${JSON.stringify(input.document, null, 2)};`,
    '',
    `export const docsMethods = ${JSON.stringify(docsMethods, null, 2)};`,
    '',
  ].join('\n');
}

function renderOpenApiMcpTools(input: { globalName: string; methods: OpenApiSurfaceMethod[] }): string {
  const methodSpecs = input.methods.map((method) => ({
    name: toMcpToolName(input.globalName, method.methodName),
    methodName: method.methodName,
    description: buildMcpToolDescription(method),
    inputSchema: method.inputJsonSchema,
    route: {
      httpMethod: method.httpMethod,
      httpPath: method.httpPath,
      requestContentType: method.requestContentType,
      requestBodyKind: method.requestBodyKind,
      responseContentType: method.responseContentType,
      graphqlOperationName: method.graphqlOperationName,
      graphqlRootFieldNames: method.graphqlRootFieldNames,
      graphqlQuery: method.graphqlQuery,
    },
  }));

  return [
    '// AUTO-GENERATED FILE. DO NOT EDIT.',
    'export type OpenApiMcpToolResponse = {',
    '  content: Array<{ type: "text"; text: string }>; ',
    '  role?: string;',
    '};',
    '',
    'export type OpenApiMcpToolDefinition = {',
    '  name: string;',
    '  description: string;',
    '  inputSchema: Record<string, unknown>;',
    '  handler: (args: Record<string, unknown>) => Promise<OpenApiMcpToolResponse>;',
    '};',
    '',
    'export type OpenApiMcpToolOptions = {',
    '  baseUrl: string;',
    '  fetch?: typeof fetch;',
    '  defaultHeaders?: Record<string, string>;',
    '};',
    '',
    'type GeneratedOpenApiRoute = {',
    '  httpMethod: string;',
    '  httpPath: string;',
    '  requestContentType?: string;',
    '  requestBodyKind: "none" | "json" | "form" | "binary" | "text";',
    '  responseContentType?: string;',
    '  graphqlOperationName?: string;',
    '  graphqlRootFieldNames?: string[];',
    '  graphqlQuery?: string;',
    '};',
    '',
    `export const ${input.globalName}McpToolSpecs = ${JSON.stringify(methodSpecs, null, 2)} as const;`,
    '',
    'function toTextResponse(value: unknown): OpenApiMcpToolResponse {',
    '  return {',
    '    content: [',
    '      {',
    '        type: "text",',
    '        text: JSON.stringify(value, null, 2),',
    '      },',
    '    ],',
    '  };',
    '}',
    '',
    'function toFormUrlEncoded(value: unknown): string {',
    '  if (!value || typeof value !== "object") {',
    '    return "";',
    '  }',
    '  const params = new URLSearchParams();',
    '  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {',
    '    if (entry === undefined || entry === null) continue;',
    '    if (Array.isArray(entry)) {',
    '      for (const item of entry) {',
    '        params.append(key, String(item));',
    '      }',
    '      continue;',
    '    }',
    '    params.set(key, String(entry));',
    '  }',
    '  return params.toString();',
    '}',
    '',
    'function toBinaryBody(value: unknown): BodyInit {',
    '  if (value instanceof Uint8Array) return value;',
    '  if (value instanceof ArrayBuffer) return value;',
    '  if (value instanceof Blob) return value;',
    '  if (typeof value === "string") return value;',
    '  return JSON.stringify(value);',
    '}',
    '',
    'async function parseResponseBody(response: Response, route: GeneratedOpenApiRoute): Promise<unknown> {',
    '  if (response.status === 204 || response.status === 205) {',
    '    return null;',
    '  }',
    '  const contentType = response.headers.get("content-type") ?? route.responseContentType ?? "";',
    '  if (contentType.includes("application/json") || contentType.endsWith("+json")) {',
    '    const parsed = await response.json();',
    '    if (route.graphqlOperationName && parsed && typeof parsed === "object") {',
    '      const data = (parsed as { data?: unknown }).data;',
    '      if (!route.graphqlRootFieldNames || route.graphqlRootFieldNames.length === 0) return data;',
    '      if (route.graphqlRootFieldNames.length === 1 && data && typeof data === "object") {',
    '        return (data as Record<string, unknown>)[route.graphqlRootFieldNames[0]!];',
    '      }',
    '      return data;',
    '    }',
    '    return parsed;',
    '  }',
    '  if (contentType.startsWith("text/")) {',
    '    return await response.text();',
    '  }',
    '  if (contentType.includes("application/octet-stream") || contentType.startsWith("image/")) {',
    '    return Array.from(new Uint8Array(await response.arrayBuffer()));',
    '  }',
    '  const raw = await response.text();',
    '  if (!raw) return null;',
    '  try {',
    '    return JSON.parse(raw);',
    '  } catch {',
    '    return raw;',
    '  }',
    '}',
    '',
    `export function create${pascalize(input.globalName)}McpTools(options: OpenApiMcpToolOptions): OpenApiMcpToolDefinition[] {`,
    '  const fetchImpl = options.fetch ?? fetch;',
    `  return ${input.globalName}McpToolSpecs.map((spec) => ({`,
    '    name: spec.name,',
    '    description: spec.description,',
    '    inputSchema: spec.inputSchema as Record<string, unknown>,',
    '    handler: async (args) => {',
    '      const route = spec.route as GeneratedOpenApiRoute;',
    '      const url = new URL(route.httpPath, options.baseUrl);',
    '      const headers: Record<string, string> = { ...(options.defaultHeaders ?? {}) };',
    '      const input = args && typeof args === "object" ? args as Record<string, unknown> : {};',
    '      const pathArgs = input.path && typeof input.path === "object" ? input.path as Record<string, unknown> : {};',
    '      const queryArgs = input.query && typeof input.query === "object" ? input.query as Record<string, unknown> : {};',
    '      const headerArgs = input.header && typeof input.header === "object" ? input.header as Record<string, unknown> : {};',
    '',
    '      for (const [key, value] of Object.entries(pathArgs)) {',
    '        url.pathname = url.pathname.replace(`{${key}}`, encodeURIComponent(String(value)));',
    '      }',
    '      for (const [key, value] of Object.entries(queryArgs)) {',
    '        if (value === undefined || value === null) continue;',
    '        if (Array.isArray(value)) {',
    '          for (const item of value) {',
    '            url.searchParams.append(key, String(item));',
    '          }',
    '          continue;',
    '        }',
    '        url.searchParams.set(key, String(value));',
    '      }',
    '      for (const [key, value] of Object.entries(headerArgs)) {',
    '        if (typeof value === "string" && value.length > 0) {',
    '          headers[key] = value;',
    '        }',
    '      }',
    '',
    '      const init: RequestInit = { method: route.httpMethod, headers };',
    '      if (input.body !== undefined && route.requestBodyKind !== "none") {',
    '        switch (route.requestBodyKind) {',
    '          case "form":',
    '            init.body = toFormUrlEncoded(input.body);',
    '            headers["content-type"] = route.requestContentType ?? "application/x-www-form-urlencoded";',
    '            break;',
    '          case "binary":',
    '            init.body = toBinaryBody(input.body);',
    '            if (route.requestContentType) headers["content-type"] = route.requestContentType;',
    '            break;',
    '          case "text":',
    '            init.body = typeof input.body === "string" ? input.body : String(input.body);',
    '            headers["content-type"] = route.requestContentType ?? "text/plain";',
    '            break;',
    '          case "json":',
    '          default:',
    '            init.body = JSON.stringify(input.body);',
    '            headers["content-type"] = route.requestContentType ?? "application/json";',
    '            break;',
    '        }',
    '      }',
    '      if (route.graphqlOperationName) {',
    '        const graphQlVariables = input.body !== undefined ? input.body : input;',
    '        init.body = JSON.stringify({',
    '          operationName: route.graphqlOperationName,',
    '          query: route.graphqlQuery,',
    '          ...(graphQlVariables && typeof graphQlVariables === "object" ? graphQlVariables : { variables: graphQlVariables }),',
    '        });',
    '        headers["content-type"] = route.requestContentType ?? "application/json";',
    '      }',
    '',
    '      const response = await fetchImpl(url, init);',
    '      const body = await parseResponseBody(response, route);',
    '      return toTextResponse({',
    '        ok: response.ok,',
    '        status: response.status,',
    '        statusText: response.statusText,',
    '        url: url.toString(),',
    '        headers: Object.fromEntries(response.headers.entries()),',
    '        body,',
    '      });',
    '    },',
    '  }));',
    '}',
    '',
  ].join('\n');
}

function buildMcpToolDescription(method: OpenApiSurfaceMethod): string {
  const summary = method.summary?.trim() || `Invoke ${method.httpMethod} ${method.httpPath}`;
  const description = method.description?.trim();
  return [
    summary,
    `HTTP: ${method.httpMethod} ${method.httpPath}`,
    ...(description ? [description] : []),
  ].join('\n');
}

function toMcpToolName(globalName: string, methodName: string): string {
  return `${globalName}_${methodName}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 100);
}

function safePropertyName(value: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value) ? value : JSON.stringify(value);
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
