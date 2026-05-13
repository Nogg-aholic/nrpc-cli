import {
  collectOpenApiSurfaceMethodSources,
  readOpenApiDocument,
  resolveDocumentRef,
  type JsonSchema,
  type OpenApiDocumentLike,
  type OpenApiParameter,
  type OpenApiSurfaceMethodSource,
  type RequestBodyKind,
  type ResolvedRequestBody,
  type ResolvedResponse,
} from './openapi-surface-extraction.js';
import type { NrpcSurfaceManifest } from './nrpc-surface/types.js';
import { renderOpenApiSurfaceContract } from './openapi-surface/contract-renderer.js';
import { renderNrpcSurfaceDocs, renderOpenApiSurfaceDocs } from './openapi-surface/docs-renderer.js';
import { renderOpenApiMcpTools } from './openapi-surface/mcp-renderer.js';
import { buildMethodTypeBaseName, pascalize, safePropertyName, type OpenApiSurfaceMethod } from './openapi-surface/renderer-shared.js';

export type GenerateOpenApiSurfaceOptions = {
  openApiFile: string;
  outputImportPath: string;
  rootTypeName?: string;
  globalName?: string;
  rootPath?: string[];
  manifest?: NrpcSurfaceManifest;
};

export type GeneratedOpenApiSurfaceResult = {
  contractText: string;
  docsText: string;
  mcpToolsText: string;
};

export function generateOpenApiSurface(options: GenerateOpenApiSurfaceOptions): GeneratedOpenApiSurfaceResult {
  const document = readOpenApiDocument(options.openApiFile);
  const typeRenderContext = createSurfaceTypeRenderContext(document);
  const methods = options.manifest
    ? collectNrpcSurfaceMethods(options.manifest, typeRenderContext)
    : collectOpenApiSurfaceMethods(document, typeRenderContext);
  const globalName = options.globalName ?? 'openApi';
  const rootTypeName = options.rootTypeName ?? 'OpenApiSurface';
  const rootPath = options.rootPath ?? [globalName];

  const contractText = renderOpenApiSurfaceContract({
    componentTypeDeclarations: [...typeRenderContext.componentTypeDeclarations.values()],
    methods,
    globalName,
    rootTypeName,
    rootPath,
  });

  const docsText = options.manifest
    ? renderNrpcSurfaceDocs({
        document,
        methods,
        manifest: options.manifest,
      })
    : renderOpenApiSurfaceDocs({
        document,
        methods,
      });

  const mcpToolsText = renderOpenApiMcpTools({
    globalName,
    methods,
  });

  return { contractText, docsText, mcpToolsText };
}

type SurfaceTypeRenderContext = {
  document: OpenApiDocumentLike;
  componentTypeNames: Map<string, string>;
  componentTypeDeclarations: Map<string, string>;
  componentTypeNameByRenderedType: Map<string, string>;
  reservedTypeNames: Set<string>;
  renderingRefs: Set<string>;
};

function createSurfaceTypeRenderContext(document: OpenApiDocumentLike): SurfaceTypeRenderContext {
  return {
    document,
    componentTypeNames: new Map<string, string>(),
    componentTypeDeclarations: new Map<string, string>(),
    componentTypeNameByRenderedType: new Map<string, string>(),
    reservedTypeNames: new Set<string>(),
    renderingRefs: new Set<string>(),
  };
}

function collectOpenApiSurfaceMethods(document: OpenApiDocumentLike, typeRenderContext: SurfaceTypeRenderContext): OpenApiSurfaceMethod[] {
  return collectOpenApiSurfaceMethodSources(document).map((methodSource) => toOpenApiSurfaceMethod(methodSource, document, typeRenderContext));
}

