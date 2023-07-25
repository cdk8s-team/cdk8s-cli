import * as path from 'path';
import * as fs from 'fs-extra';
import * as yaml from 'yaml';
import { Config, HelmChartApiVersion, SynthesisFormat, ValidationConfig } from '../../src/config';
import { findConstructMetadata, mkdtemp } from '../../src/util';

beforeEach(() => {
  // resetting so that every test can use a different config file,
  // which is read on module load.
  jest.resetModules();
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
  test('throws when synthesis --format is helm and --chart-version is not specified', async () => {

    const synthOptions: SynthOptions = {
      format: SynthesisFormat.HELM,
    };

    await expect(() => synth(synthOptions)).rejects.toThrow(/You need to specify the \'--chart-version\' when the \'--format\' is set as helm./);
  });

  test('throws when --chart-version is specified with --format as cdk8s', () => {

  });

  test('throws when --chart-api-version is specified with --format as cdk8s', () => {

  });

  test('throws when --chart-version && --chart-api-version is specified with --format as cdk8s', () => {

  });

  test('throws when --chart-version is not aligned with SemVer2 standards', () => {

  });

  test('throws when --format is helm and mode is stdout', () => {

  });

  test('throws when --chart-api-version is v1 and crds are specified', () => {

  });

  test('--chart-api-version is v1', () => {

  });


  test.skip('--chart-api-version is v2', async () => {
    const synthOptions: SynthOptions = {
      format: SynthesisFormat.HELM,
      chartVersion: '1.1.1',
      validate: false,
    };

    await synth(synthOptions);
  });

  // TODO: Test with different types of CRD values
  test('--chart-api-version is v2 and crds are specified', () => {

  });

  test('--chart-api-version is v2 and validations are performed', () => {

  });

  // TODO: Can we do helm install?
  test('helm lint succeeds with created chart', () => {

  });

  // test('', () => {

  // });

  // test('', () => {

  // });

  // test('', () => {

  // });
});

interface SynthOptions {

  readonly validations?: string | ValidationConfig[];
  readonly validate?: boolean;
  readonly stdout?: boolean;
  readonly reportsFile?: string;
  readonly format?: SynthesisFormat;
  readonly chartApiVersion?: HelmChartApiVersion;
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
    const format = options.format ?? SynthesisFormat.CDK8s;
    const chartApiVersion = format === SynthesisFormat.HELM ? (options.chartApiVersion ?? HelmChartApiVersion.V2) : undefined;

    // TODO I don't think we need to specify format each time. Since, if we mention it in cdk8s.yaml, then that should be picked up

    const config: Config = {
      validations: options.validations,
      app: 'node index.js',
      output: stdout ? undefined : 'dist',
      pluginsDirectory: path.join(dir, '.cdk8s', 'plugins'),
      format: format,
      helmSynthConfig: {
        chartApiVersion: chartApiVersion,
        chartVersion: options.chartVersion,
      },
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
        format: config.format,
        chartApiVersion: config.helmSynthConfig?.chartApiVersion,
        chartVersion: config.helmSynthConfig?.chartVersion,
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
