import { existsSync, rmSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import * as fs from 'fs-extra';
import { glob } from 'glob';
import * as yaml from 'yaml';
import { Config, HelmChartApiVersion, SynthesisFormat, ValidationConfig } from '../../src/config';
import { findConstructMetadata } from '../../src/util';

const DEFAULT_APP = 'node index.js';

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

    await synth({ config: { validations: validations } });
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
      config: { validations: validationsFile },
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
      config: { validations: validations },
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

    await synth({ config: { validations: validations } });

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

    await expect(() => synth({ config: { validations: validations } })).rejects.toThrow(/Unsupported package reference/);

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

    await expect(() => synth({ config: { validations: validations } })).rejects.toThrow('Code: 2');

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

    await synth({ config: { validations: validations }, validate: false });
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

    await expect(() => synth({ config: { validations: validations } })).rejects.toThrow(/Cannot find module/);

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

    await expect(() => synth({ config: { validations: validations } })).rejects.toThrow(/Unsupported version spec/);

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

    await expect(() => synth({ config: { validations: validations } })).rejects.toThrow(/Throwing per request/);

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
      config: { validations: validations },
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
      config: { validations: validations },
      postSynth: async (dir: string) => {
        expect(findConstructMetadata(path.join(dir, 'dist/'))).toContain('construct-metadata.json');
      },
    });
  });

  test('construct metadata is NOT recorded by default when validations is empty', async () => {

    const validations: ValidationConfig[] = [];
    await synth({
      config: { validations: validations },
      postSynth: async (dir: string) => {
        expect(findConstructMetadata(path.join(dir, 'dist/'))).toBeUndefined();
      },
    });
  });

  test('construct metadata is NOT recorded by default when validations is undefined', async () => {

    const validations = undefined;
    await synth({
      config: { validations: validations },
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
        config: { validations: validations },
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
    await expect(() => synth({ config: { validations: validations } })).rejects.toThrow(re);

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

    await synth({ config: { validations: validations }, stdout: true });

  });

});

