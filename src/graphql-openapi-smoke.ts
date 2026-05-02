import fs from 'node:fs/promises';
import path from 'node:path';

import { generateGraphqlOpenApi } from './graphql-openapi-generator.js';
import { generateOpenApiSurface } from './openapi-surface-generator.js';

const schema = /* GraphQL */ `
  scalar DateTime

  type Project {
    id: ID!
    name: String!
    createdAt: DateTime!
    tags: [String!]!
  }

  input ProjectCreateInput {
    name: String!
    tags: [String!]
  }

  type Query {
    project(id: ID!): Project
    projects(limit: Int): [Project!]!
  }

  type Mutation {
    projectCreate(input: ProjectCreateInput!): Project!
  }
`;

const document = /* GraphQL */ `
  query GetProject($id: ID!) {
    project(id: $id) {
      id
      name
      createdAt
      tags
    }
  }

  mutation CreateProject($input: ProjectCreateInput!) {
    projectCreate(input: $input) {
      id
      name
      createdAt
      tags
    }
  }
`;

const generated = generateGraphqlOpenApi({
  schema,
  document,
  title: 'Smoke GraphQL API',
  version: '1.0.0',
  endpointPath: '/graphql',
});

if (!generated.openApiDocument) {
  throw generated.error ?? generated.schemaError ?? generated.queryErrors?.[0] ?? new Error('Failed to generate GraphQL OpenAPI document.');
}

const outDir = path.resolve(process.cwd(), '..', 'openapi-generated');
await fs.mkdir(outDir, { recursive: true });

const openApiFile = path.join(outDir, 'graphql-smoke.openapi.json');
await fs.writeFile(openApiFile, JSON.stringify(generated.openApiDocument, null, 2), 'utf8');

const openApiSurface = generateOpenApiSurface({
  openApiFile,
  outputImportPath: path.join(outDir, 'graphql-smoke.surface.ts'),
  rootTypeName: 'GraphqlSmokeSurface',
  globalName: 'graphqlSmoke',
  rootPath: ['graphqlSmoke'],
});

await fs.writeFile(path.join(outDir, 'graphql-smoke.contract.ts'), openApiSurface.contractText, 'utf8');
await fs.writeFile(path.join(outDir, 'graphql-smoke.surface.docs.ts'), openApiSurface.docsText, 'utf8');
await fs.writeFile(path.join(outDir, 'graphql-smoke.mcp-tools.ts'), openApiSurface.mcpToolsText, 'utf8');
