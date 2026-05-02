# External Integrations

## Core Sections (Required)

### 1) Integration Inventory

| System | Type (API/DB/Queue/etc) | Purpose | Auth model | Criticality | Evidence |
|--------|---------------------------|---------|------------|-------------|----------|
| TypeScript compiler API | local compiler/runtime library | Loads entry files, resolves types, and inspects RPC contract declarations | none | high | src/codec-generator.ts; src/endpoint-surface-generator.ts |
| `@nogg-aholic/nrpc` runtime package | local package integration | Generated contract modules import runtime symbols and generated codec runtime helpers from this package | none in this package | high | package.json; src/endpoint-surface-generator.ts |
| GraphQL schema/document inputs | input spec format | Validates operations and derives variable/result schemas before OpenAPI conversion | none in this package | medium | src/graphql-operation-analyzer.ts; src/generate-graphql-openapi-surface-cli.ts |
| OpenAPI JSON/YAML inputs | input spec format | Generates nRPC surface contracts, docs, and MCP-tool output from an API specification | none in this package | medium | src/openapi-surface-generator.ts; src/generate-openapi-surface-cli.ts |
| Postman collection JSON | input document format | Extracts GraphQL operations for collection-mode generation | none in this package | low | src/graphql-postman-collection.ts |

### 2) Data Stores

| Store | Role | Access layer | Key risk | Evidence |
|-------|------|--------------|----------|----------|
| None found | This package reads and writes local files rather than connecting to a database or cache | local file IO in CLI entry points | Generated outputs can overwrite target files if paths are wrong | src/generate-openapi-surface-cli.ts; src/generate-graphql-openapi-surface-cli.ts |

### 3) Secrets and Credentials Handling

- Credential sources: none found in `nrpc-cli` source
- Hardcoding checks: no environment-variable reads or credential-loading code were found in the scan
- Rotation or lifecycle notes: not applicable based on current source

### 4) Reliability and Failure Behavior

- Retry/backoff behavior: none found
- Timeout policy: none found
- Circuit-breaker or fallback behavior: GraphQL CLI can skip invalid collection operations and continue when at least one valid operation remains

### 5) Observability for Integrations

- Logging around external calls: limited to `console.warn` for skipped invalid GraphQL collection operations
- Metrics/tracing coverage: none found
- Missing visibility gaps: no counters or structured diagnostics around generated file counts, parse failures, or analyzer duration

### 6) Evidence

- package.json
- src/endpoint-surface-generator.ts
- src/codec-generator.ts
- src/openapi-surface-generator.ts
- src/graphql-operation-analyzer.ts
- src/generate-graphql-openapi-surface-cli.ts
- src/graphql-postman-collection.ts
