import {
	buildClientSchema,
	buildSchema,
	GraphQLEnumType,
	GraphQLError,
	GraphQLInterfaceType,
	type GraphQLInputObjectType,
	type GraphQLInputType,
	GraphQLList,
	GraphQLNonNull,
	GraphQLObjectType,
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

function isGraphqlInputType(type: GraphQLType): type is GraphQLInputType {
	if (type instanceof GraphQLNonNull || type instanceof GraphQLList) {
		return isGraphqlInputType(type.ofType);
	}
	return type instanceof GraphQLScalarType || type instanceof GraphQLEnumType || 'getFields' in type;
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
			enum: type.getValues().map((value) => value.name),
			description: type.description ?? undefined,
			nullable: true,
		};
	}

	return graphQlInputObjectTypeToJsonSchema(type, scalarResolver);
}

function graphQlInputObjectTypeToJsonSchema(type: GraphQLInputObjectType, scalarResolver: ScalarResolver): JsonSchema {
	const fields = Object.values(type.getFields());
	const properties: Record<string, JsonSchema> = {};
	const required: string[] = [];

	for (const field of fields) {
		const schema = graphQlInputTypeToJsonSchemaInternal(field.type, scalarResolver);
		properties[field.name] = {
			...schema,
			description: field.description ?? schema.description,
		};
		if (field.type instanceof GraphQLNonNull) {
			required.push(field.name);
		}
	}

	return {
		type: 'object',
		description: type.description ?? undefined,
		properties,
		additionalProperties: false,
		...(required.length > 0 ? { required } : {}),
		nullable: true,
	};
}

function buildSelectionSetSchema(
	type: GraphQLOutputType,
	selectionSet: SelectionSetNode,
	context: SelectionContext,
): JsonSchema {
	if (type instanceof GraphQLNonNull) {
		const schema = buildSelectionSetSchema(type.ofType, selectionSet, context);
		return {
			...schema,
			nullable: false,
		};
	}

	if (type instanceof GraphQLList) {
		return {
			type: 'array',
			items: buildSelectionSetSchema(type.ofType, selectionSet, context),
			nullable: true,
		};
	}

	if (type instanceof GraphQLScalarType) {
		return resolveNamedTypeSchema(type.name, context.scalarResolver, true);
	}

	if (type instanceof GraphQLEnumType) {
		return {
			type: 'string',
			enum: type.getValues().map((value) => value.name),
			description: type.description ?? undefined,
			nullable: true,
		};
	}

	if (type instanceof GraphQLUnionType) {
		return {
			oneOf: type.getTypes().map((memberType) => buildObjectSelectionSchema(memberType, selectionSet, context)),
			description: type.description ?? undefined,
			nullable: true,
		};
	}

	return buildObjectSelectionSchema(type, selectionSet, context);
}

function buildObjectSelectionSchema(
	type: GraphQLObjectType | GraphQLInterfaceType,
	selectionSet: SelectionSetNode,
	context: SelectionContext,
): JsonSchema {
	const properties: Record<string, JsonSchema> = {};
	const required = new Set<string>();

	for (const selection of selectionSet.selections) {
		applySelectionToSchema(properties, required, type, selection, context);
	}

	return {
		type: 'object',
		description: type.description ?? undefined,
		properties,
		additionalProperties: false,
		...(required.size > 0 ? { required: Array.from(required) } : {}),
		nullable: true,
	};
}

function applySelectionToSchema(
	properties: Record<string, JsonSchema>,
	required: Set<string>,
	parentType: GraphQLObjectType | GraphQLInterfaceType,
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
		if (!fragmentType || !(fragmentType instanceof GraphQLObjectType || fragmentType instanceof GraphQLInterfaceType || fragmentType instanceof GraphQLUnionType)) {
			return;
		}
		if (fragmentType instanceof GraphQLUnionType) {
			mergeSchemaProperties(properties, buildSelectionSetSchema(fragmentType, fragment.selectionSet, context));
			return;
		}
		for (const nestedSelection of fragment.selectionSet.selections) {
			applySelectionToSchema(properties, required, fragmentType, nestedSelection, context);
		}
		return;
	}

	applyInlineFragmentSelection(properties, required, parentType, selection, context);
}

function applyFieldSelection(
	properties: Record<string, JsonSchema>,
	required: Set<string>,
	parentType: GraphQLObjectType | GraphQLInterfaceType,
	selection: FieldNode,
	context: SelectionContext,
): void {
	const fieldName = selection.name.value;
	if (fieldName === '__typename') {
		properties[selection.alias?.value ?? fieldName] = {
			type: 'string',
			nullable: false,
		};
		required.add(selection.alias?.value ?? fieldName);
		return;
	}

	const field = parentType.getFields()[fieldName];
	if (!field) {
		return;
	}

	const propertyName = selection.alias?.value ?? fieldName;
	const fieldSchema = selection.selectionSet
		? buildSelectionSetSchema(field.type, selection.selectionSet, context)
		: graphQlOutputLeafTypeToJsonSchema(field.type, context.scalarResolver);

	properties[propertyName] = {
		...fieldSchema,
		description: field.description ?? fieldSchema.description,
	};

	if (field.type instanceof GraphQLNonNull) {
		required.add(propertyName);
	}
}

function applyInlineFragmentSelection(
	properties: Record<string, JsonSchema>,
	required: Set<string>,
	parentType: GraphQLObjectType | GraphQLInterfaceType,
	selection: InlineFragmentNode,
	context: SelectionContext,
): void {
	const fragmentType = selection.typeCondition
		? context.schema.getType(selection.typeCondition.name.value)
		: parentType;

	if (!fragmentType) {
		return;
	}

	if (fragmentType instanceof GraphQLUnionType) {
		mergeSchemaProperties(properties, buildSelectionSetSchema(fragmentType, selection.selectionSet, context));
		return;
	}

	if (!(fragmentType instanceof GraphQLObjectType || fragmentType instanceof GraphQLInterfaceType)) {
		return;
	}

	for (const nestedSelection of selection.selectionSet.selections) {
		applySelectionToSchema(properties, required, fragmentType, nestedSelection, context);
	}
}

function graphQlOutputLeafTypeToJsonSchema(type: GraphQLOutputType, scalarResolver: ScalarResolver): JsonSchema {
	if (type instanceof GraphQLNonNull) {
		const schema = graphQlOutputLeafTypeToJsonSchema(type.ofType, scalarResolver);
		return {
			...schema,
			nullable: false,
		};
	}

	if (type instanceof GraphQLList) {
		return {
			type: 'array',
			items: graphQlOutputLeafTypeToJsonSchema(type.ofType, scalarResolver),
			nullable: true,
		};
	}

	if (type instanceof GraphQLScalarType) {
		return resolveNamedTypeSchema(type.name, scalarResolver, true);
	}

	if (type instanceof GraphQLEnumType) {
		return {
			type: 'string',
			enum: type.getValues().map((value) => value.name),
			description: type.description ?? undefined,
			nullable: true,
		};
	}

	return {
		type: 'object',
		nullable: true,
	};
}

function mergeSchemaProperties(target: Record<string, JsonSchema>, schema: JsonSchema): void {
	for (const [key, value] of Object.entries(schema.properties ?? {})) {
		target[key] = value;
	}
}

function collectRootFieldNames(selectionSet: SelectionSetNode): string[] {
	const fieldNames = new Set<string>();
	for (const selection of selectionSet.selections) {
		if (selection.kind === 'Field') {
			fieldNames.add(selection.name.value);
		}
	}
	return Array.from(fieldNames);
}