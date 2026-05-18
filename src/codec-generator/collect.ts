import path from "node:path";
import * as ts from "typescript";

import { normalizeType } from "./normalize.js";
import { unwrapPromiseLikeType } from "./program.js";
import type {
	CodecPolicies,
	CollectedRpcMethod,
	MemberAbiFlags,
	NodeAbiFlags,
	RpcMethodEffects,
	RelationTargetRef,
	SymbolRelationSet,
	SymbolSemanticFlags,
	SymbolKind,
	SymbolSpace,
	TypeNodeShape,
} from "./types.js";

type RpcMethodVisitor = (method: CollectedRpcMethod) => void;
type CollectRpcMethodsOptions = {
	allowedSourceFiles?: readonly string[];
	propertyValueTraversal?: "raw" | "stop-primitive-drilldown";
	skipMethodPrefixes?: readonly string[];
	activeBranchTypeIds?: ReadonlySet<number>;
	seenMethodNames?: ReadonlySet<string>;
};

function getTypeParameterNameFromDeclarationText(text: string): string {
	return text.split(/\sextends\s|\s*=\s/u)[0]!.trim();
}

function collectSignatureGenericTypeParameters(signature: ts.Signature): string[] {
	const declaration = signature.getDeclaration();
	if (!declaration) {
		return [];
	}

	const collected: string[] = [];
	const seen = new Set<string>();
	const addParameters = (parameters: ts.NodeArray<ts.TypeParameterDeclaration> | undefined) => {
		for (const parameter of parameters ?? []) {
			const text = parameter.getText().trim();
			const key = getTypeParameterNameFromDeclarationText(text);
			if (!seen.has(key)) {
				seen.add(key);
				collected.push(text);
			}
		}
	};

	const parent = declaration.parent;
	if (parent && (ts.isInterfaceDeclaration(parent) || ts.isClassDeclaration(parent))) {
		addParameters(parent.typeParameters);
	}
	if ('typeParameters' in declaration) {
		addParameters(declaration.typeParameters);
	}

	return collected;
}

function getReceiverTypeTextFromDeclaration(receiverType: ts.Type | undefined, signature: ts.Signature, checker: ts.TypeChecker): string | undefined {
	if (!receiverType) {
		return undefined;
	}

	const declaration = signature.getDeclaration();
	const parent = declaration?.parent;
	if (parent && (ts.isInterfaceDeclaration(parent) || ts.isClassDeclaration(parent)) && parent.name) {
		const typeParameterNames = parent.typeParameters?.map((parameter) => parameter.name.getText().trim()) ?? [];
		return typeParameterNames.length > 0
			? `${parent.name.getText().trim()}<${typeParameterNames.join(', ')}>`
			: parent.name.getText().trim();
	}

	return checker.typeToString(receiverType, undefined, ts.TypeFormatFlags.NoTruncation);
}

function normalizeSkipMethodPrefix(prefix: string): string {
	return prefix.endsWith(".") ? prefix.slice(0, -1) : prefix;
}

function shouldSkipPath(pathParts: readonly string[], options: CollectRpcMethodsOptions): boolean {
	if (!options.skipMethodPrefixes || options.skipMethodPrefixes.length === 0) {
		return false;
	}

	const currentPath = pathParts.join(".");
	return options.skipMethodPrefixes.some((prefix) => {
		const normalizedPrefix = normalizeSkipMethodPrefix(prefix);
		return currentPath === normalizedPrefix || currentPath.startsWith(`${normalizedPrefix}.`) || normalizedPrefix.startsWith(`${currentPath}.`);
	});
}

function isEscapedCompilerPropertyName(name: string): boolean {
	return /^__@.+@\d+$/.test(name);
}

function isPrimitiveLikeType(type: ts.Type, checker: ts.TypeChecker): boolean {
	if ((type.flags & (ts.TypeFlags.StringLike | ts.TypeFlags.NumberLike | ts.TypeFlags.BooleanLike | ts.TypeFlags.BigIntLike | ts.TypeFlags.Null | ts.TypeFlags.Undefined | ts.TypeFlags.Void)) !== 0) {
		return true;
	}

	const apparentType = checker.getApparentType(type);
	if (apparentType !== type && (apparentType.flags & (ts.TypeFlags.StringLike | ts.TypeFlags.NumberLike | ts.TypeFlags.BooleanLike | ts.TypeFlags.BigIntLike)) !== 0) {
		return true;
	}

	const typeTexts = new Set<string>([
		checker.typeToString(type, undefined, ts.TypeFormatFlags.NoTruncation),
		checker.typeToString(apparentType, undefined, ts.TypeFormatFlags.NoTruncation),
	]);

	for (const typeText of typeTexts) {
		if (
			typeText === 'string'
			|| typeText === 'number'
			|| typeText === 'boolean'
			|| typeText === 'bigint'
			|| typeText === 'String'
			|| typeText === 'Number'
			|| typeText === 'Boolean'
			|| typeText === 'BigInt'
			|| typeText === 'null'
			|| typeText === 'undefined'
			|| typeText === 'void'
		) {
			return true;
		}
	}

	return false;
}

function isValuePropertyDeclaration(declaration: ts.Declaration): boolean {
	return ts.isPropertySignature(declaration) || ts.isPropertyDeclaration(declaration) || ts.isPropertyAssignment(declaration) || ts.isShorthandPropertyAssignment(declaration) || ts.isVariableDeclaration(declaration);
}