function collectNrpcSurfaceMethods(manifest: NrpcSurfaceManifest, typeRenderContext: SurfaceTypeRenderContext): OpenApiSurfaceMethod[] {
  const httpBindingsByMethodName = new Map(
    (manifest.bindings?.http ?? []).map((binding) => [binding.methodName, binding]),
  );

  return manifest.methods.map((method) => {
    const httpBinding = httpBindingsByMethodName.get(method.methodName);
    if (!httpBinding) {
      throw new Error(`Missing HTTP binding for method \"${method.methodName}\" in NRPC surface manifest.`);
    }

    const methodSource: OpenApiSurfaceMethodSource = {
      methodName: method.methodName,
      propertyPath: method.propertyPath,
      symbolSemanticFlags: method.semantic.symbolSemanticFlags,
      httpMethod: httpBinding.transport.entrypoint.method,
      httpPath: httpBinding.transport.entrypoint.path,
      effects: method.semantic.effects,
      genericTypeParameters: method.signature.genericTypeParameters,
      parameterNames: method.signature.parameterNames,
      parameterOptionalFlags: method.signature.parameterOptionalFlags,
      parameterTypeTexts: method.signature.parameterTypeTexts,
      resultTypeText: method.signature.resultTypeText,
      memberAbiFlags: method.semantic.memberAbiFlags,
      nodeAbiFlags: method.semantic.nodeAbiFlags,
      requestContentType: httpBinding.transport.entrypoint.requestContentType,
      requestBodyKind: 'json',
      responseContentType: httpBinding.transport.entrypoint.responseContentType,
      summary: method.docs?.summary,
      description: method.docs?.description,
      tags: method.docs?.tags ?? [],
      parameters: [],
      requestBody: {
        required: method.runtime.requestRequired,
        contentType: httpBinding.transport.entrypoint.requestContentType,
        bodyKind: 'json',
        schema: nrpcRuntimeShapeToOpenApiSchema(method.runtime.inputShape),
      },
      response: {
        statusCode: '200',
        contentType: httpBinding.transport.entrypoint.responseContentType,
        schema: nrpcRuntimeShapeToOpenApiSchema(method.runtime.resultShape),
      },
    };

    return toOpenApiSurfaceMethod(methodSource, typeRenderContext.document, typeRenderContext);
  });
}

function nrpcRuntimeShapeToOpenApiSchema(shape: import('./nrpc-surface/types.js').NrpcRuntimeShape): JsonSchema {
  switch (shape.kind) {
    case 'primitive':
      return { type: shape.primitive };
    case 'bigint':
      return { type: 'string', title: 'bigint' };
    case 'unknown':
    case 'undefined':
      return {};
    case 'null':
      return { nullable: true };
    case 'literal':
      return {
        enum: shape.literalValue === undefined ? [] : [shape.literalValue],
        type: typeof shape.literalValue === 'boolean' ? 'boolean' : typeof shape.literalValue === 'number' ? 'number' : 'string',
      };
    case 'optional':
      return nrpcRuntimeShapeToOpenApiSchema(shape.inner ?? { kind: 'unknown' });
    case 'date':
      return shape.datePolicy === 'epoch-ms' ? { type: 'number', title: 'Date' } : { type: 'string', title: 'Date' };
    case 'map':
      if (shape.mapPolicy === 'object' && shape.keyShape?.kind === 'primitive' && shape.keyShape.primitive === 'string') {
        return {
          type: 'object',
          additionalProperties: nrpcRuntimeShapeToOpenApiSchema(shape.valueShape ?? { kind: 'unknown' }),
        };
      }
      return {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            key: nrpcRuntimeShapeToOpenApiSchema(shape.keyShape ?? { kind: 'unknown' }),
            value: nrpcRuntimeShapeToOpenApiSchema(shape.valueShape ?? { kind: 'unknown' }),
          },
          required: ['key', 'value'],
        },
      };
    case 'record':
      return {
        type: 'object',
        additionalProperties: nrpcRuntimeShapeToOpenApiSchema(shape.valueShape ?? { kind: 'unknown' }),
      };
    case 'set':
    case 'array':
      return { type: 'array', items: nrpcRuntimeShapeToOpenApiSchema(shape.valueShape ?? { kind: 'unknown' }) };
    case 'union':
    case 'discriminated-union':
      return { anyOf: (shape.variants ?? []).map((variant) => nrpcRuntimeShapeToOpenApiSchema(variant)) };
    case 'typed-array':
      return { type: 'array', items: { type: 'number' }, title: shape.arrayType };
    case 'tuple':
      return { type: 'array', items: (shape.elements?.length ?? 0) > 0 ? { anyOf: (shape.elements ?? []).map((entry) => nrpcRuntimeShapeToOpenApiSchema(entry)) } : {} };
    case 'object':
      return shape.schemaId
        ? { $ref: `#/components/schemas/${shape.schemaId}` }
        : {
            type: 'object',
            properties: Object.fromEntries((shape.properties ?? []).map((property) => [property.name, nrpcRuntimeShapeToOpenApiSchema(property.shape)])),
            required: shape.required,
          };
  }
}

