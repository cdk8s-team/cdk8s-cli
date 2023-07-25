import * as os from 'os';
import * as path from 'path';
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
  'CDK8s' = 'cdk8s',
  'HELM' = 'helm',
}

export enum HelmChartApiVersion {
  'V1' = 'v1',
  'V2' = 'v2',
}

export interface HelmSynthesis {
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
  readonly format?: SynthesisFormat;
  readonly helmSynthConfig?: HelmSynthesis;
}

const DEFAULTS: Config = {
  output: 'dist',
  pluginsDirectory: path.join(os.homedir(), '.cdk8s', 'plugins'),
  format: SynthesisFormat.CDK8s,
};

export function readConfigSync(): Config {
  let config: Config = DEFAULTS;

  if (fs.existsSync(CONFIG_FILE)) {
    config = {
      ...config,
      ...yaml.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')),
    };
  }

  if (config.format === SynthesisFormat.HELM && config.helmSynthConfig && !config.helmSynthConfig.chartApiVersion) {
    config = {
      ...config,
      helmSynthConfig: {
        ...config.helmSynthConfig,
        chartApiVersion: HelmChartApiVersion.V2,
      },
    };
  }

  return config;
}