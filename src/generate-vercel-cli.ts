#!/usr/bin/env bun
import path from 'node:path';
import { generateVercelArtifacts } from './vercel-generator.js';
import { generateOpenApiSurface } from './openapi-surface-generator.js';

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

const entryFile = readArg('--entry');
const outDir = readArg('--out');
const rootType = readArg('--root');
const globalName = readArg('--global');
const rootPath = readListArg('--root-path');
const rootTypeName = readArg('--root-type');
const openApiFile = readArg('--openapi');

if (!entryFile) throw new Error('Missing --entry <path>');
if (!outDir) throw new Error('Missing --out <directory>');
if (!rootType) throw new Error('Missing --root <type>');
if (!globalName) throw new Error('Missing --global <name>');

const resolvedEntryFile = path.resolve(process.cwd(), entryFile);
const resolvedOutDir = path.resolve(process.cwd(), outDir);

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

await generateVercelArtifacts({
  entryFile: resolvedEntryFile,
  outDir: resolvedOutDir,
  rootType,
  globalName,
  rootPath: rootPath ?? [],
  contractFile: path.join(resolvedOutDir, '..', 'generated', `${globalName}-api.contract.ts`),
  docsFile: path.join(resolvedOutDir, '..', 'generated', `${globalName}-api.surface.docs.ts`),
  openApiSurface: openApiSurface ? { mcpToolsText: openApiSurface.mcpToolsText } : undefined,
});

console.log(`Generated Vercel API route at ${path.join(resolvedOutDir, '[...path].ts')}`);
console.log(`Generated shared files in ${path.join(resolvedOutDir, '_shared')}`);
