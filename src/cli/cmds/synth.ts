import * as path from 'path';
import * as fs from 'fs-extra';
import * as yaml from 'yaml';
import * as yargs from 'yargs';
import { readConfigSync, ValidationConfig } from '../../config';
import { PluginManager } from '../../plugins/_manager';
import { synthApp, mkdtemp, download, validateManifests } from '../../util';

const config = readConfigSync();

class Command implements yargs.CommandModule {
  public readonly command = 'synth';
  public readonly describe = 'Synthesizes Kubernetes manifests for all charts in your app.';
  public readonly aliases = ['synthesize'];

  public readonly builder = (args: yargs.Argv) => args
    .option('app', { default: config.app, required: true, desc: 'Command to use in order to execute cdk8s app', alias: 'a' })
    .option('output', { default: config.output, required: false, desc: 'Output directory', alias: 'o' })
    .option('plugins-dir', { default: config.pluginsDirectory, required: false, desc: 'Directory to store cdk8s plugins.' })
    .option('stdout', { type: 'boolean', required: false, desc: 'Write synthesized manifests to STDOUT instead of the output directory', alias: 'p' })
    .option('validate', { type: 'boolean', default: true, required: false, desc: 'Apply validation plugins on the resulting manifests (use --no-validate to disable)' });
  ;

  public async handler(argv: any) {

    const command = argv.app;
    const outdir = argv.output;
    const stdout = argv.stdout;
    const validate = argv.validate;
    const pluginsDir = argv.pluginsDir;

    if (outdir !== config.output && stdout) {
      throw new Error('\'--output\' and \'--stdout\' are mutually exclusive. Please only use one.');
    }

    await fs.remove(outdir);

    if (stdout) {
      await mkdtemp(async tempDir => {
        const manifests = await synthApp(command, tempDir);
        for (const f of manifests) {
          fs.createReadStream(path.join(tempDir, f)).pipe(process.stdout);
        }
      });
    } else {
      const manifests = await synthApp(command, outdir);
      if (validate) {
        const validations = await fetchValidations();
        if (validations) {
          const pluginManager = new PluginManager(pluginsDir);
          await validateManifests(manifests, validations, pluginManager);
        }
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


module.exports = new Command();
