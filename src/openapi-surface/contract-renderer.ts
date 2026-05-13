import { pascalize, safePropertyName, type OpenApiSurfaceMethod } from './renderer-shared.js';

type SurfaceTreeNode = {
  method?: OpenApiSurfaceMethod;
  children: Map<string, SurfaceTreeNode>;
};

type SurfaceNodeKind = 'method' | 'property' | 'namespace';

type SharedMethodTypeTables = {
  declarations: string[];
};

type CompatibilityPreludeEntry = {
  declaration: string;
  triggers: string[];
};

type InputTypeDescriptor =
  | { kind: 'none' }
  | { kind: 'body-only'; bodyTypeText: string; optional: boolean }
  | { kind: 'full-object'; inputTypeText: string };

export function renderOpenApiSurfaceContract(input: {
  componentTypeDeclarations?: string[];
  methods: OpenApiSurfaceMethod[];
  globalName: string;
  rootTypeName: string;
  rootPath: string[];
}): string {
  const sharedMethodTypes = buildSharedMethodTypes(input.methods);
  const typeNameMap = renderTypeNameMap(input.globalName, input.methods);
  const rootType = renderSurfaceType(input.rootTypeName, input.methods);
  const effectsManifest = renderEffectsManifest(input.globalName, input.methods);
  const runtimeSurface = renderRuntimeSurface(input.globalName, input.rootTypeName, input.methods, input.rootPath);
  const manifest = renderRouteManifest(input.globalName, input.methods, input.rootPath);
  const caller = renderCallerFactory(input.globalName);
  const compatibilityPrelude = renderCompatibilityPrelude([
    ...(input.componentTypeDeclarations ?? []),
    ...sharedMethodTypes.declarations,
    rootType,
  ].join('\n'));

  return [
    '// AUTO-GENERATED FILE. DO NOT EDIT.',
    "import { createEndpointSurface, type Rpcify } from '@nogg-aholic/nrpc';",
    '',
    compatibilityPrelude,
    '',
    ...(input.componentTypeDeclarations && input.componentTypeDeclarations.length > 0
      ? [...input.componentTypeDeclarations, '']
      : []),
    ...sharedMethodTypes.declarations,
    '',
    typeNameMap,
    '',
    rootType,
    '',
    effectsManifest,
    '',
    caller,
    '',
    runtimeSurface,
    '',
    manifest,
    '',
  ].join('\n');
}

