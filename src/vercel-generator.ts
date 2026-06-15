import path from 'node:path';
import { writeFile, mkdir } from 'node:fs/promises';
import { analyzeRpcSurface } from './http-route-generator.js';

export async function generateVercelArtifacts(options: {
  entryFile: string;
  outDir: string;
  rootType: string;
  globalName: string;
  rootPath: string[];
  contractFile?: string;
  docsFile?: string;
  openApiSurface?: { mcpToolsText?: string };
}) {
  const { entryFile, outDir, rootType, globalName, rootPath, contractFile, docsFile, openApiSurface } = options;
  const analysis = analyzeRpcSurface({ entryFile, rootType, rootPath, policies: {} });

  await mkdir(outDir, { recursive: true });
  await mkdir(path.join(outDir, '_shared'), { recursive: true });

  const relativeEntryPath = path.relative(outDir, entryFile).replace(/\\/g, '/').replace(/\.ts$/, '.js');
  const contractImportPath = contractFile ? path.relative(outDir, contractFile).replace(/\\/g, '/').replace(/\.ts$/, '.js') : './_shared/contract.js';
  const docsImportPath = docsFile ? path.relative(outDir, docsFile).replace(/\\/g, '/').replace(/\.ts$/, '.js') : './_shared/docs.js';

  for (const method of analysis.methods) {
    if (method.effects.reason === 'property access') continue;
    const methodPathParts = method.path.slice(rootPath.length);
    const methodFilePath = path.join(outDir, ...methodPathParts) + '.ts';
    await mkdir(path.dirname(methodFilePath), { recursive: true });
    
    const methodPath = method.path.join('.');
    const content = `// AUTO-GENERATED FILE. DO NOT EDIT.
import { createSyntheticHttpRouteHandler } from '@nogg-aholic/nrpc/web-runtime';
import { createRpcMethodInvoker } from '@nogg-aholic/nrpc';
import { createHostService } from '${relativeEntryPath}';
import { apiContract } from '${contractImportPath}';

const service = createHostService();
const invokeRpcMethod = createRpcMethodInvoker(service);

const handler = createSyntheticHttpRouteHandler({
  manifest: apiContract.httpRouteManifest,
  codecResolver: apiContract.codecRegistry,
  invokeMethod: invokeRpcMethod,
});

export default async function (req: Request) {
  return handler(req);
};
`;
    await writeFile(methodFilePath, content);
  }

  await writeFile(path.join(outDir, 'rpc.ts'), `// AUTO-GENERATED FILE. DO NOT EDIT.
import { createRpcFetchRequestHandler } from '@nogg-aholic/nrpc/web-runtime';
import { createRpcMethodInvoker } from '@nogg-aholic/nrpc';
import { createHostService } from '${relativeEntryPath}';
import { apiContract } from '${contractImportPath}';

const service = createHostService();
const invokeRpcMethod = createRpcMethodInvoker(service);

export default createRpcFetchRequestHandler({
  codecResolver: apiContract.codecRegistry,
  invokeMethod: invokeRpcMethod,
  awaitEventCode: 0x11,
  returnEventCode: 0x12,
});
`);

  if (openApiSurface?.mcpToolsText) {
    await writeFile(path.join(outDir, 'mcp.ts'), `// AUTO-GENERATED FILE. DO NOT EDIT.
import { createMcpHttpHandler } from '@nogg-aholic/nrpc/mcp-http-handler';
import { createOpenApiMcpTools } from './_shared/mcp-tools.js';
import { createHostService } from '${relativeEntryPath}';

const service = createHostService();
const mcpHandler = createMcpHttpHandler({
  tools: createOpenApiMcpTools({ baseUrl: process.env.VERCEL_URL ?? 'http://localhost:3000' }),
  serverName: '${globalName}',
  serverVersion: '1.0.0',
});

export default async function (req: Request) {
  return mcpHandler(req);
};
`);
  }

  await writeFile(path.join(outDir, '[...path].ts'), `// AUTO-GENERATED FILE. DO NOT EDIT.
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
