## Purpose

This manual is for `@nogg-aholic/nrpc-cli` generation setup only.

Use this document when you want to:

- install the generator package correctly
- place generation code in the right project location
- generate runtime artifacts from a contract root
- generate docs and MCP artifacts
- understand what belongs to generation versus runtime wiring

Do not use this document for server endpoint mounting.
Runtime endpoint setup belongs to `nRPC/INSTRUCTION_MANUAL.md`.

## Boundary

`@nogg-aholic/nrpc-cli` is a development-time package.

It should usually be installed as a dev dependency:

```bash
npm install -D @nogg-aholic/nrpc-cli
npm install @nogg-aholic/nrpc
```

Or with Bun:

```bash
bun add -d @nogg-aholic/nrpc-cli
bun add @nogg-aholic/nrpc
```

The intent is:

- `@nogg-aholic/nrpc-cli` is used to generate files
- `@nogg-aholic/nrpc` is used to run the generated output

## Where Generation Code Should Live

Put generation entrypoints under `scripts/`, not under `src/`.

Recommended project layout:

```text
scripts/
  generate.ts
src/
  service.ts
  server.ts
  client/
  generated/
```

Why:

- generation is development-only behavior
- `src/` stays focused on runtime code
- the package boundary is clearer when `nrpc-cli` is only referenced from `scripts/`

## Core Generation Flow

The normal generation flow is:

1. define an exported root type in your service/module
2. run generation from `scripts/generate.ts`
3. emit artifacts into `src/generated/`
4. consume those artifacts from runtime code in `src/`

## Recommended Example Setup

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

This is the important pattern after moving generation into `scripts/`:

- resolve `src/` explicitly from `scripts/`
- do not assume `service.ts` is next to the script file

## Endpoint Surface Generation

Generate the native nRPC runtime artifacts from your contract root:

```ts
const surface = generateEndpointSurface({
  entryFile,
  rootType: 'ChangeCaseApi',
  outputImportPath: path.join(generatedDir, 'change-case-api.surface.ts'),
  moduleSpecifier: '../../../nRPC/src/index.js',
  runtimeImportPath: '../../../nRPC/src/generated-codec-runtime.js',
  rootPath: ['api'],
  globalName: 'api',
});
```

This produces the generated contract/module used by the runtime server and typed clients.

## Docs Artifact Generation

Generate docs artifacts separately and emit the self-contained runtime docs module:

```ts
const docsArtifacts = generateDocsArtifacts({
  entryFile,
  rootType: 'ChangeCaseApi',
  basePath: '/',
  rootPath: ['api'],
  title: 'Change Case API',
  version: '0.1.0',
});

await Bun.write(
  path.join(generatedDir, 'change-case-api.surface.docs.ts'),
  renderGeneratedDocsArtifactsModule(docsArtifacts),
);
```

The emitted docs module should be self-contained and should not require `nrpc-cli` at runtime.

## MCP Artifact Generation

If you only need MCP output from the OpenAPI-derived branch, request only that output:

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

await Bun.write(
  path.join(generatedDir, 'change-case-api.openapi-surface.mcp-tools.ts'),
  requireOpenApiSurfaceOutput(openApiSurface.mcpToolsText, 'mcp'),
);
```

This avoids generating unused wrapper contract/doc outputs when your consumer only needs MCP tools.

## What Goes In `src/generated/`

Typical generated files:

- `*.contract.ts`
- `*.surface.docs.ts`
- `*.mcp-tools.ts`

Depending on the generation path, there may be additional OpenAPI-derived outputs, but they should only be emitted when actually needed.

## What Does Not Belong Here

Do not put these concerns into `nrpc-cli` setup docs:

- mounting `/rpc`
- mounting `/api`
- mounting `/docs`
- mounting `/mcp`
- runtime client wiring

Those are runtime concerns and belong to `@nogg-aholic/nrpc` documentation.

## Recommended Package Scripts

```json
{
  "scripts": {
    "generate": "bun run scripts/generate.ts",
    "dev": "bun run src/server.ts",
    "type-check": "tsc --noEmit -p tsconfig.json"
  }
}
```

This keeps the dev dependency boundary obvious.

## Verification

Typical generation verification flow:

1. run `bun run generate`
2. confirm files land in `src/generated/`
3. run `bun run type-check`
4. start the runtime server and verify endpoints separately

Keep generation validation and runtime validation conceptually separate.