const COMPATIBILITY_PRELUDE_ENTRIES: CompatibilityPreludeEntry[] = [
  { declaration: 'type ConcatArray<T> = ReadonlyArray<T>;', triggers: ['ConcatArray'] },
  { declaration: 'type TemplateStringsArray = ReadonlyArray<string> & { readonly raw: readonly string[] };', triggers: ['TemplateStringsArray'] },
  { declaration: 'type PathLike = string | URL;', triggers: ['PathLike'] },
  { declaration: 'type Domain = Record<string, unknown>;', triggers: ['Domain'] },
  { declaration: 'type Disposable = Record<string, unknown>;', triggers: ['Disposable'] },
  { declaration: 'type ZlibCompressionOptions = Record<string, unknown>;', triggers: ['ZlibCompressionOptions'] },
  { declaration: 'type LibdeflateCompressionOptions = Record<string, unknown>;', triggers: ['LibdeflateCompressionOptions'] },
  { declaration: 'type DNSLookup = Record<string, unknown>;', triggers: ['DNSLookup'] },
  { declaration: 'type DomStorageItemAddedEventDataType = Record<string, unknown>;', triggers: ['DomStorageItemAddedEventDataType'] },
  { declaration: 'type DomStorageItemRemovedEventDataType = Record<string, unknown>;', triggers: ['DomStorageItemRemovedEventDataType'] },
  { declaration: 'type DomStorageItemsClearedEventDataType = Record<string, unknown>;', triggers: ['DomStorageItemsClearedEventDataType'] },
  { declaration: 'type DomStorageItemUpdatedEventDataType = Record<string, unknown>;', triggers: ['DomStorageItemUpdatedEventDataType'] },
  { declaration: 'type DataReceivedEventDataType = Record<string, unknown>;', triggers: ['DataReceivedEventDataType'] },
  { declaration: 'type LoadingFailedEventDataType = Record<string, unknown>;', triggers: ['LoadingFailedEventDataType'] },
  { declaration: 'type LoadingFinishedEventDataType = Record<string, unknown>;', triggers: ['LoadingFinishedEventDataType'] },
  { declaration: 'type WebSocketClosedEventDataType = Record<string, unknown>;', triggers: ['WebSocketClosedEventDataType'] },
  { declaration: 'type WebSocketCreatedEventDataType = Record<string, unknown>;', triggers: ['WebSocketCreatedEventDataType'] },
  { declaration: 'type EnableCompileCacheOptions = Record<string, unknown>;', triggers: ['EnableCompileCacheOptions'] },
  { declaration: 'type EnableCompileCacheResult = Record<string, unknown>;', triggers: ['EnableCompileCacheResult'] },
  { declaration: 'type SourceMap = Record<string, unknown>;', triggers: ['SourceMap'] },
  { declaration: 'type SourceMapsSupport = Record<string, unknown>;', triggers: ['SourceMapsSupport'] },
  { declaration: 'type RegisterOptions<Data = unknown> = Record<string, unknown>;', triggers: ['RegisterOptions'] },
  { declaration: 'type SetSourceMapsSupportOptions = Record<string, unknown>;', triggers: ['SetSourceMapsSupportOptions'] },
  { declaration: 'type StripTypeScriptTypesOptions = Record<string, unknown>;', triggers: ['StripTypeScriptTypesOptions'] },
  { declaration: 'type NonSharedBuffer = Uint8Array<ArrayBufferLike>;', triggers: ['NonSharedBuffer'] },
  { declaration: 'type NonSharedUint8Array = Uint8Array<ArrayBufferLike>;', triggers: ['NonSharedUint8Array'] },
  { declaration: 'type CpuInfo = Record<string, unknown>;', triggers: ['CpuInfo'] },
  { declaration: 'type NetworkInterfaceInfo = Record<string, unknown>;', triggers: ['NetworkInterfaceInfo'] },
  { declaration: 'type CpuUsage = Record<string, number>;', triggers: ['CpuUsage'] },
  { declaration: 'type CreateTracingOptions = Record<string, unknown>;', triggers: ['CreateTracingOptions'] },
  { declaration: 'type Tracing = Record<string, unknown>;', triggers: ['Tracing'] },
  { declaration: 'type UserInfoOptionsWithStringEncoding = Record<string, unknown>;', triggers: ['UserInfoOptionsWithStringEncoding'] },
  { declaration: 'type UserInfo<T> = Record<string, unknown>;', triggers: ['UserInfo'] },
  { declaration: 'type FormatInputPathObject = Record<string, unknown>;', triggers: ['FormatInputPathObject'] },
  { declaration: 'type ParsedPath = Record<string, unknown>;', triggers: ['ParsedPath'] },
  { declaration: 'type CreateHistogramOptions = Record<string, unknown>;', triggers: ['CreateHistogramOptions'] },
  { declaration: 'type RecordableHistogram = Record<string, unknown>;', triggers: ['RecordableHistogram'] },
  { declaration: 'type EventLoopUtilization = Record<string, unknown>;', triggers: ['EventLoopUtilization'] },
  { declaration: 'type EventLoopMonitorOptions = Record<string, unknown>;', triggers: ['EventLoopMonitorOptions'] },
  { declaration: 'type IntervalHistogram = Record<string, unknown>;', triggers: ['IntervalHistogram'] },
  { declaration: 'type EntryType = string;', triggers: ['EntryType'] },
  { declaration: 'type FetchTimingInfo = Record<string, unknown>;', triggers: ['FetchTimingInfo'] },
  { declaration: 'type TimerifyOptions = Record<string, unknown>;', triggers: ['TimerifyOptions'] },
  { declaration: 'type MemoryUsage = Record<string, unknown>;', triggers: ['MemoryUsage'] },
  { declaration: 'type ResourceUsage = Record<string, unknown>;', triggers: ['ResourceUsage'] },
  { declaration: 'type BufferEncoding = string;', triggers: ['BufferEncoding'] },
  { declaration: 'type Timer = Record<string, unknown>;', triggers: ['Timer'] },
  { declaration: 'type DeprecateOptions = Record<string, unknown>;', triggers: ['DeprecateOptions'] },
  { declaration: 'type DiffEntry = Record<string, unknown>;', triggers: ['DiffEntry'] },
  { declaration: 'type GetCallSitesOptions = Record<string, unknown>;', triggers: ['GetCallSitesOptions'] },
  { declaration: 'type CallSiteObject = Record<string, unknown>;', triggers: ['CallSiteObject'] },
  { declaration: 'type IsDeepStrictEqualOptions = Record<string, unknown>;', triggers: ['IsDeepStrictEqualOptions'] },
  { declaration: 'type CustomPromisify<T = unknown> = T;', triggers: ['CustomPromisify'] },
  { declaration: 'type InspectColor = string;', triggers: ['InspectColor'] },
  { declaration: 'type StyleTextOptions = Record<string, unknown>;', triggers: ['StyleTextOptions'] },
  { declaration: 'type StreamPipeOptions = Record<string, unknown>;', triggers: ['StreamPipeOptions'] },
  { declaration: 'type TracingChannelCollection<StoreType = unknown, ContextType extends object = Record<string, unknown>> = Record<string, unknown>;', triggers: ['TracingChannelCollection'] },
  { declaration: 'type TracingChannel<StoreType = unknown, ContextType extends object = Record<string, unknown>> = Record<string, unknown>;', triggers: ['TracingChannel'] },
  { declaration: 'type Channel = Record<string, unknown>;', triggers: ['Channel'] },
  { declaration: 'type LookupAddress = Record<string, unknown>;', triggers: ['LookupAddress'] },
  { declaration: 'type AnyRecord = Record<string, unknown>;', triggers: ['AnyRecord'] },
  { declaration: 'type CaaRecord = Record<string, unknown>;', triggers: ['CaaRecord'] },
  { declaration: 'type MxRecord = Record<string, unknown>;', triggers: ['MxRecord'] },
  { declaration: 'type NaptrRecord = Record<string, unknown>;', triggers: ['NaptrRecord'] },
  { declaration: 'type SoaRecord = Record<string, unknown>;', triggers: ['SoaRecord'] },
  { declaration: 'type SrvRecord = Record<string, unknown>;', triggers: ['SrvRecord'] },
  { declaration: 'type TlsaRecord = Record<string, unknown>;', triggers: ['TlsaRecord'] },
  { declaration: 'type SyncCPUProfileHandle = Record<string, unknown>;', triggers: ['SyncCPUProfileHandle'] },
  { declaration: 'type HeapSnapshotOptions = Record<string, unknown>;', triggers: ['HeapSnapshotOptions'] },
  { declaration: 'type Context = Record<string, unknown>;', triggers: ['Context'] },
  { declaration: 'type MeasureMemoryOptions = Record<string, unknown>;', triggers: ['MeasureMemoryOptions'] },
  { declaration: 'type MemoryMeasurement = Record<string, unknown>;', triggers: ['MemoryMeasurement'] },
  { declaration: 'type InputType = string | ArrayBufferView | ArrayBuffer;', triggers: ['InputType'] },
  { declaration: 'type ZlibOptions = Record<string, unknown>;', triggers: ['ZlibOptions'] },
  { declaration: 'type HeapCodeStatistics = Record<string, unknown>;', triggers: ['HeapCodeStatistics'] },
  { declaration: 'type HeapSpaceInfo = Record<string, unknown>;', triggers: ['HeapSpaceInfo'] },
  { declaration: 'type HeapInfo = Record<string, unknown>;', triggers: ['HeapInfo'] },
  {
    declaration: ['declare namespace ts {', '  type EditorOptions = Record<string, unknown>;', '}'].join('\n'),
    triggers: ['ts.EditorOptions'],
  },
  {
    declaration: [
      'declare namespace NodeJS {',
      '  type Architecture = string;',
      '  type Platform = string;',
      '  type Signals = string;',
      '  type Dict<T> = Record<string, T | undefined>;',
      '  type ArrayBufferView = globalThis.ArrayBufferView;',
      '  type NonSharedUint8Array = Uint8Array<ArrayBufferLike>;',
      '  type ReadableStream = globalThis.ReadableStream<Uint8Array<ArrayBufferLike>>;',
      '  type WritableStream = globalThis.WritableStream<Uint8Array<ArrayBufferLike>>;',
      '}',
    ].join('\n'),
    triggers: [
      'NodeJS.Architecture',
      'NodeJS.Platform',
      'NodeJS.Signals',
      'NodeJS.Dict',
      'NodeJS.ArrayBufferView',
      'NodeJS.NonSharedUint8Array',
      'NodeJS.ReadableStream',
      'NodeJS.WritableStream',
    ],
  },
];