function shouldStopAtPrimitiveValueProperty(
	declaration: ts.Declaration,
	propertyType: ts.Type,
	checker: ts.TypeChecker,
	pathDepth: number,
	options: CollectRpcMethodsOptions,
): boolean {
	if (options.propertyValueTraversal !== "stop-primitive-drilldown") {
		return false;
	}

	if (!isValuePropertyDeclaration(declaration)) {
		return false;
	}

	if (!isPrimitiveLikeType(propertyType, checker)) {
		return false;
	}

	const allowedDepth = 1;
	return pathDepth >= allowedDepth;
}

function shouldStopAtPrimitiveResultType(
	resultType: ts.Type,
	checker: ts.TypeChecker,
	pathDepth: number,
	options: CollectRpcMethodsOptions,
): boolean {
	if (options.propertyValueTraversal !== 'stop-primitive-drilldown') {
		return false;
	}

	const unwrappedResultType = unwrapPromiseLikeType(resultType, checker);
	if (!isPrimitiveLikeType(unwrappedResultType, checker)) {
		return false;
	}

	const allowedDepth = 1;
	return pathDepth >= allowedDepth;
}

const containerTypeNames = new Set([
	'Array',
	'ReadonlyArray',
	'NodeArray',
	'SortedArray',
	'SortedReadonlyArray',
	'Map',
	'Set',
	'Int8Array',
	'Uint8Array',
	'Uint8ClampedArray',
	'Int16Array',
	'Uint16Array',
	'Int32Array',
	'Uint32Array',
	'Float32Array',
	'Float64Array',
	'BigInt64Array',
	'BigUint64Array',
]);

function isContainerLikeType(type: ts.Type, checker: ts.TypeChecker): boolean {
	if (checker.isTupleType(type) || checker.isArrayType(type)) {
		return true;
	}

	for (const candidate of [type, checker.getApparentType(type)]) {
		const symbolName = candidate.getSymbol()?.getName() ?? candidate.aliasSymbol?.getName();
		if (symbolName && containerTypeNames.has(symbolName)) {
			return true;
		}

		if (checker.getIndexTypeOfType(candidate, ts.IndexKind.String)) {
			return true;
		}
	}

	return false;
}

function shouldStopAtContainerValueProperty(
	declaration: ts.Declaration,
	propertyType: ts.Type,
	checker: ts.TypeChecker,
	pathDepth: number,
	options: CollectRpcMethodsOptions,
): boolean {
	if (options.propertyValueTraversal !== 'stop-primitive-drilldown') {
		return false;
	}

	if (!isValuePropertyDeclaration(declaration)) {
		return false;
	}

	if (!isContainerLikeType(propertyType, checker)) {
		return false;
	}

	return pathDepth >= 0;
}

function shouldSkipContainerPrototypeMethod(
	declaration: ts.Declaration,
	propertyType: ts.Type,
	checker: ts.TypeChecker,
	pathDepth: number,
	options: CollectRpcMethodsOptions,
): boolean {
	if (options.propertyValueTraversal !== 'stop-primitive-drilldown') {
		return false;
	}

	if (!isValuePropertyDeclaration(declaration)) {
		return false;
	}

	if (pathDepth < 1 || !isContainerLikeType(propertyType, checker)) {
		return false;
	}

	const declarationSymbol = (declaration as ts.NamedDeclaration).name && ts.isIdentifier((declaration as ts.NamedDeclaration).name!)
		? checker.getSymbolAtLocation((declaration as ts.NamedDeclaration).name!)
		: undefined;
	if (!declarationSymbol) {
		return false;
	}

	const flags = declarationSymbol.getFlags();
	return hasFlag(flags, ts.SymbolFlags.Method) || hasFlag(flags, ts.SymbolFlags.Function);
}

function canonicalizeFileName(fileName: string): string {
	const normalized = path.normalize(fileName);
	return ts.sys.useCaseSensitiveFileNames ? normalized : normalized.toLowerCase();
}

function getTypeId(type: ts.Type): number | undefined {
	return typeof (type as ts.Type & { id?: unknown }).id === "number"
		? (type as ts.Type & { id: number }).id
		: undefined;
}

function canTraverseType(type: ts.Type, options: CollectRpcMethodsOptions): boolean {
	if (!options.allowedSourceFiles || options.allowedSourceFiles.length === 0) {
		return true;
	}

	const allowed = new Set(options.allowedSourceFiles.map(canonicalizeFileName));
	const declarations = [
		...(type.getSymbol()?.declarations ?? []),
		...(type.aliasSymbol?.declarations ?? []),
	];

	if (declarations.length === 0) {
		return false;
	}

	return declarations.some((declaration) => allowed.has(canonicalizeFileName(declaration.getSourceFile().fileName)));
}

function isPropertyDeclaredOnType(property: ts.Symbol, type: ts.Type): boolean {
	const declarations = property.declarations ?? [];
	const ownerDeclarations = [
		...(type.getSymbol()?.declarations ?? []),
		...(type.aliasSymbol?.declarations ?? []),
	];

	if (ownerDeclarations.length === 0 || declarations.length === 0) {
		return false;
	}

	const ownerSet = new Set(ownerDeclarations);
	return declarations.some((declaration) => {
		const parent = declaration.parent;
		return ownerSet.has(declaration) || (parent ? ownerSet.has(parent) : false);
	});
}

function isConstructableType(type: ts.Type, checker: ts.TypeChecker): boolean {
	return checker.getSignaturesOfType(type, ts.SignatureKind.Construct).length > 0;
}

function hasFlag(value: number, flag: number): boolean {
	return (value & flag) !== 0;
}

function getModifierFlags(declaration: ts.SignatureDeclaration | ts.Declaration | undefined): number {
	if (!declaration) {
		return 0;
	}
	return ts.getCombinedModifierFlags(declaration as ts.Declaration);
}

