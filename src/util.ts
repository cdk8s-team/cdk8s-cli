import { spawn, SpawnOptions } from 'child_process';
import { promises } from 'fs';
import * as http from 'http';
import * as https from 'https';
import * as os from 'os';
import * as path from 'path';
import { parse } from 'url';
import * as fs from 'fs-extra';
import * as yaml from 'yaml';
import { ValidationConfig } from './config';
import { PluginManager } from './plugins/_manager';
import { ValidationPlugin, ValidationContext, ValidationReport, Validation } from './plugins/validation';
import { SafeReviver } from './reviver';

export async function shell(program: string, args: string[] = [], options: SpawnOptions = { }): Promise<string> {
  const command = `"${program} ${args.join(' ')}" at ${path.resolve(options.cwd?.toString() ?? '.')}`;
  return new Promise((ok, ko) => {
    const child = spawn(program, args, { stdio: ['inherit', 'pipe', 'inherit'], ...options });
    const data = new Array<Buffer>();
    child.stdout?.on('data', chunk => data.push(chunk));

    child.once('error', err => ko(new Error(`command ${command} failed: ${err}`)));
    child.once('exit', code => {
      if (code === 0) {
        return ok(Buffer.concat(data).toString('utf-8'));
      } else {
        return ko(new Error(`command ${command} returned a non-zero exit code ${code}`));
      }
    });
  });
}

export async function mkdtemp(closure: (dir: string) => Promise<void>) {
  const workdir = await fs.mkdtemp(path.join(os.tmpdir(), 'cdk8s-'));
  try {
    await closure(workdir);
  } finally {
    await fs.remove(workdir);
  }
}

export async function synthApp(command: string, outdir: string, stdout: boolean, metadata: boolean): Promise<SynthesizedApp> {
  if (!stdout) {
    console.log('Synthesizing application');
  }
  await shell(command, [], {
    shell: true,
    env: {
      ...process.env,
      CDK8S_OUTDIR: outdir,
      // record metadata so that the validation report
      // has contruct aware context.
      CDK8S_RECORD_CONSTRUCT_METADATA: process.env.CDK8S_RECORD_CONSTRUCT_METADATA ?? (metadata ? 'true' : 'false'),
    },
  });

  if (!await fs.pathExists(outdir)) {
    console.error(`ERROR: synthesis failed, app expected to create "${outdir}"`);
    process.exit(1);
  }

  let found = false;
  const yamlFiles = await findManifests(outdir);
  if (yamlFiles?.length) {
    if (!stdout) {
      for (const yamlFile of yamlFiles) {
        console.log(`  - ${yamlFile}`);
      }
    }
    found = true;
  }

  if (!found) {
    console.error('No manifests synthesized');
  }

  const constructMetadata = findConstructMetadata(outdir);

  return { manifests: yamlFiles, constructMetadata };
}

export async function validateApp(
  app: SynthesizedApp,
  stdout: boolean,
  validations: ValidationConfig[],
  pluginManager: PluginManager,
  reportsFile?: string) {

  const validators: { plugin: Validation; context: ValidationContext}[] = [];

  for (const validation of validations) {
    const { plugin, context } = ValidationPlugin.load(validation, app, stdout, pluginManager);
    validators.push({ plugin, context });
  }

  const reports: ValidationReport[] = [];
  let success = true;

  console.log('Performing validations');

  for (const validator of validators) {
    await validator.plugin.validate(validator.context);
    const report = validator.context.report;
    success = success && report.success;
    reports.push(report);
  }

  console.log('Validations finished');

  // now we can print them. we don't incrementally print
  // so to not clutter the terminal in case of errors.
  for (const report of reports) {
    console.log('');
    console.log(report.toString());
    console.log('');
  }

  if (reportsFile) {

    if (fs.existsSync(reportsFile)) {
      throw new Error(`Unable to write validation reports file. Already exists: ${reportsFile}`);
    }
    // write the reports in JSON to a file
    fs.writeFileSync(reportsFile, JSON.stringify({
      reports: reports.map(r => r.toJson()),
    }, null, 2));
  }

  // exit with failure if any report resulted in a failure
  if (!success) {
    console.error('Validation failed. See above reports for details');
    process.exit(2);
  }

  console.log('Validations ended succesfully');

}

export function safeParseJson(text: string, reviver: SafeReviver): any {
  const json = JSON.parse(text);
  reviver.sanitize(json);
  return json;
}

export function safeParseYaml(text: string, reviver: SafeReviver): any[] {

  // parseAllDocuments doesnt accept a reviver
  // so we first parse normally and than transform
  // to JS using the reviver.
  const parsed = yaml.parseAllDocuments(text);
  const docs = [];
  for (const doc of parsed) {
    const json = doc.toJS();
    reviver.sanitize(json);
    docs.push(json);
  }
  return docs;
}

export async function download(url: string): Promise<string> {

  let client: typeof http | typeof https;
  const proto = parse(url).protocol;

  if (!proto || proto === 'file:') {
    return fs.readFile(url, 'utf-8');
  }

  switch (proto) {
    case 'https:':
      client = https;
      break;

    case 'http:':
      client = http;
      break;

    default:
      throw new Error(`unsupported protocol ${proto}`);
  }

  return new Promise((ok, ko) => {
    const req = client.get(url, res => {
      switch (res.statusCode) {
        case 200: {
          const data = new Array<Buffer>();
          res.on('data', chunk => data.push(chunk));
          res.once('end', () => ok(Buffer.concat(data).toString('utf-8')));
          res.once('error', ko);
          break;
        }

        case 301:
        case 302: {
          if (res.headers.location) {
            ok(download(res.headers.location));
          }
          break;
        }

        default: {
          ko(new Error(`${res.statusMessage}: ${url}`));
        }
      }
    });

    req.once('error', ko);
    req.end();
  });
}

export async function findManifests(directory: string): Promise<string[]> {
  // Ensure path is valid
  try {
    await promises.access(directory);
  } catch {
    return [];
  }

  // Read Path contents
  const entries = await promises.readdir(directory, { withFileTypes: true });

  // Get files within the current directory
  const files = entries
    .filter(file => (!file.isDirectory() && file.name.endsWith('.yaml')))
    .map(file => (directory + '/' + file.name));

  // Get sub-folders within the current folder
  const folders = entries.filter(folder => folder.isDirectory());

  for (const folder of folders) {
    files.push(...await findManifests(`${directory}/${folder.name}`));
  }

  return files;
}

export function findConstructMetadata(directory: string): string | undefined {
  // this file is optionally created during synthesis
  const p = path.join(directory, 'construct-metadata.json');
  return fs.existsSync(p) ? p : undefined;
}

/**
 * Result of synthesizing an application.
 */
export interface SynthesizedApp {

  /**
   * The list of manifests produced by the app.
   */
  readonly manifests: readonly string[];

  /**
   * The construct metadata file (if exists).
   */
  readonly constructMetadata?: string;
}