function renderCompatibilityPrelude(referencedText: string): string {
  return COMPATIBILITY_PRELUDE_ENTRIES
    .filter((entry) => entry.triggers.some((trigger) => referencedText.includes(trigger)))
    .map((entry) => entry.declaration)
    .join('\n');
}

function buildSharedMethodTypes(methods: OpenApiSurfaceMethod[]): SharedMethodTypeTables {
  const declarations: string[] = [];
  const inputAliasesByMethodName = new Map<string, string>();
  const resultAliasesByMethodName = new Map<string, string>();

  declarations.push('type OpenApiMethodDescriptor = {');
  declarations.push('  result: unknown;');
  declarations.push('  path?: unknown;');
  declarations.push('  query?: unknown;');
  declarations.push('  header?: unknown;');
  declarations.push('  body?: unknown;');
  declarations.push('};');
  declarations.push('');
  declarations.push('type Simplify<T> = { [K in keyof T]: T[K] } & {};');
  declarations.push('');
  declarations.push("export type input__<T extends OpenApiMethodDescriptor> = [keyof Omit<T, 'result'>] extends [never] ? undefined : Simplify<Omit<T, 'result'>>;");
  declarations.push("export type result__<T extends OpenApiMethodDescriptor> = T['result'];");
  declarations.push('');

  for (const method of methods) {
    const inputDescriptor = describeInputType(method.inputTypeText);
    const canonicalInputTypeText = getCanonicalInputTypeText(inputDescriptor);
    // Each method gets its own named input alias — no deduplication.
    const sharedInputName = `shared__input__${method.typeBaseName}`;
    declarations.push(`export type ${sharedInputName}${renderGenericPrefixForText(method, canonicalInputTypeText)} = ${canonicalInputTypeText};`);
    inputAliasesByMethodName.set(method.typeBaseName, sharedInputName);

    const sharedResultName = `shared__result__${method.typeBaseName}`;
    declarations.push(`export type ${sharedResultName}${renderGenericPrefixForText(method, method.resultTypeText)} = ${method.resultTypeText};`);
    resultAliasesByMethodName.set(method.typeBaseName, sharedResultName);
  }

  for (const method of methods) {
    const sharedInputName = inputAliasesByMethodName.get(method.typeBaseName)!;
    const sharedResultName = resultAliasesByMethodName.get(method.typeBaseName)!;
    const genericPrefix = renderGenericPrefix(method);
    const inputDescriptor = describeInputType(method.inputTypeText);
    const canonicalInputTypeText = getCanonicalInputTypeText(inputDescriptor);
    const inputGenericArgs = renderGenericArgsForText(method, canonicalInputTypeText);
    const resultGenericArgs = renderGenericArgsForText(method, method.resultTypeText);
    declarations.push(`export type ${method.typeBaseName}${genericPrefix} = ${buildMethodDescriptorType(`${sharedInputName}${inputGenericArgs}`, method.inputTypeText, `${sharedResultName}${resultGenericArgs}`)};`);
  }

  return {
    declarations,
  };
}

