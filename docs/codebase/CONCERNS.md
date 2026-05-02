# Codebase Concerns

## Core Sections (Required)

### 1) Top Risks (Prioritized)

| Severity | Concern | Evidence | Impact | Suggested action |
|----------|---------|----------|--------|------------------|
| high | No automated test setup is configured in this package | package.json; docs/codebase/.codebase-scan.txt | Generator regressions may only surface after consumers use emitted artifacts | Add a repeatable test/smoke command around representative fixtures and expected generated outputs |
| high | Core generators are large single files | docs/codebase/.codebase-scan.txt; src/openapi-surface-generator.ts; src/codec-generator.ts | Changes in one area can unintentionally affect multiple output formats | Split large generators into smaller parsing/rendering modules with focused tests |
| medium | Development build depends on sibling-path tsconfig aliasing into `../nRPC` | tsconfig.json | Package isolation is weaker; standalone local builds depend on repository layout | Add a documented isolated build path or validate the sibling dependency assumption in CI |
| medium | Error handling is mostly exception-based with minimal structured diagnostics | src/generate-codec-cli.ts; src/generate-openapi-surface-cli.ts; src/generate-graphql-openapi-surface-cli.ts | CLI failures may be harder to troubleshoot in automation | Emit clearer error context and optional verbose diagnostics |
| low | Observability is minimal | src/generate-graphql-openapi-surface-cli.ts | Hard to measure generated method counts, skip counts, or spec-quality issues over time | Add optional summary logging or machine-readable report output |

### 2) Technical Debt

List the most important debt items only.

| Debt item | Why it exists | Where | Risk if ignored | Suggested fix |
|-----------|---------------|-------|-----------------|---------------|
| Monolithic OpenAPI surface generator | One module currently handles parsing, naming, schema projection, docs rendering, and MCP tool text generation | src/openapi-surface-generator.ts | Refactors become high-risk and harder to review | Extract parsers, naming policy, and emitters into separate modules |
| Monolithic codec/type normalizer | TypeScript program setup, type normalization, and codec-shape logic are centralized | src/codec-generator.ts | New type-shape support may regress existing normalization behavior | Separate compiler-host concerns from shape normalization and rendering helpers |
| Packed tarball committed in root | Distribution artifact is present alongside source | docs/codebase/.codebase-scan.txt | Source review noise and possible stale artifact drift | [ASK USER] Should packed artifacts stay committed in this package root? |

### 3) Security Concerns

| Risk | OWASP category (if applicable) | Evidence | Current mitigation | Gap |
|------|--------------------------------|----------|--------------------|-----|
| Generated outputs can overwrite arbitrary relative paths supplied by callers | N/A | src/generate-openapi-surface-cli.ts; src/generate-endpoint-surface-cli.ts | CLI requires explicit `--out` paths | No path allowlist or confirmation guard |
| Parsing untrusted OpenAPI/GraphQL/Postman files may throw or create very large generated outputs | N/A | src/openapi-surface-generator.ts; src/graphql-postman-collection.ts; src/graphql-operation-analyzer.ts | GraphQL validation rejects invalid documents; collection mode skips invalid operations | No input-size limits or sandboxing |

### 4) Performance and Scaling Concerns

| Concern | Evidence | Current symptom | Scaling risk | Suggested improvement |
|---------|----------|-----------------|-------------|-----------------------|
| Rebuilding compiler programs per generation run | src/codec-generator.ts; src/endpoint-surface-generator.ts; src/http-route-generator.ts; src/openapi-generator.ts | Each command constructs fresh compiler state | Large contracts or repeated batch generation may become slow | Cache program state when generating multiple artifacts from the same entry file in one invocation |
| GraphQL collection filtering validates operations one by one | src/generate-graphql-openapi-surface-cli.ts | Sequential validation loop over extracted operations | Large Postman collections may take longer and produce limited progress feedback | Add aggregate progress reporting or reuse parsed schema state more explicitly if profiling shows need |

### 5) Fragile/High-Churn Areas

| Area | Why fragile | Churn signal | Safe change strategy |
|------|-------------|-------------|----------------------|
| src/openapi-surface-generator.ts | One file emits contract text, docs text, and MCP tool text from spec parsing | Scan lists it among the largest source files | Change one projection path at a time and verify all emitted artifact types |
| src/codec-generator.ts | Central type normalization logic affects codec generation and downstream manifest/document generation | Scan lists it among the largest source files | Add fixture-based regression coverage before extending shape handling |
| src/endpoint-surface-generator.ts | Bridges discovered RPC methods into runtime-targeted generated contract code | Used by endpoint CLI and docs generation flow | Verify generated contract output against representative example contracts |


### 6) Evidence

- docs/codebase/.codebase-scan.txt
- package.json
- tsconfig.json
- src/codec-generator.ts
- src/openapi-surface-generator.ts
- src/endpoint-surface-generator.ts
- src/generate-graphql-openapi-surface-cli.ts
- src/generate-openapi-surface-cli.ts
