#!/usr/bin/env bun
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  generateEndpointSurface,
  generateOpenApiSurface,
  requireOpenApiSurfaceOutput,
  generateDocsArtifacts,
  renderGeneratedDocsArtifactsModule,
  analyzeRpcSurface,
} from './index.js';

// Use Node.js fs for compatibility with both Bun and Node
const writeFile = async (filePath: string, content: string) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');
};

function readArg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function readListArg(flag: string): string[] | undefined {
  const value = readArg(flag);
  if (!value) return undefined;
  const items = value.split(',').map((entry) => entry.trim()).filter(Boolean);
  return items.length > 0 ? items : undefined;
}

function readBoolArg(flag: string): boolean {
  return process.argv.includes(flag);
}

const entryFile = readArg('--entry');
const outDir = readArg('--out');
const rootType = readArg('--root');
const globalName = readArg('--global');
const rootPath = readListArg('--root-path');
const rootTypeName = readArg('--root-type');
const openApiFile = readArg('--openapi');
const basePath = readArg('--base-path') ?? '/';
const datePolicy = readArg('--date-policy') as 'iso-string' | 'epoch-ms' | 'reject' | undefined;
const mapPolicy = readArg('--map-policy') as 'entries' | 'object' | 'reject' | undefined;
const setPolicy = readArg('--set-policy') as 'array' | 'reject' | undefined;

if (!entryFile) throw new Error('Missing --entry <path>');
if (!outDir) throw new Error('Missing --out <directory>');
if (!rootType) throw new Error('Missing --root <type>');
if (!globalName) throw new Error('Missing --global <name>');

const resolvedEntryFile = path.resolve(process.cwd(), entryFile);
const resolvedOutDir = path.resolve(process.cwd(), outDir);

// Use provided rootPath or default to empty array
const effectiveRootPath = rootPath ?? [];

// Analyze RPC surface to extract method paths
const analysis = analyzeRpcSurface({
  entryFile: resolvedEntryFile,
  rootType,
  rootPath: effectiveRootPath,
  policies: { date: datePolicy, map: mapPolicy, set: setPolicy },
});

// Generate artifacts
const surface = generateEndpointSurface({
  entryFile: resolvedEntryFile,
  rootType,
  outputImportPath: path.join(resolvedOutDir, '_shared', 'surface.ts'),
  rootPath,
  globalName,
  policies: { date: datePolicy, map: mapPolicy, set: setPolicy },
});

const docsArtifacts = generateDocsArtifacts({
  entryFile: resolvedEntryFile,
  rootType,
  rootPath,
  basePath,
  policies: { date: datePolicy, map: mapPolicy, set: setPolicy },
});

// Generate OpenAPI surface if openapi file is provided
let openApiSurface: ReturnType<typeof generateOpenApiSurface> | null = null;
if (openApiFile) {
  const resolvedOpenApiFile = path.resolve(process.cwd(), openApiFile);
  openApiSurface = generateOpenApiSurface({
    openApiFile: resolvedOpenApiFile,
    outputImportPath: path.join(resolvedOutDir, '_shared', 'openapi-surface.ts'),
    rootTypeName: rootTypeName ?? `${globalName}OpenApiSurface`,
    globalName,
    rootPath,
  });
}

// Ensure output directories exist
await fs.mkdir(resolvedOutDir, { recursive: true });
await fs.mkdir(path.join(resolvedOutDir, '_shared'), { recursive: true });

// Write generated files
const docsOutFile = path.join(resolvedOutDir, '_shared', 'docs.ts');
const mcpToolsOutFile = path.join(resolvedOutDir, '_shared', 'mcp-tools.ts');

// Write docs file (reuse generated docs if available)
const generatedDocsPath = path.join(resolvedOutDir, '..', 'generated', `${globalName}-api.surface.docs.ts`);
const docsImportPath = path.relative(resolvedOutDir, generatedDocsPath).replace(/\\/g, '/').replace(/\.ts$/, '.js');

// Write OpenAPI and MCP files if generated
if (openApiSurface) {
  if (openApiSurface.mcpToolsText) {
    await writeFile(mcpToolsOutFile, requireOpenApiSurfaceOutput(openApiSurface.mcpToolsText, 'mcp'));
  }
}

// Generate static files for each method in the surface
const relativeEntryPath = path.relative(resolvedOutDir, resolvedEntryFile).replace(/\\/g, '/').replace(/\.ts$/, '.js');