function getNodeFlags(declaration: ts.SignatureDeclaration | ts.Declaration | undefined): number {
	if (!declaration) {
		return 0;
	}
	return (declaration as ts.Node).flags ?? 0;
}

function getMemberAbiVisibility(modifierFlags: number): MemberAbiFlags["visibility"] {
	if (hasFlag(modifierFlags, ts.ModifierFlags.Private)) {
		return "private";
	}
	if (hasFlag(modifierFlags, ts.ModifierFlags.Protected)) {
		return "protected";
	}
	return "public";
}

function returnsPromiseLikeType(type: ts.Type, checker: ts.TypeChecker): boolean {
	return unwrapPromiseLikeType(type, checker) !== type;
}

function buildMemberAbiFlags(signature: ts.Signature, checker: ts.TypeChecker): MemberAbiFlags {
	const declaration = signature.getDeclaration();
	const modifierFlags = getModifierFlags(declaration);
	const asyncLike = hasFlag(modifierFlags, ts.ModifierFlags.Async)
		|| returnsPromiseLikeType(signature.getReturnType(), checker);

	return {
		static: hasFlag(modifierFlags, ts.ModifierFlags.Static),
		async: asyncLike,
		readonly: hasFlag(modifierFlags, ts.ModifierFlags.Readonly),
		abstract: hasFlag(modifierFlags, ts.ModifierFlags.Abstract),
		visibility: getMemberAbiVisibility(modifierFlags),
		override: hasFlag(modifierFlags, ts.ModifierFlags.Override),
		deprecated: hasFlag(modifierFlags, ts.ModifierFlags.Deprecated),
		export: hasFlag(modifierFlags, ts.ModifierFlags.Export),
	};
}

function buildNodeAbiFlags(signature: ts.Signature): NodeAbiFlags {
	const declaration = signature.getDeclaration();
	const nodeFlags = getNodeFlags(declaration);

	return {
		containsThis: hasFlag(nodeFlags, ts.NodeFlags.ContainsThis),
		hasAsyncFunctions: hasFlag(nodeFlags, ts.NodeFlags.HasAsyncFunctions),
		awaitContext: hasFlag(nodeFlags, ts.NodeFlags.AwaitContext),
		optionalChain: hasFlag(nodeFlags, ts.NodeFlags.OptionalChain),
		hasImplicitReturn: hasFlag(nodeFlags, ts.NodeFlags.HasImplicitReturn),
		hasExplicitReturn: hasFlag(nodeFlags, ts.NodeFlags.HasExplicitReturn),
	};
}

function pushUniqueSpace(spaces: SymbolSpace[], value: SymbolSpace): void {
	if (!spaces.includes(value)) {
		spaces.push(value);
	}
}

function determineSymbolKind(symbol: ts.Symbol | undefined): SymbolKind {
	if (!symbol) return "unknown";
	const flags = symbol.getFlags();
	if (hasFlag(flags, ts.SymbolFlags.Alias)) return "alias";
	if (hasFlag(flags, ts.SymbolFlags.Constructor)) return "constructor";
	if (hasFlag(flags, ts.SymbolFlags.Method)) return "method";
	if (hasFlag(flags, ts.SymbolFlags.Property)) return "property";
	if (hasFlag(flags, ts.SymbolFlags.GetAccessor) || hasFlag(flags, ts.SymbolFlags.SetAccessor)) return "accessor";
	if (hasFlag(flags, ts.SymbolFlags.Function)) return "function";
	if (hasFlag(flags, ts.SymbolFlags.Class)) return "class";
	if (hasFlag(flags, ts.SymbolFlags.Interface)) return "interface";
	if (hasFlag(flags, ts.SymbolFlags.TypeAlias)) return "typeAlias";
	if (hasFlag(flags, ts.SymbolFlags.TypeParameter)) return "typeParameter";
	if (hasFlag(flags, ts.SymbolFlags.RegularEnum) || hasFlag(flags, ts.SymbolFlags.ConstEnum)) return "enum";
	if (hasFlag(flags, ts.SymbolFlags.EnumMember)) return "enumMember";
	if (hasFlag(flags, ts.SymbolFlags.Signature)) return "signature";
	if (hasFlag(flags, ts.SymbolFlags.Prototype)) return "prototype";
	if (hasFlag(flags, ts.SymbolFlags.ValueModule)) return "module";
	if (hasFlag(flags, ts.SymbolFlags.NamespaceModule)) return "namespace";
	if (hasFlag(flags, ts.SymbolFlags.ObjectLiteral)) return "objectLiteral";
	if (hasFlag(flags, ts.SymbolFlags.TypeLiteral)) return "typeLiteral";
	return "unknown";
}

function determineSymbolSpaces(symbol: ts.Symbol | undefined): SymbolSpace[] {
	const spaces: SymbolSpace[] = [];
	if (!symbol) return spaces;
	const flags = symbol.getFlags();
	if (hasFlag(flags, ts.SymbolFlags.Value)) pushUniqueSpace(spaces, "value");
	if (hasFlag(flags, ts.SymbolFlags.Type)) pushUniqueSpace(spaces, "type");
	if (hasFlag(flags, ts.SymbolFlags.Namespace)) pushUniqueSpace(spaces, "namespace");
	return spaces;
}

function toRelationTargetRefFromType(type: ts.Type | undefined): RelationTargetRef | undefined {
	const symbol = type?.getSymbol() ?? type?.aliasSymbol;
	if (!symbol) return undefined;
	return { name: symbol.getName() };
}

function toRelationTargetRefFromSymbol(symbol: ts.Symbol | undefined): RelationTargetRef | undefined {
	if (!symbol) return undefined;
	return { name: symbol.getName() };
}

