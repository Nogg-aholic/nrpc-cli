import type * as ts from "typescript";

export type CodecPolicies = {
	date?: "iso-string" | "epoch-ms" | "reject";
	map?: "entries" | "object" | "reject";
	set?: "array" | "reject";
};

export type GenerateRpcCodecOptions = {
	entryFile: string;
	methodName: string;
	argsType: string;
	resultType: string;
	outputImportPath: string;
	runtimeImportPath?: string;
	moduleSpecifier?: string;
	policies?: CodecPolicies;
};

export type GenerateRpcSurfaceCodecOptions = {
	entryFile: string;
	rootType: string;
	outputImportPath: string;
	moduleSpecifier?: string;
	runtimeImportPath?: string;
	policies?: CodecPolicies;
};

export type VirtualProgramSource = {
	filePath: string;
	content: string;
};

export type SurfaceTraversalOptions = {
	allowedSourceFiles?: readonly string[];
	propertyValueTraversal?: "raw" | "stop-primitive-drilldown";
	skipMethodPrefixes?: readonly string[];
};

export type RpcMethodEffects = {
	receiverMutability: "none" | "immutable" | "mutable";
	mutatesReceiver: boolean;
	externalSideEffects: boolean;
	executionPurity: "pure" | "impure" | "unknown";
	reason: string;
};

export type MemberAbiVisibility = "public" | "protected" | "private";

export type MemberAbiFlags = {
	static: boolean;
	async: boolean;
	readonly: boolean;
	abstract: boolean;
	visibility: MemberAbiVisibility;
	override: boolean;
	deprecated: boolean;
	export: boolean;
};

export type NodeAbiFlags = {
	containsThis: boolean;
	hasAsyncFunctions: boolean;
	awaitContext: boolean;
	optionalChain: boolean;
	hasImplicitReturn: boolean;
	hasExplicitReturn: boolean;
};

export type SymbolSpace = "value" | "type" | "namespace";

export type SymbolKind =
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

export type RelationTargetRef = {
	name: string;
	path?: string[];
};

export type SymbolRelationSet = {
	aliasOf?: RelationTargetRef;
	instantiatedFrom?: RelationTargetRef;
	extends?: RelationTargetRef[];
	implements?: RelationTargetRef[];
	memberOf?: RelationTargetRef;
	declaresTypeParameters?: string[];
	constrainedBy?: RelationTargetRef[];
};

export type SymbolSemanticFlags = {
	symbolKind: SymbolKind;
	spaces: SymbolSpace[];
	isAlias: boolean;
	isOptional: boolean;
	isTypeOnly: boolean;
	isValueLike: boolean;
	isTypeLike: boolean;
	isNamespaceLike: boolean;
};

export type ProgramInput = {
	entryFile: string;
	virtualSources?: readonly VirtualProgramSource[];
};

export type GeneratedRpcSurfaceCodecModule = {
	methodName: string;
	exportBase: string;
	code: string;
};

type PrimitiveKind = "string" | "number" | "boolean";
type NumericKind = "f64" | "u32" | "i32";
type TypedArrayKind =
	| "Int8Array"
	| "Uint8Array"
	| "Uint8ClampedArray"
	| "Int16Array"
	| "Uint16Array"
	| "Int32Array"
	| "Uint32Array"
	| "Float32Array"
	| "Float64Array"
	| "BigInt64Array"
	| "BigUint64Array";

export type TypeNodeShape =
	| { kind: "primitive"; primitive: PrimitiveKind; numericKind?: NumericKind }
	| { kind: "bigint" }
	| { kind: "unknown" }
	| { kind: "null" }
	| { kind: "literal"; value: string | number | boolean }
	| { kind: "undefined" }
	| { kind: "optional"; inner: TypeNodeShape }
	| { kind: "date"; policy: NonNullable<CodecPolicies["date"]> }
	| { kind: "map"; key: TypeNodeShape; value: TypeNodeShape; policy: NonNullable<CodecPolicies["map"]> }
	| { kind: "record"; value: TypeNodeShape }
	| { kind: "set"; element: TypeNodeShape; policy: NonNullable<CodecPolicies["set"]> }
	| { kind: "union"; variants: TypeNodeShape[] }
	| {
			kind: "discriminated-union";
			discriminator: string;
			variants: Array<{ tagValue: string | number | boolean; shape: Extract<TypeNodeShape, { kind: "object" }> }>;
	  }
	| { kind: "typed-array"; arrayType: TypedArrayKind }
	| { kind: "array"; element: TypeNodeShape }
	| { kind: "tuple"; elements: TypeNodeShape[] }
	| { kind: "object"; properties: Array<{ name: string; shape: TypeNodeShape; description?: string }>; schemaId?: string; schemaName?: string };

export type RenderRpcCodecModuleOptions = {
	methodName: string;
	argsTypeReference: string;
	resultTypeReference: string;
	argsShape: TypeNodeShape;
	resultShape: TypeNodeShape;
	typeImportNames: string[];
	typeImportPath: string;
	runtimeImportPath: string;
};

export type RenderInlineRpcCodecMethodOptions = Omit<RenderRpcCodecModuleOptions, "typeImportNames" | "typeImportPath" | "runtimeImportPath"> & {
	methodRefName?: string;
	codecName?: string;
};

export type CollectedRpcMethod = {
	path: string[];
	methodName: string;
	argsShape: TypeNodeShape;
	parameterNames: string[];
	parameterOptionalFlags: boolean[];
	parameterRestFlags: boolean[];
	parameterTypeTexts: string[];
	genericTypeParameters: string[];
	resultType: ts.Type;
	resultTypeText: string;
	effects: RpcMethodEffects;
	memberAbiFlags: MemberAbiFlags;
	nodeAbiFlags: NodeAbiFlags;
	symbolSemanticFlags: SymbolSemanticFlags;
	symbolRelations: SymbolRelationSet;
};