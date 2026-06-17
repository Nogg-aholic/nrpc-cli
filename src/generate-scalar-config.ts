import * as fs from 'node:fs';
import * as path from 'node:path';

export type ScalarConfig = {
	$schema: string;
	scalar: string;
	info: {
		title: string;
		description: string;
	};
	assetsDir?: string;
	siteConfig?: {
		theme?: string;
		subpath?: string;
		logo?: {
			darkMode?: string;
			lightMode?: string;
		};
	};
	navigation: {
		routes: Record<string, any>;
	};
};

export function generateScalarConfig(options: {
	outputDir: string;
	title?: string;
	description?: string;
	methods: string[];
}): ScalarConfig {
	// Build navigation routes
	const routes: Record<string, any> = {
		'/': {
			type: 'group',
			title: 'Documentation',
			children: {
				'': {
					type: 'page',
					title: 'Overview',
					filepath: 'index.md',
				},
			},
		},
	};

	// Add methods navigation
	const methodsChildren: Record<string, any> = {};
	for (const methodName of options.methods) {
		methodsChildren[`/${methodName}`] = {
			type: 'page',
			title: methodName,
			filepath: `methods/${methodName}.md`,
		};
	}

	routes['/'].children['/methods'] = {
		type: 'group',
		title: 'Methods',
		children: methodsChildren,
	};

	return {
		$schema: 'https://registry.scalar.com/@scalar/schemas/config',
		scalar: '2.0.0',
		info: {
			title: options.title || 'API Documentation',
			description: options.description || 'Auto-generated documentation',
		},
		assetsDir: 'assets',
		siteConfig: {
			theme: 'default',
			subpath: '/docs',
		},
		navigation: {
			routes,
		},
	};
}

export function writeScalarConfig(config: ScalarConfig, outputDir: string): void {
	const configPath = path.join(outputDir, 'scalar.config.json');
	fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}
