import { readdirSync } from 'fs';
import * as path from 'path';
import * as fs from 'fs-extra';
import * as yaml from 'yaml';
import { Config, HelmChartApiVersion, SynthesisFormat, ValidationConfig } from '../../src/config';
import { crdsArePresent, findConstructMetadata, hashAndEncode, mkdtemp } from '../../src/util';

const DEFAULT_APP = 'node index.js';
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

describe('Create helm scaffolding', () => {
  const TEST_SCENARIO_1 = 'with all inputs from cli and no config file is present';
  const TEST_SCENARIO_2 = 'with all inputs from config file and no related cli inputs';
  const TEST_SCENARIO_3 = 'with inputs duplicated in cli and config file';
  const TEST_SCENARIO_4 = 'with different inputs in cli and config file';

  test.each([
    [
      TEST_SCENARIO_1,
      {
        format: 'foo',
      },
    ],
    [
      TEST_SCENARIO_2,
      {
        config: {
          synth: {
            format: 'foo' as SynthesisFormat,
          },
        },
      },
    ],
    [
      TEST_SCENARIO_3,
      {
        format: 'foo',
        config: {
          synth: {
            format: 'foo' as SynthesisFormat,
          },
        },
      },
    ],
    [
      TEST_SCENARIO_4,
      {
        format: 'foo',
        config: {
          synth: {
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
      TEST_SCENARIO_1,
      {
        format: SynthesisFormat.HELM,
        chartApiVersion: 'foo',
      },
    ],
    [
      TEST_SCENARIO_2,
      {
        config: {
          synth: {
            format: SynthesisFormat.HELM,
            chartApiVersion: 'foo' as HelmChartApiVersion,
          },
        },
      },
    ],
    [
      TEST_SCENARIO_3,
      {
        format: SynthesisFormat.HELM,
        config: {
          synth: {
            format: SynthesisFormat.HELM,
            chartApiVersion: 'foo' as HelmChartApiVersion,
          },
        },
      },
    ],
    [
      TEST_SCENARIO_4,
      {
        format: SynthesisFormat.HELM,
        chartApiVersion: 'foo' as HelmChartApiVersion,
        config: {
          synth: {
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
      TEST_SCENARIO_1,
      {
        format: SynthesisFormat.HELM,
      },
    ],
    [
      TEST_SCENARIO_2,
      {
        config: {
          synth: {
            format: SynthesisFormat.HELM,
          },
        },
      },
    ],
    [
      TEST_SCENARIO_3,
      {
        format: SynthesisFormat.HELM,
        config: {
          synth: {
            format: SynthesisFormat.HELM,
          },
        },
      },
    ],
    [
      TEST_SCENARIO_4,
      {
        format: SynthesisFormat.HELM,
        config: {
          synth: {
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
      TEST_SCENARIO_1,
      {
        format: SynthesisFormat.HELM,
        chartVersion: 'foo',
      },
    ],
    [
      TEST_SCENARIO_2,
      {
        config: {
          synth: {
            format: SynthesisFormat.HELM,
            chartVersion: 'foo',
          },
        },
      },
    ],
    [
      TEST_SCENARIO_3,
      {
        format: SynthesisFormat.HELM,
        chartVersion: 'foo',
        config: {
          synth: {
            format: SynthesisFormat.HELM,
            chartVersion: 'foo',
          },
        },
      },
    ],
    [
      TEST_SCENARIO_4,
      {
        format: SynthesisFormat.HELM,
        chartVersion: 'foo',
        config: {
          synth: {
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
      TEST_SCENARIO_1,
      {
        format: SynthesisFormat.HELM,
        chartVersion: '1.1.1',
        stdout: true,
      },
    ],
    [
      TEST_SCENARIO_2,
      {
        stdout: true,
        config: {
          synth: {
            format: SynthesisFormat.HELM,
            chartVersion: '1.1.1',
          },
        },
      },
    ],
    [
      TEST_SCENARIO_3,
      {
        format: SynthesisFormat.HELM,
        chartVersion: '1.1.1',
        stdout: true,
        config: {
          synth: {
            format: SynthesisFormat.HELM,
            chartVersion: '1.1.1',
          },
        },
      },
    ],
    [
      TEST_SCENARIO_4,
      {
        format: SynthesisFormat.HELM,
        chartVersion: '1.1.1',
        stdout: true,
        config: {
          synth: {
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
      TEST_SCENARIO_1,
      {
        format: SynthesisFormat.PLAIN,
        chartApiVersion: HelmChartApiVersion.V2,
      },
    ],
    [
      TEST_SCENARIO_2,
      {
        config: {
          synth: {
            format: SynthesisFormat.PLAIN,
            chartApiVersion: HelmChartApiVersion.V2,
          },
        },
      },
    ],
    [
      TEST_SCENARIO_3,
      {
        format: SynthesisFormat.PLAIN,
        chartApiVersion: HelmChartApiVersion.V2,
        config: {
          synth: {
            format: SynthesisFormat.PLAIN,
            chartApiVersion: HelmChartApiVersion.V2,
          },
        },
      },
    ],
    [
      TEST_SCENARIO_4,
      {
        format: SynthesisFormat.PLAIN,
        chartApiVersion: HelmChartApiVersion.V2,
        config: {
          synth: {
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
      TEST_SCENARIO_1,
      {
        format: SynthesisFormat.PLAIN,
        chartVersion: '1.1.1',
      },
    ],
    [
      TEST_SCENARIO_2,
      {
        config: {
          synth: {
            format: SynthesisFormat.PLAIN,
            chartVersion: '1.1.1',
          },
        },
      },
    ],
    [
      TEST_SCENARIO_3,
      {
        format: SynthesisFormat.PLAIN,
        chartVersion: '1.1.1',
        config: {
          synth: {
            format: SynthesisFormat.PLAIN,
            chartVersion: '1.1.1',
          },
        },
      },
    ],
    [
      TEST_SCENARIO_4,
      {
        format: SynthesisFormat.PLAIN,
        chartVersion: '1.1.1',
        config: {
          synth: {
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
      TEST_SCENARIO_1,
      {
        format: SynthesisFormat.PLAIN,
        chartVersion: '1.1.1',
        chartApiVersion: HelmChartApiVersion.V2,
      },
    ],
    [
      TEST_SCENARIO_2,
      {
        config: {
          synth: {
            format: SynthesisFormat.PLAIN,
            chartVersion: '1.1.1',
            chartApiVersion: HelmChartApiVersion.V2,
          },
        },
      },
    ],
    [
      TEST_SCENARIO_3,
      {
        format: SynthesisFormat.PLAIN,
        chartVersion: '1.1.1',
        chartApiVersion: HelmChartApiVersion.V2,
        config: {
          synth: {
            format: SynthesisFormat.PLAIN,
            chartVersion: '1.1.1',
            chartApiVersion: HelmChartApiVersion.V2,
          },
        },
      },
    ],
    [
      TEST_SCENARIO_4,
      {
        format: SynthesisFormat.PLAIN,
        chartVersion: '1.1.1',
        chartApiVersion: HelmChartApiVersion.V2,
        config: {
          synth: {
            format: SynthesisFormat.HELM,
            chartVersion: '1.1.1',
            chartApiVersion: HelmChartApiVersion.V2,
          },
        },
      },
    ],
  ])('throws when --chart-version and --chart-api-version is specified with --format as plain %s', async (_testName, synthOptions) => {
    await expect(() => synth(synthOptions)).rejects.toThrow(/You need to specify '--format' as 'helm' when '--chart-version' and '--chart-api-version' is set./);
  });

  test.each([
    [
      TEST_SCENARIO_1,
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
      TEST_SCENARIO_2,
      {
        config: {
          synth: {
            format: SynthesisFormat.HELM,
            chartVersion: '1.1.1',
            chartApiVersion: HelmChartApiVersion.V1,
          },
          imports: ['k8s', 'foo.yaml'],
        },
      },
    ],
    [
      TEST_SCENARIO_3,
      {
        format: SynthesisFormat.HELM,
        chartVersion: '1.1.1',
        chartApiVersion: HelmChartApiVersion.V1,
        config: {
          imports: ['k8s', 'foo.yaml'],
          synth: {
            format: SynthesisFormat.HELM,
            chartVersion: '1.1.1',
            chartApiVersion: HelmChartApiVersion.V1,
          },
        },
      },
    ],
    [
      TEST_SCENARIO_4,
      {
        format: SynthesisFormat.HELM,
        chartVersion: '1.1.1',
        chartApiVersion: HelmChartApiVersion.V1,
        config: {
          synth: {
            chartApiVersion: HelmChartApiVersion.V2,
          },
          imports: ['k8s', 'foo.yaml'],
        },
      },
    ],
  ])('throws when --chart-api-version is v1 and crds are specified %s', async (_testName, synthOptions) => {
    await expect(() => synth(synthOptions)).rejects.toThrow(/Your application uses CRDs, which are not supported with \'--chart-api-version\': \'v1\'. Please either use \'--chart-api-version\': \'v2\' or remove the CRDs from your cdk8s.yaml configuration file/);
  });

  test.each([
    [
      TEST_SCENARIO_1,
      {
        format: SynthesisFormat.HELM,
        chartVersion: '1.1.1',
        chartApiVersion: HelmChartApiVersion.V1,
        config: {
          imports: ['k8s'],
        },
        postSynth: async (dir: string) => {
          expect(generatedHelmChartExists(dir.concat('/dist'))).toBeTruthy();
        },
      },
    ],
    [
      TEST_SCENARIO_2,
      {
        config: {
          synth: {
            format: SynthesisFormat.HELM,
            chartVersion: '1.1.1',
            chartApiVersion: HelmChartApiVersion.V1,
          },
          imports: ['k8s'],
        },
        postSynth: async (dir: string) => {
          expect(generatedHelmChartExists(dir.concat('/dist'))).toBeTruthy();
        },
      },
    ],
    [
      TEST_SCENARIO_3,
      {
        format: SynthesisFormat.HELM,
        chartVersion: '1.1.1',
        chartApiVersion: HelmChartApiVersion.V1,
        config: {
          synth: {
            format: SynthesisFormat.HELM,
            chartVersion: '1.1.1',
            chartApiVersion: HelmChartApiVersion.V1,
          },
          imports: ['k8s'],
        },
        postSynth: async (dir: string) => {
          expect(generatedHelmChartExists(dir.concat('/dist'))).toBeTruthy();
        },
      },
    ],
    [
      TEST_SCENARIO_4,
      {
        format: SynthesisFormat.HELM,
        chartVersion: '1.1.1',
        chartApiVersion: HelmChartApiVersion.V1,
        config: {
          synth: {
            chartApiVersion: HelmChartApiVersion.V2,
          },
          imports: ['k8s'],
        },
        postSynth: async (dir: string) => {
          expect(generatedHelmChartExists(dir.concat('/dist'))).toBeTruthy();
        },
      },
    ],
  ])('--chart-api-version is v1 %s', async (_testName, synthOptions) => {
    await synth(synthOptions);
  });


  test.each([
    [
      TEST_SCENARIO_1,
      {
        format: SynthesisFormat.HELM,
        chartVersion: '1.1.1',
        postSynth: async (dir: string) => {
          expect(generatedHelmChartExists(dir.concat('/dist'))).toBeTruthy();
        },
      },
    ],
    [
      TEST_SCENARIO_2,
      {
        config: {
          synth: {
            format: SynthesisFormat.HELM,
            chartVersion: '1.1.1',
          },
        },
        postSynth: async (dir: string) => {
          expect(generatedHelmChartExists(dir.concat('/dist'))).toBeTruthy();
        },
      },
    ],
    [
      TEST_SCENARIO_3,
      {
        format: SynthesisFormat.HELM,
        chartVersion: '1.1.1',
        config: {
          synth: {
            format: SynthesisFormat.HELM,
            chartVersion: '1.1.1',
          },
        },
        postSynth: async (dir: string) => {
          expect(generatedHelmChartExists(dir.concat('/dist'))).toBeTruthy();
        },
      },
    ],
    [
      TEST_SCENARIO_4,
      {
        format: SynthesisFormat.HELM,
        chartVersion: '1.1.1',
        config: {
          synth: {
            format: SynthesisFormat.PLAIN,
            chartVersion: '1.1.1',
          },
        },
        postSynth: async (dir: string) => {
          expect(generatedHelmChartExists(dir.concat('/dist'))).toBeTruthy();
        },
      },
    ],
  ])('--chart-api-version is v2 without crds %s', async (_testName, synthOptions) => {
    await synth(synthOptions);
  });

  test.each([
    [
      TEST_SCENARIO_1,
      {
        format: SynthesisFormat.HELM,
        chartVersion: '1.1.1',
        config: {
          imports: [
            'k8s',
            path.join(__dirname, './__resources__/crds/foo.yaml'),
            `bar:=${path.join(__dirname, './__resources__/crds/bar.yaml')}`,
            'github:crossplane/crossplane@0.14.0',
          ],
        },
        postSynth: async (dir: string) => {
          expect(generatedHelmChartExists(dir.concat('/dist'))).toBeTruthy();

          // K8s import must be ignored
          const crdFiles = readdirSync(path.join(dir, 'dist', 'crds'));
          expect(crdFiles.length).toEqual(3);
          expect(crdFiles.includes('foo.yaml')).toBeTruthy();
          expect(crdFiles.includes('bar.yaml')).toBeTruthy();
          expect(crdFiles.includes('crossplane.yaml')).toBeTruthy();
        },
      },
    ],
    [
      TEST_SCENARIO_2,
      {
        config: {
          synth: {
            format: SynthesisFormat.HELM,
            chartVersion: '1.1.1',
          },
          imports: [
            'k8s',
            path.join(__dirname, './__resources__/crds/foo.yaml'),
            `bar:=${path.join(__dirname, './__resources__/crds/bar.yaml')}`,
            'github:crossplane/crossplane@0.14.0',
          ],
        },
        postSynth: async (dir: string) => {
          expect(generatedHelmChartExists(dir.concat('/dist'))).toBeTruthy();

          // K8s import must be ignored
          const crdFiles = readdirSync(path.join(dir, 'dist', 'crds'));
          expect(crdFiles.length).toEqual(3);
          expect(crdFiles.includes('foo.yaml')).toBeTruthy();
          expect(crdFiles.includes('bar.yaml')).toBeTruthy();
          expect(crdFiles.includes('crossplane.yaml')).toBeTruthy();
        },
      },
    ],
    [
      TEST_SCENARIO_3,
      {
        format: SynthesisFormat.HELM,
        chartVersion: '1.1.1',
        config: {
          synth: {
            format: SynthesisFormat.HELM,
            chartVersion: '1.1.1',
          },
          imports: [
            'k8s',
            path.join(__dirname, './__resources__/crds/foo.yaml'),
            `bar:=${path.join(__dirname, './__resources__/crds/bar.yaml')}`,
            'github:crossplane/crossplane@0.14.0',
          ],
        },
        postSynth: async (dir: string) => {
          expect(generatedHelmChartExists(dir.concat('/dist'))).toBeTruthy();

          // K8s import must be ignored
          const crdFiles = readdirSync(path.join(dir, 'dist', 'crds'));
          expect(crdFiles.length).toEqual(3);
          expect(crdFiles.includes('foo.yaml')).toBeTruthy();
          expect(crdFiles.includes('bar.yaml')).toBeTruthy();
          expect(crdFiles.includes('crossplane.yaml')).toBeTruthy();
        },
      },
    ],
    [
      TEST_SCENARIO_4,
      {
        format: SynthesisFormat.HELM,
        chartVersion: '1.1.1',
        config: {
          synth: {
            format: SynthesisFormat.PLAIN,
            chartVersion: '1.1.1',
          },
          imports: [
            'k8s',
            path.join(__dirname, './__resources__/crds/foo.yaml'),
            `bar:=${path.join(__dirname, './__resources__/crds/bar.yaml')}`,
            'github:crossplane/crossplane@0.14.0',
          ],
        },
        postSynth: async (dir: string) => {
          expect(generatedHelmChartExists(dir.concat('/dist'))).toBeTruthy();

          // K8s import must be ignored
          const crdFiles = readdirSync(path.join(dir, 'dist', 'crds'));
          expect(crdFiles.length).toEqual(3);
          expect(crdFiles.includes('foo.yaml')).toBeTruthy();
          expect(crdFiles.includes('bar.yaml')).toBeTruthy();
          expect(crdFiles.includes('crossplane.yaml')).toBeTruthy();
        },
      },
    ],
  ])('--chart-api-version is v2 and crds are present %s', async (_testName, synthOptions) => {
    await synth(synthOptions);
  });


  const testingFileNames: string[] = [];
  const filename = path.join(__dirname, './__resources__/crds/baz.json');
  const expectedFilename = hashAndEncode(filename);
  test.each([
    [
      TEST_SCENARIO_1,
      {
        format: SynthesisFormat.HELM,
        chartVersion: '1.1.1',
        config: {
          imports: [
            'k8s',
            filename,
          ],
        },
        postSynth: async (dir: string) => {
          expect(generatedHelmChartExists(dir.concat('/dist'))).toBeTruthy();

          // K8s import must be ignored
          const crdFiles = readdirSync(path.join(dir, 'dist', 'crds'));
          expect(crdFiles.length).toEqual(1);
          expect(crdFiles.includes(`${expectedFilename}.yaml`)).toBeTruthy();

          testingFileNames.push(crdFiles[0]);
        },
      },
    ],
    [
      TEST_SCENARIO_2,
      {
        config: {
          synth: {
            format: SynthesisFormat.HELM,
            chartVersion: '1.1.1',
          },
          imports: [
            'k8s',
            filename,
          ],
        },
        postSynth: async (dir: string) => {
          expect(generatedHelmChartExists(dir.concat('/dist'))).toBeTruthy();

          // K8s import must be ignored
          const crdFiles = readdirSync(path.join(dir, 'dist', 'crds'));
          expect(crdFiles.length).toEqual(1);
          expect(crdFiles.includes(`${expectedFilename}.yaml`)).toBeTruthy();

          testingFileNames.push(crdFiles[0]);
        },
      },
    ],
    [
      TEST_SCENARIO_3,
      {
        format: SynthesisFormat.HELM,
        chartVersion: '1.1.1',
        config: {
          synth: {
            format: SynthesisFormat.HELM,
            chartVersion: '1.1.1',
          },
          imports: [
            'k8s',
            filename,
          ],
        },
        postSynth: async (dir: string) => {
          expect(generatedHelmChartExists(dir.concat('/dist'))).toBeTruthy();

          // K8s import must be ignored
          const crdFiles = readdirSync(path.join(dir, 'dist', 'crds'));
          expect(crdFiles.length).toEqual(1);
          expect(crdFiles.includes(`${expectedFilename}.yaml`)).toBeTruthy();

          testingFileNames.push(crdFiles[0]);
        },
      },
    ],
    [
      TEST_SCENARIO_4,
      {
        format: SynthesisFormat.HELM,
        chartVersion: '1.1.1',
        config: {
          synth: {
            format: SynthesisFormat.PLAIN,
            chartVersion: '1.1.1',
          },
          imports: [
            'k8s',
            filename,
          ],
        },
        postSynth: async (dir: string) => {
          expect(generatedHelmChartExists(dir.concat('/dist'))).toBeTruthy();

          // K8s import must be ignored
          const crdFiles = readdirSync(path.join(dir, 'dist', 'crds'));
          expect(crdFiles.length).toEqual(1);
          expect(crdFiles.includes(`${expectedFilename}.yaml`)).toBeTruthy();

          testingFileNames.push(crdFiles[0]);
        },
      },
    ],
  ])('filename url hash remains the same across synthesis %s', async (_testName, synthOptions) => {
    await synth(synthOptions);
    await synth(synthOptions);
    await synth(synthOptions);

    const allEqual = (arr: string[]) => arr.every(item => item === arr[0]);
    expect(allEqual(testingFileNames)).toBeTruthy();
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

  const cdk8sApp = `
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

    const DEFAULT_OUTPUT_DIR = 'dist';
    const DEFAULT_PLUGINS_DIR = path.join(dir, '.cdk8s', 'plugins');

    // Defined config in cdk8s.yaml file
    const config: Config | undefined = options.config;

    // Mimicking defaults passed in synth handler
    const app = options.app ?? config?.app;
    const stdout = options.stdout;
    const output = options.output ?? config?.output ?? (!stdout ? DEFAULT_OUTPUT_DIR : undefined);
    const pluginsDir = options.pluginsDir ?? DEFAULT_PLUGINS_DIR;
    const validate = options.validate ?? true;
    const validationReportsOutputFile = options.reportsFile;
    const format = options.format ?? config?.synth?.format ?? SynthesisFormat.PLAIN;
    const chartApiVersion = options.chartApiVersion ?? config?.synth?.chartApiVersion ??
    (format === SynthesisFormat.HELM ? HelmChartApiVersion.V2: undefined);
    const chartVersion = options.chartVersion;

    fs.writeFileSync(path.join(dir, 'index.js'), cdk8sApp);

    if (config) {
      fs.writeFileSync(path.join(dir, 'cdk8s.yaml'), yaml.stringify(config));
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
        app: app ?? DEFAULT_APP,
        output: output,
        stdout: stdout,
        pluginsDir: pluginsDir,
        validate: validate,
        validationReportsOutputFile: validationReportsOutputFile ? path.join(dir, validationReportsOutputFile) : undefined,
        format: format,
        chartApiVersion: chartApiVersion,
        chartVersion: chartVersion,
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

function generatedHelmChartExists(dir: string): boolean {
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