# Verification

`nrpc-cli` intentionally uses a lightweight verification flow instead of an in-package test runner.

## Goals

- confirm the package still builds in the repository layout it depends on
- smoke-check representative generator entry points against existing repository fixtures
- avoid introducing extra test dependencies inside this package

## Repeatable Local Flow

Run from `nrpc-cli/`.

### 1. Build

```bash
npm run build
```

Expected result: TypeScript compilation succeeds and refreshes `dist/`.

### 2. Smoke-check GraphQL collection generation

```bash
node ./dist/generate-graphql-openapi-surface-cli.js \
  --collection ../nRPC/samples/graphql-smoke/railway_graphql_collection.json \
  --introspection ../nRPC/samples/graphql-smoke/railway-introspection.json \
  --out ../openapi-generated/railway-graphql-collection.contract.ts
```

Expected result: command exits successfully and refreshes all of:

- `../openapi-generated/railway-graphql-collection.contract.ts`
- `../openapi-generated/railway-graphql-collection.surface.docs.ts`
- `../openapi-generated/railway-graphql-collection.mcp-tools.ts`
- `../openapi-generated/railway-graphql-collection.openapi.json`

### 3. Smoke-check GraphQL document generation

```bash
node ./dist/generate-graphql-openapi-surface-cli.js \
  --document ../nRPC/samples/graphql-smoke/operations.graphql \
  --introspection ../nRPC/samples/graphql-smoke/railway-introspection.json \
  --out ../openapi-generated/graphql-smoke.contract.ts
```

Expected result: command exits successfully and refreshes all of:

- `../openapi-generated/graphql-smoke.contract.ts`
- `../openapi-generated/graphql-smoke.surface.docs.ts`
- `../openapi-generated/graphql-smoke.mcp-tools.ts`
- `../openapi-generated/graphql-smoke.openapi.json`

## Notes

- This flow assumes the repository sibling layout remains intact, especially `../nRPC` and `../openapi-generated`.
- The smoke check is intentionally artifact-oriented: success means the built CLI exits successfully and refreshes the expected generated artifact set without runtime errors.
- If this package starts changing frequently or smoke failures recur, the next step should be fixture assertions wired into a dedicated test command rather than adding ad hoc manual checks.