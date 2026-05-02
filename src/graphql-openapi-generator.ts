import { Kind, parse, print, Source, type DocumentNode, type FragmentDefinitionNode, type IntrospectionQuery, type OperationDefinitionNode, type SelectionNode } from 'graphql';

import {
  analyzeGraphqlOperations,
  type JsonSchema,
  type AnalyzeGraphqlOperationsResult,
} from './graphql-operation-analyzer.js';

type OpenApiDocumentLike = {
  openapi: string;
  info: {
    title: string;
    version: string;
    description?: string;
  };
  servers: Array<{ url: string }>;
  paths: Record<string, Record<string, unknown>>;
};

export type GenerateGraphqlOpenApiOptions = {
  document: string | Source;
  schema?: string | Source;
  introspectionSchema?: IntrospectionQuery;
  title?: string;
  version?: string;
  description?: string;
  endpointPath?: string;
};

export type GenerateGraphqlOpenApiResult = AnalyzeGraphqlOperationsResult & {
  openApiDocument?: OpenApiDocumentLike;
};

export function generateGraphqlOpenApi(options: GenerateGraphqlOpenApiOptions): GenerateGraphqlOpenApiResult {
  const analyzed = analyzeGraphqlOperations({
    document: options.document,
    schema: options.schema,
    introspectionSchema: options.introspectionSchema,
  });

  if (!analyzed.operations || analyzed.error || analyzed.queryErrors || analyzed.schemaError) {
    return analyzed;
  }

  const endpointPath = options.endpointPath ?? '/graphql';
  const rawDocumentText = typeof options.document === 'string'
    ? options.document
    : options.document.body;
  const parsedDocument = parse(rawDocumentText);
  const document: OpenApiDocumentLike = {
    openapi: '3.0.3',
    info: {
      title: options.title ?? 'Generated GraphQL OpenAPI',
      version: options.version ?? '1.0.0',
      ...(options.description ? { description: options.description } : {}),
    },
    servers: [{ url: '/' }],
    paths: {},
  };

  for (const operation of analyzed.operations) {
    const pathKey = `${endpointPath}/${operation.operationName}`;
    const operationDocument = renderGraphqlOperationDocument(parsedDocument, operation.operationName);
    document.paths[pathKey] = {
      post: {
        operationId: operation.operationName,
        summary: `GraphQL ${operation.operationType} ${operation.operationName}`,
        description: `Generated from GraphQL ${operation.operationType} ${operation.operationName}`,
        tags: ['graphql'],
        'x-nrpc-graphql-operation': {
          operationType: operation.operationType,
          operationName: operation.operationName,
          rootFieldNames: operation.rootFieldNames,
          query: operationDocument,
        },
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  variables: operation.variablesSchema,
                },
                required: ['variables'],
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'GraphQL response',
            content: {
              'application/json': {
                schema: operation.resultSchema,
              },
            },
          },
        },
      },
    };
  }

  return {
    ...analyzed,
    openApiDocument: document,
  };
}

export function serializeGraphqlOperationDocument(operationName: string, document: string): string {
  return JSON.stringify({
    operationName,
    query: renderGraphqlOperationDocument(parse(document), operationName),
  });
}

export function buildGraphqlVariablesBodySchema(variablesSchema: JsonSchema): JsonSchema {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      variables: variablesSchema,
    },
    required: ['variables'],
  };
}

function renderGraphqlOperationDocument(document: DocumentNode, operationName: string): string {
  const operation = document.definitions.find((definition): definition is OperationDefinitionNode =>
    definition.kind === 'OperationDefinition' && definition.name?.value === operationName,
  );

  if (!operation) {
    throw new Error(`Missing GraphQL operation definition for ${operationName}.`);
  }

  const fragmentDefinitions = new Map(
    document.definitions
      .filter((definition) => definition.kind === 'FragmentDefinition')
      .map((definition) => [definition.name.value, definition] as const),
  );

  const referencedFragments = new Set<string>();
  collectReferencedFragments(operation, referencedFragments, fragmentDefinitions);

  return print({
    kind: Kind.DOCUMENT,
    definitions: [
      operation,
      ...Array.from(referencedFragments).map((name) => {
        const fragment = fragmentDefinitions.get(name);
        if (!fragment) {
          throw new Error(`Missing GraphQL fragment definition for ${name}.`);
        }
        return fragment;
      }),
    ],
  });
}

function collectReferencedFragments(
  node: OperationDefinitionNode | FragmentDefinitionNode | { selectionSet?: { selections: readonly SelectionNode[] } },
  referencedFragments: Set<string>,
  fragmentDefinitions: Map<string, DocumentNode['definitions'][number]>,
): void {
  const selections = node.selectionSet?.selections ?? [];
  for (const selection of selections) {
    if (selection.kind === 'FragmentSpread' && selection.name) {
      const fragmentName = selection.name.value;
      if (referencedFragments.has(fragmentName)) {
        continue;
      }
      referencedFragments.add(fragmentName);
      const fragment = fragmentDefinitions.get(fragmentName);
      if (fragment && fragment.kind === 'FragmentDefinition') {
        collectReferencedFragments(fragment, referencedFragments, fragmentDefinitions);
      }
      continue;
    }

    if ('selectionSet' in selection && selection.selectionSet) {
      collectReferencedFragments(selection, referencedFragments, fragmentDefinitions);
    }
  }
}