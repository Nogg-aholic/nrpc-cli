import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  buildOpenApiDocumentFromProjections,
  getOpenApiProjectionShardKey,
  visitOpenApiMethodProjections,
} from '../src/openapi-generator.js';
import type { OpenApiMethodProjection } from '../src/openapi-types.js';
import { generateOpenApiSurface } from '../src/openapi-surface-generator.js';

declare const process: { exitCode?: number };
declare const Buffer: { byteLength(value: string, encoding?: string): number };

const entryFile = path.resolve('./test/typescript-openapi-wrapper.ts');
const outDir = path.resolve('./test/generated');
const shardDir = path.join(outDir, 'typescript-full-shards');
const persistentStateDir = path.resolve('./test/state');
const failedShardsLogPath = path.join(persistentStateDir, 'typescript-full.failed-shards.log');
const blacklistPath = path.join(persistentStateDir, 'typescript-full.blacklist.txt');
const blacklistPrefixesPath = path.join(persistentStateDir, 'typescript-full.blacklist-prefixes.txt');
const blacklistSuffixesPath = path.join(persistentStateDir, 'typescript-full.blacklist-suffixes.txt');
const maxOpenApiShardBytes = 100 * 1024 * 1024;
const maxContractBytes = 100 * 1024;
const initialSkippedMethodNames = [
  'getModifiers',
  'getJSDocParameterTags',
  'getJSDocTypeParameterTags',
  'hasJSDocParameterTags',
  'getJSDocAugmentsTag',
  'getJSDocImplementsTags',
  'getJSDocClassTag',
  'getJSDocPublicTag',
  'getJSDocPrivateTag',
  'getJSDocProtectedTag',
  'getJSDocReadonlyTag',
  'getJSDocOverrideTagNoCache',
  'getJSDocDeprecatedTag',
  'getJSDocEnumTag',
  'getJSDocThisTag',
  'getJSDocReturnTag',
  'getJSDocTemplateTag',
  'getJSDocSatisfiesTag',
  'getJSDocTypeTag',
  'getJSDocType',
  'getJSDocReturnType',
  'getJSDocTags',
  'getAllJSDocTags',
  'getAllJSDocTagsOfKind',
  'getTextOfJSDocComment',
  'getEffectiveTypeParameterDeclarations',
  'getJSDocCommentsAndTags',
];
const initialSkippedMethodPrefixes = [
  'server.protocol.ClassificationType.',
  'server.protocol.CommandTypes.',
  'SyntaxKind.',
  'TokenFlags.',
  'TypeFlags.',
  'TypeFormatFlags.',
  'TypePredicateKind.',
  'WatchDirectoryFlags.',
  'WatchDirectoryKind.',
  'WatchFileKind.',
  'sys.args.',
  'sys.newLine.',
  'sys.useCaseSensitiveFileNames.',
  'version.',
  'versionMajorMinor.',
  'unchangedTextChangeRange.',
];
const initialSkippedMethodSuffixes = [
  '.toExponential',
  '.toFixed',
  '.toLocaleString',
  '.toPrecision',
  '.toString',
  '.valueOf',
  '.anchor',
  '.at',
  '.big',
  '.blink',
  '.bold',
  '.charAt',
  '.charCodeAt',
  '.codePointAt',
  '.concat',
  '.copyWithin',
  '.endsWith',
  '.fill',
  '.fixed',
  '.fontcolor',
  '.fontsize',
  '.includes',
  '.indexOf',
  '.italics',
  '.join',
  '.lastIndexOf',
  '.link',
  '.localeCompare',
  '.match',
  '.normalize',
  '.padEnd',
  '.padStart',
  '.pop',
  '.push',
  '.repeat',
  '.replace',
  '.replaceAll',
  '.reverse',
  '.search',
  '.shift',
  '.slice',
  '.small',
  '.splice',
  '.split',
  '.startsWith',
  '.strike',
  '.sub',
  '.substr',
  '.substring',
  '.sup',
  '.toLocaleLowerCase',
  '.toLocaleUpperCase',
  '.toLowerCase',
  '.toUpperCase',
  '.trim',
  '.trimEnd',
  '.trimLeft',
  '.trimRight',
  '.trimStart',
  '.unshift',
];
const skippedMethodNames = new Set(initialSkippedMethodNames);
const skippedMethodPrefixes = new Set(initialSkippedMethodPrefixes);
const skippedMethodSuffixes = new Set(initialSkippedMethodSuffixes);

