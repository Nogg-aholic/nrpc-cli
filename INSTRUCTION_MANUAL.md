## Purpose

This manual is for `@nogg-aholic/nrpc-cli` generation setup only.

Companion documents:

- `nrpc-cli/BUILD_GUIDE.md`: practical build flow, SDK plugin generation flow, and verification commands
- `nRPC/USAGE_GUIDE.md`: runtime-side wiring after generation is complete

Use this document when you want to:

- install the generator package correctly
- place generation code in the right project location
- generate runtime artifacts from a contract root
- generate docs and MCP artifacts
- understand which generators are common app-facing flows versus advanced tooling
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

## Generator Completeness

This manual intentionally starts with the recommended application flow, but the package contains more generators than that flow needs.

The public command surface is:

- `nrpc-generate-endpoint-surface`: generate native nRPC endpoint contracts and surface modules from a TypeScript root type
- `nrpc-generate-openapi-surface`: generate nRPC/OpenAPI wrapper artifacts from an OpenAPI document
- `nrpc-generate-graphql-openapi-surface`: generate OpenAPI, contract, docs, and MCP artifacts from GraphQL operations
- `nrpc-generate-package-target`: generate repository package-target fixtures and canonical surface manifests
- `nrpc-generate-codec`: generate a focused method codec module
- `nrpc-generate-declaration-lines`: generate declaration-line artifacts from TypeScript source
- `nrpc-generate-endpoint-global-dts`: generate endpoint global declaration artifacts

The public library generator surface also includes lower-level helpers and advanced building blocks:

- codec generation
- contract runtime inline generation
- declaration-line generation
- endpoint-surface generation
- HTTP route manifest generation
- docs artifact generation and docs runtime helpers
- OpenAPI document generation from TypeScript surfaces
- OpenAPI wrapper/surface generation
- GraphQL operation analysis and GraphQL-to-OpenAPI generation
- GraphQL Postman collection handling
- canonical NRPC surface manifest generation
- package-target generation
- structural contract generation

Do not read the three common generated filenames below as the complete package surface.
They are the normal app-facing artifact set for a typical endpoint/docs/MCP setup.

Use the broader generators when you are building fixture packages, deriving surfaces from OpenAPI or GraphQL, debugging codec behavior, or producing canonical surface manifests.
For regular application setup, prefer one checked-in `scripts/generate.ts` that calls only the generators whose outputs are consumed by the app.

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

Additional generated files depend on the generator path:

- `*.surface.ts`: native endpoint surface modules or OpenAPI-derived wrapper surfaces
- `*.openapi.json`: OpenAPI documents generated from TypeScript, GraphQL, or package targets
- `*.surface.manifest.json`: canonical NRPC surface manifests, mostly from package-target generation
- `*.codec.ts`: focused method codec modules
- `*.d.ts`: generated global or declaration artifacts
- declaration-line modules: generated TypeScript modules that embed declaration text as data

Only emit artifacts that have a real consumer.
For example, if an integration only needs MCP tools from an OpenAPI-derived branch, request and write only the MCP output instead of also writing wrapper contracts and docs.

## Optional Generated Artifacts

### `*.surface.ts`

Surface modules are generated adapters around an API surface.

There are two common sources:

- native endpoint-surface generation from a TypeScript root type
- OpenAPI-derived surface generation from an OpenAPI document or GraphQL-derived OpenAPI document

Use a surface module when application code needs a typed object/function surface rather than raw generated metadata.
For native nRPC surfaces, this is the main bridge between the declared service contract and runtime/client wiring.
For OpenAPI-derived surfaces, this is a wrapper around HTTP operations that makes third-party or GraphQL-derived APIs look like a typed nRPC-style surface.

Do not emit a surface module if the consumer only needs docs, OpenAPI JSON, or MCP tools.
For example, an MCP-only integration should select only MCP output from `generateOpenApiSurface`.

### `*.contract.ts`

Contract modules contain the generated TypeScript contract types and method descriptors for a surface.

They are useful when you need checked-in type information for generated endpoints, wrapper APIs, MCP tools, or downstream tooling that imports generated method metadata.
OpenAPI-derived and GraphQL-derived generation usually emits this beside docs and MCP artifacts because the generated wrappers need a stable typed contract shape.

Do not treat contract files as handwritten source.
Regenerate them from the source TypeScript root, OpenAPI document, GraphQL operations, or package target config.

### `*.surface.docs.ts`

Docs modules contain self-contained documentation artifacts for a generated surface.

They normally include:

- OpenAPI JSON data for the generated methods
- Scalar HTML for interactive API documentation
- method projection metadata used by generated docs runtime helpers

