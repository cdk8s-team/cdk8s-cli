import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs-extra';
import * as yaml from 'yaml';
import { ManifestObjectDefinition } from '../../lib/import/crd';
import { Language } from '../../src/import/base';
import { ImportCustomResourceDefinition } from '../../src/import/crd';
import { testImportMatchSnapshot } from './util';

const fixtures = path.join(__dirname, 'fixtures');

async function withTempFixture(data: any, test: (fixture: string, cwd: string) => Promise<void>) {
  const tempDir = fs.mkdtempSync(os.tmpdir());
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