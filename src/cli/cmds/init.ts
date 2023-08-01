import * as path from 'path';
import * as fs from 'fs-extra';
import * as pacmak from 'jsii-pacmak';
import * as pacmakv from 'jsii-pacmak/lib/targets/version-utils';
import { sscaff } from 'sscaff';
import * as yargs from 'yargs';

const pkgroot = path.join(__dirname, '..', '..', '..');

const pkg = fs.readJsonSync(path.join(pkgroot, 'package.json'));
const constructsVersion = pkg.dependencies.constructs.replace('^', '');

const templatesDir = path.join(pkgroot, 'templates');
const availableTemplates = fs.readdirSync(templatesDir).filter(x => !x.startsWith('.'));

class Command implements yargs.CommandModule {
  public readonly command = 'init TYPE';
  public readonly describe = 'Create a new cdk8s project from a template.';
  public readonly builder = (args: yargs.Argv) => args
    .positional('TYPE', { demandOption: true, desc: 'Project type' })
    .showHelpOnFail(false)
    .choices('TYPE', availableTemplates);

  public async handler(argv: any) {
    if (fs.readdirSync('.').filter(f => !f.startsWith('.')).length > 0) {
      console.error('Cannot initialize a project in a non-empty directory');
      process.exit(1);
    }

    console.error(`Initializing a project from the ${argv.type} template`);
    const templatePath = path.join(templatesDir, argv.type);
    const deps: any = await determineDeps();

    try {
      await sscaff(templatePath, '.', deps);
    } catch (er) {
      const e = er as any;
      throw new Error(`error during project initialization: ${e.stack}\nSTDOUT:\n${e.stdout?.toString()}\nSTDERR:\n${e.stderr?.toString()}`);
    }
  }
}

async function determineDeps(): Promise<Deps> {
  const cdk8s = new ModuleVersion('cdk8s', { jsii: true });
  const cdk8sCli = new ModuleVersion('cdk8s-cli');
  const jsii = new ModuleVersion('jsii-pacmak');

  const cdk8sTarball = process.env.CDK8S_TARBALL;
  const cdk8sTarballEscaped = cdk8sTarball ? (cdk8sTarball.replace(/\\/g, '\\\\')) : undefined;

  return {
    pypi_cdk8s: cdk8s.pypiDependency,
    mvn_cdk8s: cdk8s.mavenDependency,
    cdk8s_core_version: cdk8s.version,
    constructs_version: constructsVersion,
    jsii_version: jsii.version,
    cdk8s_cli_spec: cdk8sTarballEscaped ?? `^${cdk8sCli.version}`,
  };
}

interface Deps {
  cdk8s_cli_spec: string;
  pypi_cdk8s: string;
  mvn_cdk8s: string;
  cdk8s_core_version: string;
  constructs_version: string;
  jsii_version: string;
}

class ModuleVersion {
  public readonly pypiVersion: string;
  public readonly npmVersion: string;
  public readonly mavenVersion: string;
  public readonly version: string;

  private readonly jsii: boolean;

  constructor(private readonly moduleName: string, options: { jsii?: boolean } = { }) {
    this.version = this.resolveVersion(moduleName);
    this.npmVersion = this.version;
    this.pypiVersion = pacmakv.toReleaseVersion(this.version, pacmak.TargetName.PYTHON);
    this.mavenVersion = pacmakv.toReleaseVersion(this.version, pacmak.TargetName.JAVA);
    this.jsii = options.jsii ?? false;
  }

  public get npmTarballFile() {
    if (this.jsii) {
      return `${this.moduleName}@${this.version}.jsii.tgz`;
    } else {
      return `${this.moduleName}-v${this.version}.tgz`;
    }
  }

  public get pypiWheelFile() {
    const [major, minor, patch, pre] = this.pypiVersion.split('.');
    return `${this.moduleName.replace(/-/g, '_')}-${major}.${minor}.${patch}${pre ?? ''}-py3-none-any.whl`;
  }

  public get javaJarFile() {
    return `org/cdk8s/${this.moduleName}/${this.mavenVersion}/${this.moduleName}-${this.mavenVersion}.jar`;
  }

  public get npmDependency() {
    return `${this.moduleName}@^${this.npmVersion}`;
  }

  public get pypiDependency() {
    return `${this.moduleName}~=${this.pypiVersion}`;
  }

  public get mavenDependency() {
    return this.mavenVersion;
  }

  private resolveVersion(module: string): string {
    if (module === 'cdk8s-cli') {
      module = '../../../';
    }

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require(`${module}/package.json`).version;
  }
}


module.exports = new Command();
