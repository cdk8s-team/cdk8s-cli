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
  imports: ['k8s'],
};

export function readConfigSync(filePath?: string): Config {
  let config: Config = DEFAULTS;
  const fullFilePath = filePath ? path.join(filePath, CONFIG_FILE) : CONFIG_FILE;
  if (fs.existsSync(fullFilePath)) {
    const parsedYaml: Config = yaml.parse(fs.readFileSync(fullFilePath, 'utf-8'));
    config = {
      ...config,
      ...parsedYaml,
    };
  }
  return config;
}

export async function addImportToConfig(source: string, filePath?: string) {
  const fullFilePath = filePath ? path.join(filePath, CONFIG_FILE) : CONFIG_FILE;
  let curConfig = readConfigSync(filePath);

  if (!curConfig.imports?.includes(source)) {
    const importsList = curConfig.imports ?? [];
    importsList.push(source);
    let config = {
      language: curConfig.language,
      app: curConfig.app,
      imports: importsList,
      output: curConfig.output ?? DEFAULTS.output,
      pluginsDirectory: curConfig.pluginsDirectory ?? DEFAULTS.pluginsDirectory,
    };
    await fs.outputFile(fullFilePath, yaml.stringify(config));
  }
}