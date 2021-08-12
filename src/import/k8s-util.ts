/**
 *
 *     io.k8s.api.extensions.v1beta1.Deployment
 *     |--------- ^ -------|  ^  ^ ^ |---^----|
 *                |           |  | |     |
 *  - namespace --+           |  | |     |
 *  - major ------------------+  | |     |
 *  - stability -----------------+ |     |
 *  - minor -----------------------+     |
 *  - basename --------------------------+
 */
export interface ApiObjectName extends ApiObjectVersion {
  basename: string;
  namespace: string;
  fullname: string;
}

interface ApiObjectVersion {
  fullVersion: string;
  stability: ApiStability;
  major: number;
  minor: number;
}

enum ApiStability {
  ALPHA = 'alpha',
  BETA = 'beta',
  STABLE = 'stable',
}

/**
 * Parses a fully qualified type name such as to it's components.
 */
export function parseApiTypeName(fullname: string): ApiObjectName {
  const parts = fullname.split('.');
  const basename = parts[parts.length - 1];

  const namespace = parts.slice(0, parts.length - 2).join('.');

  const v = parts[parts.length - 2];
  const match = /^v([0-9]+)(([a-z]+)([0-9]+))?$/.exec(v);
  if (!match) {
    return {
      fullname,
      namespace: parts.slice(0, parts.length - 1).join('.'),
      basename,
      fullVersion: '',
      major: 0,
      stability: ApiStability.STABLE,
      minor: 0,
    };
  }

  const fullVersion = match[0];
  const major = match[1];
  if (!major) {
    throw new Error(`unable to parse version ${v}. missing version number ("vN")`);
  }

  const stability = match[3] as ApiStability ?? ApiStability.STABLE;
  const minor = parseInt(match[4] ?? '0');
  return {
    fullname,
    namespace,
    basename,
    fullVersion,
    major: parseInt(major),
    stability,
    minor,
  };
}

