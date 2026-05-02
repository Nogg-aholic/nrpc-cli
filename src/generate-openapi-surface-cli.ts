#!/usr/bin/env bun
import fs from 'node:fs/promises';
import path from 'node:path';

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

const inputPath = readArg('--in');
const outputPath = readArg('--out');
const rootTypeName = readArg('--root-type');
const globalName = readArg('--global');
const rootPath = readListArg('--root-path');

if (!inputPath) throw new Error('Missing --in <openapi-json-path>');
if (!outputPath) throw new Error('Missing --out <generated-surface-file>');

const resolvedInputPath = path.resolve(process.cwd(), inputPath);
const resolvedOutputPath = path.resolve(process.cwd(), outputPath);
const contractOutFile = resolvedOutputPath.replace(/\.surface\.ts$/, '.contract.ts');
const docsOutFile = resolvedOutputPath.replace(/\.surface\.ts$/, '.surface.docs.ts');
const mcpToolsOutFile = resolvedOutputPath.replace(/\.surface\.ts$/, '.mcp-tools.ts');

const generated = generateOpenApiSurface({
  openApiFile: resolvedInputPath,
  outputImportPath: resolvedOutputPath,
  rootTypeName,
  globalName,
  rootPath,
});

await fs.mkdir(path.dirname(contractOutFile), { recursive: true });
await fs.writeFile(contractOutFile, generated.contractText, 'utf8');
await fs.writeFile(docsOutFile, generated.docsText, 'utf8');
await fs.writeFile(mcpToolsOutFile, generated.mcpToolsText, 'utf8');