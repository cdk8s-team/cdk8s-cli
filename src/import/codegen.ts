import { CodeMaker, toPascalCase } from 'codemaker';
// we just need the types from json-schema
// eslint-disable-next-line import/no-extraneous-dependencies
import { JSONSchema4 } from 'json-schema';
import { TypeGenerator } from 'json2jsii';

const MANIFEST_STATIC_METHOD = 'manifest';
const GVK_STATIC = 'GVK';

export interface ApiObjectDefinition {
  readonly fqn: string;
  readonly group: string;
  readonly version: string;
  readonly kind: string;
  readonly schema: JSONSchema4;

  /**
   * Is this is a custom resource (imported from a CRD) or a core API object?
   */
  readonly custom: boolean;

  /*
   * Indicates if a prefix should be added to the construct class name. For
   * example, for native k8s api objects, we add `Kube` by default.
   *
   * @default ""
   */
  readonly prefix?: string;

  /*
   * Indicates if a suffix should be added to the construct class name. For
   * example, for multi-versioned crds, we add the version as the suffix.
   *
   * @default ""
   */
  readonly suffix?: string;
}

/**
 * Emits the header for a generated imports file.
 *
 * @param custom - whether the header is being emitted for a custom resource
 * (imported from a CRD) or a core API object
 */
export function emitHeader(code: CodeMaker, custom: boolean) {
  code.line('// generated by cdk8s');
  if (custom) {
    code.line('import { ApiObject, ApiObjectMetadata, GroupVersionKind } from \'cdk8s\';');
  } else {
    code.line('import { ApiObject, GroupVersionKind } from \'cdk8s\';');
  }
  code.line('import { Construct } from \'constructs\';');
  code.line();
}

export function getTypeName(custom: boolean, kind: string, version: string) {
  // add an API version postfix only if this is core API (`import k8s`).
  // TODO = what about the rest of the namespace? the same resource can exist in multiple
  // api groups (Ingress for example exists in 'extensions' and 'networking')
  const postfix = (custom || version === 'v1') ? '' : toPascalCase(version);
  return `${kind}${postfix}`;
}

export function getConstructTypeName(def: ApiObjectDefinition) {
  const prefix = def.prefix ?? '';
  const suffix = def.suffix ?? '';
  return TypeGenerator.normalizeTypeName(`${prefix}${getTypeName(def.custom, def.kind, def.version)}${suffix}`);
}

export function getPropsTypeName(def: ApiObjectDefinition) {
  const constructName = getConstructTypeName(def);
  return TypeGenerator.normalizeTypeName(`${constructName}Props`);
}

export function generateConstruct(typegen: TypeGenerator, def: ApiObjectDefinition) {
  const constructName = getConstructTypeName(def);

  if (def.custom) {
    typegen.emitCustomType('ApiObjectMetadata', () => {});
  }

  typegen.emitCustomType(constructName, code => {
    const schema = def.schema;

    // `propsTypeName` could also be "any" if we can't parse the schema for some reason
    const propsTypeName = emitPropsStruct();
    const groupPrefix = def.group ? `${def.group}/` : '';
    const hasRequired = hasRequiredProps(schema);
    const defaultProps = hasRequired ? '' : ' = {}';
    emitConstruct();

    function emitPropsStruct() {
      const propsSchema = createPropsStructSchema();
      const propsStructName = getPropsTypeName(def);
      return typegen.emitType(propsStructName, propsSchema, def.fqn);
    }

    function createPropsStructSchema() {
      const copy: JSONSchema4 = { ...def.schema || {} };
      const props = copy.properties = copy.properties || {};
      delete props.apiVersion;
      delete props.kind;
      delete props.status;
      delete copy['x-kubernetes-group-version-kind'];

      copy.required = copy.required || [];

      if (Array.isArray(copy.required)) {
        copy.required = copy.required.filter(x => x !== 'apiVersion' && x !== 'kind' && x !== 'status');
      }

      if (def.custom) {
        // add "metadata" field for all CRDs, overriding any existing typings
        copy.properties.metadata = { $ref: '#/definitions/ApiObjectMetadata' };
      }

      // reorder top-level keys so that we have "metadata" first and then all the rest
      // This matches the behavior in the ApiObject's toJson function (https://github.com/cdk8s-team/cdk8s-core/blob/58fb8c0882ddd95a9b9dedb4107e12f601443cf4/src/api-object.ts#L185)
      const result: any = {};
      for (const k of ['metadata', ...Object.keys(copy.properties)]) {
        if (k in copy.properties) {
          result[k] = copy.properties[k];
        }
      }

      copy.properties = result;
      return copy;
    }

    function emitConstruct() {
      code.line('/**');
      code.line(` * ${def.schema?.description ?? ''}`);
      code.line(' *');
      code.line(` * @schema ${def.fqn}`);
      code.line(' */');
      code.openBlock(`export class ${constructName} extends ApiObject`);

      emitGVK();

      code.line('');

      emitManifestFactory();

      code.line('');

      emitInitializer();

      code.line('');

      emitToJson();

      code.closeBlock();
    }

    function emitGVK() {
      code.line('/**');
      code.line(` * Returns the apiVersion and kind for "${def.fqn}"`);
      code.line(' */');
      code.openBlock(`public static readonly ${GVK_STATIC}: GroupVersionKind =`);
      code.line(`apiVersion: '${groupPrefix}${def.version}',`);
      code.line(`kind: '${def.kind}',`);
      code.closeBlock();
    }

    function emitInitializer() {

      code.line('/**');
      code.line(` * Defines a "${def.fqn}" API object`);
      code.line(' * @param scope the scope in which to define this object');
      code.line(' * @param id a scope-local name for the object');
      code.line(' * @param props initialization props');
      code.line(' */');

      code.openBlock(`public constructor(scope: Construct, id: string, props: ${propsTypeName}${defaultProps})`);

      code.open('super(scope, id, {');
      code.line(`...${constructName}.${GVK_STATIC},`);
      code.line('...props,');
      code.close('});');

      code.closeBlock();
    }

    function emitManifestFactory() {
      code.line('/**');
      code.line(` * Renders a Kubernetes manifest for "${def.fqn}".`);
      code.line(' *');
      code.line(' * This can be used to inline resource manifests inside other objects (e.g. as templates).');
      code.line(' *');
      code.line(' * @param props initialization props');
      code.line(' */');

      code.openBlock(`public static ${MANIFEST_STATIC_METHOD}(props: ${propsTypeName}${defaultProps}): any`);
      code.open('return {');
      code.line(`...${constructName}.${GVK_STATIC},`);
      code.line(`...toJson_${propsTypeName}(props),`);
      code.close('};');
      code.closeBlock();
    }

    function emitToJson() {
      code.line('/**');
      code.line(' * Renders the object to Kubernetes JSON.');
      code.line(' */');
      code.openBlock('public toJson(): any');
      code.line('const resolved = super.toJson();');
      code.line();
      code.open('return {');
      code.line(`...${constructName}.${GVK_STATIC},`);
      code.line(`...toJson_${propsTypeName}(resolved),`);
      code.close('};');
      code.closeBlock();
    }
  });
}

