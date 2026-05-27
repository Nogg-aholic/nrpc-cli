import path from 'node:path';

import { describe, expect, test } from 'bun:test';

import { generateZodSchemaModule } from '../src/zod-generator.js';

const entryFile = path.resolve(process.cwd(), '..', 'nrpc-example', 'src', 'service.ts');

describe('Zod generator', () => {
  test('renders method input and result schemas from a service root', () => {
    const generated = generateZodSchemaModule({
      entryFile,
      rootType: 'ChangeCaseApi',
      outputImportPath: path.resolve(process.cwd(), 'generated', 'change-case-api.zod.ts'),
      exportName: 'changeCaseApiZodSchemas',
    });

    expect(generated.code).toContain("import { z } from \"zod\";");
    expect(generated.code).toContain('export const TextFormatNameInputSchema =');
    expect(generated.code).toContain('export const TextFormatNameResultSchema =');
    expect(generated.code).toContain('export const changeCaseApiZodSchemas =');
    expect(generated.code).toContain('"text": {');
    expect(generated.code).toContain('"formatName": { input: TextFormatNameInputSchema, result: TextFormatNameResultSchema }');
  });
});