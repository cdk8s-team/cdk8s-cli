import { spawn, SpawnOptions } from 'child_process';
import * as http from 'http';
import * as https from 'https';
import * as os from 'os';
import * as path from 'path';
import { parse } from 'url';
import * as fs from 'fs-extra';
import * as yaml from 'yaml';
import { SafeReviver } from './reviver';

export async function shell(program: string, args: string[] = [], options: SpawnOptions = { }): Promise<string> {
  const command = `"${program} ${args.join(' ')}" at ${path.resolve(options.cwd ?? '.')}`;
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

export async function synthApp(command: string, outdir: string) {
  await shell(command, [], {
    shell: true,
    env: {
      ...process.env,
      CDK8S_OUTDIR: outdir,
    },
  });

  if (!await fs.pathExists(outdir)) {
    console.error(`ERROR: synthesis failed, app expected to create "${outdir}"`);
    process.exit(1);
  }

  let found = false;
  for (const file of await fs.readdir(outdir)) {
    if (file.endsWith('.k8s.yaml')) {
      console.log(`${outdir}/${file}`);
      found = true;
    }
  }

  if (!found) {
    console.error('No manifests synthesized');
  }
}

export function safeParseJson(text: string, reviver: SafeReviver): any {
  return JSON.parse(text, (key: unknown, value: unknown) => reviver.revive(key, value));
}

export function safeParseYaml(text: string, reviver: SafeReviver): any[] {

  // parseAllDocuments doesnt accept a reviver
  // so we first parse normally and than transform
  // to JS using the reviver.
  const parsed = yaml.parseAllDocuments(text);
  const docs = [];
  for (const doc of parsed) {
    docs.push(doc.toJS({ reviver: (key: unknown, value: unknown) => reviver.revive(key, value) }));
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
          throw new Error(`${res.statusMessage}: ${url}`);
        }
      }
    });

    req.once('error', ko);
    req.end();
  });
}
