import * as child from 'child_process';
import * as os from 'os';
import * as path from 'path';
import * as url from 'url';
import * as fs from 'fs-extra';

const MODULE_NOT_FOUND_ERROR_CODE = 'MODULE_NOT_FOUND'; // TODO is there a known constant we can use here?
const MODULE_VERSION_MISMATCH_ERROR_CODE = 'MODULE_VERSION_MISMATCH';

/**
 * Error indicating a module was found but with an unexpected version.
 */
export class ModuleVersionMismatchError extends Error {

  public readonly code: string = MODULE_VERSION_MISMATCH_ERROR_CODE;

  constructor(pkg: string, expected: string, actual: string) {
    super(`Version mismatch for package ${pkg}. Found ${actual} but requested ${expected}`);
  }
}

export interface Plugin {

  readonly instance: any;
  readonly class: string;
  readonly module: any;
  readonly pkg: string;
  readonly version: string;
  readonly path: string;

}

export interface Package {

  readonly module: any;
  readonly pkg: string;
  readonly version: string;
  readonly path: string;

}

export interface PluginManagerLoadOptions {
  readonly pkg: string;
  readonly version: string;
  readonly class: string;
  readonly installEnv?: { [key: string]: any };
  readonly properties?: { [key: string]: any };
}

export class PluginManager {

  private readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  public load(options: PluginManagerLoadOptions): Plugin {

    const pkg = this.loadPackage(options.pkg, options.version, options.installEnv ?? {});

    const clazz = pkg.module[options.class];
    if (!clazz) {
      throw new Error(`Unable to locate class '${options.class}' in package '${options.pkg}@${options.version}'. Are you sure you exported it?`);
    }

    return { instance: new clazz(options.properties ?? {}), class: options.class, ...pkg };
  }

  private loadPackage(pkg: string, version: string, installEnv: { [key: string]: any }): Package {

    if (isNaN(parseInt(version.charAt(0)))) {
      // forbid version ranges because otherwise we need to do semver comparison and introduce a dependency.
      // also ranges make it easier to get left behind since it might give the false impression we will be installing
      // the latest version (which we will not because it would mean contacting NPM on every synth)
      throw new Error(`Unsupported version spec for package ${pkg}: ${version}. Cannot be a range.`);
    }

    const proto = url.parse(pkg).protocol;

    if (proto) {
      // urls are not supported because they don't provide a name with which we can 'require' the module.
      // if needed, we can make the loader smarter and enable this, but not for now.
      throw new Error(`Unsupported package reference: ${pkg}. Can either be an NPM package name, or a local path to a directory`);
    }

    const local = path.isAbsolute(pkg)
      // relative paths must start with '.' because otherise they
      // are indistinguishable from npm package names.
      || pkg.startsWith(`.${path.sep}`);

    // local plugins are loaded directly, npm packages are loaded
    // from the plugins directory.
    const modulePath = local ? path.resolve(process.cwd(), pkg) : this.pluginDir(pkg, version);

    try {
      return this.require(modulePath, version);
    } catch (e: any) {

      if (![MODULE_NOT_FOUND_ERROR_CODE, MODULE_VERSION_MISMATCH_ERROR_CODE].includes(e.code)) {
        // some unexpected error
        throw e;
      }

      if (local) {
        // if a local plugin is missing, nothing we can do about it
        throw e;
      }

      // otherwise, we install from npm and re-require.
      this.installPackage(pkg, version, installEnv);
      return this.require(modulePath, version);
    }

  }

  private installPackage(pkg: string, version: string, env: { [key: string]: any }) {

    const pluginDir = path.join(this.dir, pkg, version);
    fs.mkdirpSync(pluginDir);

    const command = [
      'npm',
      'install', `${pkg}@${version}`,
      '--no-save',
      '--prefix', pluginDir,
    ].join(' ');

    const finalEnv = { ...process.env };
    for (const [key, value] of Object.entries(env)) {
      finalEnv[key] = typeof value === 'string' ? key : JSON.stringify(value);
    }
    child.execSync(command, { stdio: ['ignore', 'pipe', 'pipe'], env: finalEnv });
  }

  private require(pkg: string, version: string): Package {

    const modulePath = require.resolve(pkg);

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const module = require(modulePath);

    const manifestPath = this.findPackageJson(modulePath, []);
    const manifest = fs.readJsonSync(manifestPath);
    if (manifest.version !== version) {
      throw new ModuleVersionMismatchError(pkg, manifest.version, version);
    }

    return { version: manifest.version, pkg: manifest.name, path: modulePath, module };
  }

  private pluginDir(pkg: string, version: string) {
    return path.join(this.dir, pkg, version, 'node_modules', pkg);
  }

  private findPackageJson(fdp: string, searched: string[]): string {

    const packageJsonPath = path.join(fdp, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      return packageJsonPath;
    }

    if (path.dirname(fdp) === fdp) {
      throw new Error(`Unable to locate package.json file. Searched in: ${searched.join(os.EOL)}`);
    }

    return this.findPackageJson(path.dirname(fdp), [...searched, packageJsonPath]);
  }


}