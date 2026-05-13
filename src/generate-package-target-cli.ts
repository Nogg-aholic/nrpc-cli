#!/usr/bin/env bun
import path from 'node:path';

import { generatePackageTargetArtifacts, readPackageTargetConfig } from './package-target-generator.js';

function readArg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

const targetName = readArg('--target');
const configPathArg = readArg('--config');

if (!targetName && !configPathArg) {
  throw new Error('Missing --target <package-name> or --config <target-json-path>');
}

const resolvedConfigPath = configPathArg
  ? path.resolve(process.cwd(), configPathArg)
  : path.resolve(process.cwd(), 'packages', targetName!, 'target.json');

const config = await readPackageTargetConfig(resolvedConfigPath);
const result = await generatePackageTargetArtifacts(config);

console.log(JSON.stringify({
  target: result.config.name,
  methodCount: result.projections.length,
  manifestPath: result.manifestPath,
  openApiPath: result.openApiPath,
  contractPath: result.contractPath,
  docsPath: result.docsPath,
  mcpToolsPath: result.mcpToolsPath,
  manifestBytes: result.manifestBytes,
  openApiBytes: result.openApiBytes,
  contractBytes: result.contractBytes,
  docsBytes: result.docsBytes,
  mcpToolsBytes: result.mcpToolsBytes,
}, null, 2));
