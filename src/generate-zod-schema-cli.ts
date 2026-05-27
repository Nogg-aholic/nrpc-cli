#!/usr/bin/env bun
import path from "node:path";

import { generateZodSchemaModule } from "./zod-generator.js";

type PolicyArg<T extends string> = T | undefined;

function readArg(flag: string): string | undefined {
	const index = process.argv.indexOf(flag);
	if (index === -1) return undefined;
	return process.argv[index + 1];
}

const inputPath = readArg("--in");
const outputPath = readArg("--out");
const rootType = readArg("--root");
const exportName = readArg("--export-name");
const zodImportPath = readArg("--zod-import");
const datePolicy = readArg("--date-policy") as PolicyArg<"iso-string" | "epoch-ms" | "reject">;
const mapPolicy = readArg("--map-policy") as PolicyArg<"entries" | "object" | "reject">;
const setPolicy = readArg("--set-policy") as PolicyArg<"array" | "reject">;

if (!inputPath) throw new Error("Missing --in <path>");
if (!outputPath) throw new Error("Missing --out <path>");
if (!rootType) throw new Error("Missing --root <type alias or interface>");

const resolvedInputPath = path.resolve(process.cwd(), inputPath);
const resolvedOutputPath = path.resolve(process.cwd(), outputPath);

const output = generateZodSchemaModule({
	entryFile: resolvedInputPath,
	rootType,
	outputImportPath: resolvedOutputPath,
	exportName,
	zodImportPath,
	policies: {
		date: datePolicy,
		map: mapPolicy,
		set: setPolicy,
	},
});

await Bun.write(resolvedOutputPath, output.code);
