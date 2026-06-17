export type OpenApiSchema = {
	$ref?: string;
	type?: string;
	title?: string;
	description?: string;
	items?: OpenApiSchema;
	properties?: Record<string, OpenApiSchema>;
	additionalProperties?: OpenApiSchema;
	required?: string[];
	anyOf?: OpenApiSchema[];
	enum?: Array<string | number | boolean | null>;
	nullable?: boolean;
};

export type OpenApiHttpMethod = "get" | "post";

export type OpenApiOperation = {
	operationId: string;
	summary?: string;
	description?: string;
	tags?: string[];
	requestBody?: {
		required: boolean;
		content: {
			"application/json": {
				schema: OpenApiSchema;
			};
		};
	};
	responses: {
		"200": {
			description: string;
			content: {
				"application/json": {
					schema: OpenApiSchema;
				};
			};
		};
	};
};

export type OpenApiDocument = {
	openapi: "3.1.0";
	info: {
		title: string;
		version: string;
		description?: string;
	};
	tags?: Array<{
		name: string;
		description?: string;
	}>;
	paths: Record<string, Partial<Record<OpenApiHttpMethod, OpenApiOperation>>>;
	components?: {
		schemas: Record<string, OpenApiSchema>;
	};
};

export type OpenApiMethodDocs = {
	summary?: string;
	description?: string;
	params?: Record<string, string>;
	returnsDescription?: string;
	tags?: string[];
};

export type OpenApiMethodEffects = {
	receiverMutability: "none" | "immutable" | "mutable";
	mutatesReceiver: boolean;
	externalSideEffects: boolean;
	executionPurity: "pure" | "impure" | "unknown";
	reason: string;
};

export type OpenApiMemberAbiFlags = {
	static: boolean;
	async: boolean;
	readonly: boolean;
	abstract: boolean;
	visibility: "public" | "protected" | "private";
	override: boolean;
	deprecated: boolean;
	export: boolean;
};

export type OpenApiNodeAbiFlags = {
	containsThis: boolean;
	hasAsyncFunctions: boolean;
	awaitContext: boolean;
	optionalChain: boolean;
	hasImplicitReturn: boolean;
	hasExplicitReturn: boolean;
};

export type OpenApiSymbolSpace = "value" | "type" | "namespace";

export type OpenApiSymbolKind =
	| "unknown"
	| "function"
	| "method"
	| "property"
	| "accessor"
	| "constructor"
	| "class"
	| "interface"
	| "typeAlias"
	| "typeParameter"
	| "enum"
	| "enumMember"
	| "module"
	| "namespace"
	| "signature"
	| "alias"
	| "prototype"
	| "objectLiteral"
	| "typeLiteral";

export type OpenApiRelationTargetRef = {
	name: string;
	path?: string[];
};

export type OpenApiSymbolRelationSet = {
	aliasOf?: OpenApiRelationTargetRef;
	instantiatedFrom?: OpenApiRelationTargetRef;
	extends?: OpenApiRelationTargetRef[];
	implements?: OpenApiRelationTargetRef[];
	memberOf?: OpenApiRelationTargetRef;
	declaresTypeParameters?: string[];
	constrainedBy?: OpenApiRelationTargetRef[];
};

export type OpenApiSymbolSemanticFlags = {
	symbolKind: OpenApiSymbolKind;
	spaces: OpenApiSymbolSpace[];
	isAlias: boolean;
	isOptional: boolean;
	isTypeOnly: boolean;
	isValueLike: boolean;
	isTypeLike: boolean;
	isNamespaceLike: boolean;
};

export type OpenApiMethodProjection = {
	methodName: string;
	httpMethod: OpenApiHttpMethod;
	httpPath: string;
	requestSchema: OpenApiSchema;
	responseSchema: OpenApiSchema;
	requestRequired: boolean;
	implementationMd?: string;
	effects: OpenApiMethodEffects;
	memberAbiFlags: OpenApiMemberAbiFlags;
	nodeAbiFlags: OpenApiNodeAbiFlags;
	genericTypeParameters: string[];
	parameterNames: string[];
	parameterOptionalFlags: boolean[];
	parameterRestFlags: boolean[];
	parameterTypeTexts: string[];
	resultTypeText: string;
	symbolSemanticFlags: OpenApiSymbolSemanticFlags;
	symbolRelations: OpenApiSymbolRelationSet;
	components?: {
		schemas: Record<string, OpenApiSchema>;
	};
	docs?: OpenApiMethodDocs;
};