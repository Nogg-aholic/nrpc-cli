# nrpc-cli

`@nogg-aholic/nrpc-cli` contains the code generation and CLI tooling for `@nogg-aholic/nrpc`.

It is maintained as a separate package so runtime consumers do not need to install generation dependencies.

This package is the generator/tooling side only. Runtime behavior stays in `@nogg-aholic/nrpc`.

## Install

For local repository development, use the package from this workspace.

If you are consuming it as a published package, install it alongside `@nogg-aholic/nrpc`.

`@nogg-aholic/nrpc-cli` expects `@nogg-aholic/nrpc` alongside it.

```bash
npm install @nogg-aholic/nrpc @nogg-aholic/nrpc-cli
```

Or with Bun:

```bash
bun add @nogg-aholic/nrpc @nogg-aholic/nrpc-cli
```

`@nogg-aholic/nrpc` is a peer dependency because generated artifacts target the runtime package.

## Purpose

This package owns:

- codec generation
- endpoint-surface generation
- declaration generation
- OpenAPI wrapper generation
- GraphQL-to-OpenAPI surface generation
- docs artifact generation helpers
- package-target generation for curated surface fixtures
- canonical NRPC surface manifest generation

It does not duplicate runtime behavior. Runtime code stays in `@nogg-aholic/nrpc`.

## CLI Commands

Installed binaries:

- `nrpc-generate-codec`
- `nrpc-generate-declaration-lines`
- `nrpc-generate-endpoint-surface`
- `nrpc-generate-endpoint-global-dts`
- `nrpc-generate-openapi-surface`
- `nrpc-generate-graphql-openapi-surface`
- `nrpc-generate-package-target`

## Examples

### Generate A Method Codec

```bash
nrpc-generate-codec \
	--in ./src/chart-contract.ts \
	--out ./src/generated/get-chart.codec.ts \
	--method chart.get \
	--args GetChartArgs \
	--result GetChartResult
```

### Generate An Endpoint Surface

```bash
nrpc-generate-endpoint-surface \
	--in ./src/server-contract.ts \
	--root ServerApi \
	--out ./src/generated/server-api.surface.ts \
	--root-path api \
	--global api
```

### Generate From OpenAPI JSON

```bash
nrpc-generate-openapi-surface \
	--in ./openapi/third-party-api.json \
	--out ./src/generated/third-party-api.surface.ts \
	--global thirdPartyApi \
	--root-type ThirdPartyApiSurface \
	--root-path thirdParty
```

Expected emitted artifact set:

- `./src/generated/third-party-api.contract.ts`
- `./src/generated/third-party-api.surface.docs.ts`
- `./src/generated/third-party-api.mcp-tools.ts`

### Generate A Package Target

Package targets are repository-local generation configs stored in `packages/*/target.json` and are mainly used to produce curated fixtures such as `lib-es5`, `node`, `bun`, and `typescript`.

```bash
nrpc-generate-package-target --target lib-es5
```

Equivalent local script:

```bash
bun run generate:lib-es5
```

Expected emitted artifact set for a package target:

- `generated/<target>/<target>.surface.manifest.json`
- `generated/<target>/<target>.openapi.json`
- `generated/<target>/<target>.contract.ts`
- `generated/<target>/<target>.surface.docs.ts`
- `generated/<target>/<target>.mcp-tools.ts`

The same files are also mirrored into `../nodeTypes/<target>/` for local editor/runtime consumption.

## Canonical Surface Manifest

Package-target generation is manifest-first.

The canonical file is:

- `<target>.surface.manifest.json`

It is the source of truth for:

- method signature metadata
- semantic/effect metadata
- runtime shape metadata
- transport bindings

Current top-level structure:

- `methods[]`: canonical NRPC surface entries
- `bindings.http[]`: HTTP binding projection for those methods

OpenAPI is now a derived transport/docs projection, not the canonical semantic source.

For difficult ambient or host-provided types, the manifest may intentionally fall back to `unknown` runtime shapes while preserving method signature metadata so generation can complete.

### Generate From GraphQL Operations

Document mode:

```bash
nrpc-generate-graphql-openapi-surface \
	--document ./samples/graphql-smoke/operations.graphql \
	--introspection ./samples/graphql-smoke/railway-introspection.json \
	--out ../openapi-generated/graphql-smoke.contract.ts
```

Expected emitted artifact set:

- `../openapi-generated/graphql-smoke.contract.ts`
- `../openapi-generated/graphql-smoke.surface.docs.ts`
- `../openapi-generated/graphql-smoke.mcp-tools.ts`
- `../openapi-generated/graphql-smoke.openapi.json`

Collection mode:

```bash
nrpc-generate-graphql-openapi-surface \
	--collection ./samples/graphql-smoke/railway_graphql_collection.json \
	--introspection ./samples/graphql-smoke/railway-introspection.json \
	--out ../openapi-generated/railway-graphql-collection.contract.ts
```

Expected emitted artifact set:

- `../openapi-generated/railway-graphql-collection.contract.ts`
- `../openapi-generated/railway-graphql-collection.surface.docs.ts`
- `../openapi-generated/railway-graphql-collection.mcp-tools.ts`
- `../openapi-generated/railway-graphql-collection.openapi.json`

When using `--collection`, operations that no longer validate against the supplied schema or introspection are skipped automatically.

## Package Boundary

Current repository layout relies on sibling-package development wiring, especially the `../nRPC` runtime sources used during local builds.

That keeps the split at two published packages without introducing parallel code paths.

Repository-local package-target source folders under `packages/` are generation inputs and fixtures. They are not part of the public published surface of `@nogg-aholic/nrpc-cli`.

## Verification

`nrpc-cli` does not currently keep an in-package unit or integration test harness.

Instead, verification is intentionally kept lightweight and repeatable:

1. build the package
2. run a smoke generation flow against repository fixtures
3. confirm emitted artifacts land in the existing generated output locations without generator errors

Typical local verification commands:

```bash
bun run build
bun run generate:lib-es5
bun run generate:node
bun run generate:bun
bun run generate:typescript
```

See `docs/codebase/VERIFICATION.md` for the repeatable local flow.