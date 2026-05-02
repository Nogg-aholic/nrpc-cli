#!/usr/bin/env bun
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  type GraphQLError,
  type IntrospectionQuery,
} from 'graphql';

import { analyzeGraphqlOperations } from './graphql-operation-analyzer.js';
import { generateGraphqlOpenApi } from './graphql-openapi-generator.js';
import { extractGraphqlOperationsFromPostmanCollection } from './graphql-postman-collection.js';
import { generateOpenApiSurface } from './openapi-surface-generator.js';

type GraphqlIntrospectionEnvelope = {
  data?: IntrospectionQuery;
};

type FilteredCollectionDocument = {
  document: string;
  skippedOperations: Array<{
    operationName?: string;
    errors: readonly GraphQLError[];
  }>;
};

type CliGraphqlSource = {
  document: string;
  skippedOperations: FilteredCollectionDocument['skippedOperations'];
};

function readArg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function readListArg(flag: string): string[] | undefined {
  const value = readArg(flag);
  if (!value) return undefined;
  const items = value.split(',').map((entry) => entry.trim()).filter(Boolean);
  return items.length > 0 ? items : undefined;
}

const documentPath = readArg('--document');
const collectionPath = readArg('--collection');
const schemaPath = readArg('--schema');
const introspectionPath = readArg('--introspection');
const outputPath = readArg('--out');
const openApiOutPath = readArg('--openapi-out');
const title = readArg('--title');
const version = readArg('--version');
const description = readArg('--description');
const endpointPath = readArg('--endpoint-path');
const rootTypeName = readArg('--root-type');
const globalName = readArg('--global');
const rootPath = readListArg('--root-path');

if (!documentPath && !collectionPath) {
  throw new Error('Missing GraphQL source: provide --document <graphql-document-path> or --collection <postman-collection.json>.');
}
if (!outputPath) throw new Error('Missing --out <generated-surface-file>');
if (!schemaPath && !introspectionPath) {
  throw new Error('Missing GraphQL schema source: provide --schema <schema.graphql> or --introspection <schema.json>.');
}

const resolvedOutputPath = path.resolve(process.cwd(), outputPath);
const resolvedOpenApiOutPath = path.resolve(
  process.cwd(),
  openApiOutPath ?? resolvedOutputPath.replace(/\.surface\.ts$/, '.openapi.json'),
);
const contractOutFile = resolvedOutputPath.replace(/\.surface\.ts$/, '.contract.ts');
const docsOutFile = resolvedOutputPath.replace(/\.surface\.ts$/, '.surface.docs.ts');
const mcpToolsOutFile = resolvedOutputPath.replace(/\.surface\.ts$/, '.mcp-tools.ts');

const schema = schemaPath ? await fs.readFile(path.resolve(process.cwd(), schemaPath), 'utf8') : undefined;
const introspectionSchema = introspectionPath
  ? unwrapIntrospectionSchema(JSON.parse(await fs.readFile(path.resolve(process.cwd(), introspectionPath), 'utf8')))
  : undefined;
const graphqlSource = await resolveGraphqlSource({
  documentPath,
  collectionPath,
  schema,
  introspectionSchema,
});

const generated = generateGraphqlOpenApi({
  document: graphqlSource.document,
  schema,
  introspectionSchema,
  title,
  version,
  description,
  endpointPath,
});

if (!generated.openApiDocument) {
  throw generated.error ?? generated.schemaError ?? generated.queryErrors?.[0] ?? new Error('Failed to generate GraphQL OpenAPI document.');
}

await fs.mkdir(path.dirname(resolvedOpenApiOutPath), { recursive: true });
await fs.writeFile(resolvedOpenApiOutPath, JSON.stringify(generated.openApiDocument, null, 2), 'utf8');

const openApiSurface = generateOpenApiSurface({
  openApiFile: resolvedOpenApiOutPath,
  outputImportPath: resolvedOutputPath,
  rootTypeName,
  globalName,
  rootPath,
});

await fs.mkdir(path.dirname(contractOutFile), { recursive: true });
await fs.writeFile(contractOutFile, openApiSurface.contractText, 'utf8');
await fs.writeFile(docsOutFile, openApiSurface.docsText, 'utf8');
await fs.writeFile(mcpToolsOutFile, openApiSurface.mcpToolsText, 'utf8');

if (graphqlSource.skippedOperations.length) {
  console.warn(
    `Skipped ${graphqlSource.skippedOperations.length} invalid collection operations: ${graphqlSource.skippedOperations
      .map((entry) => entry.operationName ?? '<unnamed>')
      .join(', ')}`,
  );
}

function unwrapIntrospectionSchema(value: unknown): IntrospectionQuery | undefined {
  if (value && typeof value === 'object' && 'data' in (value as GraphqlIntrospectionEnvelope)) {
    return (value as GraphqlIntrospectionEnvelope).data;
  }
  return value as IntrospectionQuery | undefined;
}

function filterCollectionDocument(
  collectionText: string,
  schema: string | undefined,
  introspectionSchema: IntrospectionQuery | undefined,
): FilteredCollectionDocument {
  const extracted = extractGraphqlOperationsFromPostmanCollection(collectionText);
  const includedQueries: string[] = [];
  const skippedOperations: FilteredCollectionDocument['skippedOperations'] = [];

  for (const operation of extracted.operations) {
    try {
      const analysis = analyzeGraphqlOperations({
        document: operation.query,
        schema,
        introspectionSchema,
      });

      if (analysis.queryErrors?.length) {
        skippedOperations.push({
          operationName: operation.operationName,
          errors: analysis.queryErrors,
        });
        continue;
      }

      if (analysis.schemaError) {
        skippedOperations.push({
          operationName: operation.operationName,
          errors: [analysis.schemaError],
        });
        continue;
      }

      if (analysis.error) {
        skippedOperations.push({
          operationName: operation.operationName,
          errors: [analysis.error as GraphQLError],
        });
        continue;
      }
    } catch (error) {
      skippedOperations.push({
        operationName: operation.operationName,
        errors: [error as GraphQLError],
      });
      continue;
    }

    includedQueries.push(operation.query);
  }

  if (includedQueries.length === 0) {
    throw new Error('No valid GraphQL operations found in collection.');
  }

  return {
    document: includedQueries.join('\n\n'),
    skippedOperations,
  };
}

async function resolveGraphqlSource(options: {
  documentPath: string | undefined;
  collectionPath: string | undefined;
  schema: string | undefined;
  introspectionSchema: IntrospectionQuery | undefined;
}): Promise<CliGraphqlSource> {
  if (options.documentPath) {
    return {
      document: await fs.readFile(path.resolve(process.cwd(), options.documentPath), 'utf8'),
      skippedOperations: [],
    };
  }

  const filteredCollection = filterCollectionDocument(
    await fs.readFile(path.resolve(process.cwd(), options.collectionPath!), 'utf8'),
    options.schema,
    options.introspectionSchema,
  );

  return {
    document: filteredCollection.document,
    skippedOperations: filteredCollection.skippedOperations,
  };
}