function toOpenApiSurfaceMethod(
  methodSource: OpenApiSurfaceMethodSource,
  document: OpenApiDocumentLike,
  typeRenderContext: SurfaceTypeRenderContext,
): OpenApiSurfaceMethod {
  const typeBase = buildMethodTypeBaseName(methodSource.propertyPath);

  return {
    methodName: methodSource.methodName,
    propertyPath: methodSource.propertyPath,
    symbolSemanticFlags: methodSource.symbolSemanticFlags,
    httpMethod: methodSource.httpMethod,
    httpPath: methodSource.httpPath,
    effects: methodSource.effects ?? {
      receiverMutability: 'none',
      mutatesReceiver: false,
      externalSideEffects: false,
      executionPurity: 'unknown',
      reason: 'effect metadata was not present in the OpenAPI operation',
    },
    memberAbiFlags: methodSource.memberAbiFlags,
    nodeAbiFlags: methodSource.nodeAbiFlags,
    typeBaseName: typeBase,
    inputTypeName: `input__${typeBase}`,
    resultTypeName: `result__${typeBase}`,
    inputTypeText: renderOperationInputType(
      methodSource.parameters,
      methodSource.requestBody,
      typeRenderContext,
      methodSource.parameterNames,
      methodSource.parameterTypeTexts,
      methodSource.parameterOptionalFlags,
      methodSource.genericTypeParameters,
      methodSource.resultTypeText,
    ),
    resultTypeText: renderOperationResultType(methodSource.response, typeRenderContext, methodSource.resultTypeText),
    genericTypeParameters: methodSource.genericTypeParameters,
    parameterNames: methodSource.parameterNames,
    parameterOptionalFlags: methodSource.parameterOptionalFlags,
    parameterTypeTexts: methodSource.parameterTypeTexts,
    resultTypeSourceText: methodSource.resultTypeText,
    inputJsonSchema: buildOperationInputJsonSchema(methodSource.parameters, methodSource.requestBody, document),
    requestContentType: methodSource.requestContentType,
    requestBodyKind: methodSource.requestBodyKind,
    responseContentType: methodSource.responseContentType,
    summary: methodSource.summary,
    description: methodSource.description,
    tags: methodSource.tags,
    graphqlOperationName: methodSource.graphqlOperationName,
    graphqlRootFieldNames: methodSource.graphqlRootFieldNames,
    graphqlQuery: methodSource.graphqlQuery,
  };
}

function renderOperationInputType(
  parameters: OpenApiParameter[],
  requestBody: ResolvedRequestBody | undefined,
  typeRenderContext: SurfaceTypeRenderContext,
  parameterNames?: string[],
  parameterTypeTexts?: string[],
  parameterOptionalFlags?: boolean[],
  genericTypeParameters?: string[],
  resultTypeText?: string,
): string {
  const knownBodyType = renderKnownBodyType(
    requestBody,
    parameterNames,
    parameterTypeTexts,
    parameterOptionalFlags,
    genericTypeParameters,
    resultTypeText,
  );
  if (knownBodyType) {
    return knownBodyType;
  }

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
      const propertyType = schemaToTypeText(entry.schema, typeRenderContext);
      return `${propertyName}${entry.required ? '' : '?'}: ${propertyType};`;
    });
    fields.push(`${location}: { ${objectLines.join(' ')} };`);
  }

  if (requestBody) {
    fields.push(`body${requestBody.required ? '' : '?'}: ${renderRequestBodyType(requestBody, typeRenderContext)};`);
  }

  if (fields.length === 0) {
    return 'undefined';
  }

  return `{
  ${fields.join('\n  ')}
}`;
}

