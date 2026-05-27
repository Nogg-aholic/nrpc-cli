import path from 'node:path';

import { describe, expect, test } from 'bun:test';

import { generateZodSchemaModule } from '../src/zod-generator.js';

const entryFile = path.resolve(process.cwd(), 'test', 'fixtures', 'zod-generator-fixture.ts');

describe('Zod generator', () => {
  test('renders method input and result schemas from a service root', () => {
    const generated = generateZodSchemaModule({
      entryFile,
      rootType: 'FixtureApi',
      outputImportPath: path.resolve(process.cwd(), 'generated', 'fixture-api.zod.ts'),
      exportName: 'fixtureApiZodSchemas',
    });

    expect(generated.code).toContain("import { z } from \"zod\";");
    expect(generated.code).toContain('export const TextFormatNameInputSchema =');
    expect(generated.code).toContain('export const TextFormatNameResultSchema =');
    expect(generated.code).toContain('export const fixtureApiZodSchemas =');
    expect(generated.code).toContain('"text": {');
    expect(generated.code).toContain('"formatName": { input: TextFormatNameInputSchema, result: TextFormatNameResultSchema }');
  });
});