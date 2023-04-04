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

export function readConfigSync(filePath?: string): Config {
  let config: Config = DEFAULTS;
  const fullFilePath = filePath ? path.join(filePath, CONFIG_FILE) : CONFIG_FILE;
  if (fs.existsSync(fullFilePath)) {
    config = {
      ...config,
      ...yaml.parse(fs.readFileSync(fullFilePath, 'utf-8')),
    };
  }
  return config;
}

export function addImportToConfig(source: string, filePath?: string): Config {

  const fullFilePath = filePath ? path.join(filePath, CONFIG_FILE) : CONFIG_FILE;
  let config: Config = readConfigSync(fullFilePath);
  let importsList = config.imports ?? [];

  if (!config.imports?.includes(source)) {
    importsList.push(source);
    if (fs.existsSync(CONFIG_FILE)) {
      config = {
        ...config,
        imports: importsList,
      };
      void fs.outputFile(fullFilePath, yaml.stringify(config));
    }
  }

  return readConfigSync(fullFilePath);
}