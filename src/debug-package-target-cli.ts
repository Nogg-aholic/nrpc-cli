#!/usr/bin/env bun
import path from 'node:path';

import { createRpcAnalysisScaffold } from './http-route-generator.js';
import { readPackageTargetConfig } from './package-target-generator.js';

function readArg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

const targetName = readArg('--target');
if (!targetName) {
  throw new Error('Missing --target <package-name>');
}

const configPath = path.resolve(process.cwd(), 'packages', targetName, 'target.json');
const config = await readPackageTargetConfig(configPath);
const scaffold = createRpcAnalysisScaffold({
  entryFile: path.resolve(config.entryFile),
  rootType: config.rootType,
});

const properties = scaffold.checker.getPropertiesOfType(scaffold.rootType).map((property) => property.getName()).sort();
console.log(JSON.stringify({
  target: targetName,
  rootTypeString: scaffold.checker.typeToString(scaffold.rootType),
  propertyCount: properties.length,
  firstProperties: properties.slice(0, 80),
}, null, 2));
