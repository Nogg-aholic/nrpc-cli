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
	paths: Record<
		string,
		{
			post: {
				operationId: string;
				summary?: string;
				description?: string;
				tags?: string[];
				requestBody: {
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
		}
	>;
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

export type OpenApiMethodProjection = {
	methodName: string;
	httpPath: string;
	requestSchema: OpenApiSchema;
	responseSchema: OpenApiSchema;
	requestRequired: boolean;
	components?: {
		schemas: Record<string, OpenApiSchema>;
	};
	docs?: OpenApiMethodDocs;
};