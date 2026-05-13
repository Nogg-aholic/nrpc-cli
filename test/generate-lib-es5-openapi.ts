import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  buildOpenApiDocumentFromProjections,
  visitOpenApiMethodProjections,
} from '../src/openapi-generator.js';
import type { OpenApiMethodProjection } from '../src/openapi-types.js';
import { generateOpenApiSurface } from '../src/openapi-surface-generator.js';

declare const Buffer: { byteLength(value: string, encoding?: string): number };

const entryFile = path.resolve('./test/lib-es5-openapi-wrapper.ts');
const outDir = path.resolve('./test/generated/lib-es5');
const openApiPath = path.join(outDir, 'lib-es5.openapi.json');
const surfaceBase = path.join(outDir, 'lib-es5.surface.ts');
const contractPath = path.join(outDir, 'lib-es5.contract.ts');
const docsPath = path.join(outDir, 'lib-es5.surface.docs.ts');
const mcpToolsPath = path.join(outDir, 'lib-es5.mcp-tools.ts');

const skippedMethodPrefixes = [
  'Math.',
  'JSON.',
  'ObjectPrototype.',
  'FunctionPrototype.',
];

function shouldSkip(methodName: string): boolean {
  return skippedMethodPrefixes.some((prefix) => methodName.startsWith(prefix));
}

const projections: OpenApiMethodProjection[] = [];
visitOpenApiMethodProjections({
  entryFile,
  rootType: 'LibEs5SurfaceSource',
  title: 'lib.es5 API',
  traversal: {},
}, (projection) => {
  if (shouldSkip(projection.methodName)) {
    return;
  }
  projections.push(projection);
});

mkdirSync(outDir, { recursive: true });

const document = buildOpenApiDocumentFromProjections(projections, {
  entryFile,
  rootType: 'LibEs5SurfaceSource',
  title: 'lib.es5 API',
  version: '1.0.0',
});
writeFileSync(openApiPath, JSON.stringify(document, null, 2), 'utf8');

const surface = generateOpenApiSurface({
  openApiFile: openApiPath,
  outputImportPath: surfaceBase,
  rootTypeName: 'LibEs5Surface',
  globalName: 'libEs5',
});

writeFileSync(contractPath, surface.contractText, 'utf8');
writeFileSync(docsPath, surface.docsText, 'utf8');
writeFileSync(mcpToolsPath, surface.mcpToolsText, 'utf8');

console.log(`methods:${projections.length}`);
console.log(`openapiBytes:${Buffer.byteLength(JSON.stringify(document), 'utf8')}`);
console.log(`contractBytes:${Buffer.byteLength(surface.contractText, 'utf8')}`);
console.log(`docsBytes:${Buffer.byteLength(surface.docsText, 'utf8')}`);
console.log(`mcpToolsBytes:${Buffer.byteLength(surface.mcpToolsText, 'utf8')}`);
