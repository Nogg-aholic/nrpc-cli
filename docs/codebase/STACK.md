# Technology Stack

## Core Sections (Required)

### 1) Runtime Summary

| Area | Value | Evidence |
|------|-------|----------|
| Primary language | TypeScript | package.json; tsconfig.json; src/index.ts |
| Runtime + version | Bun shebang in CLI entry points; TypeScript target ES2022 | src/generate-codec-cli.ts; src/generate-endpoint-surface-cli.ts; tsconfig.json |
| Package manager | npm lockfile present; build invokes `npm run clean`; README also documents Bun install usage | package-lock.json; package.json; README.md |
| Module/build system | ESM package (`"type": "module"`) compiled by TypeScript with Bundler module resolution to `dist/` | package.json; tsconfig.json |

### 2) Production Frameworks and Dependencies

List only high-impact production dependencies (frameworks, data, transport, auth).

| Dependency | Version | Role in system | Evidence |
|------------|---------|----------------|----------|
| graphql | ^16.11.0 | Parses, validates, and introspects GraphQL operations before converting them into OpenAPI-backed generated surfaces | package.json; src/graphql-operation-analyzer.ts; src/graphql-openapi-generator.ts |
| yaml | ^2.8.1 | Parses YAML OpenAPI inputs in addition to JSON | package.json; src/openapi-surface-generator.ts |
| @nogg-aholic/nrpc | peer `^0.5.0` | Runtime target for generated contracts and codec/runtime imports | package.json; README.md; src/endpoint-surface-generator.ts |

### 3) Development Toolchain

| Tool | Purpose | Evidence |
|------|---------|----------|
| TypeScript | Build compiler and declaration emission | package.json; tsconfig.json |
| Bun | CLI runtime via shebang and prepack/build execution | package.json; src/generate-codec-cli.ts |
| @types/node | Node type definitions for fs/path/process usage | package.json; tsconfig.json |
| @types/bun | Bun type definitions | package.json; tsconfig.json |

### 4) Key Commands

```bash
npm install
npm run build
[TODO] no test command configured
[TODO] no lint command configured
```

### 5) Environment and Config

- Config sources: package.json, tsconfig.json
- Required env vars: [TODO] no environment-variable reads were found in scanned source
- Deployment/runtime constraints: CLI sources are authored under `src/` and compiled to `dist/`; published binaries point to generated `.js` files under `dist/`.

### 6) Evidence

- package.json
- package-lock.json
- tsconfig.json
- src/generate-codec-cli.ts
- src/openapi-surface-generator.ts
- src/graphql-operation-analyzer.ts
