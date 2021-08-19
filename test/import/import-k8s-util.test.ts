import { parseApiTypeName } from '../../src/import/k8s-util';

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