import {
  buildClientSchema,
  buildSchema,
  GraphQLEnumType,
  GraphQLError,
  type GraphQLInputObjectType,
  type GraphQLInputType,
  GraphQLList,
  GraphQLNonNull,
  type GraphQLObjectType,
  type GraphQLOutputType,
  GraphQLScalarType,
  type GraphQLSchema,
  type GraphQLType,
  GraphQLUnionType,
  type IntrospectionQuery,
  parse,
  Source,
  typeFromAST,
  type DocumentNode,
  type FieldNode,
  type FragmentDefinitionNode,
  type InlineFragmentNode,
  type OperationDefinitionNode,
  type SelectionNode,
  type SelectionSetNode,
  type VariableDefinitionNode,
  validate,
} from 'graphql';

export class MissingGraphqlSchemaError extends Error {
  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = MissingGraphqlSchemaError.name;
  }
}

export class UnnamedGraphqlOperationError extends Error {
  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = UnnamedGraphqlOperationError.name;
  }
}

export class UnknownGraphqlScalarError extends Error {
  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = UnknownGraphqlScalarError.name;
  }
}

export type JsonSchema = {
  type?: string;
  format?: string;
  description?: string;
  enum?: Array<string | number | boolean | null>;
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  allOf?: JsonSchema[];
  nullable?: boolean;
};

export type GraphqlVariableSchema = {
  name: string;
  required: boolean;
  schema: JsonSchema;
  description?: string;
};

export type AnalyzedGraphqlOperation = {
  operationName: string;
  operationType: OperationDefinitionNode['operation'];
  variables: GraphqlVariableSchema[];
  variablesSchema: JsonSchema;
  resultSchema: JsonSchema;
  rootFieldNames: string[];
};

export type AnalyzeGraphqlOperationsOptions = {
  document: string | Source;
  schema?: string | Source;
  introspectionSchema?: IntrospectionQuery;
  scalarConfig?: Record<string, JsonSchema>;
  onUnknownScalar?: (name: string) => JsonSchema | undefined;
};

export type AnalyzeGraphqlOperationsResult = {
  operations?: AnalyzedGraphqlOperation[];
  schemaError?: GraphQLError;
  queryErrors?: readonly GraphQLError[];
  error?: UnnamedGraphqlOperationError;
};

type ScalarResolver = {
  scalarConfig: Record<string, JsonSchema>;
  onUnknownScalar: (name: string) => JsonSchema | undefined;
};

type SelectionContext = {
  schema: GraphQLSchema;
  fragments: Record<string, FragmentDefinitionNode>;
  scalarResolver: ScalarResolver;
};

const BUILTIN_SCALAR_MAP: Record<string, JsonSchema> = {
  ID: { type: 'string' },
  String: { type: 'string' },
  Int: { type: 'integer' },
  Float: { type: 'number' },
  Boolean: { type: 'boolean' },
};

export function analyzeGraphqlOperations(options: AnalyzeGraphqlOperationsOptions): AnalyzeGraphqlOperationsResult {
  let schema: GraphQLSchema;

  try {
    schema = buildGraphqlSchema(options);
  } catch (error) {
    return {
      schemaError: error as GraphQLError,
    };
  }

  let document: DocumentNode;
  try {
    document = parse(options.document);
  } catch (error) {
    return {
      queryErrors: [error as GraphQLError],
    };
  }

  const queryErrors = validate(schema, document);
  if (queryErrors.length > 0) {
    return { queryErrors };
  }

  const scalarResolver: ScalarResolver = {
    scalarConfig: { ...(options.scalarConfig ?? {}) },
    onUnknownScalar: options.onUnknownScalar ?? (() => ({ type: 'string' })),
  };
  const fragments = Object.fromEntries(
    document.definitions
      .filter((definition): definition is FragmentDefinitionNode => definition.kind === 'FragmentDefinition')
      .map((definition) => [definition.name.value, definition]),
  );

  const operations: AnalyzedGraphqlOperation[] = [];
  for (const definition of document.definitions) {
    if (definition.kind !== 'OperationDefinition') {
      continue;
    }

    if (!definition.name) {
      return {
        error: new UnnamedGraphqlOperationError('GraphQL operation must be named.'),
      };
    }

    const rootType = getOperationRootType(schema, definition.operation);
    if (!rootType) {
      continue;
    }

    const variables = definition.variableDefinitions?.map((variableDefinition) =>
      mapVariableDefinition(schema, variableDefinition, scalarResolver),
    ) ?? [];

    const resultSchema = buildSelectionSetSchema(rootType, definition.selectionSet, {
      schema,
      fragments,
      scalarResolver,
    });

    operations.push({
      operationName: definition.name.value,
      operationType: definition.operation,
      variables,
      variablesSchema: buildVariablesSchema(variables),
      resultSchema,
      rootFieldNames: collectRootFieldNames(definition.selectionSet),
    });
  }

  return { operations };
}

