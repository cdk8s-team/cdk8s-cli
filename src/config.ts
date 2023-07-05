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

export interface Config {
  readonly app?: string;
  readonly language?: Language;
  readonly output?: string;
  readonly imports?: string[];
  readonly pluginsDirectory?: string;
  readonly validations?: string | ValidationConfig[];
}

const DEFAULTS: Config = {
  output: 'dist',
  pluginsDirectory: path.join(os.homedir(), '.cdk8s', 'plugins'),
  imports: ['k8s'],
};

export function readConfigSync(): Config {
  let config: Config = DEFAULTS;
  if (fs.existsSync(CONFIG_FILE)) {
    const parsedYaml: Config = yaml.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    config = {
      ...config,
      ...parsedYaml,
    };
  }
  return config;
}

export async function addImportToConfig(source: string) {
  let curConfig = readConfigSync();

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