Use docs modules when the runtime app serves generated OpenAPI JSON, Scalar docs, or per-method documentation.
The docs module should be self-contained and should not import `@nogg-aholic/nrpc-cli` at runtime.

Do not emit docs modules for internal surfaces that are never documented or served.
For runtime mounting details, use the runtime package manual instead of this generator setup manual.

### `*.mcp-tools.ts`

MCP tool modules expose generated operations as Model Context Protocol tools.

Use them when a generated API should be callable by MCP clients or agent tooling.
They are especially useful for OpenAPI-derived or GraphQL-derived APIs, where operation names, input schemas, descriptions, and HTTP bindings can be converted into tool definitions.

MCP output can be generated independently from wrapper contract/docs output when it is the only consumer.
Prefer selective output generation for MCP-only consumers to avoid extra unused artifacts.

### `*.openapi.json`

OpenAPI JSON files are transport/documentation projections of a generated surface.

They can be produced from:

- TypeScript nRPC surfaces
- GraphQL operations plus schema or introspection data
- package-target generation

Use OpenAPI JSON when you need interoperability with OpenAPI tools, external documentation, client generators, Scalar UI, or as an intermediate input to `generateOpenApiSurface`.
In the package-target pipeline, OpenAPI is a derived projection; the canonical semantic source is the NRPC surface manifest.

Do not use generated OpenAPI JSON as the only source of truth when canonical method semantics, effect metadata, or runtime shape metadata must be preserved.

### `*.surface.manifest.json`

Surface manifests are canonical NRPC surface descriptions.

They capture:

- method names and property paths
- signature metadata
- runtime input and result shapes
- semantic/effect metadata
- HTTP transport bindings

Use manifests when generation needs a stable semantic source that can drive multiple derived outputs such as OpenAPI, docs, MCP tools, or wrapper contracts.
They are mainly produced by package-target generation for curated fixture packages and local editor/runtime consumption.

Do not emit a manifest for a simple app unless another generator, runtime, or tool actually consumes it.
For ordinary app setup, the TypeScript root type can remain the generation source.

### `*.codec.ts`

Codec modules contain focused serialization/deserialization logic for one RPC method shape.

Use them when debugging codec behavior, validating policy handling for dates/maps/sets, or generating a small standalone codec for a specific method.
They are lower-level than endpoint-surface generation and usually not needed in the recommended app flow.

Do not generate one-off codec files for every method unless there is a deliberate consumer.
Endpoint-surface generation already handles the normal surface-level codec needs.

### `*.d.ts`

Generated declaration files provide ambient or global TypeScript declarations for generated endpoint surfaces.

Use them when host code needs a generated global API type, editor integration, or ambient declarations without importing the full generated module directly.
The endpoint global declaration generator writes this kind of artifact from a root type, root path, declaration type name, and global name.

Do not use global declaration output as the default app integration path.
Prefer explicit imports from generated modules unless the host environment specifically expects globals.

### Declaration-Line Modules

Declaration-line modules turn a source declaration file into a generated module containing declaration text lines under a chosen variable name.

Use them for tooling that needs to embed or ship declaration text as data, such as docs, fixture generation, package-target support, or editor/runtime metadata experiments.
This is a tooling artifact, not a normal runtime service artifact.

Do not put declaration-line modules in application runtime paths unless the application actually reads declaration text at runtime.

### Package-Target Artifact Sets

Package-target generation emits a coordinated artifact set from a repository-local target config:

- `<target>.surface.manifest.json`
- `<target>.openapi.json`
- `<target>.contract.ts`
- `<target>.surface.docs.ts`
- `<target>.mcp-tools.ts`

Use package targets for curated package fixtures such as `lib-es5`, `node`, `bun`, and `typescript`, where the repository needs repeatable generation of multiple projections from one config.
The generator also mirrors artifacts into `../nodeTypes/<target>/` for local editor/runtime consumption.

Do not use package-target generation as the default application setup.
Regular apps should keep a direct `scripts/generate.ts` that calls only the specific generators they need.

### GraphQL-Derived Artifact Sets

GraphQL generation starts from operation documents or Postman collection GraphQL entries plus a schema or introspection result.

It emits:

- `*.openapi.json`
- `*.contract.ts`
- `*.surface.docs.ts`
- `*.mcp-tools.ts`

Use this path when GraphQL operations should be exposed as OpenAPI-like operations, typed nRPC-style wrappers, docs, or MCP tools.
Collection mode can skip operations that no longer validate against the supplied schema or introspection.

Do not use this path for native TypeScript service contracts.
For TypeScript-first nRPC services, generate from the exported root type directly.

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