import type {
  CollectedRpcMethod,
  MemberAbiFlags,
  NodeAbiFlags,
  RpcMethodEffects,
  SymbolRelationSet,
  SymbolSemanticFlags,
  TypeNodeShape,
} from '../codec-generator.js';
import type { OpenApiMethodDocs } from '../openapi-types.js';

export type NrpcSurfaceManifest = {
  version: 1;
  surfaceName: string;
  rootType: string;
  rootPath: string[];
  methods: NrpcSurfaceMethodManifest[];
  bindings?: NrpcSurfaceBindings;
};

export type NrpcSurfaceBindings = {
  http?: NrpcHttpBinding[];
};

export type NrpcHttpBinding = {
  methodName: string;
  propertyPath: string[];
  transport: NrpcSurfaceTransport;
};

export type NrpcSurfaceTransport = {
  protocol: 'nrpc-http';
  entrypoint: {
    kind: 'invoke';
    method: 'POST';
    path: string;
    requestContentType: 'application/json';
    responseContentType: 'application/json';
  };
};

export type NrpcRuntimeKind =
  | 'primitive'
  | 'literal'
  | 'null'
  | 'unknown'
  | 'undefined'
  | 'optional'
  | 'date'
  | 'map'
  | 'record'
  | 'set'
  | 'union'
  | 'discriminated-union'
  | 'typed-array'
  | 'array'
  | 'tuple'
  | 'object'
  | 'bigint';

export type NrpcRuntimeShape = {
  kind: NrpcRuntimeKind;
  schemaId?: string;
  schemaName?: string;
  primitive?: 'string' | 'number' | 'boolean';
  numericKind?: 'f64' | 'u32' | 'i32';
  literalValue?: string | number | boolean;
  datePolicy?: 'iso-string' | 'epoch-ms' | 'reject';
  mapPolicy?: 'entries' | 'object' | 'reject';
  setPolicy?: 'array' | 'reject';
  arrayType?: string;
  discriminator?: string;
  required?: string[];
  properties?: Array<{ name: string; description?: string; shape: NrpcRuntimeShape }>;
  elements?: NrpcRuntimeShape[];
  variants?: NrpcRuntimeShape[];
  additional?: NrpcRuntimeShape;
  keyShape?: NrpcRuntimeShape;
  valueShape?: NrpcRuntimeShape;
  inner?: NrpcRuntimeShape;
};

export type NrpcSurfaceMethodSignature = {
  genericTypeParameters: string[];
  parameterNames: string[];
  parameterOptionalFlags: boolean[];
  parameterRestFlags: boolean[];
  parameterTypeTexts: string[];
  resultTypeText: string;
};

export type NrpcSurfaceMethodSemantic = {
  effects: RpcMethodEffects;
  symbolSemanticFlags: SymbolSemanticFlags;
  symbolRelations: SymbolRelationSet;
  memberAbiFlags: MemberAbiFlags;
  nodeAbiFlags: NodeAbiFlags;
};

export type NrpcSurfaceMethodRuntime = {
  inputShape: NrpcRuntimeShape;
  resultShape: NrpcRuntimeShape;
  requestRequired: boolean;
};

export type NrpcSurfaceMethodManifest = {
  methodName: string;
  propertyPath: string[];
  signature: NrpcSurfaceMethodSignature;
  semantic: NrpcSurfaceMethodSemantic;
  runtime: NrpcSurfaceMethodRuntime;
  docs?: OpenApiMethodDocs;
};

export type NrpcCollectedMethodInput = Pick<
  CollectedRpcMethod,
  | 'methodName'
  | 'path'
  | 'parameterNames'
  | 'parameterOptionalFlags'
  | 'parameterRestFlags'
  | 'parameterTypeTexts'
  | 'genericTypeParameters'
  | 'resultTypeText'
  | 'effects'
  | 'symbolSemanticFlags'
  | 'symbolRelations'
  | 'memberAbiFlags'
  | 'nodeAbiFlags'
>;

export type NrpcTypeNodeShape = TypeNodeShape;