function renderKnownBodyType(
  requestBody: ResolvedRequestBody | undefined,
  parameterNames?: string[],
  parameterTypeTexts?: string[],
  parameterOptionalFlags?: boolean[],
  genericTypeParameters?: string[],
  resultTypeText?: string,
): string | undefined {
  if (!requestBody || requestBody.bodyKind !== 'json') {
    return undefined;
  }
  if (!parameterNames || !parameterTypeTexts || parameterNames.length === 0 || parameterNames.length !== parameterTypeTexts.length) {
    return undefined;
  }

  const fields = parameterNames.map((name, index) => {
    const rawTypeText = parameterTypeTexts[index]?.trim();
    const typeText = rawTypeText
      ? normalizeTypeText(simplifyReceiverOnlyGenericType(name, rawTypeText, parameterNames, parameterTypeTexts, genericTypeParameters, resultTypeText))
      : rawTypeText;
    if (!typeText) {
      return undefined;
    }
    const isOptional = parameterOptionalFlags?.[index] === true;
    return `  ${safePropertyName(name)}${isOptional ? '?' : ''}: ${typeText};`;
  });

  if (fields.some((entry) => entry === undefined)) {
    return undefined;
  }

  return `{
${fields.join('\n')}
}`;
}

function simplifyReceiverOnlyGenericType(
  parameterName: string,
  typeText: string,
  parameterNames: string[],
  parameterTypeTexts: string[],
  genericTypeParameters: string[] | undefined,
  resultTypeText: string | undefined,
): string {
  if (parameterName !== 'receiver' || !genericTypeParameters || genericTypeParameters.length === 0) {
    return typeText;
  }

  const genericNames = genericTypeParameters.map((parameter) => parameter.split(/\sextends\s|\s*=\s/u)[0]!.trim());
  const otherParameterText = parameterNames
    .map((name, index) => name === 'receiver' ? undefined : parameterTypeTexts[index]?.trim())
    .filter((entry): entry is string => !!entry)
    .join('\n');
  const combinedOtherUsage = `${otherParameterText}\n${resultTypeText ?? ''}`;
  const anyUsedOutsideReceiver = genericNames.some((name) => new RegExp(`\\b${escapeRegExp(name)}\\b`, 'u').test(combinedOtherUsage));
  if (anyUsedOutsideReceiver) {
    return typeText;
  }

  const simplified = typeText.replace(/<[^<>]+>$/u, '');
  // Don't produce a bare unparameterized identifier like `Array` - that's worse than the original
  if (simplified === typeText || /^[A-Z][\w]*$/u.test(simplified.trim())) {
    return typeText;
  }
  return simplified;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function renderRequestBodyType(requestBody: ResolvedRequestBody, typeRenderContext: SurfaceTypeRenderContext): string {
  if (requestBody.bodyKind === 'binary') {
    return 'Uint8Array | ArrayBuffer | Blob | string';
  }
  if (requestBody.bodyKind === 'text') {
    return 'string';
  }
  return schemaToTypeText(requestBody.schema, typeRenderContext);
}

function normalizeTypeText(text: string): string {
  // Type predicates like `arg is any[]` are only valid as function return types, not standalone aliases
  if (/^\w+\s+is\s+/u.test(text)) {
    return 'boolean';
  }
  // Replace `any` with `unknown` everywhere in the type text
  return postProcessNormalizedTypeText(
    sanitizeForeignTypeReferences(qualifyTypeScriptDeclarationNames(text.replace(/\bany\b/gu, 'unknown'))),
  );
}

const TYPESCRIPT_DECLARATION_NAME_PATTERN = /\b(?:SyntaxKind|TextChangeRange|Classifier|JSDocParsingMode|DocumentRegistry|TextSpan|SymbolDisplayPart|SourceFile|__String|DiagnosticMessageChain|Declaration|ModifierFlags|NodeFlags|TextRange|AccessExpression|HasDecorators|Decorator|CompilerOptions|FormatCodeSettings|TypeParameterDeclaration|TypeNode|DeclarationWithTypeParameters|CommentRange|SourceFileLike|LineAndCharacter|FileReference|ResolutionMode|StringLiteralLike|HasModifiers|Modifier|Expression|DeclarationName|SynthesizedComment|SignatureDeclaration|JSDocSignature|Identifier|KeywordSyntaxKind|PrivateIdentifier|BindingElement|ArrayBindingElement|BindingName|ScriptTarget|LanguageVariant|ParameterDeclaration|JSDocParameterTag|EntityName|JsonSourceFile|PreProcessedFileInfo|ReadBuildProgramHost|EmitAndSemanticDiagnosticsBuilderProgram|ModuleResolutionCache|ResolvedModuleWithFailedLookupLocations|ProjectReference|ResolvedConfigFileName|EmitFlags|Diagnostic|SortedReadonlyArray|EditorOptions|EditorSettings|Node|VariableDeclaration)\b/gu;

function qualifyTypeScriptDeclarationNames(text: string): string {
  return text.replace(TYPESCRIPT_DECLARATION_NAME_PATTERN, (match, offset, fullText) => {
    const before = offset > 0 ? fullText[offset - 1] : '';
    const after = offset + match.length < fullText.length ? fullText[offset + match.length] : '';

    if (before === '.' || before === ':' || before === '"' || before === "'") {
      return match;
    }

    if (after === ':') {
      return match;
    }

    return `ts.${match}`;
  });
}

const FOREIGN_NAMESPACE_FALLBACKS: ReadonlyArray<[RegExp, string]> = [
  [/\bStream\.PipeOptions\b/gu, 'StreamPipeOptions'],
  [/\bNonSharedBuffer\b/gu, 'Uint8Array<ArrayBufferLike>'],
  [/\bNodeJS\.NonSharedUint8Array\b/gu, 'Uint8Array<ArrayBufferLike>'],
  [/\bNodeJS\.ArrayBufferView\b/gu, 'ArrayBufferView'],
  [/\b(?:TracingChannelCollection|Tracing|CreateTracingOptions|CpuUsage|Channel|LookupAddress|AnyRecord|CaaRecord|MxRecord|NaptrRecord|SoaRecord|SrvRecord|TlsaRecord)\b/gu, 'Record<string, unknown>'],
  [/\b(?:SyncCPUProfileHandle|HeapSnapshotOptions|Context|MeasureMemoryOptions|MemoryMeasurement|ZlibOptions|HeapCodeStatistics|HeapSpaceInfo|HeapInfo)\b/gu, 'Record<string, unknown>'],
  [/\bInputType\b/gu, 'string | ArrayBufferView | ArrayBuffer'],
  [/\bNodeJS\.TypedArray\b/gu, 'ArrayBufferView'],
  [/\bBuffer<[^>]+>(?:<[^>]+>)?/gu, 'Uint8Array<ArrayBufferLike>'],
  [/\bBuffer\b/gu, 'Uint8Array<ArrayBufferLike>'],
  [/\bBun\.StringOrBuffer\b/gu, 'string | ArrayBufferView | ArrayBuffer'],
  [/\bStringOrBuffer\b/gu, 'string | ArrayBufferView | ArrayBuffer'],
  [/\bPassword\.(?:AlgorithmLabel|Argon2Algorithm|BCryptAlgorithm)\b/gu, 'string'],
  [/\b(?:AlgorithmLabel|Argon2Algorithm|BCryptAlgorithm)\b/gu, 'string'],
  [/\bCronWithAutocomplete\b/gu, 'string'],
  [/\bCronJob\b/gu, 'Record<string, unknown>'],
  [/\bProcessEnv\b/gu, 'Record<string, string | undefined>'],
  [/\bImportMetaEnv\b/gu, 'Record<string, string | undefined>'],
  [/\btypeof\s+custom\b/gu, 'symbol'],
  [/\bBunRegisterPlugin\b/gu, 'Record<string, unknown>'],
  [/\bS3Client\b/gu, 'Record<string, unknown>'],
  [/\bSQL\.Query(?:<[^>]+>)?\b/gu, 'unknown'],
  [/\bRedisClient\.KeyLike\b/gu, 'string | number | ArrayBufferView | ArrayBuffer'],
  [/\b(?:CSRFGenerateOptions|CSRFVerifyOptions|BuildConfig|BuildOutput|ColorInput|BunInspectOptions|HeapSnapshot|MMapOptions|AnsiTheme|ParseChunkResult|Options|S3Options|S3File|S3Stats|S3ListObjectsResponse|S3FilePresignOptions|S3ListObjectsOptions|StringLike|SliceAnsiOptions|StringWidthOptions|WhichOptions|WrapAnsiOptions|Stats|FileSink|BunFile|Archive)\b/gu, 'unknown'],
  [/\btypeof\s+(?:CSRF|JSON5|JSONC|JSONL|YAML)\b/gu, 'Record<string, unknown>'],
];

function sanitizeForeignTypeReferences(text: string): string {
  let sanitized = text;
  for (const [pattern, replacement] of FOREIGN_NAMESPACE_FALLBACKS) {
    sanitized = sanitized.replace(pattern, replacement);
  }
  return sanitized;
}

function postProcessNormalizedTypeText(text: string): string {
  let normalized = text;

  // `unknown<T>` is invalid after generic source types like SQL.Query<T> get collapsed.
  normalized = normalized.replace(/\bunknown<[^>]+>/gu, 'unknown');

  // `Pick<unknown, ...>` is invalid and appears when foreign option bag types are degraded.
  normalized = normalized.replace(/\bPick<\s*unknown\s*,\s*[^>]+>/gu, 'Record<string, unknown>');

  // Namespace fallback replacement can leave generic args attached to a non-generic fallback.
  normalized = normalized.replace(/\bRecord<string, unknown><[^>]+>/gu, 'Record<string, unknown>');

  // Fix array suffixes that were attached to the last union member after namespace replacement.
  normalized = normalized.replace(
    /((?:string|number|boolean|ArrayBufferView|ArrayBuffer|Uint8Array<ArrayBufferLike>|unknown)(?:\s*\|\s*(?:string|number|boolean|ArrayBufferView|ArrayBuffer|Uint8Array<ArrayBufferLike>|unknown))+)(\[\])/gu,
    (_match, unionBody: string, arraySuffix: string) => {
      const parts = unionBody.split(/\s*\|\s*/u).map((part) => `${part}${arraySuffix}`);
      return parts.join(' | ');
    },
  );

  // Deduplicate simple union members while preserving order.
  normalized = normalized.replace(/(?:[^;{}()\n]|<[^>]*>)+/gu, (segment) => dedupeUnionSegment(segment));

  return normalized;
}

function dedupeUnionSegment(segment: string): string {
  if (!segment.includes('|')) {
    return segment;
  }

  const parts = segment.split('|').map((part) => part.trim());
  if (parts.some((part) => part.length === 0)) {
    return segment;
  }

  const uniqueParts: string[] = [];
  for (const part of parts) {
    if (!uniqueParts.includes(part)) {
      uniqueParts.push(part);
    }
  }

  return uniqueParts.join(' | ');
}

function renderOperationResultType(response: ResolvedResponse | undefined, typeRenderContext: SurfaceTypeRenderContext, resultTypeText?: string): string {
  const trimmedResultTypeText = resultTypeText?.trim();
  if (trimmedResultTypeText && trimmedResultTypeText.length > 0 && trimmedResultTypeText !== 'unknown' && trimmedResultTypeText !== 'this') {
    return normalizeTypeText(trimmedResultTypeText);
  }
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
    return schemaToTypeText(response.schema, typeRenderContext);
  }
  if (response.contentType.startsWith('text/')) {
    return 'string';
  }
  if (response.contentType === 'application/octet-stream' || response.contentType.startsWith('image/')) {
    return 'Uint8Array';
  }
  return response.schema ? schemaToTypeText(response.schema, typeRenderContext) : 'unknown';
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

function decodeJsonPointerSegment(value: string): string {
  return value.replace(/~1/g, '/').replace(/~0/g, '~');
}

function getComponentTypeName(ref: string, typeRenderContext: SurfaceTypeRenderContext): string {
  const existing = typeRenderContext.componentTypeNames.get(ref);
  if (existing) {
    return existing;
  }

  const baseName = `OpenApi${ref
    .replace(/^#\//, '')
    .split('/')
    .filter(Boolean)
    .map((part) => pascalize(decodeJsonPointerSegment(part)))
    .join('') || 'Component'}`;

  let name = baseName;
  let suffix = 2;
  while (typeRenderContext.reservedTypeNames.has(name)) {
    name = `${baseName}${suffix}`;
    suffix += 1;
  }

  typeRenderContext.reservedTypeNames.add(name);
  typeRenderContext.componentTypeNames.set(ref, name);
  return name;
}

function ensureComponentTypeDeclaration(ref: string, typeRenderContext: SurfaceTypeRenderContext): string {
  const componentTypeName = getComponentTypeName(ref, typeRenderContext);
  if (typeRenderContext.componentTypeDeclarations.has(ref) || typeRenderContext.renderingRefs.has(ref)) {
    return componentTypeName;
  }

  const resolved = resolveDocumentRef<JsonSchema>(ref, typeRenderContext.document);
  if (!resolved) {
    typeRenderContext.componentTypeDeclarations.set(ref, `export type ${componentTypeName} = unknown;`);
    return componentTypeName;
  }

  typeRenderContext.renderingRefs.add(ref);
  const renderedType = schemaToTypeText(resolved, typeRenderContext, new Set([ref]));
  typeRenderContext.renderingRefs.delete(ref);

  const canonicalTypeName = typeRenderContext.componentTypeNameByRenderedType.get(renderedType);
  if (canonicalTypeName) {
    typeRenderContext.componentTypeNames.set(ref, canonicalTypeName);
    return canonicalTypeName;
  }

  typeRenderContext.componentTypeNameByRenderedType.set(renderedType, componentTypeName);
  typeRenderContext.componentTypeDeclarations.set(ref, `export type ${componentTypeName} = ${renderedType};`);
  return componentTypeName;
}

function schemaToTypeText(schema: JsonSchema | undefined, typeRenderContext: SurfaceTypeRenderContext, seen = new Set<string>()): string {
  if (!schema) {
    return 'unknown';
  }

  if (schema.$ref) {
    if (seen.has(schema.$ref)) {
      return getComponentTypeName(schema.$ref, typeRenderContext);
    }
    return ensureComponentTypeDeclaration(schema.$ref, typeRenderContext);
  }

  if (schema.enum?.length) {
    return schema.enum.map((value) => JSON.stringify(value)).join(' | ');
  }

  if (schema.oneOf?.length) {
    return schema.oneOf.map((entry) => schemaToTypeText(entry, typeRenderContext, new Set(seen))).join(' | ');
  }

  if (schema.anyOf?.length) {
    return schema.anyOf.map((entry) => schemaToTypeText(entry, typeRenderContext, new Set(seen))).join(' | ');
  }

  if (schema.allOf?.length) {
    return schema.allOf.map((entry) => schemaToTypeText(entry, typeRenderContext, new Set(seen))).join(' & ');
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
      base = `Array<${schemaToTypeText(schema.items, typeRenderContext, new Set(seen))}>`;
      break;
    case 'object':
      if (schema.properties) {
        const required = new Set(schema.required ?? []);
        const entries = Object.entries(schema.properties).map(([name, value]) => {
          const optional = required.has(name) ? '' : '?';
          return `${safePropertyName(name)}${optional}: ${schemaToTypeText(value, typeRenderContext, new Set(seen))};`;
        });
        if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
          entries.push(`[key: string]: ${schemaToTypeText(schema.additionalProperties, typeRenderContext, new Set(seen))};`);
        }
        base = `{
  ${entries.join('\n  ')}
}`;
      } else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        base = `{ [key: string]: ${schemaToTypeText(schema.additionalProperties, typeRenderContext, new Set(seen))} }`;
      } else {
        base = 'Record<string, unknown>';
      }
      break;
    default:
      if (schema.properties) {
        return schemaToTypeText({ ...schema, type: 'object' }, typeRenderContext, seen);
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


