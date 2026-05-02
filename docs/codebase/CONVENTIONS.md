# Coding Conventions

## Core Sections (Required)

### 1) Naming Rules

| Item | Rule | Example | Evidence |
|------|------|---------|----------|
| Files | kebab-case TypeScript filenames | `openapi-surface-generator.ts` | docs/codebase/.codebase-scan.txt |
| Functions/methods | camelCase for helpers and exported functions | `generateOpenApiSurface`, `readListArg` | src/openapi-surface-generator.ts; src/generate-endpoint-surface-cli.ts |
| Types/interfaces | PascalCase for type aliases, interfaces, and error classes | `GenerateOpenApiSurfaceOptions`, `MissingGraphqlSchemaError` | src/openapi-surface-generator.ts; src/graphql-operation-analyzer.ts |
| Constants/env vars | UPPER_SNAKE_CASE for module constants | `HTTP_METHODS`, `BUILTIN_SCALAR_MAP` | src/openapi-surface-generator.ts; src/graphql-operation-analyzer.ts |

### 2) Formatting and Linting

- Formatter: [TODO] no formatter config file was found
- Linter: [TODO] no linter config file was found
- Most relevant enforced rules: TypeScript `strict: true`, `skipLibCheck: true`, `moduleResolution: "Bundler"`
- Run commands: `npm run build`; [TODO] no dedicated lint/format command configured

### 3) Import and Module Conventions

- Import grouping/order: built-in modules first, then package-local modules; type-only imports are used in several files
- Alias vs relative import policy: relative imports inside `nrpc-cli`; package import for runtime target `@nogg-aholic/nrpc`; tsconfig alias remaps that package locally during development
- Public exports/barrel policy: `src/index.ts` re-exports generator modules as the package barrel

### 4) Error and Logging Conventions

- Error strategy by layer: CLI files throw `Error` for missing required flags; analysis/generator modules throw or return structured GraphQL error objects when schema or query validation fails
- Logging style and required context fields: most modules do not log; the GraphQL CLI uses `console.warn` to list skipped invalid operations by operation name
- Sensitive-data redaction rules: [TODO] no explicit redaction policy was found

### 5) Testing Conventions

- Test file naming/location rule: [TODO] no test files were found in this package
- Mocking strategy norm: [TODO]
- Coverage expectation: [TODO]

### 6) Evidence

- tsconfig.json
- src/index.ts
- src/generate-endpoint-surface-cli.ts
- src/openapi-surface-generator.ts
- src/graphql-operation-analyzer.ts
- docs/codebase/.codebase-scan.txt
