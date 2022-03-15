import * as fs from 'fs';
import * as path from 'path';
import Ajv from 'ajv';
import { CodeMaker } from 'codemaker';
import { TypeGenerator } from 'json2jsii';
import { ImportSpec } from '../config';
import { SafeReviver } from '../reviver';
import { download, safeParseYaml } from '../util';
import { GenerateOptions, ImportBase } from './base';
import { emitHeader, generateConstruct } from './codegen';
import { GroupVersionKind } from './k8s';

const CRD_KIND = 'CustomResourceDefinition';

export interface ManifestObjectDefinition {
  apiVersion?: string;
  kind?: string;
  items?: ManifestObjectDefinition[]; // if `kind` is "List"
  metadata?: {
    name?: string;
  };
  spec?: {
    group: string;
    names: {
      kind: string;
      [key: string]: any;
    };
    versions?: Array<{
      name: string;
      schema?: { openAPIV3Schema?: any };
      [key: string]: any;
    }>;
    version?: string;
    validation?: { openAPIV3Schema?: any };
    [key: string]: any;
  };
}

// all these APIs are compatible from our perspective.
const SUPPORTED_API_VERSIONS = [
  'apiextensions.k8s.io/v1beta1',
  'apiextensions.k8s.io/v1',
];

export class CustomResourceDefinition {
  private readonly schema?: any;
  private readonly group: string;
  private readonly version: string;
  private readonly kind: string;
  private readonly fqn: string;

  constructor(manifest: ManifestObjectDefinition) {
    const apiVersion = manifest?.apiVersion ?? 'undefined';
    assert(SUPPORTED_API_VERSIONS.includes(apiVersion), `"apiVersion" is "${apiVersion}" but it should be one of: ${SUPPORTED_API_VERSIONS.map(x => `"${x}"`).join(', ')}`);
    assert(manifest.kind === CRD_KIND, `"kind" must be "${CRD_KIND}"`);

    const spec = manifest.spec;
    if (!spec) {
      throw new Error('manifest does not have a "spec" attribute');
    }

    const version = spec.version ?? (spec.versions ?? [])[0];
    if (!version) {
      throw new Error('unable to determine CRD version');
    }

    const schema = typeof version === 'string'
      ? spec.validation?.openAPIV3Schema
      : version?.schema?.openAPIV3Schema ?? spec.validation?.openAPIV3Schema;

    this.schema = schema;
    this.group = spec.group;
    this.version = typeof version === 'string' ? version : version.name;
    this.kind = spec.names.kind;
    this.fqn = this.kind;
  }

  public get key() {
    return `${this.group}/${this.kind.toLocaleLowerCase()}`;
  }

  public get gvk(): GroupVersionKind {
    return {
      group: this.group,
      version: this.version,
      kind: this.kind,
    };
  }

  public async generateTypeScript(code: CodeMaker, options: GenerateOptions) {
    const types = new TypeGenerator();

    generateConstruct(types, {
      group: this.group,
      version: this.version,
      kind: this.kind,
      fqn: this.fqn,
      schema: this.schema,
      custom: true,
      prefix: options.classNamePrefix,
    });

    code.line(types.render());
  }
}

export class ImportCustomResourceDefinition extends ImportBase {
  public static async fromSpec(importSpec: ImportSpec): Promise<ImportCustomResourceDefinition> {
    const { source } = importSpec;
    const manifest = await download(source);
    return new ImportCustomResourceDefinition(safeParseCrds(manifest));
  }

  private readonly groups: Record<string, CustomResourceDefinition[]> = { };

  private constructor(manifest: ManifestObjectDefinition[]) {
    super();

    const crds: Record<string, CustomResourceDefinition> = { };
    const groups: Record<string, CustomResourceDefinition[]> = { };

    for (const spec of manifest) {
      const crd = new CustomResourceDefinition(spec);
      const key = crd.key;

      if (key in crds) {
        throw new Error(`${key} already exists`);
      }
      crds[key] = crd;
    }

    //sort to ensure consistent ordering for snapshot compare
    const sortedCrds = Object.values(crds).sort((a: CustomResourceDefinition, b: CustomResourceDefinition) => a.key.localeCompare(b.key));

    for (const crd of sortedCrds) {
      const g = crd.gvk.group;
      if ( !(g in groups) ) {
        groups[g] = new Array<CustomResourceDefinition>();
      }
      groups[g].push(crd);
    }

    this.groups = groups;
  }

  public get moduleNames() {
    return Object.keys(this.groups);
  }

  protected async generateTypeScript(code: CodeMaker, moduleName: string, options: GenerateOptions) {
    const crds = this.groups[moduleName];


    emitHeader(code, true);

    for (const crd of crds) {
      console.log(`  ${crd.key}`);
      await crd.generateTypeScript(code, options);
    }
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`invalid CustomResourceDefinition manifest: ${message}`);
  }
}


export function safeParseCrds(manifest: string): ManifestObjectDefinition[] {
  const schemaPath = path.join(__dirname, '..', 'schemas', 'crd.schema.json');
  const schema = JSON.parse(fs.readFileSync(schemaPath, { encoding: 'utf8' }));
  const reviver = new SafeReviver({
    sanitizers: [SafeReviver.DESCRIPTION_SANITIZER, SafeReviver.LEGAL_CHAR_SANITIZER],
  });

  // first parse and strip
  const objects = safeParseYaml(manifest, reviver);

  // since the manifest can contain non crds as well, we first
  // collect all crds and only apply a schema validation on them.

  const crds: any[] = [];

  function collectCRDs(objs: any[]) {
    for (const obj of objs.filter(o => o)) {
      if (obj.kind === CRD_KIND) {
        crds.push(obj);
      }
      if (obj.kind === 'List') {
        collectCRDs(obj.items);
      }
    }
  }

  collectCRDs(objects);

  const ajv = new Ajv();
  const validate = ajv.compile(schema);
  const errors = [];
  for (const crd of crds) {
    validate(crd);
    if (validate.errors) {
      errors.push(...validate.errors);
    };
  }
  if (errors.length > 0) {
    throw new Error(`Schema validation errors detected\n ${errors.map(e => `* ${e.message}`).join('\n')}`);
  }
  return crds;
}
