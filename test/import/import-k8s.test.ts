import { testImportMatchSnapshot } from './util';
import { ImportKubernetesApi } from '../../src/import/k8s';

const k8s = (v: string) =>
  testImportMatchSnapshot(`k8s@${v}`, async () => new ImportKubernetesApi({ apiVersion: v }));

k8s('1.17.0');
k8s('1.20.0');
k8s('1.21.0');
k8s('1.22.0');
