# nrpc-cli

`@nogg-aholic/nrpc-cli` contains the code generation and CLI tooling for `@nogg-aholic/nrpc`.

It is a separate package so runtime consumers do not need to install generation dependencies.

## Install

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

It does not duplicate runtime behavior. Runtime code stays in `@nogg-aholic/nrpc`.

## CLI Commands

Installed binaries:

- `nrpc-generate-codec`
- `nrpc-generate-declaration-lines`
- `nrpc-generate-endpoint-surface`
- `nrpc-generate-endpoint-global-dts`
- `nrpc-generate-openapi-surface`
- `nrpc-generate-graphql-openapi-surface`

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

## Verification

`nrpc-cli` does not currently keep an in-package unit or integration test harness.

Instead, verification is intentionally kept lightweight and repeatable:

1. build the package
2. run a smoke generation flow against repository fixtures
3. confirm emitted artifacts land in the existing generated output locations without generator errors

See `docs/codebase/VERIFICATION.md` for the repeatable local flow.