/**
 * Emit imports for generated helm construct
 * @param code CodeMaker istance
 */
export function emitHelmHeader(code: CodeMaker) {
  code.line('// generated by cdk8s');
  code.line('import { Helm } from \'cdk8s\';');
  code.line('import { Construct } from \'constructs\';');
  code.line();
}

/**
 * Helm Object Definition
 */
export interface HelmObjectDefinition {
  /**
   * `values.schema.json` for the helm chart
   */
  readonly schema: JSONSchema4 | undefined;
  /**
   * Chart name
   */
  readonly chartName: string;
  /**
   * Chart url
   */
  readonly chartUrl: string;
  /**
   * Chart version
   */
  readonly chartVersion: string;
  /**
   * Chart dependencies
   */
  readonly chartDependencies: string[];
  /**
   * Fully qualified name for the construct
   */
  readonly fqn?: string;
}

export function generateHelmConstruct(typegen: TypeGenerator, def: HelmObjectDefinition) {
  const noSpecialChars = def.chartName.replace(/([^\w ]|_)/g, '');
  const chartName = TypeGenerator.normalizeTypeName(noSpecialChars);
  const schema = def.schema;
  const repoUrl = def.chartUrl;
  const chartVersion = def.chartVersion;

  // Create custom type
  typegen.emitCustomType(chartName, code => {

    const valuesInterface = `${chartName}Values`;
    if (schema !== undefined) {
      // Creating values interface
      emitValuesInterface();

      function emitValuesInterface() {
        const copyOfSchema = schema;

        if (copyOfSchema && copyOfSchema.properties) {
          // Sub charts or dependencies
          for (const dependency of def.chartDependencies) {
            copyOfSchema.properties[dependency] = { type: 'object', additionalProperties: { type: 'object' } };
          }

          copyOfSchema.properties.global = { type: 'object', additionalProperties: { type: 'object' } };
          copyOfSchema.properties.additionalValues = { type: 'object', additionalProperties: { type: 'object' } };
        }

        typegen.emitType(valuesInterface, copyOfSchema, def.fqn);
      }
    }

    // Creating construct properties
    emitPropsInterface();

    code.line();

    // Creating construct for helm chart
    emitConstruct();

    function emitPropsInterface() {
      code.openBlock(`export interface ${chartName}Props`);

      code.line('readonly namespace?: string;');
      code.line('readonly releaseName?: string;');
      code.line('readonly helmExecutable?: string;');
      code.line('readonly helmFlags?: string[];');

      if (schema === undefined) {
        code.line('readonly values?: { [key: string]: any };');
      } else {
        const doValuesHaveReqProps = hasRequiredProps(schema) ? '' : '?';
        code.line(`readonly values${doValuesHaveReqProps}: ${valuesInterface};`);
      }

      code.closeBlock();
    }

    function emitConstruct() {
      code.openBlock(`export class ${chartName} extends Construct`);

      emitInitializer();

      code.closeBlock();
    }

    function emitInitializer() {
      code.openBlock(`public constructor(scope: Construct, id: string, props: ${chartName}Props = {})`);

      code.line(`let updatedProps: ${chartName}Props = {};`);
      code.line();
      code.openBlock('if (props.values && \'additionalValues\' in props.values)');
      code.line('const { additionalValues, ...valuesWithoutAdditionalValues } = props.values;');
      code.open('updatedProps = {');
      code.line('...props,');
      code.open('values: {');
      code.line('...valuesWithoutAdditionalValues,');
      code.line('...additionalValues,');
      code.close('}');
      code.close('};');
      code.closeBlock();
      code.line();

      code.open('const finalProps = {');
      code.line(`chart: \'${def.chartName}\',`);
      code.line(`repo: \'${repoUrl}\',`);
      code.line(`version: \'${chartVersion}\',`);
      code.line('...(updatedProps ?? props),');
      code.close('};');

      code.line();
      code.line('super(scope, id)');
      code.line('new Helm(scope, \'Helm\', finalProps)');
      code.closeBlock();
    }
  });
}

function hasRequiredProps(schema: JSONSchema4):boolean | undefined {
  return schema?.required && Array.isArray(schema.required) && schema.required.length > 0;
}