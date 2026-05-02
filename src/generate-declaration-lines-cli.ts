#!/usr/bin/env bun
import path from "node:path";
import { buildDeclarationLinesModule } from "./declaration-lines-generator.js";

function readArg(flag: string): string | undefined {
	const index = process.argv.indexOf(flag);
	if (index === -1) {
		return undefined;
	}
	return process.argv[index + 1];
}

const inputPath = readArg("--in");
const outputPath = readArg("--out");
const variableName = readArg("--var");
const sourceLabel = readArg("--source-label");

if (!inputPath) {
	throw new Error("Missing --in <path>");
}

if (!outputPath) {
	throw new Error("Missing --out <path>");
}

if (!variableName) {
	throw new Error("Missing --var <name>");
}

const resolvedInputPath = path.resolve(process.cwd(), inputPath);
const resolvedOutputPath = path.resolve(process.cwd(), outputPath);
const sourceText = await Bun.file(resolvedInputPath).text();
const output = buildDeclarationLinesModule({
	sourceText,
	variableName,
	sourceLabel,
});

await Bun.write(resolvedOutputPath, output);