function buildMethodDescriptorType(sharedInputName: string, inputTypeText: string, sharedResultName: string): string {
  const inputDescriptor = describeInputType(inputTypeText);

  if (inputDescriptor.kind === 'none') {
    return `{
  result: ${sharedResultName};
}`;
  }

  if (inputDescriptor.kind === 'body-only') {
    return `{
  body${inputDescriptor.optional ? '?' : ''}: ${sharedInputName};
  result: ${sharedResultName};
}`;
  }

  return `${sharedInputName} & {
  result: ${sharedResultName};
}`;
}

function describeInputType(inputTypeText: string): InputTypeDescriptor {
  if (inputTypeText === 'undefined') {
    return { kind: 'none' };
  }

  const bodyOnlyMatch = inputTypeText.match(/^\{\s*body(\?)?:\s*([\s\S]+);\s*\}$/);
  if (bodyOnlyMatch) {
    return {
      kind: 'body-only',
      optional: bodyOnlyMatch[1] === '?',
      bodyTypeText: bodyOnlyMatch[2]!.trim(),
    };
  }

  return {
    kind: 'full-object',
    inputTypeText,
  };
}

function getCanonicalInputTypeText(inputDescriptor: InputTypeDescriptor): string {
  if (inputDescriptor.kind === 'none') {
    return 'undefined';
  }

  if (inputDescriptor.kind === 'body-only') {
    return inputDescriptor.bodyTypeText;
  }

  return inputDescriptor.inputTypeText;
}

