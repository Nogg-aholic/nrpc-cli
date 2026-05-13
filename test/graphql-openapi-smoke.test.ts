import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, test } from 'bun:test';

import { writeGraphqlSmokeArtifacts } from '../src/graphql/smoke-artifacts.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nrpc-cli-graphql-smoke-'));

afterAll(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe('GraphQL smoke artifacts', () => {
  test('writes the expected OpenAPI surface artifact set', async () => {
    await writeGraphqlSmokeArtifacts(tempRoot);

    const openApiJson = await fs.readFile(path.join(tempRoot, 'graphql-smoke.openapi.json'), 'utf8');
    const contractText = await fs.readFile(path.join(tempRoot, 'graphql-smoke.contract.ts'), 'utf8');
    const docsText = await fs.readFile(path.join(tempRoot, 'graphql-smoke.surface.docs.ts'), 'utf8');
    const mcpToolsText = await fs.readFile(path.join(tempRoot, 'graphql-smoke.mcp-tools.ts'), 'utf8');

    expect(openApiJson).toContain('"openapi": "3.0.3"');
    expect(openApiJson).toContain('/graphql/GetProject');
    expect(openApiJson).toContain('/graphql/CreateProject');

    expect(contractText).toContain('export type GetProjectInput');
    expect(contractText).toContain('export type CreateProjectResult');
    expect(contractText).toContain('export const graphqlSmokeRouteManifest');

    expect(docsText).toContain('export const docsJson');
    expect(docsText).toContain('GetProject');
    expect(docsText).toContain('CreateProject');

    expect(mcpToolsText).toContain('export const graphqlSmokeMcpToolSpecs');
    expect(mcpToolsText).toContain('graphqlsmoke_getproject');
    expect(mcpToolsText).toContain('graphqlsmoke_createproject');
  });
});