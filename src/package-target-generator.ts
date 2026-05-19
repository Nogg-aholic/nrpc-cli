import fs from 'node:fs/promises';
import path from 'node:path';

import {
  buildOpenApiDocumentFromProjections,
  visitOpenApiMethodProjections,
  type GenerateOpenApiDocumentOptions,
} from './openapi-generator.js';
import { generateNrpcSurfaceManifest } from './nrpc-surface/generator.js';
import type { OpenApiMethodProjection } from './openapi-types.js';
import { generateOpenApiSurface, requireOpenApiSurfaceOutput } from './openapi-surface-generator.js';

export type PackageTargetConfig = {
  name: string;
  entryFile: string;
  rootType: string;
  title: string;
  globalName: string;
  rootTypeName: string;
  outDir: string;
  traversal?: GenerateOpenApiDocumentOptions['traversal'];
  skipMethodPrefixes?: string[];
};

export type GeneratedPackageTargetArtifacts = {
  config: PackageTargetConfig;
  projections: OpenApiMethodProjection[];
  manifestPath: string;
  openApiPath: string;
  contractPath: string;
  docsPath: string;
  mcpToolsPath: string;
  manifestBytes: number;
  openApiBytes: number;
  contractBytes: number;
  docsBytes: number;
  mcpToolsBytes: number;
};

async function syncArtifactsToNodeTypes(config: PackageTargetConfig, artifactPaths: {
  manifestPath: string;
  openApiPath: string;
  contractPath: string;
  docsPath: string;
  mcpToolsPath: string;
}): Promise<void> {
  const workspaceRoot = path.resolve(process.cwd(), '..');
  const nodeTypesDir = path.join(workspaceRoot, 'nodeTypes', config.name);

  await fs.mkdir(nodeTypesDir, { recursive: true });
  await Promise.all([
    fs.copyFile(artifactPaths.manifestPath, path.join(nodeTypesDir, path.basename(artifactPaths.manifestPath))),
    fs.copyFile(artifactPaths.openApiPath, path.join(nodeTypesDir, path.basename(artifactPaths.openApiPath))),
    fs.copyFile(artifactPaths.contractPath, path.join(nodeTypesDir, path.basename(artifactPaths.contractPath))),
    fs.copyFile(artifactPaths.docsPath, path.join(nodeTypesDir, path.basename(artifactPaths.docsPath))),
    fs.copyFile(artifactPaths.mcpToolsPath, path.join(nodeTypesDir, path.basename(artifactPaths.mcpToolsPath))),
  ]);
}

function shouldSkipMethod(methodName: string, config: PackageTargetConfig): boolean {
  return (config.skipMethodPrefixes ?? []).some((prefix) => methodName.startsWith(prefix));
}

export async function readPackageTargetConfig(configPath: string): Promise<PackageTargetConfig> {
  const resolvedPath = path.resolve(configPath);
  return JSON.parse(await fs.readFile(resolvedPath, 'utf8')) as PackageTargetConfig;
}

export async function generatePackageTargetArtifacts(config: PackageTargetConfig): Promise<GeneratedPackageTargetArtifacts> {
  const resolvedEntryFile = path.resolve(config.entryFile);
  const resolvedOutDir = path.resolve(config.outDir);
  const manifestPath = path.join(resolvedOutDir, `${config.name}.surface.manifest.json`);
  const openApiPath = path.join(resolvedOutDir, `${config.name}.openapi.json`);
  const surfaceBase = path.join(resolvedOutDir, `${config.name}.surface.ts`);
  const contractPath = path.join(resolvedOutDir, `${config.name}.contract.ts`);
  const docsPath = path.join(resolvedOutDir, `${config.name}.surface.docs.ts`);
  const mcpToolsPath = path.join(resolvedOutDir, `${config.name}.mcp-tools.ts`);

  const projections: OpenApiMethodProjection[] = [];
  visitOpenApiMethodProjections({
    entryFile: resolvedEntryFile,
    rootType: config.rootType,
    title: config.title,
    traversal: {
      propertyValueTraversal: config.traversal?.propertyValueTraversal ?? 'stop-primitive-drilldown',
      ...config.traversal,
      skipMethodPrefixes: config.skipMethodPrefixes,
    },
  }, (projection) => {
    if (shouldSkipMethod(projection.methodName, config)) {
      return;
    }
    projections.push(projection);
  });

  const document = buildOpenApiDocumentFromProjections(projections, {
    entryFile: resolvedEntryFile,
    rootType: config.rootType,
    title: config.title,
    version: '1.0.0',
  });
  const manifest = generateNrpcSurfaceManifest({
    entryFile: resolvedEntryFile,
    rootType: config.rootType,
    rootPath: [config.globalName],
    surfaceName: config.name,
    traversal: {
      propertyValueTraversal: config.traversal?.propertyValueTraversal ?? 'stop-primitive-drilldown',
      ...config.traversal,
      skipMethodPrefixes: config.skipMethodPrefixes,
    },
  });
  const manifestText = JSON.stringify(manifest, null, 2);
  const openApiText = JSON.stringify(document, null, 2);

  await fs.mkdir(resolvedOutDir, { recursive: true });
  await fs.writeFile(manifestPath, manifestText, 'utf8');
  await fs.writeFile(openApiPath, openApiText, 'utf8');

  const surface = generateOpenApiSurface({
    openApiFile: openApiPath,
    outputImportPath: surfaceBase,
    rootTypeName: config.rootTypeName,
    globalName: config.globalName,
    manifest,
  });

  const contractText = requireOpenApiSurfaceOutput(surface.contractText, 'contract');
  const docsText = requireOpenApiSurfaceOutput(surface.docsText, 'docs');
  const mcpToolsText = requireOpenApiSurfaceOutput(surface.mcpToolsText, 'mcp');

  await fs.writeFile(contractPath, contractText, 'utf8');
  await fs.writeFile(docsPath, docsText, 'utf8');
  await fs.writeFile(mcpToolsPath, mcpToolsText, 'utf8');

  await syncArtifactsToNodeTypes(config, {
    manifestPath,
    openApiPath,
    contractPath,
    docsPath,
    mcpToolsPath,
  });

  return {
    config,
    projections,
    manifestPath,
    openApiPath,
    contractPath,
    docsPath,
    mcpToolsPath,
    manifestBytes: Buffer.byteLength(manifestText, 'utf8'),
    openApiBytes: Buffer.byteLength(openApiText, 'utf8'),
    contractBytes: Buffer.byteLength(contractText, 'utf8'),
    docsBytes: Buffer.byteLength(docsText, 'utf8'),
    mcpToolsBytes: Buffer.byteLength(mcpToolsText, 'utf8'),
  };
}
