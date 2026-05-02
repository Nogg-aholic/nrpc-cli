#!/usr/bin/env bun
import path from "node:path";
import { generateEndpointGlobalDeclaration } from "./endpoint-surface-generator.js";

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

if (!inputPath) throw new Error("Missing --in <path>");
if (!outputPath) throw new Error("Missing --out <global-dts-file>");
if (!rootType) throw new Error("Missing --root <type alias or interface>");

const resolvedInputPath = path.resolve(process.cwd(), inputPath);
const resolvedOutputPath = path.resolve(process.cwd(), outputPath);

const output = generateEndpointGlobalDeclaration({
  entryFile: resolvedInputPath,
  rootType,
  rootPath,
  declarationTypeName: declarationTypeName ?? "__nrpcGeneratedApiApi",
  globalName: globalName ?? "api",
});

await Bun.write(resolvedOutputPath, output);
