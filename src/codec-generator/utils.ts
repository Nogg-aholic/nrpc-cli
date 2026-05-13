import path from "node:path";

export function camelize(value: string): string {
	return value
		.replace(/[^a-zA-Z0-9]+(.)/g, (_match, chr: string) => chr.toUpperCase())
		.replace(/^[A-Z]/, (chr) => chr.toLowerCase());
}

export function toModuleRelativeImport(fromFile: string, targetFile: string): string {
	const relative = path.relative(path.dirname(fromFile), targetFile).replace(/\\/g, "/");
	return relative.startsWith(".") ? relative : `./${relative}`;
}