# Codebase Structure

## Core Sections (Required)

### 1) Top-Level Map

List only meaningful top-level directories and files.

| Path | Purpose | Evidence |
|------|---------|----------|
| docs/codebase/ | Generated repository knowledge output and scan artifact | docs/codebase/.codebase-scan.txt |
| src/ | Source for CLI entry points and reusable generators/renderers | docs/codebase/.codebase-scan.txt; src/index.ts |
| package.json | Package manifest, published bins, exports, scripts, dependencies | package.json |
| tsconfig.json | Compiler target, strictness, output path, and local path mapping into the sibling runtime package | tsconfig.json |
| package-lock.json | npm dependency lockfile | package-lock.json |
| nogg-aholic-nrpc-cli-0.5.0.tgz | Packed distribution artifact present in repo root | docs/codebase/.codebase-scan.txt |

### 2) Entry Points

- Main runtime entry: src/index.ts
- Secondary entry points (worker/cli/jobs): src/generate-codec-cli.ts, src/generate-declaration-lines-cli.ts, src/generate-endpoint-surface-cli.ts, src/generate-endpoint-global-dts-cli.ts, src/generate-openapi-surface-cli.ts, src/generate-graphql-openapi-surface-cli.ts
- How entry is selected (script/config): package.json `bin` maps command names to built `dist/*.js` files; package.json `main` and `exports` expose library modules.

### 3) Module Boundaries

| Boundary | What belongs here | What must not be here |
|----------|-------------------|------------------------|
| `src/generate-*-cli.ts` | Argument parsing, path resolution, file writing, orchestration of generator functions | Core AST/GraphQL/OpenAPI transformation logic |
| `src/*-generator.ts` | Reusable transformation logic that reads contracts/specs and returns generated text or manifest structures | Direct CLI argument parsing |
| `src/docs*.ts` | Docs/OpenAPI artifact rendering wrappers around generator output | Runtime transport implementation |
| `src/index.ts` | Barrel exports for library consumption | CLI side effects or file IO |

### 4) Naming and Organization Rules

- File naming pattern: kebab-case TypeScript filenames, e.g. `generate-openapi-surface-cli.ts`, `graphql-postman-collection.ts`
- Directory organization pattern: layer-style, with all source in one `src/` folder and modules grouped by responsibility rather than by feature directory
- Import aliasing or path conventions: relative imports within the package; tsconfig path aliases map `@nogg-aholic/nrpc` to sibling `../nRPC/dist` and `../nRPC/src`

### 5) Evidence

- docs/codebase/.codebase-scan.txt
- package.json
- tsconfig.json
- src/index.ts
- src/generate-endpoint-surface-cli.ts
