import { readdirSync } from 'fs';
import * as path from 'path';
import * as fs from 'fs-extra';
import * as yaml from 'yaml';
import { Config, HelmChartApiVersion, SynthesisFormat, ValidationConfig } from '../../src/config';
import { crdsArePresent, findConstructMetadata, mkdtemp } from '../../src/util';

const imports: string[] = [];

beforeEach(() => {
  // resetting so that every test can use a different config file,
  // which is read on module load.
  jest.resetModules();
  // Emptying the imports every time a test is run
  imports.length = 0;
});

test('synth with both --stdout and --output throws exception', () => {

  const cmd = requireSynth();

  // eslint-disable-next-line
  expect(cmd.handler({ app: 'cdk8s', output: 'test', stdout: true })).rejects.toEqual(new Error('\'--output\' and \'--stdout\' are mutually exclusive. Please only use one.'));
});

describe('validations', () => {

  test('synth with inline validations', async () => {

    const validations: ValidationConfig[] = [{
      package: path.join(__dirname, '__resources__', 'validation-plugin'),
      version: '0.0.0',
      class: 'MockValidation',
      properties: {
        fail: false,
      },
    }];

    await synth({ validations });
  });

  test('synth with local validations file', async () => {

    const validationsFile = './validations.yaml';

    const validations: ValidationConfig[] = [{
      package: path.join(__dirname, '__resources__', 'validation-plugin'),
      version: '0.0.0',
      class: 'MockValidation',
      properties: {
        fail: false,
      },
    }];

    await synth({
      validations: validationsFile,
      preSynth: async (dir: string) => {
        fs.writeFileSync(path.join(dir, validationsFile), yaml.stringify(validations));
      },
    });

  });

  test('synth with validation plugin specified as relative path', async () => {

    const validations: ValidationConfig[] = [{
      package: './validation-plugin',
      version: '0.0.0',
      class: 'MockValidation',
      properties: {
        fail: false,
      },
    }];

    await synth({
      validations,
      preSynth: async (dir: string) => {
        fs.copySync(path.join(__dirname, '__resources__', 'validation-plugin'), path.join(dir, 'validation-plugin'));
      },
    });

  });

  test('synth with validation plugin specified as absolute path', async () => {

    const validations: ValidationConfig[] = [{
      package: path.join(__dirname, '__resources__', 'validation-plugin'),
      version: '0.0.0',
      class: 'MockValidation',
      properties: {
        fail: false,
      },
    }];

    await synth({ validations });

  });

  test('synth fails when validation plugin specified as url', async () => {

    const validations: ValidationConfig[] = [{
      package: 'http://path/to/plugin',
      version: '0.0.0',
      class: 'MockValidation',
      properties: {
        fail: false,
      },
    }];

    await expect(() => synth({ validations })).rejects.toThrow(/Unsupported package reference/);

  });

  test('synth fails when validation reports failure', async () => {

    const validations: ValidationConfig[] = [{
      package: path.join(__dirname, '__resources__', 'validation-plugin'),
      version: '0.0.0',
      class: 'MockValidation',
      properties: {
        fail: true,
      },
    }];

    await expect(() => synth({ validations })).rejects.toThrow('Code: 2');

  });

  test('synth skips validation if no-validate is passed', async () => {

    const validations: ValidationConfig[] = [{
      package: path.join(__dirname, '__resources__', 'validation-plugin'),
      version: '0.0.0',
      class: 'MockValidation',
      properties: {
        fail: true,
      },
    }];

    await synth({ validations, validate: false });
  });

  test('synth fails when validations specify non existing local plugin', async () => {

    const plugin = path.join(__dirname, '__resources__', 'non-existing');
    const validations: ValidationConfig[] = [{
      package: plugin,
      version: '0.0.0',
      class: 'MockValidation',
      properties: {
        fail: true,
      },
    }];

    await expect(() => synth({ validations })).rejects.toThrow(/Cannot find module/);

  });

  test('synth fails when validations specify plugin version range', async () => {

    const validations: ValidationConfig[] = [{
      package: path.join(__dirname, '__resources__', 'validation-plugin'),
      version: '^1.0.0',
      class: 'MockValidation',
      properties: {
        fail: true,
      },
    }];

    await expect(() => synth({ validations })).rejects.toThrow(/Unsupported version spec/);

  });

  test('synth fails when validation plugin throws', async () => {

    const validations: ValidationConfig[] = [{
      package: path.join(__dirname, '__resources__', 'validation-plugin'),
      version: '0.0.0',
      class: 'MockValidation',
      properties: {
        throw: true,
      },
    }];

    await expect(() => synth({ validations })).rejects.toThrow(/Throwing per request/);

  });

  test('synth can write the validation reports to a file', async () => {

    const pluginPath = path.join(__dirname, '__resources__', 'validation-plugin');
    const dirNameRegex = new RegExp(__dirname, 'g');
    const validations: ValidationConfig[] = [{
      package: pluginPath,
      version: '0.0.0',
      class: 'MockValidation',
      properties: {
        fail: false,
      },
    }];
    await synth({
      validations,
      reportsFile: 'reports.json',
      postSynth: async (dir: string) => {
        const reports = fs.readFileSync(path.join(dir, 'reports.json'), { encoding: 'utf-8' })
          // '__dirname' contains environment specific paths, so it needs to be sanitized for consistent
          // results.
          .replace(dirNameRegex, '<__dirname-replaced>');
        expect(reports).toMatchSnapshot();
      },
    });

  });

  test('construct metadata is recorded by default when there are validations', async () => {

    const pluginPath = path.join(__dirname, '__resources__', 'validation-plugin');
    const validations: ValidationConfig[] = [{
      package: pluginPath,
      version: '0.0.0',
      class: 'MockValidation',
      properties: {
        fail: false,
      },
    }];
    await synth({
      validations,
      postSynth: async (dir: string) => {
        expect(findConstructMetadata(path.join(dir, 'dist/'))).toContain('construct-metadata.json');
      },
    });
  });

  test('construct metadata is NOT recorded by default when validations is empty', async () => {

    const validations: ValidationConfig[] = [];
    await synth({
      validations,
      postSynth: async (dir: string) => {
        expect(findConstructMetadata(path.join(dir, 'dist/'))).toBeUndefined();
      },
    });
  });

  test('construct metadata is NOT recorded by default when validations is undefined', async () => {

    const validations = undefined;
    await synth({
      validations,
      postSynth: async (dir: string) => {
        expect(findConstructMetadata(path.join(dir, 'dist/'))).toBeUndefined();
      },
    });
  });

  test('synth will not write the validation reports to an existing file', async () => {

    const pluginPath = path.join(__dirname, '__resources__', 'validation-plugin');
    const dirNameRegex = new RegExp(__dirname, 'g');
    const validations: ValidationConfig[] = [{
      package: pluginPath,
      version: '0.0.0',
      class: 'MockValidation',
      properties: {
        fail: false,
      },
    }];

    await expect(async () => {

      await synth({
        validations,
        reportsFile: 'reports.json',
        preSynth: async (dir: string) => {
          fs.writeFileSync(path.join(dir, 'reports.json'), 'hello');
        },
        postSynth: async (dir: string) => {
          const reports = fs.readFileSync(path.join(dir, 'reports.json'), { encoding: 'utf-8' })
            // '__dirname' contains environment specific paths, so it needs to be sanitized for consistent
            // results.
            .replace(dirNameRegex, '<__dirname-replaced>');
          expect(reports).toMatchSnapshot();
        },
      });

    }).rejects.toThrow(/Unable to write validation reports file. Already exists:/);

  });

  test('can pass environment to installation command', async () => {

    const validations: ValidationConfig[] = [{
      package: 'some-plugin',
      version: '0.0.0',
      class: 'MockValidation',
      properties: {
        throw: true,
      },
      installEnv: {
        // this should fail synth
        npm_config_registry: 'localhost:1234',
      },
    }];

    const messageNode14 = 'invalid config registry';
    const messageNode16 = messageNode14;
    const messageNode18 = 'ERR_INVALID_URL';

    const re = new RegExp(`${messageNode14}|${messageNode18}|${messageNode16}`);
    await expect(() => synth({ validations })).rejects.toThrow(re);

  });

  test('synth executed with --stdout', async () => {

    const validations: ValidationConfig[] = [{
      package: path.join(__dirname, '__resources__', 'validation-plugin'),
      version: '0.0.0',
      class: 'MockValidation',
      properties: {
        fail: false,
      },
    }];

    await synth({ validations, stdout: true });

  });

});

