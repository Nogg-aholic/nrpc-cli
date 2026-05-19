import fs from 'node:fs/promises';
import path from 'node:path';

import { generateGraphqlOpenApi } from './openapi-generator.js';
import { generateOpenApiSurface, requireOpenApiSurfaceOutput } from '../openapi-surface-generator.js';

export const graphqlSmokeSchema = /* GraphQL */ `
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

export const graphqlSmokeDocument = /* GraphQL */ `
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

export type GraphqlSmokeArtifacts = {
  openApiJson: string;
  contractText: string;
  docsText: string;
  mcpToolsText: string;
};

export function buildGraphqlSmokeArtifacts(): GraphqlSmokeArtifacts {
  const generated = generateGraphqlOpenApi({
    schema: graphqlSmokeSchema,
    document: graphqlSmokeDocument,
    title: 'Smoke GraphQL API',
    version: '1.0.0',
    endpointPath: '/graphql',
  });

  if (!generated.openApiDocument) {
    throw generated.error ?? generated.schemaError ?? generated.queryErrors?.[0] ?? new Error('Failed to generate GraphQL OpenAPI document.');
  }

  const openApiJson = JSON.stringify(generated.openApiDocument, null, 2);
  const tempOpenApiFile = path.join(process.cwd(), '.tmp-graphql-smoke.openapi.json');
  const openApiSurface = generateOpenApiSurface({
    openApiFile: tempOpenApiFile,
    outputImportPath: path.join(process.cwd(), 'graphql-smoke.surface.ts'),
    rootTypeName: 'GraphqlSmokeSurface',
    globalName: 'graphqlSmoke',
    rootPath: ['graphqlSmoke'],
  });

  return {
    openApiJson,
    contractText: requireOpenApiSurfaceOutput(openApiSurface.contractText, 'contract'),
    docsText: requireOpenApiSurfaceOutput(openApiSurface.docsText, 'docs'),
    mcpToolsText: requireOpenApiSurfaceOutput(openApiSurface.mcpToolsText, 'mcp'),
  };
}

export async function writeGraphqlSmokeArtifacts(outDir: string): Promise<void> {
  const generated = generateGraphqlOpenApi({
    schema: graphqlSmokeSchema,
    document: graphqlSmokeDocument,
    title: 'Smoke GraphQL API',
    version: '1.0.0',
    endpointPath: '/graphql',
  });

  if (!generated.openApiDocument) {
    throw generated.error ?? generated.schemaError ?? generated.queryErrors?.[0] ?? new Error('Failed to generate GraphQL OpenAPI document.');
  }

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

  await fs.writeFile(path.join(outDir, 'graphql-smoke.contract.ts'), requireOpenApiSurfaceOutput(openApiSurface.contractText, 'contract'), 'utf8');
  await fs.writeFile(path.join(outDir, 'graphql-smoke.surface.docs.ts'), requireOpenApiSurfaceOutput(openApiSurface.docsText, 'docs'), 'utf8');
  await fs.writeFile(path.join(outDir, 'graphql-smoke.mcp-tools.ts'), requireOpenApiSurfaceOutput(openApiSurface.mcpToolsText, 'mcp'), 'utf8');
}