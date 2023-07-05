import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs-extra';
import * as yaml from 'yaml';
import { testImportMatchSnapshot } from './util';
import { readConfigSync, ImportSpec } from '../../src/config';
import { Language, ImportOptions } from '../../src/import/base';
import { ManifestObjectDefinition, ImportCustomResourceDefinition } from '../../src/import/crd';
import { importDispatch } from '../../src/import/dispatch';

const fixtures = path.join(__dirname, 'fixtures');

async function withTempFixture(data: any, test: (fixture: string, cwd: string) => Promise<void>) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdk8s-import-test'));
  const fixture = path.join(tempDir, 'fixture.yaml');
  try {
    if (Array.isArray(data)) {
      fs.writeFileSync(fixture, data.map(d => yaml.stringify(d)).join('\n---\n'));
    } else {
      fs.writeFileSync(fixture, yaml.stringify(data));
    }
    await test(fixture, tempDir);
  } finally {
    fs.removeSync(tempDir);
  }

}

// just drop files into the "fixtures" directory and we will import it as a crd
// and match it against a jest snapshot.
describe('snapshots', () => {
  for (const fixture of fs.readdirSync(fixtures)) {
    if (path.extname(fixture) !== '.yaml') {
      continue;
    }
    testImportMatchSnapshot(fixture, async () => ImportCustomResourceDefinition.fromSpec({ source: path.join(fixtures, fixture) }));
  }
});

test('fails if CRDs api version is not supported', async () => {
  const manifest = {
    apiVersion: 'voo',
    kind: 'CustomResourceDefinition',
  };
  await withTempFixture(manifest, async (fixture: string) => {
    await expect(() => ImportCustomResourceDefinition.fromSpec({ source: fixture })).rejects.toThrow('invalid CustomResourceDefinition manifest: "apiVersion" is "voo" but it should be one of: "apiextensions.k8s.io/v1beta1", "apiextensions.k8s.io/v1"');
  });
});

test('fails if manifest does not have a "spec" field', async () => {
  const manifest = {
    apiVersion: 'apiextensions.k8s.io/v1beta1',
    kind: 'CustomResourceDefinition',
  };
  await withTempFixture(manifest, async (fixture: string) => {
    await expect(() => ImportCustomResourceDefinition.fromSpec({ source: fixture })).rejects.toThrow('manifest does not have a "spec" attribute');
  });
});

test('fails if one apiObject in multiObject CRD is not a valid CRD', async () => {

  const manifest = [
    {
      apiVersion: 'apiextensions.k8s.io/v1beta1',
      kind: 'CustomResourceDefinition',
      metadata: {
        name: 'testMetadata',
      },
      spec: {
        group: 'testGroup',
        names: {
          kind: 'testNameKind',
        },
        versions: [{
          name: 'testVersionName',
          schema: {
            openAPIV3Schema: {
              type: 'testObject',
            },
          },
        }],
      },
    },
    {
      apiVersion: 'apiextensions.k8s.io/v1beta1',
      kind: 'CustomResourceDefinition',
    },
  ];
  await withTempFixture(manifest, async (fixture: string) => {
    await expect(() => ImportCustomResourceDefinition.fromSpec({ source: fixture })).rejects.toThrow('manifest does not have a "spec" attribute');
  });
});

test('can import a "List" of CRDs (kubectl get crds -o json)', async () => {

  const manifest = {
    kind: 'List',
    items: [
      {
        apiVersion: 'apiextensions.k8s.io/v1beta1',
        kind: 'CustomResourceDefinition',
        metadata: {
          name: 'crontabs.stable.example.com',
        },
        spec: {
          group: 'stable.example.com',
          versions: [
            {
              name: 'v1',
              served: true,
              storage: true,
            },
          ],
          scope: 'Namespaced',
          names: {
            plural: 'crontabs',
            singular: 'crontab',
            kind: 'OtherCronTab',
            shortNames: [
              'ct',
            ],
          },
          preserveUnknownFields: false,
          validation: {
            openAPIV3Schema: {
              type: 'object',
              properties: {
                spec: {
                  type: 'object',
                  properties: {
                    cronSpec: {
                      type: 'string',
                    },
                    image: {
                      type: 'string',
                    },
                    replicas: {
                      type: 'integer',
                    },
                  },
                },
              },
            },
          },
        },
      },
      {}, // verify that we skip empty
      {
        kind: 'List',
        items: [],
      },

      // nested lists
      {
        kind: 'List',
        items: [
          {
            apiVersion: 'apiextensions.k8s.io/v1beta1',
            kind: 'CustomResourceDefinition',
            spec: {
              group: 'foo.bar',
              version: 'v1',
              names: {
                kind: 'foo',
              },
            },
          },

          // skip non-CRD
          {
            apiVersion: 'apiextensions.k8s.io/v1beta1',
            kind: 'NonCustomResourceDefinition',
            spec: {
              group: 'foo.bar',
              names: { kind: 'foo' },
            },
          },
        ],
      },
      {
        apiVersion: 'apiextensions.k8s.io/v1beta1',
        kind: 'CustomResourceDefinition',
        metadata: {
          name: 'crontabs.stable.example.com',
        },
        spec: {
          group: 'stable.example.com',
          versions: [
            {
              name: 'v1',
              served: true,
              storage: true,
            },
          ],
          scope: 'Namespaced',
          names: {
            plural: 'crontabs',
            singular: 'crontab',
            kind: 'CronTab',
            shortNames: [
              'ct',
            ],
          },
          preserveUnknownFields: false,
          validation: {
            openAPIV3Schema: {
              type: 'object',
              properties: {
                spec: {
                  type: 'object',
                  properties: {
                    cronSpec: {
                      type: 'string',
                    },
                    image: {
                      type: 'string',
                    },
                    replicas: {
                      type: 'integer',
                    },
                  },
                },
              },
            },
          },
        },
      },
    ],
  };

  await withTempFixture(manifest, async (fixture) => {
    const importer = await ImportCustomResourceDefinition.fromSpec({ source: fixture });
    expect(importer.moduleNames).toEqual([
      'foo.bar',
      'stable.example.com',
    ]);
  });

});

