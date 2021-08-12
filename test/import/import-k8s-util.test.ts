import { parseApiTypeName } from '../../src/import/k8s-util';

test('parseApiTypeName', () => {
  expect(parseApiTypeName('io.k8s.api.extensions.v1.Deployment')).toStrictEqual({ basename: 'Deployment', fullname: 'io.k8s.api.extensions.v1.Deployment', stability: 'stable', namespace: 'io.k8s.api.extensions', minor: 0, major: 1, fullVersion: 'v1' });
  expect(parseApiTypeName('io.k8s.api.extensions.v1beta1.Deployment')).toStrictEqual({ basename: 'Deployment', fullname: 'io.k8s.api.extensions.v1beta1.Deployment', stability: 'beta', namespace: 'io.k8s.api.extensions', minor: 1, major: 1, fullVersion: 'v1beta1' });
  expect(parseApiTypeName('io.k8s.api.extensions.v2.Deployment')).toStrictEqual({ basename: 'Deployment', fullname: 'io.k8s.api.extensions.v2.Deployment', stability: 'stable', namespace: 'io.k8s.api.extensions', minor: 0, major: 2, fullVersion: 'v2' });
  expect(parseApiTypeName('io.v2alpha2.Deployment')).toStrictEqual({ basename: 'Deployment', fullname: 'io.v2alpha2.Deployment', stability: 'alpha', namespace: 'io', minor: 2, major: 2, fullVersion: 'v2alpha2' });
  expect(parseApiTypeName('io.k8s.apimachinery.pkg.api.resource.Quantity')).toStrictEqual({ basename: 'Quantity', fullname: 'io.k8s.apimachinery.pkg.api.resource.Quantity', stability: 'stable', namespace: 'io.k8s.apimachinery.pkg.api.resource', minor: 0, major: 0, fullVersion: '' });
});