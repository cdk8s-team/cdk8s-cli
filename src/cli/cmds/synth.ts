import { randomUUID } from 'crypto';
import * as fs from 'fs';
import path from 'path';
import * as semver from 'semver';
import { sscaff } from 'sscaff';
import * as yaml from 'yaml';
import * as yargs from 'yargs';
import { HelmChartApiVersion, ImportSpec, SynthesisFormat, ValidationConfig, readConfigSync } from '../../config';
import { matchCrdsDevUrl } from '../../import/crds-dev';
import { PluginManager } from '../../plugins/_manager';
import { SynthesizedApp, download, mkdtemp, synthApp, validateApp } from '../../util';

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
      default: config.format,
      required: false,
      desc: 'Synthesis format for Kubernetes manifests.',
      choices: ['cdk8s', 'helm'],
      type: 'string',
    })
    .option('chart-api-version', { default: config.helmSynthConfig?.chartApiVersion, required: false, desc: 'Chart API version of helm chart.' })
    .option('chart-version', { required: false, desc: 'Chart version of helm chart.' });
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

    if (format === SynthesisFormat.HELM && !chartVersion) {
      throw new Error('You need to specify the \'--chart-version\' when the \'--format\' is set as helm.');
    }

    if (format === SynthesisFormat.CDK8s && (chartApiVersion || chartVersion || (chartApiVersion && chartVersion))) {
      throw new Error('You need to specify \'--format\' as helm when \'--chart-version\' and/or \'--chart-api-version\' is set.');
    }

    if (chartVersion && !semver.valid(chartVersion)) {
      throw new Error(`The value specified for '--chart-version': ${chartVersion} does not follow SemVer-2(https://semver.org/).`);
    }

    if (stdout && format === SynthesisFormat.HELM) {
      throw new Error('Helm format synthesis does not support \'stdout\'. Please use \'outdir\' instead.');
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
        await helmSynthesis(chartApiVersion, chartVersion, outdir);
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


async function helmSynthesis(apiVersion: string, chartVersion: string, outdir: string) {
  const TEMPLATE_WITHOUT_CRDS = 'helm-chart-without-crds';
  const TEMPLATE_WITH_CRDS = 'helm-chart-with-crds';

  const pkgroot = path.join(__dirname, '..', '..', '..');
  const templatesDir = path.join(pkgroot, 'templates');

  let templatePath: string;

  const substituteValues = {
    apiVersion: apiVersion,
    version: chartVersion,
    app: path.basename(path.resolve()),
  };

  // Helm chart structure without CRDs support
  if (apiVersion === HelmChartApiVersion.V1) {

    if (config.imports && config.imports.length > 0) {
      throw new Error(`CRDs are not supported in cdk8s for --chart-api-version: ${apiVersion}'. Please use ${HelmChartApiVersion.V2} for using CRDs.`);
    }

    templatePath = path.join(templatesDir, TEMPLATE_WITHOUT_CRDS);
  } else {
    templatePath = path.join(templatesDir, TEMPLATE_WITH_CRDS);
  }

  try {
    await sscaff(templatePath, outdir, substituteValues);
  } catch (error) {
    throw new Error(`An error occurred during Helm chart creation: ${error}`);
  }

  await addCrdsToHelmChart(outdir);
}

async function addCrdsToHelmChart(chartDir: string) {
  try {
    const CRD_KIND = 'CustomResourceDefinition';
    const manifestFiles = await downloadCrds();

    for (const file of manifestFiles) {
      const parsed = yaml.parseAllDocuments(file);

      let filename;
      for (const doc of parsed) {
        const parsedToJson = doc.toJSON();
        if (
          parsedToJson.kind === CRD_KIND &&
          parsedToJson.metadata &&
          parsedToJson.metadata.name
        ) {
          filename = parsedToJson.metadata.name;
        }
      }

      if (!filename) {
        filename = `CRD-${randomUUID}`;
      }

      console.error('This is where we are - 1');

      fs.writeFileSync(path.join(chartDir, 'crds', filename), file);

      console.error('This is where we are - 2');
    }
  } catch (er) {
    const e = er as any;
    throw new Error(`error during project initialization: ${e.stack}\nSTDOUT:\n${e.stdout?.toString()}\nSTDERR:\n${e.stderr?.toString()}`);
  }
}

async function downloadCrds(): Promise<string[]> {
  const manifestFiles = [];

  if (config.imports) {
    for (const crd of config.imports) {
      let importSpec;
      try {
        importSpec = parseImports(crd);
      } catch (error) {
        throw new Error(`I caught you: ${error}`);
      }

      const crdsDevUrl = matchCrdsDevUrl(importSpec.source);

      let manifest;

      if (crdsDevUrl) {
        manifest = await download(crdsDevUrl);
      } else {
        manifest = await download(importSpec.source);
      }

      manifestFiles.push(manifest);
    }
  }

  return manifestFiles;
}

export function parseImports(spec: string): ImportSpec {
  const splitImport = spec.split(':=');

  // k8s@x.y.z
  // crd.yaml
  // url.com/crd.yaml
  if (splitImport.length === 1) {
    return {
      source: spec,
    };
  }

  // crd=crd.yaml
  // crd=url.com/crd.yaml
  if (splitImport.length === 2) {
    return {
      moduleNamePrefix: splitImport[0],
      source: splitImport[1],
    };
  }

  throw new Error('Unable to parse import specification. Syntax is [NAME:=]SPEC');
}

module.exports = new Command();