function appendUniqueLine(filePath: string, value: string): void {
  const normalized = value.trim();
  if (!normalized) {
    return;
  }

  let existing = new Set<string>();
  if (existsSync(filePath)) {
    existing = new Set(
      readFileSync(filePath, 'utf8')
        .split(/\r?\n/u)
        .map((line: string) => line.trim())
        .filter(Boolean),
    );
  }

  if (existing.has(normalized)) {
    return;
  }

  existing.add(normalized);
  writeFileSync(filePath, `${Array.from(existing).sort().join('\n')}\n`, 'utf8');
}

function seedFileIfMissing(filePath: string, values: readonly string[]): void {
  if (existsSync(filePath)) {
    return;
  }

  for (const value of values) {
    appendUniqueLine(filePath, value);
  }
}

function loadSetFromFile(filePath: string, target: Set<string>): void {
  if (!existsSync(filePath)) {
    return;
  }

  for (const value of readFileSync(filePath, 'utf8').split(/\r?\n/u)) {
    const normalized = value.trim();
    if (normalized) {
      target.add(normalized);
    }
  }
}

function loadBlacklist(): void {
  seedFileIfMissing(blacklistPath, initialSkippedMethodNames);
  seedFileIfMissing(blacklistPrefixesPath, initialSkippedMethodPrefixes);
  seedFileIfMissing(blacklistSuffixesPath, initialSkippedMethodSuffixes);

  loadSetFromFile(blacklistPath, skippedMethodNames);
  loadSetFromFile(blacklistPrefixesPath, skippedMethodPrefixes);
  loadSetFromFile(blacklistSuffixesPath, skippedMethodSuffixes);
}

function getBlacklistReason(methodName: string): string | undefined {
  if (skippedMethodNames.has(methodName)) {
    return 'exact';
  }

  for (const prefix of skippedMethodPrefixes) {
    if (methodName.startsWith(prefix)) {
      return `prefix:${prefix}`;
    }
  }

  for (const suffix of skippedMethodSuffixes) {
    if (methodName.endsWith(suffix)) {
      return `suffix:${suffix}`;
    }
  }

  return undefined;
}

function blacklistShard(shardKey: string, projections: OpenApiMethodProjection[], reason: string): void {
  console.log(`blacklistShard:${shardKey}:${reason}`);
  for (const projection of projections) {
    skippedMethodNames.add(projection.methodName);
    appendUniqueLine(blacklistPath, projection.methodName);
  }
}

function shardFileBase(shardKey: string): string {
  const safe = shardKey.replace(/[^A-Za-z0-9._-]+/g, '-');
  return path.join(shardDir, `typescript-full.${safe}`);
}

