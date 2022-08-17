import * as child from 'child_process';
import * as path from 'path';
import * as fs from 'fs-extra';
import { table } from 'table';
import { ValidationConfig } from '../config';

const VALIDATION_SYMBOL = Symbol.for('cdk8s-cli.Validation');

export abstract class Validation {

  public static load(config: ValidationConfig): Validation {

    const module = this.loadModule(config.package, config.version);

    const clazz = module[config.class];
    if (!clazz) {
      throw new Error(`Unable to locate class ${config.class} in package ${config.package}. Are you sure you exported it?`);
    }

    const instance = new clazz(config.properties);

    if (this.isValidation(instance)) {
      return instance;
    }

    throw new Error(`Instance of class ${clazz} is not a validation plugin. Are you sure you specified the correct class?`);
  }

  private static isValidation(x: any): x is Validation {
    return VALIDATION_SYMBOL in x;
  }

  private static loadModule(pkg: string, version: string): any {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const module = require(pkg);
      const modulePath = require.resolve(pkg);
      const manifestPath = this.findPackageJson(modulePath);

      if (!manifestPath) {
        throw new Error(`Unable to locate package manifest for ${pkg}`);
      }

      const manifest = fs.readJsonSync(manifestPath);

      // TODO - what if given a version range?
      if (manifest.version === version) {
        return module;
      }

      this.installPackage(pkg, version);
      return this.loadModule(pkg, version);

    } catch (e) {
      this.installPackage(pkg, version);
      return this.loadModule(pkg, version);
    }
  }

  private static installPackage(pkg: string, version: string) {
    const myPackageJson = this.findPackageJson(__dirname);
    if (!myPackageJson) {
      // should never happen...
      throw new Error('Unable to locate package manifest for cdk8s-cli');
    }
    const prefix = path.dirname(myPackageJson);
    const command = [
      'npm',
      'install', `${pkg}@${version}`,
      '--no-save',
      '--prefix', prefix,
    ].join(' ');
    child.execSync(command);
  }

  private static findPackageJson(fdp: string): string | undefined {

    const packageJsonPath = path.join(fdp, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      return packageJsonPath;
    }

    if (path.dirname(fdp) === fdp) {
      return undefined;
    }

    return this.findPackageJson(path.dirname(fdp));
  }

  constructor() {
    Object.defineProperty(this, VALIDATION_SYMBOL, { value: true });
  }

  abstract validate(manifests: string[]): ValidationReport;

}

export enum ViolationSeverity {
  WARNING = 'WARNING',
  ERROR = 'ERROR'
}

export interface Violation {

  readonly resourceName: string;
  readonly message: string;
  readonly severity: ViolationSeverity;
  readonly manifestPath: string;

}

export interface ValidationReportProps {

  readonly success: boolean;
  readonly violations: Violation[];
  readonly package: string;
  readonly version: string;

}

export class ValidationReport {

  constructor(private readonly props: ValidationReportProps) {}

  public toTable() {
    return table([
      ['Resource', 'Message', 'Severity', 'Manifest'],
      ...this.props.violations.map(v => [v.resourceName, v.manifestPath, v.severity, v.manifestPath]),
    ], { header: { content: `Validation Report | ${this.props.package} (v${this.props.version})` } });
  }

  public get success(): boolean {
    return this.props.success;
  }

}
