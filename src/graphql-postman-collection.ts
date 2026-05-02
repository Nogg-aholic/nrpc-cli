type PostmanCollection = {
  item?: PostmanItem[];
};

type PostmanItem = {
  name?: string;
  item?: PostmanItem[];
  request?: {
    body?: {
      mode?: string;
      graphql?: {
        query?: string;
      };
    };
  };
};

export type ExtractGraphqlCollectionOperationsResult = {
  document: string;
  operationCount: number;
  operations: Array<{
    operationName?: string;
    query: string;
  }>;
};

export function extractGraphqlOperationsFromPostmanCollection(
  collection: string | PostmanCollection,
): ExtractGraphqlCollectionOperationsResult {
  const parsedCollection = typeof collection === 'string'
    ? JSON.parse(collection) as PostmanCollection
    : collection;

  const operations: Array<{
    operationName?: string;
    query: string;
  }> = [];
  for (const item of walkCollectionItems(parsedCollection.item ?? [])) {
    const query = item.request?.body?.mode === 'graphql'
      ? item.request.body.graphql?.query?.trim()
      : undefined;
    if (!query) {
      continue;
    }

    const operationName = inferOperationName(query);
    operations.push({ operationName, query });
  }

  return {
    document: operations.map((entry) => entry.query).join('\n\n'),
    operationCount: operations.length,
    operations,
  };
}

function* walkCollectionItems(items: readonly PostmanItem[]): Generator<PostmanItem> {
  for (const item of items) {
    if (item.item?.length) {
      yield* walkCollectionItems(item.item);
      continue;
    }

    yield item;
  }
}

function inferOperationName(query: string): string | undefined {
  const match = query.match(/^\s*(query|mutation|subscription)\s+([_A-Za-z][_0-9A-Za-z]*)/m);
  return match?.[2];
}