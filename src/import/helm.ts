import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Yaml } from 'cdk8s';
import { CodeMaker } from 'codemaker';
import type { JSONSchema4 } from 'json-schema';
import { TypeGenerator } from 'json2jsii';
import * as semver from 'semver';
import { ImportBase } from './base';
import { emitHelmHeader, generateHelmConstruct } from './codegen';
import { ImportSpec } from '../config';

const MAX_HELM_BUFFER = 10 * 1024 * 1024;
const CHART_SCHEMA = 'values.schema.json';
const CHART_YAML = 'Chart.yaml';

export class ImportHelm extends ImportBase {
  public static async fromSpec(importSpec: ImportSpec): Promise<ImportHelm> {
    const { source } = importSpec;
    return new ImportHelm(source);
  }

  private readonly chartName: string;
  private readonly chartUrl: string;
  private readonly chartVersion: string;
  private readonly chartSchemaPath: string | undefined;
  private readonly chartDependencies: string[] = [];
  private readonly schema: JSONSchema4 | undefined;

  private constructor(source: string) {
    super();

    const [chartUrl, chartName, chartVersion] = extractHelmChartDetails(source);

    this.chartName = chartName;
    this.chartUrl = chartUrl;
    this.chartVersion = chartVersion;
    const tmpDir = pullHelmRepo(chartUrl, chartName, chartVersion);

    const chartYamlFilePath = path.join(tmpDir, this.chartName, CHART_YAML);
    const contents = Yaml.load(chartYamlFilePath);

    if (contents.length === 1 && contents[0].dependencies) {
      for (const dependency of contents[0].dependencies) {
        this.chartDependencies.push(dependency.name);
      }
    }

    const potentialSchemaPath = path.join(tmpDir, this.chartName, CHART_SCHEMA);
    this.chartSchemaPath = fs.existsSync(potentialSchemaPath) ? potentialSchemaPath : undefined;
    this.schema = this.chartSchemaPath ? JSON.parse(fs.readFileSync(this.chartSchemaPath, 'utf-8')) : undefined;

    cleanup(tmpDir);
  }

  public get moduleNames() {
    return [this.chartName];
  }

  protected async generateTypeScript(code: CodeMaker) {
    emitHelmHeader(code);

    const types = new TypeGenerator({
      definitions: this.schema?.definitions,
      toJson: false,
      sanitizeEnums: true,
    });

    generateHelmConstruct(types, {
      schema: this.schema,
      chartName: this.chartName,
      chartUrl: this.chartUrl,
      chartVersion: this.chartVersion,
      chartDependencies: this.chartDependencies,
      fqn: this.chartName,
    });

    code.line(types.render());
  }
}

/**
 * Gets information about the helm chart from the helm url
 * @param url
 * @returns chartUrl, chartName and chartVersion
 */
function extractHelmChartDetails(url: string) {

  let chartUrl;
  let chartName;
  let chartVersion;

  if (url.startsWith('helm:oci://')) {
    // URL: helm:oci://registry-1.docker.io/bitnamicharts/wordpress@17.1.17
    const helmRegex = /^helm:(oci:\/\/[A-Za-z0-9_.-:\-]+)\@([0-9]+)\.([0-9]+)\.([A-Za-z0-9-+]+)$/;
    const helmDetails = helmRegex.exec(url);

    if (!helmDetails) {
      throw Error(`Invalid helm URL: ${url}. Must match the format: 'helm:<oci-registry-url>@<chart-version>'.`);
    }

    chartUrl = helmDetails[1];
    const lastIndexOfSlash = chartUrl.lastIndexOf('/');
    chartName = chartUrl.substring(lastIndexOfSlash + 1);

    const major = helmDetails[2];
    const minor = helmDetails[3];
    const patch = helmDetails[4];
    chartVersion = `${major}.${minor}.${patch}`;

  } else {
    // URL: helm:https://lacework.github.io/helm-charts/lacework-agent@6.9.0
    const helmRegex = /^helm:([A-Za-z0-9_.-:\-]+)\/([A-Za-z0-9_.-:\-]+)\@([0-9]+)\.([0-9]+)\.([A-Za-z0-9-+]+)$/;
    const helmDetails = helmRegex.exec(url);

    if (!helmDetails) {
      throw Error(`Invalid helm URL: ${url}. Must match the format: 'helm:<repo-url>/<chart-name>@<chart-version>'.`);
    }

    chartUrl = helmDetails[1];
    chartName = helmDetails[2];

    const major = helmDetails[3];
    const minor = helmDetails[4];
    const patch = helmDetails[5];
    chartVersion = `${major}.${minor}.${patch}`;
  }

  if (!semver.valid(chartVersion)) {
    throw new Error(`Invalid chart version (${chartVersion}) in URL: ${url}. Must follow SemVer-2 (see https://semver.org/).`);
  }

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

  if (!chartUrl.startsWith('oci://')) {
    args.push(chartName);
    args.push('--repo', chartUrl);
  } else {
    args.push(chartUrl);
  }

  args.push('--version', chartVersion);
  args.push('--untar');
  args.push('--untardir', workdir);

  args.forEach((item) => console.log(`ITEM: ----> ${item}`));

  const command = 'helm';

  const helm = spawnSync(command, args, {
    maxBuffer: MAX_HELM_BUFFER,
  });

  if (helm.error) {
    const err = helm.error.message;
    if (err.includes('ENOENT')) {
      throw new Error(`Unable to execute '${command}' to pull the Helm chart. Is helm installed on your system?`);
    }

    throw new Error(`Failed pulling helm chart from URL (${chartUrl}): ${err}`);
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