// import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs-extra';
import * as yaml from 'yaml';
// import { testImportMatchSnapshot } from './util';
import { readConfigSync, addImportToConfig } from '../../src/config';
// import { Language } from '../../src/import/base';
// import { ManifestObjectDefinition, ImportCustomResourceDefinition } from '../../src/import/crd';

// const fixtures = path.join(__dirname, 'fixtures');
const configFilePath = path.join(__dirname, 'configOutput');
const jenkinsCRD = 'https://raw.githubusercontent.com/jenkinsci/kubernetes-operator/master/deploy/crds/jenkins.io_jenkins_crd.yaml';

// async function withTempFixture(data: any, test: (fixture: string, configFile: string) => Promise<void>) {
//   const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdk8s-import-test'));
//   const fixture = path.join(tempDir, 'fixture.yaml');
//   // const outdir = path.join(tempDir, 'cdk8s.yaml');
//   try {
//     if (Array.isArray(data)) {
//       fs.writeFileSync(fixture, data.map(d => yaml.stringify(d)).join('\n---\n'));
//     } else {
//       fs.writeFileSync(fixture, yaml.stringify(data));
//     }
//     // if (Array.isArray(configYaml)) {
//     //   fs.writeFileSync(fixture, configYaml.map(d => yaml.stringify(d)).join('\n---\n'));
//     // } else {
//     //   fs.writeFileSync(fixture, configYaml.stringify(data));
//     // }
//     await test(fixture, configFilePath);
//   } finally {
//     fs.removeSync(tempDir);
//     // clean up cdk8s.yaml file, reseting back to template:
//     const defaultConfig = yaml.parse(fs.readFileSync(path.join(configFilePath, 'cdk8s-template.yaml'), 'utf-8'));
//     await fs.outputFile(path.join(configFilePath, 'cdk8s.yaml'), yaml.stringify(defaultConfig));
//   }

// }

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

  // test importing duplicate does not add to config
  await addImportToConfig(jenkinsCRD, configFilePath);
  const config3 = readConfigSync(configFilePath);
  expect(config3).toEqual(config2);
});

// test('cdk8s.yaml config file is updated', async () => {

//   const crd: ManifestObjectDefinition = {
//     apiVersion: 'apiextensions.k8s.io/v1beta1',
//     kind: 'CustomResourceDefinition',
//     metadata: {
//       name: 'testMetadata',
//     },
//     spec: {
//       version: 'v1',
//       group: 'testGroup',
//       names: {
//         kind: 'testNameKind',
//       },
//       validation: {
//         openAPIV3Schema: {
//           description: "*/console.log('hello')/*",
//         },
//       },
//     },
//   };

//   await withTempFixture(crd, async (fixture: string, configFile: string) => {
//     // default config imports should only be ['k8s']
//     const config1 = readConfigSync(configFile);
//     expect(fixture).not.toEqual(configFile);
//     // expect(config1).toEqual({});
//     expect(config1.language).toEqual('typescript');
//     expect(config1.app).toEqual('node main.js');
//     expect(config1.imports?.length == 1).toBeTruthy();
//     expect(config1.imports?.includes('k8s')).toBeTruthy();

//     // // test importing fixtures adds to config file
//     const importer = await ImportCustomResourceDefinition.fromSpec({ source: fixture }, configFile);
//     await importer.import({ targetLanguage: Language.TYPESCRIPT, outdir: cwd });
//     // const config2 = readConfigSync(configFile);
//     // expect(config2).toEqual('hello');
//     // expect(config2.imports).toBeDefined();
//     // expect(config2.imports!.length).toEqual(21);

//     //test importing crd from external link
//     // const jenkinsCRD = 'https://raw.githubusercontent.com/jenkinsci/kubernetes-operator/master/deploy/crds/jenkins.io_jenkins_crd.yaml';
//     // const importer2 = await ImportCustomResourceDefinition.fromSpec({ source: jenkinsCRD }, configFile);
//     // await importer2.import({ targetLanguage: Language.TYPESCRIPT, outdir: cwd });
//     // const config3 = readConfigSync(configFile);
//     // expect(config3.imports).toBeDefined();
//     // expect(config3.imports!.length).toEqual(22);
//     // expect(config3.imports?.includes(jenkinsCRD)).toBeTruthy();

//     // test that adding duplicate import does not change the config imports list
//     // const template = fs.readFileSync(path.join(c onfigFilePath, 'cdk8s-template.yaml'));
//     // const defaultConfig = yaml.parse(template);
//     // expect(defaultConfig).toBeUndefined();
//   });

//   // clean up cdk8s.yaml file, reseting back to template:
//   // const defaultConfig = yaml.parse(fs.readFileSync(path.join(configFilePath, 'cdk8s-template.yaml'), 'utf-8'));
//   // await fs.outputFile(path.join(configFilePath, 'cdk8s.yaml'), yaml.stringify(defaultConfig));
//   // const curConfigFile = readConfigSync(configFilePath);
//   // expect(curConfigFile.imports).toEqual(['k8s']);
//   // expect(defaultConfig.imports).toEqual(readConfigSync(configFilePath).imports);
// });