function renderTypeNameMap(globalName: string, methods: OpenApiSurfaceMethod[]): string {
  const lines = methods.flatMap((method) => [
    `  ${JSON.stringify(method.typeBaseName)}: { kind: 'method', methodName: ${JSON.stringify(method.methodName)}, path: ${JSON.stringify(method.propertyPath)} },`,
    `  ${JSON.stringify(renderInputTypeName(method))}: { kind: 'input', methodName: ${JSON.stringify(method.methodName)}, path: ${JSON.stringify(method.propertyPath)} },`,
    `  ${JSON.stringify(renderResultTypeName(method))}: { kind: 'result', methodName: ${JSON.stringify(method.methodName)}, path: ${JSON.stringify(method.propertyPath)} },`,
  ]);

  return [
    `export const ${globalName}TypeNameMap = {`,
    ...lines,
    `} as const;`,
  ].join('\n');
}

function renderEffectsManifest(globalName: string, methods: OpenApiSurfaceMethod[]): string {
  const entries = methods.map((method) => `  ${JSON.stringify(method.methodName)}: ${JSON.stringify(method.effects)},`);
  return [
    `export const ${globalName}MethodEffects = {`,
    ...entries,
    `} as const;`,
  ].join('\n');
}

function renderSurfaceType(rootTypeName: string, methods: OpenApiSurfaceMethod[]): string {
  const tree: SurfaceTreeNode = { children: new Map<string, SurfaceTreeNode>() };
  for (const method of methods) {
    let cursor = tree;
    for (let index = 0; index < method.propertyPath.length - 1; index += 1) {
      const part = method.propertyPath[index]!;
	  let child = cursor.children.get(part);
	  if (!child) {
		child = { children: new Map<string, SurfaceTreeNode>() };
		cursor.children.set(part, child);
	  }
	  cursor = child;
    }
    const leafName = method.propertyPath[method.propertyPath.length - 1]!;
    const leaf = cursor.children.get(leafName) ?? { children: new Map<string, SurfaceTreeNode>() };
    leaf.method = method;
    cursor.children.set(leafName, leaf);
  }

  return `export type ${rootTypeName} = ${renderTreeType(tree, 0)};`;
}

