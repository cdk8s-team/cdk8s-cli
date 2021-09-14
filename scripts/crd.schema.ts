/***************************************************************************************************
 * Script to generate the JSONSchema of a CRD.
 *
 * Based on the 'ManifestObjectDefinition' TypeScript definition we use in src/import/crd.ts
 * It is used to validate CRD manifests when running 'cdk8s import <crd-url>'.
 *
 */
import * as tjs from 'typescript-json-schema';
import * as path from 'path';
import * as fs from 'fs';

const out = path.join(__dirname, '..', 'src', 'schemas', `crd.schema.json`);

const settings: Partial<tjs.Args> = {
  required: true,
  ref: true,
  topRef: true,
  noExtraProps: false,
  out
};

const compilerOptions = {
  strictNullChecks: true,
};

const program = tjs.getProgramFromFiles([path.join(__dirname, '../lib/import/crd.d.ts')], compilerOptions);
const schema = tjs.generateSchema(program, 'ManifestObjectDefinition', settings);
fs.writeFileSync(out, JSON.stringify(schema, null, 4));