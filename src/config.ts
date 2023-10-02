import * as fs from 'fs-extra';
import * as yaml from 'yaml';
import { Language } from './import/base';

const CONFIG_FILE = 'cdk8s.yaml';

export interface ImportSpec {
  readonly moduleNamePrefix?: string;
  readonly source: string;
}

export interface ValidationConfig {
  readonly package: string;
  readonly version: string;
  readonly class: string;
  readonly installEnv?: { [key: string]: any };
  readonly properties?: { [key: string]: any };
}

export enum SynthesisFormat {
  PLAIN = 'plain',
  HELM = 'helm',
}

export enum HelmChartApiVersion {
  V1 = 'v1',
  V2 = 'v2',
}

export interface SynthConfig {
  readonly format?: SynthesisFormat;
  readonly chartApiVersion?: HelmChartApiVersion;
  readonly chartVersion?: string;
}

export interface Config {
  readonly app?: string;
  readonly language?: Language;
  readonly output?: string;
  readonly imports?: string[];
  readonly pluginsDirectory?: string;
  readonly validations?: string | ValidationConfig[];
  readonly synthConfig?: SynthConfig;
}

export function readConfigSync(): Config | undefined {
  if (fs.existsSync(CONFIG_FILE)) {
    const config = {
      ...yaml.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')),
    };

    return config;
  }

  return undefined;
}

export async function addImportToConfig(source: string) {
  let curConfig = yaml.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));

  const curImports = curConfig.imports ?? [];
  if (!curImports.includes(source)) {
    const importsList = curConfig.imports ?? [];
    importsList.push(source);
    let config = {
      ...curConfig,
      imports: importsList,
    };
    await fs.outputFile(CONFIG_FILE, yaml.stringify(config));
  }
}