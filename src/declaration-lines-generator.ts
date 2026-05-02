export type GenerateDeclarationLinesOptions = {
	sourceText: string;
	variableName: string;
	sourceLabel?: string;
};

export function buildDeclarationLinesModule(options: GenerateDeclarationLinesOptions): string {
	const normalized = options.sourceText.replace(/\r\n/g, "\n").trimEnd();
	const lines = normalized.length > 0 ? normalized.split("\n") : [];
	const header = [
		"// AUTO-GENERATED FILE. DO NOT EDIT.",
		...(options.sourceLabel ? [`// Source: ${options.sourceLabel}`] : []),
		"",
	];

	return [
		...header,
		`export const ${options.variableName} = [`,
		...lines.map((line) => `\t${JSON.stringify(line)},`),
		"] as const;",
		"",
	].join("\n");
}