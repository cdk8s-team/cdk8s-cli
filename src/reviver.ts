/**
 * A function that takes a value and the path to it within the parent object,
 * and either transforms it or leaves it alone.
 */
export type Sanitizer = (path: string[], value: string) => { applied: boolean; sanitized?: string };

/**
 * Properties for 'SafeReviver'.
 */
export interface SafeReviverProps {
  readonly allowlistedKeys?: string[];
  readonly sanitizers?: Array<Sanitizer>;
}

/**
 * JSON/YAML reviver that:
 *
 * - Throws when an illegal key is detected.
 * - Replaces illegal values with a special marker.
 */
export class SafeReviver {

  // . | used in resource fqn which servers as a key (e.g io.k8s.apimachinery.pkg.apis.meta.v1.APIGroup)
  // / | used in $ref to point to a definition (e.g #/definitions/io.k8s.apimachinery.pkg.apis.meta.v1.GroupVersionForDiscovery)
  // - | used in annotation keys (e.g x-kubernetes-group-version-kind)
  // # | used in $ref to point to a definition (e.g #/definitions/io.k8s.apimachinery.pkg.apis.meta.v1.GroupVersionForDiscovery)
  // , | used in values that represent a list (e.g merge,retainKeys)
  // + | used in values representing MIME types (e.g application/json-patch+json)
  // : | used in e.g. Prometheus events (e.g run:completed)
  // * | used in e.g. AWS policies (e.g s3:ObjectCreated:*)
  public static readonly LEGAL_CHARS = /^(\w|\.|\/|-|#|,)*$/;
  public static readonly LEGAL_CHARS_IN_ENUM = /^( |\w|\.|\/|-|#|,|\+|:|\*)*$/;

  // the string we use as the stripped value
  public static readonly STRIPPED_VALUE = '__stripped_by_cdk8s__';

  // remove characters from descriptions that might terminate the comment
  public static readonly DESCRIPTION_SANITIZER: Sanitizer = (path: string[], value: string) => {
    if (path.length > 0 && path[path.length - 1] === 'description') {
      return { applied: true, sanitized: value.replace(/\*\//g, '_/') };
    } else {
      return { applied: false };
    }
  };

  // strip most illegal values
  // the reason we don't throw is because sometimes these type of values exist in
  // the original text for good reason, like for example a `jsonPath` key in a CRD manifest, and we don't
  // want to fail the entire thing.
  public static readonly LEGAL_CHAR_SANITIZER: Sanitizer = (path: string[], value: string) => {
    // case 1: we are in an array of enums
    if (path.length > 2 && path[path.length - 2] === 'enum' && /^\d+$/.test(path[path.length - 1])) {

      if (!SafeReviver.LEGAL_CHARS_IN_ENUM.test(value)) {
        return { applied: true, sanitized: SafeReviver.STRIPPED_VALUE };
      } else {
        return { applied: false };
      }

    // case 2: default
    } else {

      if (!SafeReviver.LEGAL_CHARS.test(value)) {
        return { applied: true, sanitized: SafeReviver.STRIPPED_VALUE };
      } else {
        return { applied: false };
      }

    }
  };

  private readonly allowlistedKeys: string[];
  private readonly sanitizers: Array<Sanitizer>;

  constructor(props?: SafeReviverProps) {
    this.allowlistedKeys = props?.allowlistedKeys ?? [];
    this.sanitizers = props?.sanitizers ?? [];
  }

  public sanitizeValue(path: string[], value: string): string | undefined {
    for (const sanitizer of this.sanitizers) {
      const { applied, sanitized } = sanitizer(path, value);
      if (applied) {
        return sanitized;
      }
    }

    return value;
  }

  /**
   * Sanitizes a JSON object in-place.
   */
  public sanitize(obj: any) {
    if (obj == null) return;
    this._sanitizeObj([], obj);
  }

  private _sanitizeObj(path: string[], partialObj: any) {
    for (const [key, value] of Object.entries(partialObj)) {
      if (typeof(key) !== 'string') {
        throw new Error(`Expected key (${key}) to be of type 'string', but got '${typeof(key)}'`);
      }

      if (!this.allowlistedKeys.includes(key) && !SafeReviver.LEGAL_CHARS.test(key)) {
        // keys cannot be stripped so we have to throw - thats ok, we don't want to parse such docs at all
        throw new Error(`Key '${key}' contains non standard characters (Must match regex '${SafeReviver.LEGAL_CHARS}')`);
      }

      const childPath = path.concat([key]);

      if (typeof(value) === 'string') {
        partialObj[key] = this.sanitizeValue(childPath, value);
      } else if (typeof(value) === 'object' && value !== null) {
        this._sanitizeObj(childPath, value); // recursive call
      }
    }
  }
}
