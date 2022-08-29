import { table } from 'table';
import { ValidationConfig } from '../config';
import { PluginManager } from './_manager';

/**
 * Context available to plugins during validation.
 */
export class ValidationContext {

  private readonly _report: ValidationReport;
  private readonly _logger: ValidationLogger;

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
     *
     * @default - No metadata. This means construct aware metadata will not be available in the report.
     */
    public readonly metadata?: {[key: string]: ConstructAwareMetadata},

    /**
     * Whether or not the synth command was executed with --stdout.
     *
     * @default false
     */
    public readonly stdout?: boolean) {

    this._report = new ValidationReport(this.pkg, this.version, this.metadata ?? {}, stdout ?? false);
    this._logger = new ValidationLogger();
  }

  /**
   * Report emitted by the validation.
   *
   * Plugins should interact with this object to generate the report.
   */
  public get report(): ValidationReport {
    return this._report;
  }

  /**
   * Logger for the validation.
   *
   * Plugins should interact with this object to log messages during validation.
   */
  public get logger(): ValidationLogger {
    return this._logger;
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
   * Make sure to call `context.report.pass()` or `context.report.fail()` before returning, otherwise the validation is considered incomplete.
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
   * Path to the manifest containing the resource.
   */
  readonly manifestPath: string;

}

/**
 * Validation violation augmented with construct aware data.
 */
interface ConstructAwareValidationViolation extends ValidationViolation {

  /**
   * The construct path as defined in the application.
   */
  readonly constructPath?: string;

}

/**
 * Construct related metadata on resources.
 */
interface ConstructAwareMetadata {

  /**
   * The path of the construct in the application.
   */
  readonly path: string;

}

/**
 * Logger. Use this instead of `console.log`.
 */
export class ValidationLogger {

  /**
   * Log a message.
   */
  public log(message: string) {
    console.log(message);
  }
}

/**
 * The report emitted by the plugin after evaluation.
 */
export class ValidationReport {

  private readonly violations: ConstructAwareValidationViolation[] = [];

  private readonly header: string;

  private _status?: 'success' | 'failure';

  constructor(
    private readonly pkg: string,
    private readonly version: string,
    private readonly metadata: {[key: string]: ConstructAwareMetadata},
    private readonly stdout: boolean) {
    this.header = `Validation Report | ${this.pkg} (v${this.version})`;
  }

  /**
   * Add a violation to the report.
   */
  public addViolation(violation: ValidationViolation) {
    if (this._status) {
      throw new Error('Violations cannot be added to report after its submitted');
    }
    const constructPath = this.metadata[violation.resourceName]?.path;
    this.violations.push({
      ...violation,
      constructPath,
    });
  }

  public submit(status: 'success' | 'failure') {
    this._status = status;
  }

  /**
   * Whether or not the report was successfull.
   */
  public get success(): boolean {
    if (!this._status) {
      throw new Error('Unable to determine report status: Report is incomplete. Call \'report.submit\'');
    }
    return this._status === 'success';
  }

  /**
   * Transform the report to a well formatted table string.
   */
  public toTable(): string {

    const json = this.toJson();

    return table([
      ['Resource', 'Message', 'Manifest', 'Construct'],
      ...json.violations.map(v => [v.resourceName, v.message, v.manifestPath, v.constructPath]),
    ], {
      header: { content: json.header },
    });
  }

  /**
   * Transform the report into a JSON object.
   */
  public toJson(): { header: string; violations: ConstructAwareValidationViolation[]; status: 'success' | 'failure'} {
    if (!this._status) {
      throw new Error('Unable to determine report result: Report is incomplete. Call \'report.submit\'');
    }
    return {
      header: `${this._status} | ${this.header}`,
      violations: this.violations.map(v => ({
        resourceName: v.resourceName,
        message: v.message,
        manifestPath: this.stdout ? 'STDOUT' : v.manifestPath,
        constructPath: v.constructPath ?? 'N/A',
      })),
      status: this._status,
    };
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
    stdout: boolean,
    pluginManager: PluginManager): { plugin: Validation; context: ValidationContext } {

    const plugin = pluginManager.load({
      pkg: validation.package,
      version: validation.version,
      class: validation.class,
      properties: validation.properties,
      installEnv: validation.installEnv,
    });

    if (typeof plugin.instance.validate !== 'function') {
      throw new Error(`Instance of class ${validation.class} is not a validation plugin. Are you sure you specified the correct class?`);
    }

    // TODO: parse from manifests
    const metadata = {};
    const context = new ValidationContext(manifests, plugin.pkg, plugin.version, metadata, stdout);
    return { plugin: plugin.instance as Validation, context };

  }

}
