import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  buildOpenApiDocumentFromProjections,
  visitOpenApiMethodProjections,
} from '../src/openapi-generator.js';
import type { OpenApiMethodProjection } from '../src/openapi-types.js';
import { generateOpenApiSurface } from '../src/openapi-surface-generator.js';

declare const Buffer: { byteLength(value: string, encoding?: string): number };

const entryFile = path.resolve('./test/node-fs-openapi-wrapper.ts');
const outDir = path.resolve('./test/generated/node-fs');
const openApiPath = path.join(outDir, 'node-fs.openapi.json');
const surfaceBase = path.join(outDir, 'node-fs.surface.ts');
const contractPath = path.join(outDir, 'node-fs.contract.ts');
const docsPath = path.join(outDir, 'node-fs.surface.docs.ts');
const mcpToolsPath = path.join(outDir, 'node-fs.mcp-tools.ts');

const projections: OpenApiMethodProjection[] = [];
visitOpenApiMethodProjections({
  entryFile,
  rootType: 'NodeFsSurfaceSource',
  title: 'Node FS API',
  traversal: {},
}, (projection) => {
  projections.push(projection);
});

mkdirSync(outDir, { recursive: true });

const document = buildOpenApiDocumentFromProjections(projections, {
  entryFile,
  rootType: 'NodeFsSurfaceSource',
  title: 'Node FS API',
  version: '1.0.0',
});
writeFileSync(openApiPath, JSON.stringify(document, null, 2), 'utf8');

const surface = generateOpenApiSurface({
  openApiFile: openApiPath,
  outputImportPath: surfaceBase,
  rootTypeName: 'NodeFsSurface',
  globalName: 'nodeFs',
});

writeFileSync(contractPath, surface.contractText, 'utf8');
writeFileSync(docsPath, surface.docsText, 'utf8');
writeFileSync(mcpToolsPath, surface.mcpToolsText, 'utf8');

console.log(`methods:${projections.length}`);
console.log(`openapiBytes:${Buffer.byteLength(JSON.stringify(document), 'utf8')}`);
console.log(`contractBytes:${Buffer.byteLength(surface.contractText, 'utf8')}`);
console.log(`docsBytes:${Buffer.byteLength(surface.docsText, 'utf8')}`);
console.log(`mcpToolsBytes:${Buffer.byteLength(surface.mcpToolsText, 'utf8')}`);
