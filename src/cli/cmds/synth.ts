import { createHash } from 'crypto';
import * as os from 'os';
import path from 'path';
import * as fs from 'fs-extra';
import * as semver from 'semver';
import { sscaff } from 'sscaff';
import * as yaml from 'yaml';
import * as yargs from 'yargs';
import { HelmChartApiVersion, SynthesisFormat, ValidationConfig, readConfigSync } from '../../config';
import { matchCrdsDevUrl } from '../../import/crds-dev';
import { PluginManager } from '../../plugins/_manager';
import { SynthesizedApp, crdsArePresent, download, isK8sImport, mkdtemp, parseImports, synthApp, validateApp } from '../../util';

const CHART_YAML_FILE = 'Chart.yaml';
const README = 'README.md';

const config = readConfigSync();

class Command implements yargs.CommandModule {
  public readonly command = 'synth';
  public readonly describe = 'Synthesizes Kubernetes manifests for all charts in your app.';
  public readonly aliases = ['synthesize'];

  public readonly builder = (args: yargs.Argv) => args
    .option('app', { default: config.app, required: true, desc: 'Command to use in order to execute cdk8s app', alias: 'a' })
    .option('output', { default: config.output, required: false, desc: 'Output directory', alias: 'o' })
    .option('stdout', { type: 'boolean', required: false, desc: 'Write synthesized manifests to STDOUT instead of the output directory', alias: 'p' })
    .option('plugins-dir', { default: config.pluginsDirectory, required: false, desc: 'Directory to store cdk8s plugins.' })
    .option('validate', { type: 'boolean', default: true, required: false, desc: 'Apply validation plugins on the resulting manifests (use --no-validate to disable)' })
    .option('validation-reports-output-file', { required: false, desc: 'File to write a JSON representation of the validation reports to' })
    .option('format', {
      default: config.synth?.format,
      required: false,
      desc: 'Synthesis format for Kubernetes manifests.',
      choices: ['plain', 'helm'],
      type: 'string',
    })
    .option('chart-api-version', { default: config.synth?.chartApiVersion, required: false, desc: 'Chart API version of helm chart. The default value would be \'v2\'.' })
    .option('chart-version', { required: false, desc: 'Chart version of helm chart. This is required if synthesis format(--format) is helm.' });
  ;

  public async handler(argv: any) {

    const command = argv.app;
    const outdir = argv.output;
    const stdout = argv.stdout;
    const validate = argv.validate;
    const pluginsDir = argv.pluginsDir;
    const reportFile = argv.validationReportsOutputFile;
    const format = argv.format;
    const chartApiVersion = argv.chartApiVersion;
    const chartVersion = argv.chartVersion;

    if (outdir && outdir !== config.output && stdout) {
      throw new Error('\'--output\' and \'--stdout\' are mutually exclusive. Please only use one.');
    }

    if (outdir) {
      fs.rmSync(outdir, { recursive: true, force: true });
    }

    if (format && (format != SynthesisFormat.PLAIN && format != SynthesisFormat.HELM)) {
      throw new Error(`You need to specify synthesis format either as ${SynthesisFormat.PLAIN} or ${SynthesisFormat.HELM} but received: ${format}`);
    }

    if (chartApiVersion && (chartApiVersion != HelmChartApiVersion.V1 && chartApiVersion != HelmChartApiVersion.V2)) {
      throw new Error(`You need to specify helm chart api version either as ${HelmChartApiVersion.V1} or ${HelmChartApiVersion.V2} but received: ${chartApiVersion}`);
    }

    if (format === SynthesisFormat.HELM && !chartVersion) {
      throw new Error('You need to specify the \'--chart-version\' when the \'--format\' is set as helm.');
    }

    if (chartVersion && !semver.valid(chartVersion)) {
      throw new Error(`The value specified for '--chart-version': ${chartVersion} does not follow SemVer-2(https://semver.org/).`);
    }

    if (stdout && format === SynthesisFormat.HELM) {
      throw new Error('Helm format synthesis does not support \'stdout\'. Please use \'outdir\' instead.');
    }

    if (format === SynthesisFormat.PLAIN && (chartApiVersion || chartVersion || (chartApiVersion && chartVersion))) {
      throw new Error('You need to specify \'--format\' as helm when \'--chart-version\' and/or \'--chart-api-version\' is set.');
    }

    if (chartApiVersion === HelmChartApiVersion.V1 && config.imports && config.imports.length > 0) {
      if (!crdsArePresent(config.imports)) {} else {
        throw new Error(`CRDs are not supported with --format as 'helm' for --chart-api-version: '${chartApiVersion}'. Please use --chart-api-version: '${HelmChartApiVersion.V2}' for using CRDs.`);
      }
    }

    const validations = validate ? await fetchValidations() : undefined;
    const recordConstructMetadata = !(validations == undefined || validations.length == 0);

    if (stdout) {
      await mkdtemp(async tempDir => {
        const app = await synthApp(command, tempDir, stdout, recordConstructMetadata);
        for (const f of app.manifests) {
          fs.createReadStream(f).pipe(process.stdout);
        }
        if (validations) {
          const pluginManager = new PluginManager(pluginsDir);
          await validateApp(app, stdout, validations, pluginManager, reportFile);
        }
      });
    } else {
      let manifests: SynthesizedApp;

      if (format === SynthesisFormat.HELM) {
        await createHelmScaffolding(chartApiVersion, chartVersion, outdir);
        const templateDir = path.join(outdir, 'templates');

        manifests = await synthApp(command, templateDir, stdout, recordConstructMetadata);
      } else {
        manifests = await synthApp(command, outdir, stdout, recordConstructMetadata);
      }

      if (validations) {
        const pluginManager = new PluginManager(pluginsDir);
        await validateApp(manifests, stdout, validations, pluginManager, reportFile);
      }
    }
  }

}

