import { parseApiTypeName, safeParseJsonSchema } from '../../src/import/k8s-util';
import { SafeReviver } from '../../src/reviver';

test('parseApiTypeName', () => {
  expect(parseApiTypeName('io.k8s.api.extensions.v1.Deployment')).toStrictEqual({
    basename: 'Deployment',
    fullname: 'io.k8s.api.extensions.v1.Deployment',
    namespace: 'io.k8s.api.extensions',
    version: {
      raw: 'v1',
      major: 1,
      level: 'stable',
      subversion: 0,
    },
  });
  expect(parseApiTypeName('io.k8s.api.extensions.v1beta1.Deployment')).toStrictEqual({
    basename: 'Deployment',
    fullname: 'io.k8s.api.extensions.v1beta1.Deployment',
    namespace: 'io.k8s.api.extensions',
    version: {
      raw: 'v1beta1',
      major: 1,
      level: 'beta',
      subversion: 1,
    },
  });
  expect(parseApiTypeName('io.k8s.api.extensions.v2.Deployment')).toStrictEqual({
    basename: 'Deployment',
    fullname: 'io.k8s.api.extensions.v2.Deployment',
    namespace: 'io.k8s.api.extensions',
    version: {
      raw: 'v2',
      major: 2,
      level: 'stable',
      subversion: 0,
    },
  });
  expect(parseApiTypeName('io.v2alpha2.Deployment')).toStrictEqual({
    basename: 'Deployment',
    fullname: 'io.v2alpha2.Deployment',
    namespace: 'io',
    version: {
      raw: 'v2alpha2',
      major: 2,
      level: 'alpha',
      subversion: 2,
    },
  });
  expect(parseApiTypeName('io.intstr.IntOrString')).toStrictEqual({
    basename: 'IntOrString',
    fullname: 'io.intstr.IntOrString',
    namespace: 'io.intstr',
    version: undefined,
  });
});

describe('safeParseJsonSchema', () => {

  test('description is sanitized', () => {

    const schema = {
      definitions: {
        MutatingWebhook: {
          description: "*/console.log('hello')/*",
          properties: {
            sideEffects: {
              description: 'some normal description',
              type: 'string',
            },
          },
          required: [
            'sideEffects',
          ],
          type: 'object',
        },
      },
    };
    const parsed = safeParseJsonSchema(JSON.stringify(schema));
    expect(parsed.definitions?.MutatingWebhook?.description).toEqual("_/console.log('hello')/*");
  });

  test('throws when a key is illegal', () => {

    const schema = {
      definitions: {
        MutatingWebhook: {
          description: "*/console.log('hello')/*",
          properties: {
            'sideEffects': {
              description: 'some normal description',
              type: 'string',
            },
            'not a word': {
              type: 'string',
            },
          },
          required: [
            'sideEffects',
          ],
          type: 'object',
        },
      },
    };
    expect(() => safeParseJsonSchema(JSON.stringify(schema))).toThrow("Key 'not a word' contains non standard characters");
  });

  test('strips when value is illegal', () => {

    const schema = {
      definitions: {
        MutatingWebhook: {
          description: "*/console.log('hello')/*",
          properties: {
            sideEffects: {
              description: 'some normal description',
              type: 'string',
              somethingElse: 'not a word',
            },
          },
          required: [
            'sideEffects',
          ],
          type: 'object',
        },
      },
    };
    const parsed = safeParseJsonSchema(JSON.stringify(schema));
    // the 'somethingElse' key should be stripped because it contains spaces.
    expect(parsed.definitions?.MutatingWebhook?.properties?.sideEffects?.somethingElse).toEqual(SafeReviver.STRIPPED_VALUE);
  });

  test('strips array element values when illegal', () => {

    const schema = {
      definitions: {
        MutatingWebhook: {
          description: "*/console.log('hello')/*",
          properties: {
            sideEffects: {
              description: 'some normal description',
              type: 'string',
            },
          },
          required: [
            'sideEffects', 'not a word',
          ],
          type: 'object',
        },
      },
    };
    const parsed = safeParseJsonSchema(JSON.stringify(schema));
    expect(parsed.definitions?.MutatingWebhook?.required).toEqual(['sideEffects', SafeReviver.STRIPPED_VALUE]);
  });

  test('detects invalid schema', async () => {

    const schema = {
      definitions: {
        MutatingWebhook: {
          description: "*/console.log('hello')/*",
          properties: {
            sideEffects: {
              description: 'some normal description',
              type: 'not a valid type',
            },
          },
          required: [
            'sideEffects',
          ],
          type: 'object',
        },
      },
    };

    expect(() => safeParseJsonSchema(JSON.stringify(schema))).toThrow('schema is invalid');

  });

});