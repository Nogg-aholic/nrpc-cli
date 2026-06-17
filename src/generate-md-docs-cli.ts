import { writeMdDocsToDisk } from './md-docs-generator.js';
import { parseArgs } from 'node:util';
import * as path from 'node:path';

async function main() {
	const args = parseArgs({
		args: process.argv.slice(2),
		options: {
			entry: { type: 'string' },
			root: { type: 'string' },
			output: { type: 'string', default: './docs/generated' },
			implementation: { type: 'boolean', default: true },
			external: { type: 'boolean', default: false },
		},
		allowPositionals: true,
	});

	if (!args.values.entry || !args.values.root) {
		console.error('Usage: generate-md-docs --entry <file> --root <type> [--output <dir>] [--implementation] [--external]');
		process.exit(1);
	}

	const options = {
		entryFile: path.resolve(process.cwd(), args.values.entry),
		rootType: args.values.root,
		outputDir: path.resolve(process.cwd(), args.values.output),
		includeImplementation: args.values.implementation,
		includeExternalDeps: args.values.external,
	};

	console.log(`Generating markdown documentation for ${options.rootType} from ${options.entryFile}...`);
	try {
		writeMdDocsToDisk(options);
		console.log(`Documentation successfully generated in ${options.outputDir}`);
	} catch (error) {
		console.error('Failed to generate documentation:', error);
		process.exit(1);
	}
}

main();
