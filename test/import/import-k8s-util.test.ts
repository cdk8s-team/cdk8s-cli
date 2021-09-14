import { parseApiTypeName, safeParseJsonSchema } from '../../src/import/k8s-util';

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
    expect(parsed.definitions.MutatingWebhook.description).toEqual("_/console.log('hello')/*");
  });

  test('keys must be words', () => {

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

  test('values must be words', () => {

    const schema = {
      definitions: {
        MutatingWebhook: {
          description: "*/console.log('hello')/*",
          properties: {
            sideEffects: {
              description: 'some normal description',
              type: 'not a word',
            },
          },
          required: [
            'sideEffects',
          ],
          type: 'object',
        },
      },
    };
    expect(() => safeParseJsonSchema(JSON.stringify(schema))).toThrow("Value for key 'type' contains non standard characters");
  });

  test('array element values must be words', () => {

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
    expect(() => safeParseJsonSchema(JSON.stringify(schema))).toThrow("Value for key '1' contains non standard characters");
  });

});