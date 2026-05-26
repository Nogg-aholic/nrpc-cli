# nrpc-cli Build Guide

This guide is for building with `@nogg-aholic/nrpc-cli`.

Use this guide when you want to:

- install the generator package correctly
- structure generation code in an app
- build runtime artifacts from a TypeScript service root
- generate SDK-style plugin exports
- build docs or MCP artifacts
- run local repository verification for `nrpc-cli`

Do not use this guide for mounting runtime endpoints.
Runtime endpoint setup belongs to `nRPC/USAGE_GUIDE.md` and `nRPC/INSTRUCTION_MANUAL.md`.

## Package Boundary

`@nogg-aholic/nrpc-cli` is a development-time package.

Install it as a dev dependency alongside the runtime package:

```bash
npm install -D @nogg-aholic/nrpc-cli
npm install @nogg-aholic/nrpc
```

Or with Bun:

```bash
bun add -d @nogg-aholic/nrpc-cli
bun add @nogg-aholic/nrpc
```

The intended split is:

- `@nogg-aholic/nrpc-cli` generates files
- `@nogg-aholic/nrpc` runs those generated files

## Recommended Project Layout

Put generation code under `scripts/`, not under `src/`.

Recommended layout:

```text
scripts/
  generate.ts
src/
  service.ts
  server.ts
  client/
  generated/
```

The important rule is:

- generation lives in `scripts/`
- runtime code and generated artifacts live under `src/`

## Normal App Build Flow

The common app-facing flow is:

1. define an exported root type in a service module
2. write one checked-in `scripts/generate.ts`
3. emit artifacts into `src/generated/`
4. consume those artifacts from runtime code

## Standard Endpoint Surface Generation

Typical generation script structure:

```ts
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { generateDocsArtifacts, renderGeneratedDocsArtifactsModule } from '@nogg-aholic/nrpc-cli/src/docs.js';
import { generateEndpointSurface } from '@nogg-aholic/nrpc-cli/src/endpoint-surface-generator.js';
import { generateOpenApiSurface, requireOpenApiSurfaceOutput } from '@nogg-aholic/nrpc-cli/src/openapi-surface-generator.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const projectSrcDir = path.join(currentDir, '..', 'src');
const generatedDir = path.join(projectSrcDir, 'generated');
const entryFile = path.join(projectSrcDir, 'service.ts');
```

Generate the native contract surface:

```ts
const surface = generateEndpointSurface({
  entryFile,
  rootType: 'ChangeCaseApi',
  outputImportPath: path.join(generatedDir, 'change-case-api.surface.ts'),
  rootPath: ['api'],
  globalName: 'api',
});
```

Generate docs:

```ts
const docsArtifacts = generateDocsArtifacts({
  entryFile,
  rootType: 'ChangeCaseApi',
  basePath: '/',
  rootPath: ['api'],
  title: 'Change Case API',
  version: '0.1.0',
});
```

Generate MCP-only output from the OpenAPI-derived branch if needed:

```ts
const openApiSurface = generateOpenApiSurface({
  openApiDocument: docsArtifacts.json,
  outputImportPath: path.join(generatedDir, 'change-case-api.openapi-surface.mcp-tools.ts'),
  rootTypeName: 'ChangeCaseOpenApiSurface',
  globalName: 'openApi',
  outputs: {
    mcp: true,
  },
});
```

## SDK Plugin Build Flow

SDK mode is for generating a plugin package that is mounted into a host service instead of exposing its own standalone runtime artifact set.

Use `generatePackageTargetArtifacts(...)` with `mode: 'sdk'`.

Example plugin generation script:

```ts
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { generatePackageTargetArtifacts } from '@nogg-aholic/nrpc-cli/src/package-target-generator.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.join(currentDir, '..');
const projectSrcDir = path.join(projectDir, 'src');
const generatedDir = path.join(projectSrcDir, 'generated');

await generatePackageTargetArtifacts({
  name: 'sdk-plugin',
  mode: 'sdk',
  entryFile: path.join(projectSrcDir, 'service.ts'),
  rootType: 'SdkPluginApi',
  title: 'SDK Plugin API',
  globalName: 'sdkPluginApi',
  rootPath: ['api', 'plugins', 'sdkPlugin'],
  rootTypeName: 'SdkPluginApi',
  outDir: generatedDir,
});
```

SDK mode currently emits a single contract artifact containing:

- the generated RPC definition
- codec registry
- route manifest
- generated namespace installer helper

Expected output:

- `src/generated/sdk-plugin.contract.ts`

## Host Build Flow For SDK Plugins

The host package should:

1. import the plugin implementation and generated installer
2. mount the plugin into a host service object
3. generate the final host contract from the composed host root

Example host composition:

```ts
import { installSdkPluginApiNamespace } from '../../plugin/src/generated/sdk-plugin.contract.js';
import { createSdkPluginService } from '../../plugin/src/service.js';
import { createChangeCaseService } from './service.js';

export function createHostService() {
  const hostService = createChangeCaseService();
  installSdkPluginApiNamespace(hostService, createSdkPluginService());
  return hostService;
}
```

Then generate the final host artifact with `generateEndpointSurface(...)` or the normal docs/OpenAPI flow.

## CLI Commands

Installed binaries:

- `nrpc-generate-codec`
- `nrpc-generate-declaration-lines`
- `nrpc-generate-endpoint-surface`
- `nrpc-generate-endpoint-global-dts`
- `nrpc-generate-openapi-surface`
- `nrpc-generate-graphql-openapi-surface`
- `nrpc-generate-package-target`

Common examples:

```bash
nrpc-generate-endpoint-surface \
	--in ./src/server-contract.ts \
	--root ServerApi \
	--out ./src/generated/server-api.surface.ts \
	--root-path api \
	--global api
```

```bash
nrpc-generate-openapi-surface \
	--in ./openapi/third-party-api.json \
	--out ./src/generated/third-party-api.surface.ts \
	--global thirdPartyApi \
	--root-type ThirdPartyApiSurface \
	--root-path thirdParty
```

```bash
nrpc-generate-package-target --target lib-es5
```

## What Goes In `src/generated/`

Common generated files are:

- `*.contract.ts`
- `*.surface.docs.ts`
- `*.mcp-tools.ts`

Additional generated files depend on the generator path:

- `*.surface.ts`
- `*.openapi.json`
- `*.surface.manifest.json`
- `*.codec.ts`
- `*.d.ts`

Only write artifacts that have a real consumer.

## Local Repository Build And Verification

For `nrpc-cli` package-local verification:

```bash
cd nrpc-cli
bun install
bun run build
bun run generate:lib-es5
bun run generate:node
bun run generate:bun
bun run generate:typescript
```

For the repository-local sibling SDK example:

```bash
cd ../nrpc-example-sdk-plugin
bun install
bun run generate

cd ../nrpc-example
bun install
bun run generate
bun run dev
bun run call:manifest
bun run call:no-manifest
```

## When To Use Which Doc

Use `nrpc-cli/INSTRUCTION_MANUAL.md` when you need the broader generator catalog and package boundary explanation.

Use this build guide when you need:

- the recommended app build flow
- the SDK plugin generation flow
- local build and verification commands

Use `nRPC/USAGE_GUIDE.md` when you move from generation into runtime endpoint wiring.