describe('Helm synthesis', () => {
  const withOnlyCliInputs = 'with all inputs from cli and no config file is present';
  const withOnlyConfigInputs = 'with all inputs from config file and no related cli inputs';
  const withSameInputsInBoth = 'with inputs duplicated in cli and config file';
  const withDifferentInputsInBoth = 'with different inputs in cli and config file';

  test.each([
    [
      withOnlyCliInputs,
      {
        format: 'foo',
      },
    ],
    [
      withOnlyConfigInputs,
      {
        config: {
          synthConfig: {
            format: 'foo' as SynthesisFormat,
          },
        },
      },
    ],
    [
      withSameInputsInBoth,
      {
        format: 'foo',
        config: {
          synthConfig: {
            format: 'foo' as SynthesisFormat,
          },
        },
      },
    ],
    [
      withDifferentInputsInBoth,
      {
        format: 'foo',
        config: {
          synthConfig: {
            format: SynthesisFormat.HELM,
          },
        },
      },
    ],
  ])('throws when synthesis --format is not plain or helm %s', async (_testName, synthOptions) => {
    await expect(() => synth(synthOptions)).rejects.toThrow(/You need to specify synthesis format either as plain or helm but received:/);
  });

  test.each([
    [
      withOnlyCliInputs,
      {
        format: SynthesisFormat.HELM,
        chartApiVersion: 'foo',
      },
    ],
    [
      withOnlyConfigInputs,
      {
        config: {
          synthConfig: {
            format: SynthesisFormat.HELM,
            chartApiVersion: 'foo' as HelmChartApiVersion,
          },
        },
      },
    ],
    [
      withSameInputsInBoth,
      {
        format: SynthesisFormat.HELM,
        chartApiVersion: 'foo',
        config: {
          synthConfig: {
            format: SynthesisFormat.HELM,
            chartApiVersion: 'foo' as HelmChartApiVersion,
          },
        },
      },
    ],
    [
      withDifferentInputsInBoth,
      {
        format: SynthesisFormat.HELM,
        chartApiVersion: 'foo' as HelmChartApiVersion,
        config: {
          synthConfig: {
            format: SynthesisFormat.HELM,
            chartApiVersion: HelmChartApiVersion.V2,
          },
        },
      },
    ],
  ])('throws when helm chart api version is not v1 or v2 %s', async (_testName, synthOptions) => {
    await expect(() => synth(synthOptions)).rejects.toThrow(/You need to specify helm chart api version either as v1 or v2 but received:/);
  });

  test.each([
    [
      withOnlyCliInputs,
      {
        format: SynthesisFormat.HELM,
      },
    ],
    [
      withOnlyConfigInputs,
      {
        config: {
          synthConfig: {
            format: SynthesisFormat.HELM,
          },
        },
      },
    ],
    [
      withSameInputsInBoth,
      {
        format: SynthesisFormat.HELM,
        config: {
          synthConfig: {
            format: SynthesisFormat.HELM,
          },
        },
      },
    ],
    [
      withDifferentInputsInBoth,
      {
        format: SynthesisFormat.HELM,
        config: {
          synthConfig: {
            format: SynthesisFormat.PLAIN,
          },
        },
      },
    ],
  ])('throws when synthesis --format is helm and --chart-version is not specified %s', async (_testName, synthOptions) => {
    await expect(() => synth(synthOptions)).rejects.toThrow(/You need to specify '--chart-version' when '--format' is set as 'helm'./);
  });

  test.each([
    [
      withOnlyCliInputs,
      {
        format: SynthesisFormat.HELM,
        chartVersion: 'foo',
      },
    ],
    [
      withOnlyConfigInputs,
      {
        config: {
          synthConfig: {
            format: SynthesisFormat.HELM,
            chartVersion: 'foo',
          },
        },
      },
    ],
    [
      withSameInputsInBoth,
      {
        format: SynthesisFormat.HELM,
        chartVersion: 'foo',
        config: {
          synthConfig: {
            format: SynthesisFormat.HELM,
            chartVersion: 'foo',
          },
        },
      },
    ],
    [
      withDifferentInputsInBoth,
      {
        format: SynthesisFormat.HELM,
        chartVersion: 'foo',
        config: {
          synthConfig: {
            format: SynthesisFormat.PLAIN,
            chartVersion: 'foo',
          },
        },
      },
    ],
  ])('throws when --chart-version is not aligned with SemVer2 standards %s', async (_testName, synthOptions) => {
    await expect(() => synth(synthOptions)).rejects.toThrow(/The value specified for '--chart-version': foo does not follow SemVer-2/);
  });

  test.each([
    [
      withOnlyCliInputs,
      {
        format: SynthesisFormat.HELM,
        chartVersion: '1.1.1',
        stdout: true,
      },
    ],
    [
      withOnlyConfigInputs,
      {
        stdout: true,
        config: {
          synthConfig: {
            format: SynthesisFormat.HELM,
            chartVersion: '1.1.1',
          },
        },
      },
    ],
    [
      withSameInputsInBoth,
      {
        format: SynthesisFormat.HELM,
        chartVersion: '1.1.1',
        stdout: true,
        config: {
          synthConfig: {
            format: SynthesisFormat.HELM,
            chartVersion: '1.1.1',
          },
        },
      },
    ],
    [
      withDifferentInputsInBoth,
      {
        format: SynthesisFormat.HELM,
        chartVersion: '1.1.1',
        stdout: true,
        config: {
          synthConfig: {
            format: SynthesisFormat.PLAIN,
            chartVersion: '1.1.1',
          },
        },
      },
    ],
  ])('throws when --format is helm and mode is stdout %s', async (_testName, synthOptions) => {
    await expect(() => synth(synthOptions)).rejects.toThrow(/Helm format synthesis does not support 'stdout'. Please use 'outdir' instead./);
  });

  test.each([
    [
      withOnlyCliInputs,
      {
        format: SynthesisFormat.PLAIN,
        chartApiVersion: HelmChartApiVersion.V2,
      },
    ],
    [
      withOnlyConfigInputs,
      {
        config: {
          synthConfig: {
            format: SynthesisFormat.PLAIN,
            chartApiVersion: HelmChartApiVersion.V2,
          },
        },
      },
    ],
    [
      withSameInputsInBoth,
      {
        format: SynthesisFormat.PLAIN,
        chartApiVersion: HelmChartApiVersion.V2,
        config: {
          synthConfig: {
            format: SynthesisFormat.PLAIN,
            chartApiVersion: HelmChartApiVersion.V2,
          },
        },
      },
    ],
    [
      withDifferentInputsInBoth,
      {
        format: SynthesisFormat.PLAIN,
        chartApiVersion: HelmChartApiVersion.V2,
        config: {
          synthConfig: {
            format: SynthesisFormat.HELM,
            chartApiVersion: HelmChartApiVersion.V2,
          },
        },
      },
    ],
  ])('throws when --chart-api-version is specified with --format as plain %s', async (_testName, synthOptions) => {
    await expect(() => synth(synthOptions)).rejects.toThrow(/You need to specify '--format' as 'helm' when '--chart-api-version' is set./);
  });

  test.each([
    [
      withOnlyCliInputs,
      {
        format: SynthesisFormat.PLAIN,
        chartVersion: '1.1.1',
      },
    ],
    [
      withOnlyConfigInputs,
      {
        config: {
          synthConfig: {
            format: SynthesisFormat.PLAIN,
            chartVersion: '1.1.1',
          },
        },
      },
    ],
    [
      withSameInputsInBoth,
      {
        format: SynthesisFormat.PLAIN,
        chartVersion: '1.1.1',
        config: {
          synthConfig: {
            format: SynthesisFormat.PLAIN,
            chartVersion: '1.1.1',
          },
        },
      },
    ],
    [
      withDifferentInputsInBoth,
      {
        format: SynthesisFormat.PLAIN,
        chartVersion: '1.1.1',
        config: {
          synthConfig: {
            format: SynthesisFormat.HELM,
            chartVersion: '1.1.1',
          },
        },
      },
    ],
  ])('throws when --chart-version is specified with --format as plain %s', async (_testName, synthOptions) => {
    await expect(() => synth(synthOptions)).rejects.toThrow(/You need to specify '--format' as 'helm' when '--chart-version' is set./);
  });

  test.each([
    [
      withOnlyCliInputs,
      {
        format: SynthesisFormat.HELM,
        chartVersion: '1.1.1',
        chartApiVersion: HelmChartApiVersion.V1,
        config: {
          imports: ['k8s', 'foo.yaml'],
        },
      },
    ],
    [
      withOnlyConfigInputs,
      {
        config: {
          synthConfig: {
            format: SynthesisFormat.HELM,
            chartVersion: '1.1.1',
            chartApiVersion: HelmChartApiVersion.V1,
          },
          imports: ['k8s', 'foo.yaml'],
        },
      },
    ],
    [
      withSameInputsInBoth,
      {
        format: SynthesisFormat.HELM,
        chartVersion: '1.1.1',
        chartApiVersion: HelmChartApiVersion.V1,
        config: {
          imports: ['k8s', 'foo.yaml'],
          synthConfig: {
            format: SynthesisFormat.HELM,
            chartVersion: '1.1.1',
            chartApiVersion: HelmChartApiVersion.V1,
          },
        },
      },
    ],
    [
      withDifferentInputsInBoth,
      {
        format: SynthesisFormat.HELM,
        chartVersion: '1.1.1',
        chartApiVersion: HelmChartApiVersion.V1,
        config: {
          synthConfig: {
            chartApiVersion: HelmChartApiVersion.V2,
          },
          imports: ['k8s', 'foo.yaml'],
        },
      },
    ],
  ])('throws when --chart-api-version is v1 and crds are specified %s', async (_testName, synthOptions) => {
    await expect(() => synth(synthOptions)).rejects.toThrow(/Your application uses CRDs, which are not supported when '--chart-api-version' is set to v1. Please either set '--chart-api-version' to v2, or remove the CRDs from your cdk8s.yaml configuration file/);
  });

  const matchSynthSnapshot = async (dir: string) => {
    await expectSynthMatchSnapshot(dir.concat('/dist'));
  };

  test.each([
    [
      withOnlyCliInputs,
      {
        format: SynthesisFormat.HELM,
        chartVersion: '1.1.1',
        chartApiVersion: HelmChartApiVersion.V1,
        config: {
          imports: ['k8s'],
        },
        postSynth: matchSynthSnapshot,
      },
    ],
    [
      withOnlyConfigInputs,
      {
        config: {
          synthConfig: {
            format: SynthesisFormat.HELM,
            chartVersion: '1.1.1',
            chartApiVersion: HelmChartApiVersion.V1,
          },
          imports: ['k8s'],
        },
        postSynth: matchSynthSnapshot,
      },
    ],
    [
      withSameInputsInBoth,
      {
        format: SynthesisFormat.HELM,
        chartVersion: '1.1.1',
        chartApiVersion: HelmChartApiVersion.V1,
        config: {
          synthConfig: {
            format: SynthesisFormat.HELM,
            chartVersion: '1.1.1',
            chartApiVersion: HelmChartApiVersion.V1,
          },
          imports: ['k8s'],
        },
        postSynth: matchSynthSnapshot,
      },
    ],
    [
      withDifferentInputsInBoth,
      {
        format: SynthesisFormat.HELM,
        chartVersion: '1.1.1',
        chartApiVersion: HelmChartApiVersion.V1,
        config: {
          synthConfig: {
            chartApiVersion: HelmChartApiVersion.V2,
          },
          imports: ['k8s'],
        },
        postSynth: matchSynthSnapshot,
      },
    ],
  ])('--chart-api-version is v1 %s', async (_testName, synthOptions) => {
    await synth(synthOptions);
  });

  test.each([
    [
      withOnlyCliInputs,
      {
        format: SynthesisFormat.HELM,
        chartVersion: '1.1.1',
        postSynth: matchSynthSnapshot,
      },
    ],
    [
      withOnlyConfigInputs,
      {
        config: {
          synthConfig: {
            format: SynthesisFormat.HELM,
            chartVersion: '1.1.1',
          },
        },
        postSynth: matchSynthSnapshot,
      },
    ],
    [
      withSameInputsInBoth,
      {
        format: SynthesisFormat.HELM,
        chartVersion: '1.1.1',
        config: {
          synthConfig: {
            format: SynthesisFormat.HELM,
            chartVersion: '1.1.1',
          },
        },
        postSynth: matchSynthSnapshot,
      },
    ],
    [
      withDifferentInputsInBoth,
      {
        format: SynthesisFormat.HELM,
        chartVersion: '1.1.1',
        config: {
          synthConfig: {
            format: SynthesisFormat.PLAIN,
            chartVersion: '1.1.1',
          },
        },
        postSynth: matchSynthSnapshot,
      },
    ],
  ])('--chart-api-version is v2 without crds %s', async (_testName, synthOptions) => {
    await synth(synthOptions);
  });

  const importsForChartApiv2 = [
    'k8s',
    path.join(__dirname, './__resources__/crds/foo.yaml'),
    `bar:=${path.join(__dirname, './__resources__/crds/bar.yaml')}`,
    'github:crossplane/crossplane@0.14.0',
  ];

  test.each([
    [
      withOnlyCliInputs,
      {
        format: SynthesisFormat.HELM,
        chartVersion: '1.1.1',
        config: {
          imports: importsForChartApiv2,
        },
        postSynth: matchSynthSnapshot,
      },
    ],
    [
      withOnlyConfigInputs,
      {
        config: {
          synthConfig: {
            format: SynthesisFormat.HELM,
            chartVersion: '1.1.1',
          },
          imports: importsForChartApiv2,
        },
        postSynth: matchSynthSnapshot,
      },
    ],
    [
      withSameInputsInBoth,
      {
        format: SynthesisFormat.HELM,
        chartVersion: '1.1.1',
        config: {
          synthConfig: {
            format: SynthesisFormat.HELM,
            chartVersion: '1.1.1',
          },
          imports: importsForChartApiv2,
        },
        postSynth: matchSynthSnapshot,
      },
    ],
    [
      withDifferentInputsInBoth,
      {
        format: SynthesisFormat.HELM,
        chartVersion: '1.1.1',
        config: {
          synthConfig: {
            format: SynthesisFormat.PLAIN,
            chartVersion: '1.1.1',
          },
          imports: importsForChartApiv2,
        },
        postSynth: matchSynthSnapshot,
      },
    ],
  ])('--chart-api-version is v2 and crds are present %s', async (_testName, synthOptions) => {
    await synth(synthOptions);
  });

  const filename = path.join(__dirname, './__resources__/crds/baz.json');

  test.each([
    [
      withOnlyCliInputs,
      {
        format: SynthesisFormat.HELM,
        chartVersion: '1.1.1',
        config: {
          imports: [
            'k8s',
            filename,
          ],
        },
        postSynth: matchSynthSnapshot,
      },
    ],
    [
      withOnlyConfigInputs,
      {
        config: {
          synthConfig: {
            format: SynthesisFormat.HELM,
            chartVersion: '1.1.1',
          },
          imports: [
            'k8s',
            filename,
          ],
        },
        postSynth: matchSynthSnapshot,
      },
    ],
    [
      withSameInputsInBoth,
      {
        format: SynthesisFormat.HELM,
        chartVersion: '1.1.1',
        config: {
          synthConfig: {
            format: SynthesisFormat.HELM,
            chartVersion: '1.1.1',
          },
          imports: [
            'k8s',
            filename,
          ],
        },
        postSynth: matchSynthSnapshot,
      },
    ],
    [
      withDifferentInputsInBoth,
      {
        format: SynthesisFormat.HELM,
        chartVersion: '1.1.1',
        config: {
          synthConfig: {
            format: SynthesisFormat.PLAIN,
            chartVersion: '1.1.1',
          },
          imports: [
            'k8s',
            filename,
          ],
        },
        postSynth: matchSynthSnapshot,
      },
    ],
  ])('filename url hash remains the same across synthesis %s', async (_testName, synthOptions) => {
    // This would be run 4 times with test.each
    await synth(synthOptions);
  });
});

