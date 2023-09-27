import * as fs from 'fs';
import * as path from 'path';
import Ajv from 'ajv';
import { CodeMaker, toPascalCase } from 'codemaker';
import { TypeGenerator } from 'json2jsii';
import { GenerateOptions, ImportBase } from './base';
import { emitHeader, generateConstruct } from './codegen';
import { ImportSpec } from '../config';
import { SafeReviver } from '../reviver';
import { download, safeParseYaml } from '../util';

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

type CustomResourceDefinitionVersion = { name: string; schema?: any };

export class CustomResourceDefinition {

  private readonly kind: string;
  private readonly versions: CustomResourceDefinitionVersion[] = [];

  public readonly group: string;

  constructor(manifest: ManifestObjectDefinition) {
    const apiVersion = manifest?.apiVersion ?? 'undefined';
    assert(SUPPORTED_API_VERSIONS.includes(apiVersion), `"apiVersion" is "${apiVersion}" but it should be one of: ${SUPPORTED_API_VERSIONS.map(x => `"${x}"`).join(', ')}`);
    assert(manifest.kind === CRD_KIND, `"kind" must be "${CRD_KIND}"`);

    const spec = manifest.spec;
    if (!spec) {
      throw new Error('manifest does not have a "spec" attribute');
    }

    this.group = spec.group;
    this.kind = spec.names.kind;

    if (spec.version) {
      this.addVersions([{ name: spec.version, schema: spec.validation?.openAPIV3Schema }]);
    } else {
      this.addVersions((spec.versions ?? []).map(v => ({ name: v.name, schema: v.schema?.openAPIV3Schema ?? spec.validation?.openAPIV3Schema })));
    }

    if (this.versions.length === 0) {
      throw new Error('unable to determine CRD versions');
    }

  }

  public merge(crd: CustomResourceDefinition) {
    this.addVersions(crd.versions);
  }

  private addVersions(versions: CustomResourceDefinitionVersion[]) {
    for (const v of versions) {
      const existingVersions = this.versions.map(ver => ver.name);
      if (existingVersions.includes(v.name)) {
        throw new Error(`Found multiple occurrences of version ${v.name} for ${this.key}`);
      }
      this.versions.push({ name: v.name, schema: v.schema });
    }
  }

  public get key() {
    return `${this.group}/${this.kind.toLocaleLowerCase()}`;
  }

  public async generateTypeScript(code: CodeMaker, options: GenerateOptions) {

    for (let i = 0; i < this.versions.length; i++) {

      const version = this.versions[i];

      // to preseve backwards compatiblity, only append a suffix for
      // the second version onwards.
      const suffix = i === 0 ? '' : toPascalCase(version.name);

      const types = new TypeGenerator({});

      generateConstruct(types, {
        group: this.group,
        version: version.name,
        kind: this.kind,
        fqn: `${this.kind}${suffix}`,
        schema: version.schema,
        custom: true,
        prefix: options.classNamePrefix,
        suffix,
      });

      code.line(types.render());
    }
  }
}

export class ImportCustomResourceDefinition extends ImportBase {
  public static async fromSpec(importSpec: ImportSpec): Promise<ImportCustomResourceDefinition> {
    const { source } = importSpec;
    const manifest = await download(source);
    return new ImportCustomResourceDefinition(manifest);
  }

  public readonly rawManifest: string;
  private readonly groups: Record<string, CustomResourceDefinition[]> = { };

  private constructor(rawManifest: string) {
    super();

    this.rawManifest = rawManifest;
    const manifest = safeParseCrds(rawManifest);

    const crds: Record<string, CustomResourceDefinition> = { };
    const groups: Record<string, CustomResourceDefinition[]> = { };

    for (const spec of manifest) {
      const crd = new CustomResourceDefinition(spec);
      const key = crd.key;

      if (key in crds) {
        // might contain different versions - lets try to merge them in
        crds[key].merge(crd);
      } else {
        crds[key] = crd;
      }
    }

    //sort to ensure consistent ordering for snapshot compare
    const sortedCrds = Object.values(crds).sort((a: CustomResourceDefinition, b: CustomResourceDefinition) => a.key.localeCompare(b.key));

    for (const crd of sortedCrds) {
      const g = crd.group;
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