function flushShard(shardKey: string, projections: OpenApiMethodProjection[]): void {
  const base = shardFileBase(shardKey);
  const openApiPath = `${base}.openapi.json`;
  const surfaceBase = `${base}.surface.ts`;
  const contractPath = surfaceBase.replace(/\.surface\.ts$/, '.contract.ts');
  const docsPath = surfaceBase.replace(/\.surface\.ts$/, '.surface.docs.ts');
  const mcpToolsPath = surfaceBase.replace(/\.surface\.ts$/, '.mcp-tools.ts');
  const safeName = shardKey.replace(/[^A-Za-z0-9]+/g, '') || 'Root';

  console.log(`buildShardDocument:${shardKey}:${projections.length}`);
  const document = buildOpenApiDocumentFromProjections(projections, {
    entryFile,
    rootType: 'TypeScriptFullSource',
    title: `TypeScript Full API (${shardKey})`,
    version: '1.0.0',
  });
  const openApiText = JSON.stringify(document, null, 2);
  const openApiShardSize = Buffer.byteLength(openApiText, 'utf8');
  if (openApiShardSize > maxOpenApiShardBytes) {
    throw new Error(`OpenAPI shard exceeds ${maxOpenApiShardBytes} bytes before write: ${openApiShardSize}`);
  }

  console.log(`writeOpenApiShard:${shardKey}`);
  writeFileSync(openApiPath, openApiText, 'utf8');

  console.log(`generateSurfaceShard:${shardKey}`);
  const surface = generateOpenApiSurface({
    openApiFile: openApiPath,
    outputImportPath: surfaceBase,
    rootTypeName: `TypeScriptFull${safeName}Surface`,
    globalName: `typeScriptFull${safeName}`,
  });
  const contractSize = Buffer.byteLength(surface.contractText, 'utf8');
  if (contractSize > maxContractBytes) {
    unlinkSync(openApiPath);
    throw new Error(`Contract shard exceeds ${maxContractBytes} bytes before write: ${contractSize}`);
  }

  console.log(`writeSurfaceArtifacts:${shardKey}`);
  writeFileSync(contractPath, surface.contractText, 'utf8');
  writeFileSync(docsPath, surface.docsText, 'utf8');
  writeFileSync(mcpToolsPath, surface.mcpToolsText, 'utf8');
}

function tryFlushShard(shardKey: string, projections: OpenApiMethodProjection[]): boolean {
  try {
    flushShard(shardKey, projections);
    return true;
  } catch (error) {
    console.error(`failedShard:${shardKey}`);
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    blacklistShard(shardKey, projections, error instanceof Error ? error.message : String(error));
    writeFileSync(
      failedShardsLogPath,
      `${new Date().toISOString()}\t${shardKey}\t${projections.map((projection) => projection.methodName).join(',')}\n`,
      { encoding: 'utf8', flag: 'a' },
    );
    return false;
  }
}

try {
  console.log('start');
  mkdirSync(outDir, { recursive: true });
  mkdirSync(shardDir, { recursive: true });
  mkdirSync(persistentStateDir, { recursive: true });
  loadBlacklist();
  for (const entry of readdirSync(shardDir)) {
    rmSync(path.join(shardDir, entry), { recursive: true, force: true });
  }
  if (!existsSync(failedShardsLogPath)) {
    writeFileSync(failedShardsLogPath, '', 'utf8');
  }

  console.log('visitOpenApiMethodProjections');
  const seenMethodNames = new Set<string>();
  let currentShardKey: string | undefined;
  let currentShardProjections: OpenApiMethodProjection[] = [];
  let nextEntryLogCount = 0;

  visitOpenApiMethodProjections({
    entryFile,
    rootType: 'TypeScriptFullSource',
    title: 'TypeScript Full API',
  }, (projection) => {
    const blacklistReason = getBlacklistReason(projection.methodName);
    if (blacklistReason !== undefined) {
      console.log(`skipMethod:${projection.methodName}:${blacklistReason}`);
      return;
    }

    if (seenMethodNames.has(projection.methodName)) {
      return;
    }
    seenMethodNames.add(projection.methodName);

    console.log(`nextEntry:${projection.methodName}`);
    nextEntryLogCount += 1;
    if (nextEntryLogCount % 100 === 0) {
      console.log(`progressEntries:${nextEntryLogCount}`);
    }

    const shardKey = getOpenApiProjectionShardKey(projection);
    if (currentShardKey !== undefined && shardKey !== currentShardKey) {
      console.log(`nextFlush:${currentShardKey}:${currentShardProjections.length}`);
      tryFlushShard(currentShardKey, currentShardProjections);
      currentShardProjections = [];
    }

    currentShardKey = shardKey;
    currentShardProjections.push(projection);
  });

  if (currentShardKey !== undefined && currentShardProjections.length > 0) {
    console.log(`nextFlush:${currentShardKey}:${currentShardProjections.length}`);
    tryFlushShard(currentShardKey, currentShardProjections);
  }

  console.log('done');
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
}
