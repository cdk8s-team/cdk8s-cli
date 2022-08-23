import * as path from 'path';
import * as fs from 'fs-extra';
import * as yaml from 'yaml';
import { Config, ValidationConfig } from '../../src/config';
import { mkdtemp } from '../../src/util';

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

    await synth(validations, true);
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

    await synth(validationsFile, true, async (dir: string) => {
      fs.writeFileSync(path.join(dir, validationsFile), yaml.stringify(validations));
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

    await synth(validations, true, async (dir: string) => {
      fs.copySync(path.join(__dirname, '__resources__', 'validation-plugin'), path.join(dir, 'validation-plugin'));
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

    await synth(validations, true);

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

    await expect(() => synth(validations, true)).rejects.toThrow(/Unsupported package reference/);

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

    await expect(() => synth(validations, true)).rejects.toThrow('Code: 2');

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

    await synth(validations, false);
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

    await expect(() => synth(validations, true)).rejects.toThrow(/Cannot find module/);

  });

  test('synth fails when validations specify non existing plugin version', async () => {

    const validations: ValidationConfig[] = [{
      package: path.join(__dirname, '__resources__', 'validation-plugin'),
      version: '1.0.0',
      class: 'MockValidation',
      properties: {
        fail: true,
      },
    }];

    await expect(() => synth(validations, true)).rejects.toThrow(/Version mismatch for package/);

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

    await expect(() => synth(validations, true)).rejects.toThrow(/Unsupported version spec/);

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

    await expect(() => synth(validations, true)).rejects.toThrow(/Throwing per request/);

  });

});

async function synth(validations: string | ValidationConfig[], validate: boolean, preSynth?: (dir: string) => Promise<void>) {

  const app = `
const cdk8s = require('${require.resolve('cdk8s')}');
const app = new cdk8s.App();
new cdk8s.Chart(app, 'Chart');
app.synth();
`;

  await mkdtemp(async (dir: string) => {

    const config: Config = {
      validations,
      app: 'node index.js',
      output: 'dist',
    };

    fs.writeFileSync(path.join(dir, 'index.js'), app);
    fs.writeFileSync(path.join(dir, 'cdk8s.yaml'), yaml.stringify(config));

    const pwd = process.cwd();
    const exit = process.exit;
    try {
      process.chdir(dir);
      // our implementation does process.exit(2) so we need
      // to monkey patch it so we can assert on it.
      (process as any).exit = (code: number) => {
        throw new Error(`Code: ${code}`);
      };

      const cmd = requireSynth();
      if (preSynth) {
        await preSynth(dir);
      }
      await cmd.handler({ app: config.app, output: config.output, validate });
      if (validate) {
        // this file is written by our test plugin
        const marker = path.join(dir, 'validation-done.marker');
        expect(fs.existsSync(marker)).toBeTruthy();
      }
    } finally {
      process.chdir(pwd);
      (process as any).exit = exit;
    }

  });

}

function requireSynth() {
  const module = '../../src/cli/cmds/synth';
  // eslint-disable-next-line
  return require(module);
}