function buildGraphqlSchema(options: AnalyzeGraphqlOperationsOptions): GraphQLSchema {
  if (options.schema) {
    return buildSchema(options.schema);
  }
  if (options.introspectionSchema) {
    return buildClientSchema(options.introspectionSchema);
  }
  throw new MissingGraphqlSchemaError('Neither schema nor introspection schema supplied.');
}

function getOperationRootType(schema: GraphQLSchema, operation: OperationDefinitionNode['operation']): GraphQLObjectType | undefined {
  switch (operation) {
    case 'query':
      return schema.getQueryType() ?? undefined;
    case 'mutation':
      return schema.getMutationType() ?? undefined;
    case 'subscription':
      return schema.getSubscriptionType() ?? undefined;
    default:
      return undefined;
  }
}

function mapVariableDefinition(schema: GraphQLSchema, variableDefinition: VariableDefinitionNode, scalarResolver: ScalarResolver): GraphqlVariableSchema {
  const resolvedType = typeFromAST(schema, variableDefinition.type);
  if (!resolvedType || !isGraphqlInputType(resolvedType)) {
    throw new GraphQLError(`Unable to resolve GraphQL input type for $${variableDefinition.variable.name.value}.`);
  }
  const inputType = graphQlInputTypeToJsonSchemaInternal(resolvedType, scalarResolver);
  return {
    name: variableDefinition.variable.name.value,
    required: !inputType.nullable,
    schema: inputType,
    description: inputType.description,
  };
}

function buildVariablesSchema(variables: GraphqlVariableSchema[]): JsonSchema {
  const required = variables.filter((entry) => entry.required).map((entry) => entry.name);
  return {
    type: 'object',
    properties: Object.fromEntries(variables.map((entry) => [entry.name, entry.schema])),
    additionalProperties: false,
    ...(required.length > 0 ? { required } : {}),
  };
}

function resolveNamedTypeSchema(typeName: string, scalarResolver: ScalarResolver, nullable: boolean): JsonSchema {
  const builtin = BUILTIN_SCALAR_MAP[typeName];
  if (builtin) {
    return { ...builtin, nullable };
  }

  const configured = scalarResolver.scalarConfig[typeName];
  if (configured) {
    return { ...configured, nullable };
  }

  const fallback = scalarResolver.onUnknownScalar(typeName);
  if (!fallback) {
    throw new UnknownGraphqlScalarError(`Unknown scalar: ${typeName}`);
  }

  scalarResolver.scalarConfig[typeName] = fallback;
  return { ...fallback, nullable };
}

function buildSelectionSetSchema(parentType: GraphQLObjectType, selectionSet: SelectionSetNode, context: SelectionContext): JsonSchema {
  const properties: Record<string, JsonSchema> = {};
  const required = new Set<string>();

  for (const selection of selectionSet.selections) {
    mergeSelection(properties, required, parentType, selection, context);
  }

  return {
    type: 'object',
    properties,
    additionalProperties: false,
    ...(required.size > 0 ? { required: [...required] } : {}),
  };
}

function mergeSelection(
  properties: Record<string, JsonSchema>,
  required: Set<string>,
  parentType: GraphQLObjectType,
  selection: SelectionNode,
  context: SelectionContext,
): void {
  if (selection.kind === 'Field') {
    applyFieldSelection(properties, required, parentType, selection, context);
    return;
  }

  if (selection.kind === 'FragmentSpread') {
    const fragment = context.fragments[selection.name.value];
    if (!fragment) {
      return;
    }
    const fragmentType = context.schema.getType(fragment.typeCondition.name.value);
    if (fragmentType && isGraphqlObjectType(fragmentType)) {
      const fragmentSchema = buildSelectionSetSchema(fragmentType, fragment.selectionSet, context);
      mergeObjectSchemas(properties, required, fragmentSchema);
    }
    return;
  }

  applyInlineFragment(properties, required, parentType, selection, context);
}

function applyInlineFragment(
  properties: Record<string, JsonSchema>,
  required: Set<string>,
  parentType: GraphQLObjectType,
  inlineFragment: InlineFragmentNode,
  context: SelectionContext,
): void {
  const fragmentTypeName = inlineFragment.typeCondition?.name.value;
  const fragmentType = fragmentTypeName ? context.schema.getType(fragmentTypeName) : parentType;
  if (!fragmentType || !isGraphqlObjectType(fragmentType)) {
    return;
  }

  const fragmentSchema = buildSelectionSetSchema(fragmentType, inlineFragment.selectionSet, context);
  mergeObjectSchemas(properties, required, fragmentSchema);
}

function applyFieldSelection(
  properties: Record<string, JsonSchema>,
  required: Set<string>,
  parentType: GraphQLObjectType,
  fieldNode: FieldNode,
  context: SelectionContext,
): void {
  const fieldDef = parentType.getFields()[fieldNode.name.value];
  if (!fieldDef) {
    return;
  }

  const propertyName = fieldNode.alias?.value ?? fieldNode.name.value;
  const fieldSchema = graphQlOutputTypeToJsonSchema(fieldDef.type, fieldNode.selectionSet, context);
  fieldSchema.description ??= fieldDef.description ?? undefined;
  properties[propertyName] = fieldSchema;
  if (fieldDef.type instanceof GraphQLNonNull) {
    required.add(propertyName);
  }
}

