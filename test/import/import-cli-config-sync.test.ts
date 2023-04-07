import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs-extra';
import * as yaml from 'yaml';
import { readConfigSync, addImportToConfig } from '../../src/config';
import { Language } from '../../src/import/base';
import { ManifestObjectDefinition } from '../../src/import/crd';
import { importDispatch } from '../../src/import/dispatch';

const configFilePath = path.join(__dirname, 'configOutput');
const jenkinsCRD = 'https://raw.githubusercontent.com/jenkinsci/kubernetes-operator/master/deploy/crds/jenkins.io_jenkins_crd.yaml';

async function withTempFixture(data: any, test: (fixture: string, configFile: string, cwd: string) => Promise<void>) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdk8s-import-test'));
  const fixture = path.join(tempDir, 'fixture.yaml');
  try {
    if (Array.isArray(data)) {
      fs.writeFileSync(fixture, data.map(d => yaml.stringify(d)).join('\n---\n'));
    } else {
      fs.writeFileSync(fixture, yaml.stringify(data));
    }
    await test(fixture, configFilePath, tempDir);
  } finally {
    fs.removeSync(tempDir);
    // clean up cdk8s.yaml file, reseting back to template:
    const defaultConfig = yaml.parse(fs.readFileSync(path.join(configFilePath, 'cdk8s-template.yaml'), 'utf-8'));
    await fs.outputFile(path.join(configFilePath, 'cdk8s.yaml'), yaml.stringify(defaultConfig));
  }
}

test('reading default config file works', async () => {

  // clean up cdk8s.yaml file, reseting back to template:
  const defaultConfig = yaml.parse(fs.readFileSync(path.join(configFilePath, 'cdk8s-template.yaml'), 'utf-8'));
  await fs.outputFile(path.join(configFilePath, 'cdk8s.yaml'), yaml.stringify(defaultConfig));
  const config1 = readConfigSync(configFilePath);
  expect(config1.language).toEqual('typescript');
  expect(config1.app).toEqual('node main.js');
  expect(config1.imports?.length == 1).toBeTruthy();
  expect(config1.imports?.includes('k8s')).toBeTruthy();
});

test('writing default config file works', async () => {
  await addImportToConfig(jenkinsCRD, configFilePath);
  const config2 = readConfigSync(configFilePath);
  expect(config2.imports).toEqual(['k8s', jenkinsCRD]);
  expect(config2.language).toEqual('typescript');
  expect(config2.app).toEqual('node main.js');

  // test importing duplicate does not add to config
  await addImportToConfig(jenkinsCRD, configFilePath);
  const config3 = readConfigSync(configFilePath);
  expect(config3).toEqual(config2);

  // clean up cdk8s.yaml file, reseting back to template:
  const defaultConfig = yaml.parse(fs.readFileSync(path.join(configFilePath, 'cdk8s-template.yaml'), 'utf-8'));
  await fs.outputFile(path.join(configFilePath, 'cdk8s.yaml'), yaml.stringify(defaultConfig));
});

test('can import crds from fixtures', async () => {

  const crd: ManifestObjectDefinition = {
    apiVersion: 'apiextensions.k8s.io/v1beta1',
    kind: 'CustomResourceDefinition',
    metadata: {
      name: 'testMetadata',
    },
    spec: {
      version: 'v1',
      group: 'testGroup',
      names: {
        kind: 'testNameKind',
      },
      validation: {
        openAPIV3Schema: {
          description: "*/console.log('hello')/*",
        },
      },
    },
  };

  await withTempFixture(crd, async (fixture: string, configFile: string, cwd: string) => {
    const config1 = readConfigSync(configFile);
    expect(fixture).not.toEqual(configFile);
    expect(config1.language).toEqual('typescript');
    expect(config1.app).toEqual('node main.js');
    expect(config1.imports).toEqual(['k8s']);

    await importDispatch([{ source: fixture }], 'argv', { targetLanguage: Language.TYPESCRIPT, outdir: cwd, configFilePath: configFilePath });
    const config2 = readConfigSync(configFilePath);
    expect(config2.language).toEqual('typescript');
    expect(config2.app).toEqual('node main.js');
    expect(config2.imports).toEqual(['k8s', fixture]);
  });
});