interface SynthCliOptions {
  readonly app?: string;
  readonly output?: string;
  readonly stdout?: boolean;
  readonly pluginsDir?: string;
  readonly validate?: boolean;
  readonly reportsFile?: string;
  readonly format?: string;
  readonly chartApiVersion?: string;
  readonly chartVersion?: string;
}

interface SynthOptions extends SynthCliOptions {
  readonly config?: Config;
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

  const dir = path.join(os.tmpdir(), 'cdk8s-synth-test');

  // Defined config in cdk8s.yaml file
  const config: Config | undefined = options.config;

  fs.outputFileSync(path.join(dir, 'index.js'), app);

  if (config) {
    fs.outputFileSync(path.join(dir, 'cdk8s.yaml'), yaml.stringify(config));
  }

  const recordConstructMetadata = !(options.config?.validations == undefined || options.config?.validations.length == 0);

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

    // Specifiying defaults specific to running tests
    await cmd.handler({
      app: options.app ?? DEFAULT_APP,
      output: options.output,
      stdout: options.stdout,
      pluginsDir: options.pluginsDir,
      validate: options.validate,
      validationReportsOutputFile: options.reportsFile ? path.join(dir, options.reportsFile) : undefined,
      format: options.format,
      chartApiVersion: options.chartApiVersion,
      chartVersion: options.chartVersion,
    });

    if (options.postSynth) {
      await options.postSynth(dir);
    }
    if (options.validate && findConstructMetadata(path.join(dir, 'dist/'))) {
      // this file is written by our test plugin
      const marker = path.join(dir, 'validation-done.marker');
      expect(fs.existsSync(marker)).toBeTruthy();
    }
  } finally {
    process.chdir(pwd);
    (process as any).exit = exit;
    delete process.env.CDK8S_RECORD_CONSTRUCT_METADATA;

    if (existsSync(dir)) {
      rmSync(dir, { recursive: true });
    }
  }
}

function requireSynth() {
  const module = '../../src/cli/cmds/synth';
  // eslint-disable-next-line
  return require(module);
}

async function expectSynthMatchSnapshot(workdir: string) {
  const files = await promisify(glob)('**', {
    cwd: workdir,
    nodir: true,
  });

  const map: Record<string, string> = {};

  for (const file of files) {
    const filePath = path.join(workdir, file);

    const source = fs.readFileSync(filePath, 'utf-8');
    map[file] = source;
  }

  expect(map).toMatchSnapshot();
}