function collectDeclarationTypeParameters(declaration: ts.SignatureDeclaration | ts.Declaration | undefined): string[] {
	if (!declaration || !('typeParameters' in declaration)) {
		return [];
	}
	return (declaration.typeParameters ?? []).map((parameter) => parameter.name.getText().trim());
}

function buildSymbolSemanticFlags(
	symbol: ts.Symbol | undefined,
	signature: ts.Signature,
	checker: ts.TypeChecker,
): SymbolSemanticFlags {
	const spaces = determineSymbolSpaces(symbol);
	const declaration = signature.getDeclaration();
	const targetSymbol = symbol && hasFlag(symbol.getFlags(), ts.SymbolFlags.Alias)
		? checker.getAliasedSymbol(symbol)
		: symbol;
	const isOptional = !!symbol && hasFlag(symbol.getFlags(), ts.SymbolFlags.Optional);
	return {
		symbolKind: determineSymbolKind(targetSymbol ?? symbol),
		spaces,
		isAlias: !!symbol && hasFlag(symbol.getFlags(), ts.SymbolFlags.Alias),
		isOptional,
		isTypeOnly: spaces.length > 0 && !spaces.includes("value") && spaces.includes("type"),
		isValueLike: spaces.includes("value"),
		isTypeLike: spaces.includes("type"),
		isNamespaceLike: spaces.includes("namespace"),
	};
}

function buildSymbolRelations(
	symbol: ts.Symbol | undefined,
	signature: ts.Signature,
	checker: ts.TypeChecker,
	receiverType: ts.Type | undefined,
): SymbolRelationSet {
	const declaration = signature.getDeclaration();
	const parent = declaration?.parent;
	const relations: SymbolRelationSet = {};

	if (symbol && hasFlag(symbol.getFlags(), ts.SymbolFlags.Alias)) {
		relations.aliasOf = toRelationTargetRefFromSymbol(checker.getAliasedSymbol(symbol));
	}

	if (receiverType) {
		relations.memberOf = toRelationTargetRefFromType(receiverType);
		const receiverSymbol = receiverType.getSymbol();
		const receiverDecl = receiverSymbol?.declarations?.[0];
		if (receiverDecl && (ts.isClassDeclaration(receiverDecl) || ts.isInterfaceDeclaration(receiverDecl))) {
			const extendsTargets = (checker.getBaseTypes(receiverType as ts.InterfaceType) ?? [])
				.map((baseType) => toRelationTargetRefFromType(baseType))
				.filter((entry): entry is RelationTargetRef => !!entry);
			if (extendsTargets.length > 0) {
				relations.extends = extendsTargets;
			}

			const heritageClauses = receiverDecl.heritageClauses ?? [];
			const implementsTargets = heritageClauses
				.filter((clause) => clause.token === ts.SyntaxKind.ImplementsKeyword)
				.flatMap((clause) => clause.types)
				.map((heritageType) => toRelationTargetRefFromType(checker.getTypeAtLocation(heritageType)))
				.filter((entry): entry is RelationTargetRef => !!entry);
			if (implementsTargets.length > 0) {
				relations.implements = implementsTargets;
			}

			const declaredTypeParameters = (receiverDecl.typeParameters ?? []).map((parameter) => parameter.name.getText().trim());
			if (declaredTypeParameters.length > 0) {
				relations.declaresTypeParameters = declaredTypeParameters;
				const constrainedBy = (receiverDecl.typeParameters ?? [])
					.map((parameter) => parameter.constraint ? toRelationTargetRefFromType(checker.getTypeFromTypeNode(parameter.constraint)) : undefined)
					.filter((entry): entry is RelationTargetRef => !!entry);
				if (constrainedBy.length > 0) {
					relations.constrainedBy = constrainedBy;
				}
			}

			if ((receiverType as ts.TypeReference).target && receiverSymbol) {
				const targetRef = toRelationTargetRefFromSymbol((receiverType as ts.TypeReference).target.symbol);
				if (targetRef && targetRef.name !== receiverSymbol.getName()) {
					relations.instantiatedFrom = targetRef;
				}
			}
		}
	}

	const signatureTypeParameters = collectDeclarationTypeParameters(declaration);
	if (signatureTypeParameters.length > 0) {
		relations.declaresTypeParameters = [...new Set([...(relations.declaresTypeParameters ?? []), ...signatureTypeParameters])];
	}

	if (parent && (ts.isTypeAliasDeclaration(parent) || ts.isInterfaceDeclaration(parent) || ts.isClassDeclaration(parent))) {
		const parentRef = toRelationTargetRefFromSymbol(checker.getSymbolAtLocation(parent.name));
		if (parentRef) {
			relations.memberOf = relations.memberOf ?? parentRef;
		}
	}

	return relations;
}

function normalizeResultTypeText(resultTypeText: string): string {
	const trimmed = resultTypeText.trim();
	if (/^asserts\b/u.test(trimmed)) {
		return "void";
	}
	return trimmed;
}

function getNormalizedResultTypeText(signature: ts.Signature, checker: ts.TypeChecker): string {
	const resultType = checker.getReturnTypeOfSignature(signature);
	const unwrappedResultType = unwrapPromiseLikeType(resultType, checker);
	const declaration = signature.getDeclaration();
	const declarationTypeNode = declaration?.type;
	const declarationTypeText = declarationTypeNode?.getText().trim();
	const declarationType = declarationTypeNode
		? checker.getTypeFromTypeNode(declarationTypeNode)
		: undefined;
	const rawResultTypeText = declarationTypeText && declarationType && !returnsPromiseLikeType(declarationType, checker)
		? declarationTypeText
		: checker.typeToString(unwrappedResultType, undefined, ts.TypeFormatFlags.NoTruncation);

	return normalizeResultTypeText(rawResultTypeText);
}

