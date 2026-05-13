# Testing Patterns

## Core Sections (Required)

### 1) Test Stack and Commands

- Primary test framework: none configured in package manifest
- Assertion/mocking tools: none configured in package manifest
- Commands:

```bash
npm run build
# then follow docs/codebase/VERIFICATION.md for repository-fixture smoke checks
```

### 2) Test Layout

- Test file placement pattern: no local test files are currently configured in this package
- Naming convention: none yet
- Setup files and where they run: none

### 3) Test Scope Matrix

| Scope | Covered? | Typical target | Notes |
|-------|----------|----------------|-------|
| Unit | No | N/A | No test files detected under `nrpc-cli` |
| Integration | Partial | CLI build plus repository-fixture smoke generation | Verification is documented rather than wired to a local test runner |
| E2E | No | N/A | No end-to-end harness is configured in this package |

### 4) Mocking and Isolation Strategy

- Main mocking approach: none
- Isolation guarantees: smoke flow writes to existing generated artifact locations already used by the repo
- Common failure mode in tests: command or fixture-path drift would break the documented smoke flow

### 5) Coverage and Quality Signals

- Coverage tool + threshold: none configured
- Current reported coverage: none
- Known gaps/flaky areas: no in-package automated test coverage is configured; confidence comes from repeatable build plus fixture-backed smoke generation documented in `VERIFICATION.md`

### 6) Evidence

- package.json
- docs/codebase/.codebase-scan.txt
- README.md
- docs/codebase/VERIFICATION.md
- ../nrpc-api-example/src/generate.ts
- ../nRPC/samples/graphql-smoke/railway_graphql_collection.json
