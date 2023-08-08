import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CodeMaker } from 'codemaker';
// we just need the types from json-schema
// eslint-disable-next-line import/no-extraneous-dependencies
import { JSONSchema4 } from 'json-schema';
import { TypeGenerator } from 'json2jsii';
import { ImportBase } from './base';
import { emitHelmHeader, generateHelmConstruct } from './codegen';
import { ImportSpec } from '../config';

const MAX_HELM_BUFFER = 10 * 1024 * 1024;

// TODO: Validate if chart version follows SemVer
export class ImportHelm extends ImportBase {
  chartName: string;
  chartUrl: string;
  chartVersion: string;
  chartSchemaPath: string | undefined;
  tmpDir: string;
  schemaFileName: string = 'values.schema.json';

  constructor(importSpec: ImportSpec) {
    super();

    const [chartUrl, chartName, chartVersion] = getHelmChartDetails(importSpec.source);

    this.chartName = chartName;
    this.chartUrl = chartUrl;
    this.chartVersion = chartVersion;

    this.tmpDir = pullHelmRepo(chartUrl, chartName, chartVersion);

    const potentialSchemaPath = path.join(this.tmpDir, this.chartName, this.schemaFileName);

    if (fs.existsSync(potentialSchemaPath)) {
      this.chartSchemaPath = potentialSchemaPath;
    } else {
      this.chartSchemaPath = undefined;
    }

    console.log(`CHART SCHEMA PATH: ${this.chartSchemaPath}`);
  }

  public get moduleNames() {
    return [this.chartName];
  }

  protected async generateTypeScript(code: CodeMaker) {

    emitHelmHeader(code);

    let schema: JSONSchema4 | undefined;
    if (this.chartSchemaPath !== undefined) {
      schema = JSON.parse(fs.readFileSync(this.chartSchemaPath, 'utf-8'));
    } else {
      schema = undefined;
    }

    const types = new TypeGenerator({
      definitions: schema?.definitions,
    });

    generateHelmConstruct(types, {
      schema: schema,
      chartName: this.chartName,
      chartUrl: this.chartUrl,
      chartVersion: this.chartVersion,
      fqn: this.chartName,
    });

    code.line(types.render());

    cleanup(this.tmpDir);
  }
}

/**
 * Validating if a helm chart url is in an expected format
 * @param url
 */
function validateHelmUrl(url: string): RegExpExecArray {
  const helmRegex = /^helm:([A-Za-z0-9_.-:]+)\/([A-Za-z0-9_.-:]+)\@([0-9]+)\.([0-9]+)\.([0-9]+)$/;
  const match = helmRegex.exec(url);

  if (match) {
    return match;
  } else {
    throw Error(`There was an error processing the helm chart url you passed in: ${url}. Make sure it matches the format of 'helm:<repo-url>/<chart-name>@<chart-version>'.`);
  }
}

/**
 * Gets information about the helm chart from the helm url
 * @param url
 * @returns chartUrl, chartName and chartVersion
 */
function getHelmChartDetails(url: string) {

  const helmDetails = validateHelmUrl(url);
  const chartUrl = helmDetails[1];
  const chartName = helmDetails[2];
  const major = helmDetails[3];
  const minor = helmDetails[4];
  const patch = helmDetails[5];

  const chartVersion = `${major}.${minor}.${patch}`;

  return [chartUrl, chartName, chartVersion];
}

/**
 * Pulls the helm chart in a temporary directory
 * @param chartUrl Chart url
 * @param chartName Chart name
 * @param chartVersion Chart version
 * @returns Temporary directory path
 */
function pullHelmRepo(chartUrl: string, chartName: string, chartVersion: string): string {
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdk8s-helm-'));

  const args = new Array<string>();
  args.push('pull');
  args.push(chartName);
  args.push('--repo', chartUrl);
  args.push('--version', chartVersion);
  args.push('--untar');
  args.push('--untardir', workdir);

  const command = 'helm';

  const helm = spawnSync(command, args, {
    maxBuffer: MAX_HELM_BUFFER,
  });

  if (helm.error) {
    const err = helm.error.message;
    if (err.includes('ENOENT')) {
      throw new Error(`unable to execute '${command}' to pull the Helm chart. Is it installed on your system?`);
    }

    throw new Error(`error while pulling a helm chart: ${err}`);
  }

  if (helm.status !== 0) {
    throw new Error(helm.stderr.toString());
  }

  return workdir;
}

/**
 * Cleanup temp directory created
 * @param tmpDir Temporary directory path
 */
function cleanup(tmpDir: string) {
  fs.rmSync(tmpDir, { recursive: true });
}