// Determine contract import path (reuse generated contract if available)
const generatedContractPath = path.join(resolvedOutDir, '..', 'generated', `${globalName}-api.contract.ts`);
const contractImportPath = path.relative(resolvedOutDir, generatedContractPath).replace(/\\/g, '/').replace(/\.ts$/, '.js');

for (const method of analysis.methods) {
  if (method.effects.reason === 'property access') continue;
  
  // Build the file path from method.path (strip effectiveRootPath prefix to avoid duplication)
  const methodPathParts = method.path.slice(effectiveRootPath.length);
  const methodFilePath = path.join(resolvedOutDir, ...methodPathParts) + '.ts';
  
  // Generate the handler content for this specific method
  const methodHandlerContent = `
// AUTO-GENERATED FILE. DO NOT EDIT.
import { createSyntheticHttpRouteHandler } from '@nogg-aholic/nrpc/web-runtime';
import { createRpcMethodInvoker } from '@nogg-aholic/nrpc';
import { createHostService } from '${relativeEntryPath}';
import { ${globalName}Contract } from '${contractImportPath}';

const service = createHostService();
const invokeRpcMethod = createRpcMethodInvoker(service);

const handler = createSyntheticHttpRouteHandler({
  manifest: ${globalName}Contract.httpRouteManifest,
  codecResolver: ${globalName}Contract.codecRegistry,
  invokeMethod: invokeRpcMethod,
});

export default async function (req: Request) {
  return handler(req);
};
`;

  await writeFile(methodFilePath, methodHandlerContent);
}

// Generate RPC handler (POST /rpc)
const rpcHandlerContent = `
// AUTO-GENERATED FILE. DO NOT EDIT.
import { createRpcFetchRequestHandler } from '@nogg-aholic/nrpc/web-runtime';
import { createRpcMethodInvoker } from '@nogg-aholic/nrpc';
import { createHostService } from '${relativeEntryPath}';
import { ${globalName}Contract } from '${contractImportPath}';

const service = createHostService();
const invokeRpcMethod = createRpcMethodInvoker(service);

const rpcHandler = createRpcFetchRequestHandler({
  codecResolver: ${globalName}Contract.codecRegistry,
  invokeMethod: invokeRpcMethod,
  awaitEventCode: 0x11,
  returnEventCode: 0x12,
});

export default async function handler(req: Request) {
  return rpcHandler(req);
};
`;

const rpcOutFile = path.join(resolvedOutDir, 'rpc.ts');
await writeFile(rpcOutFile, rpcHandlerContent);

// Generate MCP handler (POST /mcp) if OpenAPI surface is provided
if (openApiSurface && openApiSurface.mcpToolsText) {
  const mcpHandlerContent = `
// AUTO-GENERATED FILE. DO NOT EDIT.
import { createMcpHttpHandler } from '@nogg-aholic/nrpc/mcp-http-handler';
import { createOpenApiMcpTools } from './_shared/mcp-tools.js';

export default createMcpHttpHandler({
  tools: createOpenApiMcpTools({
    baseUrl: process.env.VERCEL_URL ?? 'http://localhost:3000',
  }),
  serverName: '${globalName}',
  serverVersion: '1.0.0',
  endpointPath: '/mcp',
});
`;

  const mcpOutFile = path.join(resolvedOutDir, 'mcp.ts');
  await writeFile(mcpOutFile, mcpHandlerContent);
}

// Generate fallback [...path].ts for unmatched routes (docs only)
const vercelApiRouteContent = `
// AUTO-GENERATED FILE. DO NOT EDIT.
import { generatedDocsRuntime } from '${docsImportPath}';

export default async function handler(req: Request) {
  const url = new URL(req.url);

  // Docs
  const docsResponse = generatedDocsRuntime.resolve(req);
  if (docsResponse) {
    return docsResponse.kind === 'json'
      ? Response.json(docsResponse.body, { status: docsResponse.status })
      : new Response(String(docsResponse.body), {
          status: docsResponse.status,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        });
  }

  return Response.json({ error: { message: 'Not found', type: 'not_found' } }, { status: 404 });
};
`;

// Write Vercel API route
const apiRouteOutFile = path.join(resolvedOutDir, '[...path].ts');
await writeFile(apiRouteOutFile, vercelApiRouteContent);

console.log(`Generated Vercel API route at ${apiRouteOutFile}`);
console.log(`Generated shared files in ${path.join(resolvedOutDir, '_shared')}`);