function buildCollectedPropertyAccessor(
	nextPath: string[],
	propertySymbol: ts.Symbol,
	propertyType: ts.Type,
	checker: ts.TypeChecker,
	policies: Required<CodecPolicies>,
	receiverType: ts.Type | undefined,
): CollectedRpcMethod {
	const resultTypeText = normalizeResultTypeText(
		checker.typeToString(propertyType, undefined, ts.TypeFormatFlags.NoTruncation),
	);

	return {
		path: nextPath,
		methodName: nextPath.join('.'),
		parameterNames: [],
		parameterOptionalFlags: [],
		parameterRestFlags: [],
		parameterTypeTexts: [],
		genericTypeParameters: [],
		argsShape: {
			kind: 'tuple',
			elements: [],
		},
		resultType: propertyType,
		resultTypeText,
		effects: {
			receiverMutability: 'none',
			mutatesReceiver: false,
			externalSideEffects: false,
			executionPurity: 'pure',
			reason: 'property access',
		},
		memberAbiFlags: {
			static: false,
			async: false,
			readonly: false,
			abstract: false,
			visibility: 'public',
			override: false,
			deprecated: false,
			export: false,
		},
		nodeAbiFlags: {
			containsThis: false,
			hasAsyncFunctions: false,
			awaitContext: false,
			optionalChain: false,
			hasImplicitReturn: false,
			hasExplicitReturn: true,
		},
		symbolSemanticFlags: {
			symbolKind: determineSymbolKind(propertySymbol),
			spaces: determineSymbolSpaces(propertySymbol),
			isAlias: hasFlag(propertySymbol.getFlags(), ts.SymbolFlags.Alias),
			isOptional: hasFlag(propertySymbol.getFlags(), ts.SymbolFlags.Optional),
			isTypeOnly: false,
			isValueLike: true,
			isTypeLike: false,
			isNamespaceLike: false,
		},
		symbolRelations: receiverType
			? {
				memberOf: toRelationTargetRefFromType(receiverType),
			}
			: {},
	};
}

function buildCollectedMethod(
	nextPath: string[],
	propertySymbol: ts.Symbol | undefined,
	signature: ts.Signature,
	checker: ts.TypeChecker,
	policies: Required<CodecPolicies>,
	receiverType?: ts.Type,
): CollectedRpcMethod {
	const methodName = nextPath.join(".");
	const parameterNames = signature.getParameters().map((parameter, index) => {
		const rawName = parameter.name || `arg${index}`;
		const sanitized = rawName.replace(/[^A-Za-z0-9_$]/g, "_");
		return sanitized.length > 0 ? sanitized : `arg${index}`;
	});
	const parameterOptionalFlags = signature.getParameters().map((parameter) => {
		const parameterDeclaration = parameter.valueDeclaration ?? parameter.declarations?.[0];
		return parameterDeclaration && ts.isParameter(parameterDeclaration)
			? !!parameterDeclaration.questionToken || !!parameterDeclaration.initializer || !!parameterDeclaration.dotDotDotToken
			: false;
	});
	const parameterRestFlags = signature.getParameters().map((parameter) => {
		const parameterDeclaration = parameter.valueDeclaration ?? parameter.declarations?.[0];
		return parameterDeclaration && ts.isParameter(parameterDeclaration)
			? !!parameterDeclaration.dotDotDotToken
			: false;
	});
	const parameterShapes: TypeNodeShape[] = signature.getParameters().map((parameter, index) => {
		const parameterDeclaration = parameter.valueDeclaration ?? parameter.declarations?.[0];
		if (!parameterDeclaration) throw new Error(`Missing declaration for parameter ${parameter.name}.`);
		const parameterType = checker.getTypeOfSymbolAtLocation(parameter, parameterDeclaration);
		const normalized = normalizeType(parameterType, checker, policies, parameter.name);
		const isOptionalParameter = ts.isParameter(parameterDeclaration)
			? !!parameterDeclaration.questionToken || !!parameterDeclaration.initializer || !!parameterDeclaration.dotDotDotToken
			: false;
		return isOptionalParameter && normalized.kind !== "optional"
			? { kind: "optional", inner: normalized }
			: normalized;
	});
	const parameterTypeTexts: string[] = signature.getParameters().map((parameter, index) => {
		const parameterDeclaration = parameter.valueDeclaration ?? parameter.declarations?.[0];
		if (!parameterDeclaration) throw new Error(`Missing declaration for parameter ${parameter.name}.`);
		const parameterType = checker.getTypeOfSymbolAtLocation(parameter, parameterDeclaration);
		return ts.isParameter(parameterDeclaration) && parameterDeclaration.type
			? parameterDeclaration.type.getText().trim()
			: checker.typeToString(parameterType, parameterDeclaration, ts.TypeFormatFlags.NoTruncation);
	});
	const genericTypeParameters = collectSignatureGenericTypeParameters(signature);

	if (receiverType) {
		parameterNames.unshift("receiver");
		parameterOptionalFlags.unshift(false);
		parameterRestFlags.unshift(false);
		parameterShapes.unshift(normalizeType(receiverType, checker, policies, "receiver"));
		parameterTypeTexts.unshift(getReceiverTypeTextFromDeclaration(receiverType, signature, checker) ?? "unknown");
	}
	const resultType = checker.getReturnTypeOfSignature(signature);

	return {
		path: nextPath,
		methodName,
		parameterNames,
		parameterOptionalFlags,
		parameterRestFlags,
		parameterTypeTexts,
		genericTypeParameters,
		argsShape: {
			kind: "tuple",
			elements: parameterShapes,
		},
		resultType,
		resultTypeText: getNormalizedResultTypeText(signature, checker),
		effects: inferMethodEffects(methodName, receiverType, signature, checker),
		memberAbiFlags: buildMemberAbiFlags(signature, checker),
		nodeAbiFlags: buildNodeAbiFlags(signature),
		symbolSemanticFlags: buildSymbolSemanticFlags(propertySymbol, signature, checker),
		symbolRelations: buildSymbolRelations(propertySymbol, signature, checker, receiverType),
	};
}

