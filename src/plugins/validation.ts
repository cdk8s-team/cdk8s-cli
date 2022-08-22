import { table } from 'table';
import { ValidationConfig } from '../config';
import { PluginManager } from './_manager';

/**
 * Properties for `ValidationContext`.
 */
export interface ValidationContextProps {

  /**
   * The list of manifests to validate.
   */
  readonly manifests: string[];

  /**
   * The NodeJS package name of the plugin running the validation.
   */
  readonly pkg: string;

  /**
   * The version of the NodeJS package that runs the validation.
   */
  readonly version: string;

}

/**
 * Context available to plugins during validation.
 */
export class ValidationContext {

  private readonly _report: ValidationReport;

  constructor(

    /**
     * The list of manifests to validate.
     */
    public readonly manifests: string[],

    /**
     * The NodeJS package name of the plugin running the validation.
     */
    public readonly pkg: string,

    /**
     * The version of the NodeJS package that runs the validation.
     */
    public readonly version: string,

    /**
     * Construct metadata of resources in the application.
     */
    public readonly metadata: Map<string, ConstructAwareMetadata>) {

    this._report = new ValidationReport(this.pkg, this.version, this.metadata);
  }

  /**
   * The report emitted by the validation. Plugins should interact with this
   * object to generate the report.
   */
  public get report(): ValidationReport {
    return this._report;
  }
}

/**
 * The contract between cdk8s and third-parties looking to implement validation plugins.
 */
export interface Validation {

  /**
   * Run the validation logic.
   *
   * - Use `context.manifests` to retrieve the list of manifests to validate.
   * - Use `context.report` to access and build the resulting report.
   *
   * Make sure to call `context.report.submit()` before returning, otherwise the validation is considered incomplete.
   */
  validate(context: ValidationContext): Promise<void>;

}

/**
 * Violation produced by the validation plugin.
 */
export interface ValidationViolation {

  /**
   * Violating resource name.
   */
  readonly resourceName: string;

  /**
   * Violation message.
   */
  readonly message: string;

  /**
   * Violation severity.
   */
  readonly severity: string;

  /**
   * Path to the manifest containing the resource.
   */
  readonly manifestPath: string;

}

/**
 * Validation violation augmented with construct aware data.
 */
export interface ConstructAwareValidationViolation extends ValidationViolation {

  /**
   * The construct path as defined in the application.
   */
  readonly constructPath?: string;

}

/**
 * Construct related metadata on resources.
 */
export interface ConstructAwareMetadata {

  /**
   * The path of the construct in the application.
   */
  readonly path: string;

}

/**
 * The report emitted by the plugin after evaluation.
 */
export class ValidationReport {

  private readonly violations: ConstructAwareValidationViolation[] = [];

  private _status?: 'success' | 'failure';

  constructor(
    private readonly pkg: string,
    private readonly version: string,
    private readonly metadata: Map<string, ConstructAwareMetadata>) {}

  /**
   * Add a violation to the report.
   */
  public addViolation(violation: ValidationViolation) {
    if (this._status) {
      throw new Error('Violations cannot be added to report after its submitted');
    }
    const constructPath = this.metadata.get(violation.resourceName)?.path;
    this.violations.push({
      ...violation,
      constructPath,
    });
  }

  /**
   * Submit the report with a passing status.
   */
  public pass() {
    this._status = 'success';
  }

  /**
   * Submit the report with failure status.
   */
  public fail() {
    this._status = 'failure';
  }

  /**
   * Whether or not the report was successfull.
   */
  public get success(): boolean {
    if (!this._status) {
      throw new Error('Unable to determine report result: Report is incomplete. Call \'report.pass()\' or \'report.fail()\' to set the status.');
    }
    return this._status === 'success';
  }

  /**
   * Transform the report to a well formatted table string.
   */
  public toTable() {
    return table([
      ['Resource', 'Message', 'Severity', 'Manifest', 'Construct'],
      ...this.violations.map(v => [v.resourceName, v.message, v.severity, v.manifestPath, v.constructPath ?? 'N/A']),
    ], {
      header: { content: `Validation Report | ${this.pkg} (v${this.version})` },
    });
  }

}

/**
 * Utiliy class for loading validation plugins.
 */
export class ValidationPlugin {

  /**
   * Load the validation plugin and create the necessary context for its execution.
   */
  public static load(
    validation: ValidationConfig,
    manifests: string[],
    pluginManager: PluginManager): { plugin: Validation; context: ValidationContext } {

    const plugin = pluginManager.load({
      pkg: validation.package,
      version: validation.version,
      class: validation.class,
      properties: validation.properties,
    });

    if (typeof plugin.instance.validate !== 'function') {
      throw new Error(`Instance of class ${validation.class} is not a validation plugin. Are you sure you specified the correct class?`);
    }

    // TODO: parse from manifests
    const metadata = new Map();
    const context = new ValidationContext(manifests, plugin.pkg, plugin.version, metadata);
    return { plugin: plugin.instance as Validation, context };

  }

}
