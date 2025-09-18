import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Yaml } from 'cdk8s';
import { CodeMaker } from 'codemaker';
import type { JSONSchema4 } from 'json-schema';
import { TypeGenerator } from 'json2jsii';
import * as semver from 'semver';
import * as yaml from 'yaml';
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
    let contents: any[];

    const isLocalChart = !chartUrl.startsWith('http') && !chartUrl.startsWith('oci://');
    if (isLocalChart) {
      const yamlContent = fs.readFileSync(chartYamlFilePath, 'utf-8');
      contents = [yaml.parse(yamlContent)];
    } else {
      contents = Yaml.load(chartYamlFilePath);
    }

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
      definitions: this.schema?.definitions ?? this.schema?.$defs,
      toJson: true,
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
    const helmRegex = /^helm:(oci:\/\/[A-Za-z0-9_.-:\-]+)\@(v?[0-9]+)\.([0-9]+)\.([A-Za-z0-9-+]+)$/;
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
  } else if (url.startsWith('helm:.') || url.startsWith('helm:/')) {
    // URL: helm:./my-charts or helm:/absolute/path/to/my-charts
    const localPath = url.slice(5);

    if (!localPath) {
      throw Error(`Invalid helm URL: ${url}. Must match the format: 'helm:<local-path>'.`);
    }
    if (!fs.existsSync(localPath)) {
      throw Error(`Local chart path does not exist: ${localPath}`);
    }

    const chartYamlPath = path.join(localPath, CHART_YAML);
    if (!fs.existsSync(chartYamlPath)) {
      throw Error(`Chart.yaml not found in local path: ${localPath}`);
    }

    const chartYamlContent = Yaml.load(chartYamlPath);
    if (chartYamlContent.length !== 1 || !chartYamlContent[0].name || !chartYamlContent[0].version) {
      throw Error(`Invalid Chart.yaml in local path: ${localPath}. Missing name or version.`);
    }

    chartUrl = localPath;
    chartName = chartYamlContent[0].name;
    chartVersion = chartYamlContent[0].version;
  } else {
    // URL: helm:https://lacework.github.io/helm-charts/lacework-agent@6.9.0
    const helmRegex = /^helm:([A-Za-z0-9_.-:\-]+)\/([A-Za-z0-9_.-:\-]+)\@(v?[0-9]+)\.([0-9]+)\.([A-Za-z0-9-+]+)$/;
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
 * @param chartUrl Chart url or local path
 * @param chartName Chart name
 * @param chartVersion Chart version
 * @returns Temporary directory path
 */
function pullHelmRepo(chartUrl: string, chartName: string, chartVersion: string): string {
  if (!chartUrl.startsWith('http') && !chartUrl.startsWith('oci://')) {
    // For local charts, resolve the absolute path and return the parent directory
    // so that the chart can be accessed as workdir/chartName just like remote charts
    const absolutePath = path.resolve(chartUrl);
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`Local chart path does not exist: ${absolutePath}`);
    }

    // Create a temp directory and copy the chart to maintain the expected structure
    const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdk8s-helm-local-'));
    const chartDir = path.join(workdir, chartName);

    fs.mkdirSync(chartDir, { recursive: true });
    fs.cpSync(absolutePath, chartDir, { recursive: true });

    return workdir;
  }

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