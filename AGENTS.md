# nrpc-cli Repository Instructions

These instructions exist to prevent regression toward older generation patterns that the `rpc-example` cleanup intentionally removed.

## Package Boundary

- Treat `@nogg-aholic/nrpc-cli` as the development-time generation package.
- Treat `@nogg-aholic/nrpc` as the runtime package.
- Do not move runtime endpoint wiring into `nrpc-cli` documentation or generated output contracts.
- Do not make generated runtime artifacts require `nrpc-cli` at runtime.

## Project Layout Expectations

When updating examples or documentation, prefer this layout:

```text
scripts/
  generate.ts
src/
  service.ts
  server.ts
  client/
  generated/
```

Rules:

- generation entrypoints belong in `scripts/`
- runtime code belongs in `src/`
- generated artifacts belong in `src/generated/`
- do not reintroduce `src/generate.ts` as the default pattern
- do not reintroduce `contracts/` folders as the default pattern

## Generation Rules

- Prefer checked-in generation scripts over ad hoc CLI command strings in documentation.
- Generation scripts should resolve from `scripts/` into `src/` explicitly.
- Keep `nrpc-cli` as a dev dependency in examples and recommended consumer setups.

## Artifact Emission Rules

- Emit only the outputs the consumer actually needs.
- Do not always emit wrapper/docs/MCP artifacts if a caller requested only one of them.
- Prefer explicit output selection for OpenAPI-derived generation paths.

## Self-Contained Output Rules

- Generated docs artifacts must be self-contained.
- Do not emit imports from `nrpc-cli` into generated runtime artifacts.
- If a generated file needs helper functions or helper types, inline them into the generated output when appropriate.
- Do not emit references to undeclared helper symbols.

## Canonical Manifest Direction

- Prefer one canonical semantic manifest pipeline.
- Treat OpenAPI/docs/MCP outputs as derived projections.
- Avoid creating multiple route-manifest-like structures as independent primary sources unless there is a strong architectural reason.

## Documentation Separation

- Keep generation/setup guidance in `nrpc-cli`.
- Keep runtime endpoint/setup guidance in `nRPC`.
- Do not blur package responsibilities in READMEs or manuals.

## Example Behavior To Preserve

`rpc-example` is the reference example pattern.
Preserve these properties:

- `nrpc-cli` is a dev dependency
- generation script lives under `scripts/`
- generated files land in `src/generated/`
- typed manifest-aware usage is shown separately from plain external-client usage