describe('classPrefix can be used to add a prefix to all construct class names', () => {
  testImportMatchSnapshot('Foo', () => ImportCustomResourceDefinition.fromSpec({ source: path.join(fixtures, 'multi_object_crd.yaml') }), {
    classNamePrefix: 'Foo',
  });
});

describe('safe parsing', () => {

  test('description is sanitized', async () => {

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

    await withTempFixture(crd, async (fixture: string, cwd: string) => {
      const importer = await ImportCustomResourceDefinition.fromSpec({ source: fixture });
      await importer.import({ targetLanguage: Language.TYPESCRIPT, outdir: cwd });
      expect(fs.readFileSync(path.join(cwd, 'testGroup.ts'), { encoding: 'utf8' })).toMatchSnapshot();
    });
  });

  test('does not error for enums with spaces', async () => {

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
            properties: {
              usages: {
                description: 'Usages is the set of x509 usages that are requested for the certificate. Defaults to `digital signature` and `key encipherment` if not specified.',
                type: 'array',
                items: {
                  description: '\'KeyUsage specifies valid usage contexts for keys. See: https://tools.ietf.org/html/rfc5280#section-4.2.1.3      https://tools.ietf.org/html/rfc5280#section-4.2.1.12 Valid KeyUsage values are as follows: "signing", "digital signature", "content commitment", "key encipherment", "key agreement", "data encipherment", "cert sign", "crl sign", "encipher only", "decipher only", "any", "server auth", "client auth", "code signing", "email protection", "s/mime", "ipsec end system", "ipsec tunnel", "ipsec user", "timestamping", "ocsp signing", "microsoft sgc", "netscape sgc"\'',
                  type: 'string',
                  enum: [
                    'signing',
                    'digital signature',
                    'content commitment',
                    'key encipherment',
                    'key agreement',
                    'data encipherment',
                    'cert sign',
                    'crl sign',
                    'encipher only',
                    'decipher only',
                    'any',
                    'server auth',
                    'client auth',
                    'code signing',
                    'email protection',
                    's/mime',
                    'ipsec end system',
                    'ipsec tunnel',
                    'ipsec user',
                    'timestamping',
                    'ocsp signing',
                    'microsoft sgc',
                    'netscape sgc',
                  ],
                },
              },
            },
          },
        },
      },
    };

    await withTempFixture(crd, async (fixture: string, cwd: string) => {
      const importer = await ImportCustomResourceDefinition.fromSpec({ source: fixture });
      await importer.import({ targetLanguage: Language.TYPESCRIPT, outdir: cwd });
      const output = fs.readFileSync(path.join(cwd, 'testGroup.ts'), { encoding: 'utf8' });
      expect(output).toMatchSnapshot();
      expect(output).not.toContain('STRIPPED_BY_CDK8S');
    });
  });

  test('throws when key is illegal', async () => {

    const crd: ManifestObjectDefinition = {
      apiVersion: 'apiextensions.k8s.io/v1beta1',
      kind: 'CustomResourceDefinition',
      metadata: {
        name: 'testMetadata',
      },
      spec: {
        group: 'testGroup',
        names: {
          kind: 'testNameKind',
        },
        validation: {
          openAPIV3Schema: {
            'description': "*/console.log('hello')/*",
            'not a word': 'value',
          },
        },
      },
    };

    await withTempFixture(crd, async (fixture: string) => {
      await expect(() => ImportCustomResourceDefinition.fromSpec({ source: fixture })).rejects.toThrow("Key 'not a word' contains non standard characters");
    });

  });

  test('strips values when illegal', async () => {

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
          kind: 'its not ok to have spaces here',
        },
        validation: {
          openAPIV3Schema: {
            description: 'Its ok to have spaces here',
          },
        },
      },
    };

    await withTempFixture(crd, async (fixture: string, cwd: string) => {
      const importer = await ImportCustomResourceDefinition.fromSpec({ source: fixture });
      await importer.import({ targetLanguage: Language.TYPESCRIPT, outdir: cwd });
      expect(fs.readFileSync(path.join(cwd, 'testGroup.ts'), { encoding: 'utf8' })).toMatchSnapshot();
    });

  });

  test('detects invalid schema', async () => {

    const crd = {
      apiVersion: 'apiextensions.k8s.io/v1beta1',
      kind: 'CustomResourceDefinition',
      metadata: {
        name: 'testMetadata',
      },
      spec: {
        names: {
          kind: 'testNameKind',
        },
        validation: {
          openAPIV3Schema: {
            description: 'Its ok to have spaces here',
          },
        },
      },
    };

    await withTempFixture(crd, async (fixture: string) => {
      await expect(() => ImportCustomResourceDefinition.fromSpec({ source: fixture })).rejects.toThrow("must have required property 'group'");
    });

  });

});