describe('Helm Synthesis', () => {
  test('throws when synthesis --format is not plain or helm', async () => {
    const synthOptions: SynthOptions = {
      format: 'foo',
    };

    await expect(() => synth(synthOptions)).rejects.toThrow(/You need to specify synthesis format either as plain or helm but received:/);
  });

  test('throws when helm chart api version is not v1 or v2', async () => {
    const synthOptions: SynthOptions = {
      format: SynthesisFormat.HELM,
      chartApiVersion: 'foo',
    };

    await expect(() => synth(synthOptions)).rejects.toThrow(/You need to specify helm chart api version either as v1 or v2 but received:/);
  });

  test('throws when synthesis --format is helm and --chart-version is not specified', async () => {
    const synthOptions: SynthOptions = {
      format: SynthesisFormat.HELM,
    };

    await expect(() => synth(synthOptions)).rejects.toThrow(/You need to specify the \'--chart-version\' when the \'--format\' is set as helm./);
  });

  test('throws when --chart-version is not aligned with SemVer2 standards', async () => {
    const synthOptions: SynthOptions = {
      format: SynthesisFormat.HELM,
      chartVersion: 'foo',
    };

    await expect(() => synth(synthOptions)).rejects.toThrow(/The value specified for '--chart-version': foo does not follow SemVer-2/);
  });

  test('throws when --format is helm and mode is stdout', async () => {
    const synthOptions: SynthOptions = {
      format: SynthesisFormat.HELM,
      chartVersion: '1.1.1',
      stdout: true,
    };

    await expect(() => synth(synthOptions)).rejects.toThrow(/Helm format synthesis does not support 'stdout'. Please use 'outdir' instead./);
  });

  test('throws when --chart-version and/or --chart-api-version is specified with --format as plain', async () => {
    const synthOptions: SynthOptions = {
      format: SynthesisFormat.PLAIN,
      chartVersion: '1.1.1',
      chartApiVersion: HelmChartApiVersion.V2,
    };

    await expect(() => synth(synthOptions)).rejects.toThrow(/You need to specify '--format' as helm when '--chart-version' and\/or '--chart-api-version' is set./);
  });

  test('throws when --chart-api-version is v1 and crds are specified', async () => {
    const synthOptions: SynthOptions = {
      format: SynthesisFormat.HELM,
      chartVersion: '1.1.1',
      chartApiVersion: HelmChartApiVersion.V1,
    };

    imports.push('k8s');
    imports.push('foo.yaml');

    await expect(() => synth(synthOptions)).rejects.toThrow(/CRDs are not supported with --format as 'helm' for --chart-api-version: 'v1'. Please use --chart-api-version: 'v2' for using CRDs./);
  });

  test('--chart-api-version is v1', async () => {
    // An error should not be thrown since k8s is not a crd
    imports.push('k8s');

    const synthOptions: SynthOptions = {
      format: SynthesisFormat.HELM,
      chartVersion: '1.1.1',
      chartApiVersion: HelmChartApiVersion.V1,
      postSynth: async (dir: string) => {
        expect(generatedHelmChartExists(dir.concat('/dist'))).toBeTruthy();
      },
    };

    await synth(synthOptions);
  });


  test('--chart-api-version is v2 without crds', async () => {
    const synthOptions: SynthOptions = {
      format: SynthesisFormat.HELM,
      chartVersion: '1.1.1',
      postSynth: async (dir: string) => {
        expect(generatedHelmChartExists(dir.concat('/dist'))).toBeTruthy();
      },
    };

    await synth(synthOptions);
  });

  test('--chart-api-version is v2 and crds are specified', async () => {
    imports.push('k8s');
    imports.push(path.join(__dirname, './__resources__/crds/foo.yaml'));
    imports.push(`bar:=${path.join(__dirname, './__resources__/crds/bar.yaml')}`);
    imports.push('github:crossplane/crossplane@0.14.0');

    const synthOptions: SynthOptions = {
      format: SynthesisFormat.HELM,
      chartVersion: '1.1.1',
      postSynth: async (dir: string) => {
        expect(generatedHelmChartExists(dir.concat('/dist'))).toBeTruthy();

        // K8s import must be ignored
        const crdFiles = readdirSync(path.join(dir, 'dist', 'crds'));
        expect(crdFiles.length).toEqual(3);
        expect(crdFiles.includes('foo.yaml')).toBeTruthy();
        expect(crdFiles.includes('bar.yaml')).toBeTruthy();
        expect(crdFiles.includes('crossplane.yaml')).toBeTruthy();
      },
    };

    await synth(synthOptions);
  });

  // TODO test singlular functions
  // TODO For instance, derivingFileName
});

interface SynthOptions {

  readonly validations?: string | ValidationConfig[];
  readonly validate?: boolean;
  readonly stdout?: boolean;
  readonly reportsFile?: string;
  readonly format?: string;
  readonly chartApiVersion?: string;
  readonly chartVersion?: string;
  readonly preSynth?: (dir: string) => Promise<void>;
  readonly postSynth?: (dir: string) => Promise<void>;

}

async function synth(options: SynthOptions) {

  const app = `
const cdk8s = require('${require.resolve('cdk8s')}');
const app = new cdk8s.App();
const chart = new cdk8s.Chart(app, 'Chart');
new cdk8s.ApiObject(chart, 'Object', {
  kind: 'ConfigMap',
  apiVersion: 'v1',
  metadata: {
    name: 'config-map',
  }
});
app.synth();
`;

  await mkdtemp(async (dir: string) => {

    const stdout = options.stdout ?? false;
    const validate = options.validate ?? true;
    const format = options.format ?? SynthesisFormat.PLAIN;
    const chartApiVersion = format === SynthesisFormat.HELM ? (options.chartApiVersion ?? HelmChartApiVersion.V2) : undefined;

    const config: Config = {
      validations: options.validations,
      app: 'node index.js',
      output: stdout ? undefined : 'dist',
      pluginsDirectory: path.join(dir, '.cdk8s', 'plugins'),
      synth: {
        format: format as SynthesisFormat,
        chartApiVersion: chartApiVersion as HelmChartApiVersion,
        chartVersion: options.chartVersion,
      },
      imports: imports,
    };

    fs.writeFileSync(path.join(dir, 'index.js'), app);
    fs.writeFileSync(path.join(dir, 'cdk8s.yaml'), yaml.stringify(config));

    const recordConstructMetadata = !(options.validations == undefined || options.validations.length == 0);

    const pwd = process.cwd();
    const exit = process.exit;
    try {
      process.chdir(dir);
      process.env.CDK8S_RECORD_CONSTRUCT_METADATA = recordConstructMetadata ? 'true' : 'false';
      // our implementation does process.exit(2) so we need
      // to monkey patch it so we can assert on it.
      (process as any).exit = (code: number) => {
        throw new Error(`Code: ${code}`);
      };

      const cmd = requireSynth();

      if (options.preSynth) {
        await options.preSynth(dir);
      }
      await cmd.handler({
        app: config.app,
        output: config.output,
        stdout: stdout,
        validate: validate,
        pluginsDir: config.pluginsDirectory,
        validationReportsOutputFile: options.reportsFile ? path.join(dir, options.reportsFile) : undefined,
        format: config.synth?.format,
        chartApiVersion: config.synth?.chartApiVersion,
        chartVersion: config.synth?.chartVersion,
      });
      if (options.postSynth) {
        await options.postSynth(dir);
      }
      if (validate && findConstructMetadata(path.join(dir, 'dist/'))) {
        // this file is written by our test plugin
        const marker = path.join(dir, 'validation-done.marker');
        expect(fs.existsSync(marker)).toBeTruthy();
      }
    } finally {
      process.chdir(pwd);
      (process as any).exit = exit;
      delete process.env.CDK8S_RECORD_CONSTRUCT_METADATA;
    }

  });

}

function requireSynth() {
  const module = '../../src/cli/cmds/synth';
  // eslint-disable-next-line
  return require(module);
}


function generatedHelmChartExists(dir: string) {
  const chartYaml = path.join(dir, 'Chart.yaml');
  const chartYamlExists = fs.existsSync(chartYaml);

  const readme = path.join(dir, 'README.md');
  const readmeExists = fs.existsSync(readme);

  const templates = path.join(dir, 'templates');
  const templateDirExists = fs.existsSync(templates);

  const manifestFiles = readdirSync(templates);
  const manifestFilesExists = manifestFiles.length > 0;

  if (crdsArePresent(imports)) {
    const crds = path.join(dir, 'crds');
    const crdsExists = fs.existsSync(crds);

    const crdFiles = readdirSync(crds);
    const crdFilesExists = crdFiles.length > 0;

    return chartYamlExists && readmeExists && templateDirExists && manifestFilesExists && crdsExists && crdFilesExists;
  }

  return chartYamlExists && readmeExists && templateDirExists && manifestFilesExists;
}