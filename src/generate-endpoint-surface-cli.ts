#!/usr/bin/env bun
import path from "node:path";
import { generateDocsArtifacts, renderGeneratedDocsArtifactsModule } from "./docs.js";
import { generateEndpointSurface } from "./endpoint-surface-generator.js";

function readArg(flag: string): string | undefined {
	const index = process.argv.indexOf(flag);
	if (index === -1) return undefined;
	return process.argv[index + 1];
}

function readListArg(flag: string): string[] | undefined {
	const value = readArg(flag);
	if (!value) return undefined;
	const items = value.split(",").map((entry) => entry.trim()).filter(Boolean);
	return items.length > 0 ? items : undefined;
}

const inputPath = readArg("--in");
const outputPath = readArg("--out");
const rootType = readArg("--root");
const globalName = readArg("--global");
const declarationTypeName = readArg("--declaration-type");
const rootPath = readListArg("--root-path");
const datePolicy = readArg("--date-policy") as "iso-string" | "epoch-ms" | "reject" | undefined;
const mapPolicy = readArg("--map-policy") as "entries" | "object" | "reject" | undefined;
const setPolicy = readArg("--set-policy") as "array" | "reject" | undefined;

if (!inputPath) throw new Error("Missing --in <path>");
if (!outputPath) throw new Error("Missing --out <generated-surface-file>");
if (!rootType) throw new Error("Missing --root <type alias or interface>");

const resolvedInputPath = path.resolve(process.cwd(), inputPath);
const resolvedOutputPath = path.resolve(process.cwd(), outputPath);

const result = generateEndpointSurface({
	entryFile: resolvedInputPath,
	rootType,
	outputImportPath: resolvedOutputPath,
	rootPath,
	globalName,
	declarationTypeName,
	policies: {
		date: datePolicy,
		map: mapPolicy,
		set: setPolicy
	}
});

const docsArtifacts = generateDocsArtifacts({
	entryFile: resolvedInputPath,
	rootType,
	rootPath,
	basePath: "/",
	policies: {
		date: datePolicy,
		map: mapPolicy,
		set: setPolicy,
	}
});

await Bun.write(resolvedOutputPath.replace(/\.surface\.ts$/, ".contract.ts"), result.contractText);
await Bun.write(
	resolvedOutputPath.replace(/\.surface\.ts$/, ".surface.docs.ts"),
	renderGeneratedDocsArtifactsModule(docsArtifacts),
);
