import fs from 'node:fs/promises';
import path from 'node:path';

import {
  buildOpenApiDocumentFromProjections,
  visitOpenApiMethodProjections,
  type GenerateOpenApiDocumentOptions,
} from './openapi-generator.js';
import { generateEndpointSurface } from './endpoint-surface-generator.js';
import { generateNrpcSurfaceManifest } from './nrpc-surface/generator.js';
import type { OpenApiMethodProjection } from './openapi-types.js';
import { generateOpenApiSurface, requireOpenApiSurfaceOutput } from './openapi-surface-generator.js';

export type PackageTargetMode = 'service' | 'sdk';

export type PackageTargetConfig = {
  name: string;
  entryFile: string;
  rootType: string;
  title: string;
  globalName: string;
  rootPath?: string[];
  rootTypeName: string;
  outDir: string;
  mode?: PackageTargetMode;
  moduleSpecifier?: string;
  runtimeImportPath?: string;
  traversal?: GenerateOpenApiDocumentOptions['traversal'];
  skipMethodPrefixes?: string[];
};

export type GeneratedPackageTargetArtifacts = {
  config: PackageTargetConfig;
  projections: OpenApiMethodProjection[];
  manifestPath?: string;
  openApiPath?: string;
  contractPath: string;
  docsPath?: string;
  mcpToolsPath?: string;
  manifestBytes?: number;
  openApiBytes?: number;
  contractBytes: number;
  docsBytes?: number;
  mcpToolsBytes?: number;
};

async function syncArtifactsToNodeTypes(config: PackageTargetConfig, artifactPaths: {
  manifestPath?: string;
  openApiPath?: string;
  contractPath: string;
  docsPath?: string;
  mcpToolsPath?: string;
}): Promise<void> {
  const workspaceRoot = path.resolve(process.cwd(), '..');
  const nodeTypesDir = path.join(workspaceRoot, 'nodeTypes', config.name);

  await fs.mkdir(nodeTypesDir, { recursive: true });
  const copyJobs = [
    artifactPaths.manifestPath,
    artifactPaths.openApiPath,
    artifactPaths.contractPath,
    artifactPaths.docsPath,
    artifactPaths.mcpToolsPath,
  ].filter((artifactPath): artifactPath is string => typeof artifactPath === 'string');

  await Promise.all(
    copyJobs.map((artifactPath) =>
      fs.copyFile(artifactPath, path.join(nodeTypesDir, path.basename(artifactPath))),
    ),
  );
}

function getPackageTargetMode(config: PackageTargetConfig): PackageTargetMode {
  return config.mode ?? 'service';
}

function getPackageTargetTraversal(config: PackageTargetConfig): NonNullable<GenerateOpenApiDocumentOptions['traversal']> {
  return {
    propertyValueTraversal: config.traversal?.propertyValueTraversal ?? 'stop-primitive-drilldown',
    ...config.traversal,
    skipMethodPrefixes: config.skipMethodPrefixes,
  };
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
  const mode = getPackageTargetMode(config);
  const manifestPath = path.join(resolvedOutDir, `${config.name}.surface.manifest.json`);
  const openApiPath = path.join(resolvedOutDir, `${config.name}.openapi.json`);
  const surfaceBase = path.join(resolvedOutDir, `${config.name}.surface.ts`);
  const contractPath = path.join(resolvedOutDir, `${config.name}.contract.ts`);
  const docsPath = path.join(resolvedOutDir, `${config.name}.surface.docs.ts`);
  const mcpToolsPath = path.join(resolvedOutDir, `${config.name}.mcp-tools.ts`);
  const traversal = getPackageTargetTraversal(config);

  const projections: OpenApiMethodProjection[] = [];
  await fs.mkdir(resolvedOutDir, { recursive: true });

  if (mode === 'sdk') {
    const sdkSurface = generateEndpointSurface({
      entryFile: resolvedEntryFile,
      rootType: config.rootType,
      outputImportPath: contractPath,
      rootPath: config.rootPath,
      globalName: config.globalName,
      moduleSpecifier: config.moduleSpecifier,
      runtimeImportPath: config.runtimeImportPath,
      traversal,
    });

    await fs.writeFile(contractPath, sdkSurface.contractText, 'utf8');

    await syncArtifactsToNodeTypes(config, {
      contractPath,
    });

    return {
      config,
      projections,
      contractPath,
      contractBytes: Buffer.byteLength(sdkSurface.contractText, 'utf8'),
    };
  }

  visitOpenApiMethodProjections({
    entryFile: resolvedEntryFile,
    rootType: config.rootType,
    title: config.title,
    traversal,
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
    rootPath: config.rootPath ?? [config.globalName],
    surfaceName: config.name,
    traversal,
  });
  const manifestText = JSON.stringify(manifest, null, 2);
  const openApiText = JSON.stringify(document, null, 2);

  await fs.writeFile(manifestPath, manifestText, 'utf8');
  await fs.writeFile(openApiPath, openApiText, 'utf8');

  const surface = generateOpenApiSurface({
    openApiFile: openApiPath,
    outputImportPath: surfaceBase,
    rootTypeName: config.rootTypeName,
    globalName: config.globalName,
    rootPath: config.rootPath,
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
