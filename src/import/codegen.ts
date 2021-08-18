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

export function getConstructTypeName(def: ApiObjectDefinition) {
  const prefix = def.prefix ?? '';

  // add an API version postfix only if this is core API (`import k8s`).
  const postfix = (def.custom || def.version === 'v1') ? '' : toPascalCase(def.version);
  return TypeGenerator.normalizeTypeName(`${prefix}${def.kind}${postfix}`);
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
    const hasRequired = schema?.required && Array.isArray(schema.required) && schema.required.length > 0;
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
      copy.required = copy.required.filter(x => x !== 'apiVersion' && x !== 'kind' && x !== 'status');

      if (def.custom) {
        // add "metadata" field for all CRDs, overriding any existing typings
        copy.properties.metadata = { $ref: '#/definitions/ApiObjectMetadata' };
      }

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

      code.line(`super(scope, id, ${constructName}.${MANIFEST_STATIC_METHOD}(props));`);

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
      code.line('...props,');
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
