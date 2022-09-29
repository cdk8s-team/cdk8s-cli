import * as fs from 'fs';
import * as yaml from 'yaml';
import * as yargs from 'yargs';
import { readConfigSync, ValidationConfig } from '../../config';
import { PluginManager } from '../../plugins/_manager';
import { synthApp, mkdtemp, download, validateApp } from '../../util';

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
    .option('validate', { type: 'boolean', default: true, required: false, desc: 'Apply validation plugins on the resulting manifests (use --no-validate to disable)' });
  ;

  public async handler(argv: any) {

    const command = argv.app;
    const outdir = argv.output;
    const stdout = argv.stdout;
    const validate = argv.validate;
    const pluginsDir = argv.pluginsDir;

    if (outdir && outdir !== config.output && stdout) {
      throw new Error('\'--output\' and \'--stdout\' are mutually exclusive. Please only use one.');
    }

    if (outdir) {
      fs.rmSync(outdir, { recursive: true, force: true });
    }

    const validations = validate ? await fetchValidations() : undefined;

    if (stdout) {
      await mkdtemp(async tempDir => {
        const app = await synthApp(command, tempDir, stdout);
        for (const f of app.manifests) {
          fs.createReadStream(f).pipe(process.stdout);
        }
        if (validations) {
          const pluginManager = new PluginManager(pluginsDir);
          await validateApp(app, stdout, validations, pluginManager);
        }
      });
    } else {
      const manifests = await synthApp(command, outdir, stdout);
      if (validations) {
        const pluginManager = new PluginManager(pluginsDir);
        await validateApp(manifests, stdout, validations, pluginManager);
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
