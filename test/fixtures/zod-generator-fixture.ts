export interface FormatNameInput {
	value: string;
}

export interface FormatNameResult {
	camel: string;
	pascal: string;
	snake: string;
	constant: string;
}

export interface AnalyzeTitleInput {
	value: string;
}

export interface AnalyzeTitleResult {
	title: string;
	sentence: string;
	kebab: string;
	wordCount: number;
}

async function formatName(input: FormatNameInput): Promise<FormatNameResult> {
	return {
		camel: input.value,
		pascal: input.value,
		snake: input.value,
		constant: input.value,
	};
}

async function formatName_string(input: string): Promise<FormatNameResult> {
	return {
		camel: input,
		pascal: input,
		snake: input,
		constant: input,
	};
}

async function analyzeTitle(input: AnalyzeTitleInput): Promise<AnalyzeTitleResult> {
	return {
		title: input.value,
		sentence: input.value,
		kebab: input.value,
		wordCount: 1,
	};
}

export function createFixtureService() {
	return {
		text: {
			formatName,
			formatName_string,
			analyzeTitle,
		},
	};
}

export type FixtureApi = ReturnType<typeof createFixtureService>;