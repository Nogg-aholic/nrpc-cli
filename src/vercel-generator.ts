import path from 'node:path';
import { writeFile, mkdir } from 'node:fs/promises';
import { analyzeRpcSurface } from './http-route-generator.js';

function toRelativeImport(fromDir: string, targetFile: string): string {
  const relative = path.relative(fromDir, targetFile).replace(/\\/g, '/').replace(/\.ts$/, '.js');
  return relative.startsWith('.') ? relative : `./${relative}`;
}

export async function generateVercelArtifacts(options: {
  entryFile: string;
  outDir: string;
  rootType: string;
  globalName: string;
  rootPath: string[];
  contractFile: string;
  docsFile: string;
  openApiSurface?: { mcpToolsText?: string };
  protocolMode?: 'binary' | 'json' | 'both';
}) {
  const { entryFile, outDir, rootType, globalName, rootPath, contractFile, docsFile, openApiSurface, protocolMode } = options;
  const analysis = analyzeRpcSurface({ entryFile, rootType, rootPath, policies: {} });
  const effectiveProtocolMode = protocolMode ?? 'both';
  
  // Deduplicate methods by their full path to avoid duplicate files
  const seenMethodPaths = new Set<string>();

  await mkdir(outDir, { recursive: true });

  const relativeEntryPath = toRelativeImport(outDir, entryFile);
  const contractImportPath = toRelativeImport(outDir, contractFile);
  const docsImportPath = toRelativeImport(outDir, docsFile);
  const mcpToolsImportPath = toRelativeImport(outDir, contractFile.replace(/\.contract\.ts$/, '.openapi-surface.mcp-tools.ts'));

  for (const method of analysis.methods) {
    if (method.effects.reason === 'property access') continue;
    
    // Skip if we've already processed this method path
    const methodPathKey = method.path.join('.');
    if (seenMethodPaths.has(methodPathKey)) continue;
    seenMethodPaths.add(methodPathKey);
    
    // Make method.path relative to analysis.rootPath
    const pathStartsWithAnalysisRoot = analysis.rootPath.length > 0 && 
      method.path.length >= analysis.rootPath.length &&
      method.path.slice(0, analysis.rootPath.length).join('.') === analysis.rootPath.join('.');
    
    const relativePathParts = pathStartsWithAnalysisRoot 
      ? method.path.slice(analysis.rootPath.length)
      : method.path;
    
    // Reconstruct full path for manifest: rootPath + method.path
    const fullPathParts = [...rootPath, ...method.path];
    const httpPath = `/${fullPathParts.join('/')}`;
    
    // Use relative path for file path
    const methodFilePath = path.join(outDir, ...relativePathParts) + '.ts';
    await mkdir(path.dirname(methodFilePath), { recursive: true });
    
    const methodRelativeDocsImportPath = toRelativeImport(path.dirname(methodFilePath), docsFile);
    const methodRelativeContractImportPath = toRelativeImport(path.dirname(methodFilePath), contractFile);
    const methodRelativeEntryPath = toRelativeImport(path.dirname(methodFilePath), entryFile);

    // For single-route manifest, rootPath should be full path without the method name
    
    // For single-route manifest, rootPath should be full path without the method name
    const methodRootPath = fullPathParts.slice(0, -1);
    
    const singleRouteManifest = {
      id: analysis.rootPath[analysis.rootPath.length - 1] ?? globalName,
      rootPath: methodRootPath,
      basePath: '',
      protocolMode: effectiveProtocolMode,
      routes: [{
        methodName: method.methodName,
        pathParts: fullPathParts,
        httpPath: httpPath,
        codecLookupKey: method.methodName,
        protocolMode: effectiveProtocolMode,
      }],
    };

    const content = `// AUTO-GENERATED FILE. DO NOT EDIT.
import { createSyntheticHttpRouteHandler } from '@nogg-aholic/nrpc/web-runtime';
import { createRpcMethodInvoker } from '@nogg-aholic/nrpc';
import { createHostService } from '${methodRelativeEntryPath}';
import { ${globalName}CodecRegistry } from '${methodRelativeContractImportPath}';
import { generatedDocsRuntime } from '${methodRelativeDocsImportPath}';

const service = createHostService();
const invokeRpcMethod = createRpcMethodInvoker(service);

const handler = createSyntheticHttpRouteHandler({
  manifest: ${JSON.stringify(singleRouteManifest, null, 2)},
  codecResolver: ${globalName}CodecRegistry,
  invokeMethod: invokeRpcMethod,
});

export default async function (req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.has('__docs')) {
    const docsResponse = generatedDocsRuntime.resolve(req);
    if (docsResponse) {
      return docsResponse.kind === 'json'
        ? Response.json(docsResponse.body, { status: docsResponse.status })
        : new Response(String(docsResponse.body), {
            status: docsResponse.status,
            headers: { 'content-type': 'text/html; charset=utf-8' },
          });
    }
  }
  return handler(req);
};
`;
    await writeFile(methodFilePath, content);

    // Generate method-specific docs handler at [methodPath]/_docs.ts
    const methodDocsDir = path.join(outDir, ...method.path);
    const methodDocsFilePath = path.join(methodDocsDir, '_docs.ts');
    await mkdir(methodDocsDir, { recursive: true });

    const methodDocsRelativeDocsImportPath = toRelativeImport(methodDocsDir, docsFile);
    const docsContent = `// AUTO-GENERATED FILE. DO NOT EDIT.
import { generatedDocsRuntime } from '${methodDocsRelativeDocsImportPath}';

export default async function handler(req: Request) {
  const docsResponse = generatedDocsRuntime.resolve(req);
  if (docsResponse) {
    return docsResponse.kind === 'json'
      ? Response.json(docsResponse.body, { status: docsResponse.status })
      : new Response(String(docsResponse.body), {
          status: docsResponse.status,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        });
  }
  return Response.json({ error: { message: 'Not found' } }, { status: 404 });
};
`;
    await writeFile(methodDocsFilePath, docsContent);
  }

  await writeFile(path.join(outDir, 'rpc.ts'), `// AUTO-GENERATED FILE. DO NOT EDIT.
import { createRpcFetchRequestHandler } from '@nogg-aholic/nrpc/web-runtime';
import { createRpcMethodInvoker } from '@nogg-aholic/nrpc';
import { createHostService } from '${relativeEntryPath}';
import { ${globalName}CodecRegistry } from '${contractImportPath}';

const service = createHostService();
const invokeRpcMethod = createRpcMethodInvoker(service);

export default createRpcFetchRequestHandler({
  codecResolver: ${globalName}CodecRegistry,
  invokeMethod: invokeRpcMethod,
  awaitEventCode: 0x11,
  returnEventCode: 0x12,
});
`);

  if (openApiSurface?.mcpToolsText) {
    const mcpToolsFunctionNameMatch = openApiSurface.mcpToolsText.match(/export function (create\w+McpTools)/);
    const mcpToolsFunctionName = mcpToolsFunctionNameMatch ? mcpToolsFunctionNameMatch[1] : 'createOpenApiMcpTools';

    await writeFile(path.join(outDir, 'mcp.ts'), `// AUTO-GENERATED FILE. DO NOT EDIT.
import { createMcpHttpHandler } from '@nogg-aholic/nrpc/mcp-http-handler';
import { ${mcpToolsFunctionName} } from '${mcpToolsImportPath}';

const mcpHandler = createMcpHttpHandler({
  tools: ${mcpToolsFunctionName}({ baseUrl: process.env.VERCEL_URL ?? 'http://localhost:3000' }),
  serverName: '${globalName}',
  serverVersion: '1.0.0',
});

export default async function (req: Request) {
  return mcpHandler(req);
};
`);
  }

  await writeFile(path.join(outDir, 'docs.ts'), `// AUTO-GENERATED FILE. DO NOT EDIT.
import { generatedDocsRuntime } from '${docsImportPath}';

export default async function handler(req: Request) {
  const docsResponse = generatedDocsRuntime.resolve(req);
  if (docsResponse) {
    return docsResponse.kind === 'json'
      ? Response.json(docsResponse.body, { status: docsResponse.status })
      : new Response(String(docsResponse.body), {
          status: docsResponse.status,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        });
  }
  return Response.json({ error: { message: 'Not found' } }, { status: 404 });
};
`);
}