function stripNumericOverloadSuffix(name: string): string {
	return name.replace(/(\D)\d+$/u, "$1");
}

function resolveCanonicalPropertyName(propertyName: string, properties: Map<string, ts.Symbol>): string {
	const strippedName = stripNumericOverloadSuffix(propertyName);
	if (strippedName !== propertyName && properties.has(strippedName)) {
		return strippedName;
	}
	return propertyName;
}

function inferMethodEffects(
	methodName: string,
	receiverType: ts.Type | undefined,
	signature: ts.Signature,
	checker: ts.TypeChecker,
): RpcMethodEffects {
	const parts = methodName.split(".");
	const root = parts[0] ?? "";
	const namespace = parts.slice(0, -1).join(".");
	const leaf = parts[parts.length - 1] ?? "";
	const lowerLeaf = leaf.toLowerCase();
	const parameterCount = signature.getParameters().length;
	const receiverName = receiverType ? checker.typeToString(receiverType) : undefined;
	const normalizedReceiverName = receiverName?.replace(/<.*>$/u, "");
	const rootLower = root.toLowerCase();
	const namespaceLower = namespace.toLowerCase();

	if (!receiverType) {
		if (root === "fs" || namespaceLower === "fs.promises") {
			const readLike = /^(access|exists|fstat|glob|lstat|openasblob|opendir|readdir|read(file|link|sync|v|vsync)?|realpath|stat|statfs)/i.test(leaf);
			return {
				receiverMutability: "none",
				mutatesReceiver: false,
				externalSideEffects: !readLike || true,
				executionPurity: "impure",
				reason: readLike ? "module function reads external filesystem state" : "module function writes or mutates external filesystem state",
			};
		}

		if (/^(path|punycode|querystring)$/i.test(root)) {
			return {
				receiverMutability: "none",
				mutatesReceiver: false,
				externalSideEffects: false,
				executionPurity: "pure",
				reason: "stateless transformation module function",
			};
		}

		if (/^(crypto|timers|dns|childProcess|console|process|inspector|os|net|http|https|http2|stream|streamWeb|workerThreads|traceEvents|v8|vm|zlib)$/i.test(root)) {
			return {
				receiverMutability: "none",
				mutatesReceiver: false,
				externalSideEffects: true,
				executionPurity: "impure",
				reason: "module function interacts with runtime, system, network, IO, scheduling, or global process state",
			};
		}

		return {
			receiverMutability: "none",
			mutatesReceiver: false,
			externalSideEffects: false,
			executionPurity: "unknown",
			reason: "no receiver; purity cannot be proven from declaration alone",
		};
	}

	if (normalizedReceiverName === "string" || normalizedReceiverName === "String" || rootLower === "string") {
		const maybeImpureString = lowerLeaf === "replace" || lowerLeaf === "replaceall" || lowerLeaf === "match" || lowerLeaf === "matchall" || lowerLeaf === "search" || lowerLeaf === "split";
		return {
			receiverMutability: "immutable",
			mutatesReceiver: false,
			externalSideEffects: false,
			executionPurity: maybeImpureString ? "unknown" : "pure",
			reason: maybeImpureString
				? "string receiver is immutable, but callback or RegExp arguments may introduce observable behavior"
				: "string receiver is immutable; operation returns a derived value without mutating receiver",
		};
	}

	if (
		normalizedReceiverName === "number" || normalizedReceiverName === "Number"
		|| normalizedReceiverName === "boolean" || normalizedReceiverName === "Boolean"
		|| normalizedReceiverName === "bigint"
		|| normalizedReceiverName === "symbol" || normalizedReceiverName === "Symbol"
		|| rootLower === "number" || rootLower === "boolean"
	) {
		return {
			receiverMutability: "immutable",
			mutatesReceiver: false,
			externalSideEffects: false,
			executionPurity: "pure",
			reason: "primitive receiver is immutable and operation is value-observing",
		};
	}

	if (/^(Date)$/.test(normalizedReceiverName ?? "") || rootLower === "date") {
		const mutatingDate = /^(set|setutc)/i.test(lowerLeaf);
		return {
			receiverMutability: "mutable",
			mutatesReceiver: mutatingDate,
			externalSideEffects: false,
			executionPurity: mutatingDate ? "impure" : "pure",
			reason: mutatingDate ? "date setter mutates the receiver" : "date getter/formatter observes receiver without mutating it",
		};
	}

	if (
		/^(Array|ReadonlyArray|Int8Array|Uint8Array|Uint8ClampedArray|Int16Array|Uint16Array|Int32Array|Uint32Array|Float32Array|Float64Array|BigInt64Array|BigUint64Array)$/.test(normalizedReceiverName ?? "")
		|| ["array", "readonlyarray", "int8array", "uint8array", "uint8clampedarray", "int16array", "uint16array", "int32array", "uint32array", "float32array", "float64array", "bigint64array", "biguint64array"].includes(rootLower)
	) {
		const definitelyMutating = new Set(["copywithin", "fill", "pop", "push", "reverse", "shift", "sort", "splice", "unshift", "set"]);
		const mutatesReceiver = definitelyMutating.has(lowerLeaf);
		const immutableReceiver = normalizedReceiverName === "ReadonlyArray" || rootLower === "readonlyarray";
		const definitelyPure = new Set(["slice", "concat", "includes", "indexof", "lastindexof", "join", "at", "tostring"]);
		return {
			receiverMutability: immutableReceiver ? "immutable" : "mutable",
			mutatesReceiver: immutableReceiver ? false : mutatesReceiver,
			externalSideEffects: false,
			executionPurity: mutatesReceiver ? "impure" : (definitelyPure.has(lowerLeaf) || parameterCount === 0 ? "pure" : "unknown"),
			reason: immutableReceiver
				? "readonly array-like receiver cannot be mutated by declaration"
				: mutatesReceiver
					? "array-like mutator updates receiver contents or shape"
					: "array-like method appears to derive a value without mutating receiver",
		};
	}

	if (/^(Map|Set|WeakMap|WeakSet)$/.test(normalizedReceiverName ?? "") || ["map", "set", "weakmap", "weakset"].includes(rootLower)) {
		const mutatesReceiver = ["add", "set", "delete", "clear"].includes(lowerLeaf);
		return {
			receiverMutability: "mutable",
			mutatesReceiver,
			externalSideEffects: false,
			executionPurity: mutatesReceiver ? "impure" : "unknown",
			reason: mutatesReceiver ? "collection mutator updates receiver state" : "collection observer cannot be proven pure from declaration alone",
		};
	}

	return {
		receiverMutability: "mutable",
		mutatesReceiver: false,
		externalSideEffects: false,
		executionPurity: "unknown",
		reason: "receiver-bound method; mutation/purity not provable from declaration alone",
	};
}