function renderTreeType(tree: SurfaceTreeNode, depth: number): string {
  const indent = '  '.repeat(depth);
  const childIndent = '  '.repeat(depth + 1);
  const lines = ['{'];
  for (const [key, value] of [...tree.children.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const nodeKind = getSurfaceNodeKind(value);

    if (value.method && value.children.size === 0) {
      const method = value.method;
      lines.push(`${childIndent}${safePropertyName(key)}: ${renderLeafType(method, nodeKind)};`);
      continue;
    }

    if (value.method) {
      const method = value.method;
	  if (nodeKind === 'property') {
		lines.push(`${childIndent}${safePropertyName(key)}: ${renderTreeType({ children: value.children }, depth + 1)};`);
		continue;
	  }
	  lines.push(`${childIndent}${safePropertyName(key)}: ${renderLeafType(method, nodeKind)} & ${renderTreeType({ children: value.children }, depth + 1)};`);
      continue;
    }

    lines.push(`${childIndent}${safePropertyName(key)}: ${renderTreeType(value, depth + 1)};`);
  }
  lines.push(`${indent}}`);
  return lines.join('\n');
}

function renderMethodSignature(method: OpenApiSurfaceMethod): string {
  const genericPrefix = renderGenericPrefix(method);
  return `${genericPrefix}(input: ${renderInputTypeName(method)}) => Promise<${renderResultTypeName(method)}>`;
}

function renderInputTypeName(method: OpenApiSurfaceMethod): string {
  return `input__<${method.typeBaseName}${renderGenericArgs(method)}>`;
}

function renderResultTypeName(method: OpenApiSurfaceMethod): string {
  return `result__<${method.typeBaseName}${renderGenericArgs(method)}>`;
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
    '  if (value instanceof Uint8Array) {',
    '    if (value.buffer instanceof ArrayBuffer) {',
    '      return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);',
    '    }',
    '    return Uint8Array.from(value);',
    '  }',
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
  const routeEntries = methods.map((method) => {
    const route = {
      httpMethod: method.httpMethod,
      httpPath: method.httpPath,
      requestContentType: method.requestContentType,
      requestBodyKind: method.requestBodyKind,
      responseContentType: method.responseContentType,
      graphqlOperationName: method.graphqlOperationName,
      graphqlRootFieldNames: method.graphqlRootFieldNames,
      graphqlQuery: method.graphqlQuery,
    };
    return `    ${JSON.stringify(method.methodName)}: ${JSON.stringify(route)},`;
  });

  return [
    `const ${globalName}Routes = {`,
    ...routeEntries,
    '} as const;',
    '',
    `export const ${globalName} = createEndpointSurface<Rpcify<${rootTypeName}>>(${JSON.stringify(rootPath)});`,
  ].join('\n');
}

function renderRouteManifest(globalName: string, methods: OpenApiSurfaceMethod[], rootPath: string[]): string {
  const routes = methods.map((method) => ({
    methodName: method.methodName,
    pathParts: [...rootPath, ...method.propertyPath],
    httpPath: method.httpPath,
    httpMethod: method.httpMethod,
    requestContentType: method.requestContentType,
    requestBodyKind: method.requestBodyKind,
    responseContentType: method.responseContentType,
  }));

  return `export const ${globalName}RouteManifest = ${JSON.stringify({
    id: rootPath[rootPath.length - 1] ?? globalName,
    rootPath,
    routes,
  }, null, 2)} as const;`;
}

function renderGenericPrefix(method: OpenApiSurfaceMethod): string {
  const activeParameters = getActiveGenericParameters(method);
  return activeParameters.length > 0
    ? `<${activeParameters.join(', ')}>`
    : '';
}

function renderGenericArgs(method: OpenApiSurfaceMethod): string {
  const activeParameters = getActiveGenericParameters(method);
  if (activeParameters.length === 0) {
    return '';
  }

  const names = activeParameters.map((parameter) => parameter.split(/\sextends\s|\s*=\s/u)[0]!.trim());
  return `<${names.join(', ')}>`;
}

function renderGenericPrefixForText(method: OpenApiSurfaceMethod, usageText: string): string {
  const activeParameters = getActiveGenericParameters(method, usageText);
  return activeParameters.length > 0
    ? `<${activeParameters.join(', ')}>`
    : '';
}

function renderGenericArgsForText(method: OpenApiSurfaceMethod, usageText: string): string {
  const activeParameters = getActiveGenericParameters(method, usageText);
  if (activeParameters.length === 0) {
    return '';
  }

  const names = activeParameters.map((parameter) => parameter.split(/\sextends\s|\s*=\s/u)[0]!.trim());
  return `<${names.join(', ')}>`;
}

function getActiveGenericParameters(method: OpenApiSurfaceMethod, usageText?: string): string[] {
  if (!method.genericTypeParameters || method.genericTypeParameters.length === 0) {
    return [];
  }

  const effectiveUsageText = usageText ?? `${method.inputTypeText}\n${method.resultTypeText}`;
  return method.genericTypeParameters.filter((parameter) => {
    const name = parameter.split(/\sextends\s|\s*=\s/u)[0]!.trim();
    return new RegExp(`\\b${escapeRegExp(name)}\\b`, 'u').test(effectiveUsageText);
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getSurfaceNodeKind(node: SurfaceTreeNode): SurfaceNodeKind {
  if (!node.method) {
    return 'namespace';
  }

  return isPropertyLikeMethod(node.method) ? 'property' : 'method';
}

function isPropertyLikeMethod(method: OpenApiSurfaceMethod): boolean {
  return method.symbolSemanticFlags.symbolKind === 'property' || method.symbolSemanticFlags.symbolKind === 'accessor';
}

function renderLeafType(method: OpenApiSurfaceMethod, nodeKind: SurfaceNodeKind): string {
  if (nodeKind === 'property') {
    return method.resultTypeText;
  }

  return renderMethodSignature(method);
}