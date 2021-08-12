import { CodeMaker } from 'codemaker';

// we just need the types from json-schema
// eslint-disable-next-line import/no-extraneous-dependencies
import { JSONSchema4 } from 'json-schema';

import { TypeGenerator } from 'json2jsii';
import { ImportSpec } from '../config';
import { download } from '../util';
import { GenerateOptions, ImportBase } from './base';
import { ApiObjectDefinition, emitHeader, generateConstruct, getCanonicalName, getPropsTypeName } from './codegen';
import { parseApiTypeName } from './k8s-util';


const DEFAULT_API_VERSION = '1.15.0';
const DEFAULT_CLASS_NAME_PREFIX = 'Kube';

export interface ImportKubernetesApiOptions {
  /**
   * The API version to generate.
   */
  readonly apiVersion: string;

  /**
   * Do not import these types. Instead, represent them as "any".
   *
   * @default - include all types that derive from the root types.
   */
  readonly exclude?: string[];
}

export class ImportKubernetesApi extends ImportBase {

  public static async match(importSpec: ImportSpec, argv: any): Promise<ImportKubernetesApiOptions | undefined> {
    const { source } = importSpec;
    if (source !== 'k8s' && !source.startsWith('k8s@')) {
      return undefined;
    }

    return {
      apiVersion: source.split('@')[1] ?? DEFAULT_API_VERSION,
      exclude: argv.exclude,
    };
  }

  constructor(private readonly options: ImportKubernetesApiOptions) {
    super();
  }

  public get moduleNames() {
    return ['k8s'];
  }

  protected async generateTypeScript(code: CodeMaker, moduleName: string, options: GenerateOptions) {
    const schema = await downloadSchema(this.options.apiVersion);

    if (moduleName !== 'k8s') {
      throw new Error(`unexpected module name "${moduleName}" when importing k8s types (expected "k8s")`);
    }

    const classNamePrefix = options.classNamePrefix ?? DEFAULT_CLASS_NAME_PREFIX;

    const typeGenerator = new TypeGenerator({ exclude: this.options.exclude });

    for (const [fqn, def] of Object.entries(schema.definitions ?? {})) {
      const apiObjectName = tryGetApiObjectName(def);

      // emit types differently based on whether the definition corresponds to
      // an API object (object that has the 'x-kubernetes-group-version-kind'
      // annotation) or not
      if (apiObjectName) {
        const obj = createApiObjectDefinition(fqn, def, classNamePrefix);

        // rename "Props" type from their original name based on the API object kind
        // (e.g. `Deployment`) to their actual props type (`KubeDeploymentProps`) in
        // order to avoid confusion between constructs (`KubeDeployment`) and those
        // types.
        typeGenerator.addAlias(fqn, getPropsTypeName(obj));

        // emit construct type (recursive)
        generateConstruct(typeGenerator, obj);
      } else {
        // rename struct types from their original names to ensure that
        // differently-versioned but identically-named resources
        // are generated as distinct types (differentiated by
        // their version).
        const { fullVersion } = parseApiTypeName(fqn);
        const canonicalName = getCanonicalName(fqn, fullVersion === '' ? 'v1' : fullVersion);

        // e.g. re-map "io.k8s.api.apps.v1beta1.DeploymentCondition" to "DeploymentConditionV1Beta1",
        // and "DeploymentConditionV1Beta1" to its schema
        typeGenerator.addAlias(fqn, canonicalName);
        typeGenerator.addDefinition(canonicalName, def);
      }
    }

    emitHeader(code, false);

    code.line(typeGenerator.render());
  }
}

export function createApiObjectDefinition(fqn: string, def: JSONSchema4, prefix: string): ApiObjectDefinition {
  const objectName = tryGetApiObjectName(def);
  if (!objectName) {
    throw new Error(`${fqn} cannot be defined as an API object.`);
  }

  return {
    custom: false, // not a CRD
    fqn,
    group: objectName.group,
    kind: objectName.kind,
    version: objectName.version,
    schema: def,
    prefix,
  };
}

function tryGetApiObjectName(def: JSONSchema4): GroupVersionKind | undefined {
  const objectNames = def[X_GROUP_VERSION_KIND] as GroupVersionKind[];
  if (!objectNames) {
    return undefined;
  }

  const objectName = objectNames[0];
  if (!objectName) {
    return undefined;
  }

  // skip definitions without "metadata". they are not API objects that can be defined
  // in manifests (example: io.k8s.apimachinery.pkg.apis.meta.v1.DeleteOptions)
  // they will be treated as data types
  if (!def.properties?.metadata) {
    return undefined;
  }

  return objectName;
}

export interface GroupVersionKind {
  readonly group: string;
  readonly kind: string;
  readonly version: string;
}

const X_GROUP_VERSION_KIND = 'x-kubernetes-group-version-kind';

async function downloadSchema(apiVersion: string) {
  const url = `https://raw.githubusercontent.com/awslabs/cdk8s/master/kubernetes-schemas/v${apiVersion}/_definitions.json`;
  const output = await download(url);
  return JSON.parse(output) as JSONSchema4;
}
