# Architecture

## Core Sections (Required)

### 1) Architectural Style

- Primary style: layered code-generation pipeline
- Why this classification: CLI entry files parse flags and write files, while generator modules transform TypeScript contracts, OpenAPI specs, or GraphQL operations into generated contract/docs/tooling artifacts.
- Primary constraints: generated output targets `@nogg-aholic/nrpc`; TypeScript type analysis depends on compiler APIs; GraphQL generation requires either schema SDL or introspection JSON.

### 2) System Flow

```text
CLI entry file -> parse CLI flags and resolve paths -> generator/analyzer builds in-memory model -> renderer produces contract/docs/tool text -> CLI writes generated files
```

Describe the flow in 4-6 steps using file-backed evidence.

1. A Bun CLI file reads positional flags from `process.argv` and resolves input/output paths with `node:path`. Evidence: src/generate-codec-cli.ts; src/generate-endpoint-surface-cli.ts.
2. The CLI calls a reusable generator such as `generateEndpointSurface`, `generateOpenApiSurface`, or `generateGraphqlOpenApi`. Evidence: src/generate-endpoint-surface-cli.ts; src/generate-openapi-surface-cli.ts; src/generate-graphql-openapi-surface-cli.ts.
3. TypeScript-backed generators create a compiler program and inspect exported interfaces/type aliases to collect RPC methods and normalize argument/result shapes. Evidence: src/codec-generator.ts; src/endpoint-surface-generator.ts; src/http-route-generator.ts.
4. GraphQL inputs are optionally validated against schema/introspection, then projected into an OpenAPI document before being fed into the OpenAPI surface generator. Evidence: src/graphql-operation-analyzer.ts; src/graphql-openapi-generator.ts; src/generate-graphql-openapi-surface-cli.ts.
5. Renderers emit contract modules, docs modules, HTTP route manifests, or MCP tools text, and the CLI persists them as `.contract.ts`, `.surface.docs.ts`, `.mcp-tools.ts`, or `.openapi.json`. Evidence: src/endpoint-surface-generator.ts; src/docs.ts; src/openapi-surface-generator.ts; src/generate-openapi-surface-cli.ts.

### 3) Layer/Module Responsibilities

| Layer or module | Owns | Must not own | Evidence |
|-----------------|------|--------------|----------|
| CLI entry modules | Process args, enforce required flags, resolve paths, write files | AST traversal and schema projection rules | src/generate-codec-cli.ts |
| `codec-generator.ts` | TypeScript program creation, type normalization, codec shape derivation | Output file path policy | src/codec-generator.ts |
| `endpoint-surface-generator.ts` | Build generated nRPC contract text and codec registry metadata from RPC method discovery | Reading CLI args directly | src/endpoint-surface-generator.ts |
| `openapi-surface-generator.ts` | Read OpenAPI JSON/YAML and synthesize contract/docs/MCP tool outputs | GraphQL schema validation | src/openapi-surface-generator.ts |
| `graphql-*` modules | Extract collection operations, validate GraphQL documents, convert GraphQL to OpenAPI | Writing files directly except from the CLI wrapper | src/graphql-postman-collection.ts; src/graphql-operation-analyzer.ts; src/graphql-openapi-generator.ts |

### 4) Reused Patterns

| Pattern | Where found | Why it exists |
|---------|-------------|---------------|
| Thin CLI wrapper over reusable library function | src/generate-codec-cli.ts; src/generate-openapi-surface-cli.ts | Keeps published binaries small and allows generator reuse from code |
| Generator + renderer split | src/docs.ts; src/openapi-generator.ts; src/endpoint-surface-generator.ts | Separates model creation from emitted text/assets |
| Manifest projection from discovered methods | src/http-route-generator.ts; src/openapi-generator.ts | Reuses one discovered RPC surface to emit multiple integration artifacts |
| Validation-before-generation | src/generate-graphql-openapi-surface-cli.ts; src/graphql-operation-analyzer.ts | Prevents invalid GraphQL operations from entering generated output |

### 5) Known Architectural Risks

- Large single-file generators such as `src/openapi-surface-generator.ts` and `src/codec-generator.ts` concentrate multiple responsibilities, which raises change risk.
- The package relies on a sibling runtime package path mapping during development, so local builds depend on the surrounding repository layout rather than a fully isolated package boundary.

### 6) Evidence

- src/generate-codec-cli.ts
- src/generate-endpoint-surface-cli.ts
- src/codec-generator.ts
- src/endpoint-surface-generator.ts
- src/http-route-generator.ts
- src/openapi-surface-generator.ts
- src/graphql-openapi-generator.ts
- src/generate-graphql-openapi-surface-cli.ts