function isReceiverBoundBranch(pathParts: readonly string[]): boolean {
	const root = pathParts[0];
	if (!root) {
		return false;
	}

	if (/Static$/.test(root)) {
		return false;
	}

	if (/(Prototype|Instance)$/.test(root)) {
		return true;
	}

	return /^[A-Z]/.test(root);
}

function inferMethodReceiverType(rootType: ts.Type, pathParts: readonly string[]): ts.Type | undefined {
	return isReceiverBoundBranch(pathParts) ? rootType : undefined;
}

function shouldIncludeResolvedProperties(rootType: ts.Type, checker: ts.TypeChecker, pathParts: readonly string[]): boolean {
	if (isReceiverBoundBranch(pathParts)) {
		return false;
	}

	if (isConstructableType(rootType, checker)) {
		return false;
	}

	return true;
}

function collectDeclaredChildSymbols(symbol: ts.Symbol, checker: ts.TypeChecker): ts.Symbol[] {
	const seen = new Map<string, ts.Symbol>();
	const declarations = symbol.declarations ?? [];
	for (const declaration of declarations) {
		if (ts.isModuleDeclaration(declaration)) {
			const moduleSymbol = checker.getSymbolAtLocation(declaration.name);
			for (const candidate of moduleSymbol?.exports?.values() ?? []) {
				const candidateName = candidate.getName();
				if (isEscapedCompilerPropertyName(candidateName)) {
					continue;
				}
				seen.set(candidateName, candidate);
			}
			continue;
		}

		if (ts.isSourceFile(declaration)) {
			const moduleSymbol = checker.getSymbolAtLocation(declaration);
			for (const candidate of moduleSymbol?.exports?.values() ?? []) {
				const candidateName = candidate.getName();
				if (isEscapedCompilerPropertyName(candidateName)) {
					continue;
				}
				seen.set(candidateName, candidate);
			}
			continue;
		}

		if (ts.isVariableDeclaration(declaration) || ts.isPropertyDeclaration(declaration) || ts.isPropertySignature(declaration) || ts.isPropertyAssignment(declaration) || ts.isShorthandPropertyAssignment(declaration)) {
			const initializer = ts.isShorthandPropertyAssignment(declaration)
				? declaration.name
				: ts.isVariableDeclaration(declaration) || ts.isPropertyDeclaration(declaration) || ts.isPropertyAssignment(declaration)
					? declaration.initializer
					: undefined;
			if (initializer) {
				const initializerType = checker.getTypeAtLocation(initializer);
				for (const candidate of checker.getPropertiesOfType(initializerType)) {
					const candidateName = candidate.getName();
					if (isEscapedCompilerPropertyName(candidateName)) {
						continue;
					}
					if (!isPropertyDeclaredOnType(candidate, initializerType)) {
						continue;
					}
					seen.set(candidateName, candidate);
				}
			}
			continue;
		}

		if (ts.isTypeLiteralNode(declaration) || ts.isInterfaceDeclaration(declaration)) {
			for (const member of declaration.members) {
				const memberSymbol = member.name ? checker.getSymbolAtLocation(member.name) : undefined;
				if (memberSymbol) {
					const memberName = memberSymbol.getName();
					if (isEscapedCompilerPropertyName(memberName)) {
						continue;
					}
					seen.set(memberName, memberSymbol);
				}
			}
		}
	}
	return [...seen.values()];
}

