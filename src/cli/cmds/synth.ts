import * as os from 'os';
import path from 'path';
import * as fs from 'fs-extra';
import * as semver from 'semver';
import { sscaff } from 'sscaff';
import * as yaml from 'yaml';
import * as yargs from 'yargs';
import { HelmChartApiVersion, SynthesisFormat, ValidationConfig, readConfigSync } from '../../config';
import { ImportCustomResourceDefinition } from '../../import/crd';
import { matchImporter } from '../../import/dispatch';
import { PluginManager } from '../../plugins/_manager';
import { SynthesizedApp, crdsArePresent, deriveFileName, download, isHelmImport, isK8sImport, mkdtemp, parseImports, synthApp, validateApp } from '../../util';

const CHART_YAML_FILE = 'Chart.yaml';
const README = 'README.md';
const DEFAULT_OUTPUT_DIR = 'dist';
const DEFAULT_PLUGINS_DIR = path.join(os.homedir(), '.cdk8s', 'plugins');

const config = readConfigSync();

class Command implements yargs.CommandModule {
  public readonly command = 'synth';
  public readonly describe = 'Synthesizes Kubernetes manifests for all charts in your app.';
  public readonly aliases = ['synthesize'];

  public readonly builder = (args: yargs.Argv) => args
    .option('app', { required: true, default: config?.app, desc: 'Command to use in order to execute cdk8s app', alias: 'a' })
    .option('output', { required: false, desc: 'Output directory', alias: 'o' })
    .option('stdout', { type: 'boolean', required: false, desc: 'Write synthesized manifests to STDOUT instead of the output directory', alias: 'p' })
    .option('plugins-dir', { required: false, desc: 'Directory to store cdk8s plugins.' })
    .option('validate', { type: 'boolean', required: false, desc: 'Apply validation plugins on the resulting manifests (use --no-validate to disable)' })
    .option('validation-reports-output-file', { required: false, desc: 'File to write a JSON representation of the validation reports to' })
    .option('format', { required: false, desc: 'Synthesis format for Kubernetes manifests. The default synthesis format is plain kubernetes manifests.', type: 'string' })
    .option('chart-api-version', { required: false, desc: 'Chart API version of helm chart. The default value would be \'v2\' api version when synthesis format is helm. There is no default set when synthesis format is plain.', type: 'string' })
    .option('chart-version', { required: false, desc: 'Chart version of helm chart. This is required if synthesis format is helm.' });

  public async handler(argv: any) {

    const command = argv.app;
    const stdout = argv.stdout;
    const outdir = argv.output ?? config?.output ?? (!stdout ? DEFAULT_OUTPUT_DIR : undefined);
    const validate = argv.validate ?? true;
    const reportFile = argv.validationReportsOutputFile;
    const pluginsDir = argv.pluginsDir ?? config?.pluginsDirectory ?? DEFAULT_PLUGINS_DIR;
    const format = argv.format ?? config?.synthConfig?.format ?? SynthesisFormat.PLAIN;
    const chartVersion = argv.chartVersion ?? config?.synthConfig?.chartVersion;
    const chartApiVersion = argv.chartApiVersion ?? config?.synthConfig?.chartApiVersion ?? getDefaultChartApiVersion(format);

    if (outdir && outdir !== config?.output && stdout) {
      throw new Error('\'--output\' and \'--stdout\' are mutually exclusive. Please only use one.');
    }

    if (outdir) {
      fs.rmSync(outdir, { recursive: true, force: true });
    }

    if (format != SynthesisFormat.PLAIN && format != SynthesisFormat.HELM) {
      throw new Error(`You need to specify synthesis format either as ${SynthesisFormat.PLAIN} or ${SynthesisFormat.HELM} but received: ${format}`);
    }

    if (chartApiVersion && (chartApiVersion != HelmChartApiVersion.V1 && chartApiVersion != HelmChartApiVersion.V2)) {
      throw new Error(`You need to specify helm chart api version either as ${HelmChartApiVersion.V1} or ${HelmChartApiVersion.V2} but received: ${chartApiVersion}`);
    }

    if (format === SynthesisFormat.HELM && !chartVersion) {
      throw new Error('You need to specify \'--chart-version\' when \'--format\' is set as \'helm\'.');
    }

    if (chartVersion && !semver.valid(chartVersion)) {
      throw new Error(`The value specified for '--chart-version': ${chartVersion} does not follow SemVer-2(https://semver.org/).`);
    }

    if (stdout && format === SynthesisFormat.HELM) {
      throw new Error('Helm format synthesis does not support \'stdout\'. Please use \'outdir\' instead.');
    }

    if (format === SynthesisFormat.PLAIN && chartApiVersion) {
      throw new Error('You need to specify \'--format\' as \'helm\' when \'--chart-api-version\' is set.');
    }

    if (format === SynthesisFormat.PLAIN && chartVersion) {
      throw new Error('You need to specify \'--format\' as \'helm\' when \'--chart-version\' is set.');
    }

    if (chartApiVersion === HelmChartApiVersion.V1 && crdsArePresent(config?.imports)) {
      throw new Error(`Your application uses CRDs, which are not supported when '--chart-api-version' is set to ${HelmChartApiVersion.V1}. Please either set '--chart-api-version' to ${HelmChartApiVersion.V2}, or remove the CRDs from your cdk8s.yaml configuration file`);
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
  if (typeof(config?.validations) === 'string') {
    const content = await download(config.validations);
    return yaml.parse(content) as ValidationConfig[];
  } else {
    return config?.validations;
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
  } finally {
    fs.rmSync(tempHelmStructure, { recursive: true });
  }


  if (apiVersion === HelmChartApiVersion.V2 && crdsArePresent(config?.imports)) {
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

    return root;
  }
}

async function addCrdsToHelmChart(chartDir: string) {
  const crds = (config?.imports ?? []).filter((imprt) => (!isK8sImport(imprt) && !isHelmImport(imprt)));

  for (const crd of crds) {
    const importSpec = parseImports(crd);
    const importedCrdDef = await matchImporter(importSpec, process.argv) as ImportCustomResourceDefinition;
    const manifest = importedCrdDef.rawManifest;

    const filename = deriveFileName(importSpec.source);

    fs.outputFileSync(path.join(chartDir, 'crds', `${filename}.yaml`), manifest);
  }
}

function getDefaultChartApiVersion(synthFormat: string): string | undefined {
  return (synthFormat === SynthesisFormat.HELM) ? HelmChartApiVersion.V2: undefined;
}

module.exports = new Command();