async function fetchValidations(): Promise<ValidationConfig[] | undefined> {
  if (typeof(config.validations) === 'string') {
    const content = await download(config.validations);
    return yaml.parse(content) as ValidationConfig[];
  } else {
    return config.validations;
  }
}

async function createHelmScaffolding(apiVersion: string, chartVersion: string, outdir: string) {
  const tempHelmStructure = createFolderStructure();

  const substituteValues = {
    apiVersion: apiVersion,
    version: chartVersion,
    app: path.basename(path.resolve()),
  };

  try {
    await sscaff(tempHelmStructure, outdir, substituteValues);
  } catch (error) {
    throw new Error(`An error occurred during Helm chart creation: ${error}`);
  }

  if (apiVersion === HelmChartApiVersion.V2 && crdsArePresent(config.imports)) {
    await addCrdsToHelmChart(outdir);
  }

  function createFolderStructure(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-scaffolding-'));

    fs.mkdirSync(path.join(root, 'templates'));

    const chartYamlFile = {
      apiVersion: '{{ apiVersion }}',
      name: '{{ app }}',
      version: '{{ version }}',
      description: 'Generated chart for {{ app }}',
      type: 'application',
    };

    fs.outputFileSync(path.join(root, CHART_YAML_FILE), yaml.stringify(chartYamlFile));

    const readmeFile = 'This Helm chart is generated using cdk8s. Any manual changes to the chart would be discarded once cdk8s app is synthesized again with `--format helm`.';

    fs.outputFileSync(path.join(root, README), readmeFile);

    if (config.synth?.chartApiVersion === HelmChartApiVersion.V2 && crdsArePresent(config.imports)) {
      fs.mkdirSync(path.join(root, 'crds'));
    }

    return root;
  }
}

function deriveFileName(url: string) {
  const devUrl = matchCrdsDevUrl(url);
  let filename = undefined;

  if (devUrl) {
    const lastIndexOfSlash = devUrl.lastIndexOf('/');
    const lastIndexOfAt = devUrl.lastIndexOf('@');
    filename = devUrl.slice(lastIndexOfSlash+1, lastIndexOfAt);
  } else {
    const lastIndexOfSlash = url.lastIndexOf('/');
    const lastIndexOfYaml = url.lastIndexOf('.yaml');
    filename = url.slice(lastIndexOfSlash+1, lastIndexOfYaml);
  }

  if (!filename) {
    filename = createHash('sha256');
  }

  return filename;
}

async function downloadCrds(url: string) {
  const devUrl = matchCrdsDevUrl(url);
  const manifest = devUrl ? await download(devUrl): await download(url);

  return manifest;
}

async function addCrdsToHelmChart(chartDir: string) {
  try {
    if (config.imports) {
      for (const imprt of config.imports) {
        if (isK8sImport(imprt)) {
          continue;
        }

        const { source } = parseImports(imprt);
        const manifest = await downloadCrds(source);
        const filename = deriveFileName(source);

        fs.outputFileSync(path.join(chartDir, 'crds', `${filename}.yaml`), manifest);
      }
    }
  } catch (er) {
    const e = er as any;

    throw new Error(`Error during adding custom resource definition to helm chart folder: ${e.stack}\nSTDOUT:\n${e.stdout?.toString()}\nSTDERR:\n${e.stderr?.toString()}. `);
  }
}

module.exports = new Command();

// Update config format and code: https://github.com/cdk8s-team/cdk8s-cli/pull/1195#discussion_r1304168534
// What is happening here: https://github.com/cdk8s-team/cdk8s-cli/pull/1195#discussion_r1304185894
// Dynamically create folder structure: https://github.com/cdk8s-team/cdk8s-cli/pull/1195#discussion_r1304146586
// Reafctor to make intent more clear: https://github.com/cdk8s-team/cdk8s-cli/pull/1195#discussion_r1304172122
// How can we do this: https://github.com/cdk8s-team/cdk8s-cli/pull/1195#discussion_r1304173280, https://github.com/cdk8s-team/cdk8s-cli/pull/1195#discussion_r1304198734
// Remove parse imports since already exported: https://github.com/cdk8s-team/cdk8s-cli/pull/1195#discussion_r1304182946
// Validate format: https://github.com/cdk8s-team/cdk8s-cli/pull/1195#discussion_r1304163604.
// Similar to prior, do the same for Chart Api Version and also add choices to options: https://github.com/cdk8s-team/cdk8s-cli/pull/1195#discussion_r1304164280
// Improve validation and ignore K8s imports: https://github.com/cdk8s-team/cdk8s-cli/pull/1195#discussion_r1304165021, https://github.com/cdk8s-team/cdk8s-cli/pull/1195#discussion_r1304189554

// Fix linting
// Remove debugging logic
// Add tests, unit and integ
// Manual test deployment on local cluster
// Review your own PR before submission
// What happens if I delete an imported file and run synthesis. Does it import it back using cdk8s.yaml config?
// Make sure documentation reflects defaults to users
// Add docs to exported functions