function visitRpcMethodsInternal(
	rootType: ts.Type,
	checker: ts.TypeChecker,
	policies: Required<CodecPolicies>,
	visitor: RpcMethodVisitor,
	pathParts: string[],
	options: CollectRpcMethodsOptions,
): void {
	const typeId = getTypeId(rootType);
	if (typeId !== undefined && options.activeBranchTypeIds?.has(typeId)) {
		return;
	}

	const activeBranchTypeIds = new Set(options.activeBranchTypeIds ?? []);
	if (typeId !== undefined) {
		activeBranchTypeIds.add(typeId);
	}
	const seenMethodNames = options.seenMethodNames instanceof Set
		? options.seenMethodNames as Set<string>
		: new Set(options.seenMethodNames ?? []);
	const rootIsConstructable = isConstructableType(rootType, checker);

	const declaredProperties = rootType.getSymbol() ? collectDeclaredChildSymbols(rootType.getSymbol()!, checker) : [];
	const resolvedProperties = shouldIncludeResolvedProperties(rootType, checker, pathParts)
		? checker.getPropertiesOfType(rootType)
		: [];
	const properties = new Map<string, ts.Symbol>();
	for (const property of declaredProperties) {
		const propertyName = property.getName();
		if (isEscapedCompilerPropertyName(propertyName)) {
			continue;
		}
		properties.set(propertyName, property);
	}
	if (resolvedProperties.length > 0) {
		for (const property of resolvedProperties) {
			const propertyName = property.getName();
			if (isEscapedCompilerPropertyName(propertyName)) {
				continue;
			}
			properties.set(propertyName, property);
		}
	}

	for (const property of properties.values()) {
		if (isEscapedCompilerPropertyName(property.name)) continue;
		if (property.name === "__nrpcMethodName") continue;
		if (property.name === "then") continue;
		if (rootIsConstructable && property.name === "prototype") continue;
		const canonicalPropertyName = resolveCanonicalPropertyName(property.name, properties);
		const nextPath = [...pathParts, canonicalPropertyName];
		if (shouldSkipPath(nextPath, options)) {
			continue;
		}
		const declaration = property.valueDeclaration ?? property.declarations?.[0];
		if (!declaration) continue;

		if (ts.isPropertySignature(declaration) || ts.isMethodSignature(declaration) || ts.isPropertyDeclaration(declaration) || ts.isMethodDeclaration(declaration) || ts.isVariableDeclaration(declaration)) {
			const declaredTypeNode = declaration.type;
			if (declaredTypeNode && ts.isFunctionTypeNode(declaredTypeNode)) {
				const declaredSignature = checker.getSignatureFromDeclaration(declaredTypeNode);
				if (declaredSignature) {
					const methodName = nextPath.join(".");
					if (seenMethodNames.has(methodName)) {
						continue;
					}
					try {
						seenMethodNames.add(methodName);
						visitor(buildCollectedMethod(nextPath, property, declaredSignature, checker, policies, inferMethodReceiverType(rootType, pathParts)));
					} catch {
						// Skip signatures that cannot be represented by the codec/OpenAPI model.
					}
					continue;
				}
			}
		}

		const propertyType = checker.getTypeOfSymbolAtLocation(property, declaration);
		const signatures = checker.getSignaturesOfType(propertyType, ts.SignatureKind.Call);
		const stopPrimitiveValueProperty = shouldStopAtPrimitiveValueProperty(declaration, propertyType, checker, pathParts.length, options);
		const stopContainerValueProperty = shouldStopAtContainerValueProperty(declaration, propertyType, checker, pathParts.length, options);
		if (isValuePropertyDeclaration(declaration) && signatures.length === 0) {
			const methodName = nextPath.join('.');
			if (!seenMethodNames.has(methodName)) {
				try {
					seenMethodNames.add(methodName);
					visitor(buildCollectedPropertyAccessor(nextPath, property, propertyType, checker, policies, inferMethodReceiverType(rootType, pathParts)));
				} catch {
					// Skip properties that cannot be represented by the codec/OpenAPI model.
				}
			}
		}

		if (stopPrimitiveValueProperty || stopContainerValueProperty) {
			continue;
		}

		if (signatures.length > 0) {
			const signature = signatures[0]!;
			const methodName = nextPath.join(".");
			if (seenMethodNames.has(methodName)) {
				continue;
			}
			try {
				seenMethodNames.add(methodName);
				visitor(buildCollectedMethod(nextPath, property, signature, checker, policies, inferMethodReceiverType(rootType, pathParts)));
			} catch {
				// Skip signatures that cannot be represented by the codec/OpenAPI model.
			}
			if (shouldStopAtPrimitiveResultType(checker.getReturnTypeOfSignature(signature), checker, pathParts.length, options)) {
				continue;
			}
		}

		if (shouldSkipContainerPrototypeMethod(declaration, propertyType, checker, pathParts.length, options)) {
			continue;
		}

		if (options.propertyValueTraversal === 'stop-primitive-drilldown' && isPrimitiveLikeType(propertyType, checker)) {
			continue;
		}

		if (!canTraverseType(propertyType, options)) {
			continue;
		}

		if (rootIsConstructable && isConstructableType(propertyType, checker)) {
			continue;
		}

		visitRpcMethodsInternal(propertyType, checker, policies, visitor, nextPath, {
			...options,
			activeBranchTypeIds,
			seenMethodNames,
		});
	}
}

export function visitRpcMethods(
	rootType: ts.Type,
	checker: ts.TypeChecker,
	policies: Required<CodecPolicies>,
	visitor: RpcMethodVisitor,
	pathParts: string[] = [],
	options: CollectRpcMethodsOptions = {},
): void {
	visitRpcMethodsInternal(rootType, checker, policies, visitor, pathParts, options);
}

export function collectRpcMethods(
	rootType: ts.Type,
	checker: ts.TypeChecker,
	policies: Required<CodecPolicies>,
	pathParts: string[] = [],
	options: CollectRpcMethodsOptions = {},
): CollectedRpcMethod[] {
	const out: CollectedRpcMethod[] = [];
	visitRpcMethodsInternal(rootType, checker, policies, (method) => {
		out.push(method);
	}, pathParts, {
		...options,
		activeBranchTypeIds: new Set(options.activeBranchTypeIds ?? []),
		seenMethodNames: new Set(options.seenMethodNames ?? []),
	});
	return out;
}