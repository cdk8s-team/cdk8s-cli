import Ajv from 'ajv';
import { safeParseJson } from '../util';

/**
 *
 *     io.k8s.api.extensions.v1beta1.Deployment
 *     |--------- ^ -------|  ^  ^ ^ |---^----|
 *                |           |  | |     |
 *  - namespace --+           |  | |     |
 *  - major ------------------+  | |     |
 *  - level ---------------------+ |     |
 *  - subversion ------------------+     |
 *  - basename --------------------------+
 */
export interface ApiTypeName {
  basename: string;
  namespace: string;
  fullname: string;
  version?: ApiTypeVersion;
}

interface ApiTypeVersion {
  raw: string;
  level: ApiLevel;
  major: number;
  subversion: number;
}

enum ApiLevel {
  ALPHA = 'alpha',
  BETA = 'beta',
  STABLE = 'stable',
}

/**
 * Parses a fully qualified type name such as to it's components.
 */
export function parseApiTypeName(fullname: string): ApiTypeName {
  const parts = fullname.split('.');
  const type = parts[parts.length - 1];

  const namespace = parts.slice(0, parts.length - 2).join('.');
  const prebase = parts[parts.length - 2];
  const version = /^v([0-9]+)(([a-z]+)([0-9]+))?$/.exec(prebase);
  return {
    fullname: fullname,
    version: version ? {
      raw: version[0],
      major: parseInt(version[1]),
      level: version[3] as ApiLevel ?? ApiLevel.STABLE,
      subversion: parseInt(version[4] ?? '0'),
    } : undefined,
    namespace: version ? namespace : `${namespace}.${prebase}`,
    basename: type,
  };
}

export function safeParseJsonSchema(text: string): any {
  const schema = safeParseJson(text);
  const ajv = new Ajv();
  ajv.compile(schema);
  return schema;
}