function graphQlOutputTypeToJsonSchema(
  type: GraphQLOutputType,
  selectionSet: SelectionSetNode | undefined,
  context: SelectionContext,
): JsonSchema {
  if (type instanceof GraphQLNonNull) {
    const schema = graphQlOutputTypeToJsonSchema(type.ofType, selectionSet, context);
    return {
      ...schema,
      nullable: false,
    };
  }

  if (type instanceof GraphQLList) {
    return {
      type: 'array',
      items: graphQlOutputTypeToJsonSchema(type.ofType, selectionSet, context),
      nullable: true,
    };
  }

  if (type instanceof GraphQLScalarType) {
    return resolveNamedTypeSchema(type.name, context.scalarResolver, true);
  }

  if (type instanceof GraphQLEnumType) {
    return {
      type: 'string',
      enum: type.getValues().map((entry) => entry.value as string),
      description: type.description ?? undefined,
      nullable: true,
    };
  }

  if (type instanceof GraphQLUnionType) {
    return {
      anyOf: type.getTypes().map((entry) => {
        if (!selectionSet) {
          return {
            type: 'object',
            additionalProperties: true,
          };
        }
        return buildSelectionSetSchema(entry, selectionSet, context);
      }),
      description: type.description ?? undefined,
      nullable: true,
    };
  }

  if (isGraphqlObjectType(type)) {
    if (!selectionSet) {
      return {
        type: 'object',
        additionalProperties: true,
        description: type.description ?? undefined,
        nullable: true,
      };
    }

    return {
      ...buildSelectionSetSchema(type, selectionSet, context),
      description: type.description ?? undefined,
      nullable: true,
    };
  }

  return {
    type: 'object',
    additionalProperties: true,
    nullable: true,
  };
}

function mergeObjectSchemas(properties: Record<string, JsonSchema>, required: Set<string>, schema: JsonSchema): void {
  for (const [name, propertySchema] of Object.entries(schema.properties ?? {})) {
    properties[name] = propertySchema;
  }
  for (const name of schema.required ?? []) {
    required.add(name);
  }
}

function collectRootFieldNames(selectionSet: SelectionSetNode): string[] {
  return selectionSet.selections
    .filter((selection): selection is FieldNode => selection.kind === 'Field')
    .map((selection) => selection.alias?.value ?? selection.name.value);
}

function isGraphqlObjectType(type: GraphQLType): type is GraphQLObjectType {
  return typeof (type as GraphQLObjectType).getFields === 'function';
}

function isGraphqlInputType(type: GraphQLType): type is GraphQLInputType {
  return type instanceof GraphQLNonNull
    || type instanceof GraphQLList
    || type instanceof GraphQLScalarType
    || type instanceof GraphQLEnumType
    || (typeof (type as GraphQLInputObjectType).getFields === 'function' && !isGraphqlObjectType(type));
}

export function graphQlInputTypeToJsonSchema(type: GraphQLInputType, scalarConfig?: Record<string, JsonSchema>, onUnknownScalar?: (name: string) => JsonSchema | undefined): JsonSchema {
  const scalarResolver: ScalarResolver = {
    scalarConfig: { ...(scalarConfig ?? {}) },
    onUnknownScalar: onUnknownScalar ?? (() => ({ type: 'string' })),
  };
  return graphQlInputTypeToJsonSchemaInternal(type, scalarResolver);
}

function graphQlInputTypeToJsonSchemaInternal(type: GraphQLInputType, scalarResolver: ScalarResolver): JsonSchema {
  if (type instanceof GraphQLNonNull) {
    const schema = graphQlInputTypeToJsonSchemaInternal(type.ofType, scalarResolver);
    return {
      ...schema,
      nullable: false,
    };
  }

  if (type instanceof GraphQLList) {
    return {
      type: 'array',
      items: graphQlInputTypeToJsonSchemaInternal(type.ofType, scalarResolver),
      nullable: true,
    };
  }

  if (type instanceof GraphQLScalarType) {
    return resolveNamedTypeSchema(type.name, scalarResolver, true);
  }

  if (type instanceof GraphQLEnumType) {
    return {
      type: 'string',
      enum: type.getValues().map((entry) => entry.name),
      description: type.description ?? undefined,
      nullable: true,
    };
  }

  const inputObjectType = type as GraphQLInputObjectType;
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];
  for (const [fieldName, field] of Object.entries(inputObjectType.getFields())) {
    const fieldSchema = graphQlInputTypeToJsonSchemaInternal(field.type, scalarResolver);
    fieldSchema.description ??= field.description ?? undefined;
    properties[fieldName] = fieldSchema;
    if (field.type instanceof GraphQLNonNull) {
      required.push(fieldName);
    }
  }

  return {
    type: 'object',
    properties,
    additionalProperties: false,
    description: inputObjectType.description ?? undefined,
    nullable: true,
    ...(required.length > 0 ? { required } : {}),
  };
}