test('given a prefix, we can import two crds with the same group id', async () => {

  const crd = (kind: string) => ({
    apiVersion: 'apiextensions.k8s.io/v1beta1',
    kind: 'CustomResourceDefinition',
    metadata: {
      name: 'testMetadata',
    },
    spec: {
      version: 'v1',
      group: 'testGroup',
      names: {
        kind,
      },
      validation: {
        openAPIV3Schema: {
          description: 'Some text',
        },
      },
    },
  });

  const crd1 = crd('kind1');
  const crd2 = crd('kind2');

  await withTempFixture(crd1, async (fixture1: string, _: string) => {
    const importer1 = await ImportCustomResourceDefinition.fromSpec({ source: fixture1 });

    await withTempFixture(crd2, async (fixture2: string, cwd: string) => {
      const importer2 = await ImportCustomResourceDefinition.fromSpec({ source: fixture2 });
      await importer1.import({ targetLanguage: Language.PYTHON, outdir: cwd, moduleNamePrefix: 'pref1' });
      await importer2.import({ targetLanguage: Language.PYTHON, outdir: cwd, moduleNamePrefix: 'pref2' });
      expect(fs.existsSync(path.join(cwd, 'pref1', 'testGroup', '_jsii', 'pref1_testGroup@0.0.0.jsii.tgz'))).toBeTruthy();
      expect(fs.existsSync(path.join(cwd, 'pref2', 'testGroup', '_jsii', 'pref2_testGroup@0.0.0.jsii.tgz'))).toBeTruthy();
      expect(fs.readFileSync(path.join(cwd, 'pref1', 'testGroup', '_jsii', '__init__.py'), { encoding: 'utf8' })).toMatchSnapshot();
      expect(fs.readFileSync(path.join(cwd, 'pref2', 'testGroup', '_jsii', '__init__.py'), { encoding: 'utf8' })).toMatchSnapshot();
    });
  });


});

describe('cdk8s.yaml file', () => {

  const jenkinsCRD: ImportSpec = {
    source: 'https://raw.githubusercontent.com/jenkinsci/kubernetes-operator/master/deploy/crds/jenkins.io_jenkins_crd.yaml',
  };

  let importOptions: ImportOptions;
  let tempDir: string;

  beforeEach(() => {
    // creates temp directory to run each test on
    tempDir = fs.mkdtempSync(path.join(os.tmpdir() + 'yaml-sync'));
    importOptions = {
      targetLanguage: Language.TYPESCRIPT,
      outdir: tempDir,
    };

    const defaultConfigPath = path.join(__dirname, 'cdk8s-template.yaml');
    process.chdir(tempDir);
    const defaultConfig = yaml.parse(fs.readFileSync(defaultConfigPath, 'utf-8'));
    fs.outputFileSync('cdk8s.yaml', yaml.stringify(defaultConfig));
  });

  test('can be read by default', async () => {
    const config = readConfigSync();
    expect(config.language).toEqual('typescript');
    expect(config.app).toEqual('node main.js');
    expect(config.imports?.length == 1).toBeTruthy();
    expect(config.imports?.includes('k8s')).toBeTruthy();
  });

  afterEach(() => {
    if (tempDir) {
      fs.removeSync(tempDir);
    };
  });

  test('is updated with new imports', async () => {
    await importDispatch([jenkinsCRD], {}, importOptions);

    const config = readConfigSync();
    expect(config.imports?.length == 2).toBeTruthy();
    expect(config.imports?.includes(jenkinsCRD.source)).toBeTruthy();
  });

  test('does not update with CRD that is imported twice', async () => {
    await importDispatch([jenkinsCRD], {}, importOptions);
    await importDispatch([jenkinsCRD], {}, importOptions);

    const config = readConfigSync();
    expect(config.imports?.length == 2).toBeTruthy();
  });

});