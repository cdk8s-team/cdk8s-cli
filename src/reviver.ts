/**
 * Properties for 'SafeReviver'.
 */
export interface SafeReviverProps {
  readonly allowlistedKeys?: string[];
  readonly sanitizers?: { [key: string]: (key: string) => string };
}

/**
 * JSON/YAML reviver that:
 *
 * - Throws when an illegal key is detected.
 * - Replaces illegal values with a special marker.
 */
export class SafeReviver {

  // the string we use as the stripped value
  public static readonly STRIPPED_VALUE = '__stripped_by_cdk8s__';

  // remove characters that might terminate the comment
  public static readonly DESCRIPTION_SANITIZER = (desc: string) => desc.replace(/\*\//g, '_/');

  private readonly allowlistedKeys: string[];
  private readonly sanitizers: { [key: string]: (key: string) => string };

  constructor(props?: SafeReviverProps) {
    this.allowlistedKeys = props?.allowlistedKeys ?? [];
    this.sanitizers = props?.sanitizers ?? {};
  }

  public revive(key: unknown, value: unknown): unknown {

    if (typeof(key) !== 'string') {
      // this should always hold
      throw new Error(`Expected key (${key}) to be of type 'string', but got '${typeof(key)}'`);
    }

    // .       | used in resource fqn which servers as a key (e.g io.k8s.apimachinery.pkg.apis.meta.v1.APIGroup)
    // /       | used in $ref to point to a definition (e.g #/definitions/io.k8s.apimachinery.pkg.apis.meta.v1.GroupVersionForDiscovery)
    // -       | used in annotation keys (e.g x-kubernetes-group-version-kind)
    // #       | used in $ref to point to a definition (e.g #/definitions/io.k8s.apimachinery.pkg.apis.meta.v1.GroupVersionForDiscovery)
    // ,       | used in values that represent a list (e.g merge,retainKeys)
    // <space> | used in enum values with spaces
    const legalKey = /^(\w|\.|\/|-|#|,)*$/;
    const legalValue = /^(\w| |\.|\/|-|#|,)*$/;

    if (!this.allowlistedKeys.includes(key) && !key.match(legalKey)) {
      // keys cannot be stripped so we have to throw - thats ok, we don't want to parse such docs at all
      throw new Error(`Key '${key}' contains non standard characters (Must match regex '${legalKey}')`);
    }

    if (typeof(value) === 'string') {

      const sanitizer = this.sanitizers[key];

      if (sanitizer) {
        // if we have a sanitizer - apply it
        return sanitizer(value);
      }

      if (!value.match(legalValue)) {
        // otherwise strip illegal values.
        // we shouldn't be using these values anyway.
        // the reason we don't throw is because sometimes these type of values exist in
        // the original text for good reason, like for example a `jsonPath` key in a CRD manifest, and we don't
        // want to fail the entire thing.
        // if we happen to add code that needs them, this would have to change and
        // employ some validation logic.
        return SafeReviver.STRIPPED_VALUE;
      }
      return value;
    }
    return value;
  }
}
