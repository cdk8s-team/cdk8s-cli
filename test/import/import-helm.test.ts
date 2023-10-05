import { testImportMatchSnapshot } from './util';
import { Language } from '../../src/import/base';
import { ImportHelm } from '../../src/import/helm';
import { parseImports } from '../../src/util';

// TODO add multiple chart urls to test. Especially after fixing Json2Jsii issues
describe.each([
  'helm:https://charts.bitnami.com/bitnami/mysql@9.10.10', // Contains schema and dependencies
  'helm:https://kubernetes.github.io/ingress-nginx/ingress-nginx@4.8.0', // Does not contain schema
])('importing helm chart %s', (testChartUrl) => {
  const spec = parseImports(testChartUrl);

  testImportMatchSnapshot('with typescript lanugage', async () => ImportHelm.fromSpec(spec));
  testImportMatchSnapshot('with python lanugage', async () => ImportHelm.fromSpec(spec), { targetLanguage: Language.PYTHON });
});

describe('helm chart import validations', () => {
  test('throws if url is not valid', async () => {
    const testUrl = 'helm:fooBar@9.10.10';
    const spec = parseImports(testUrl);

    await expect(() => ImportHelm.fromSpec(spec)).rejects.toThrow('Invalid helm URL: helm:fooBar@9.10.10. Must match the format: \'helm:<repo-url>/<chart-name>@<chart-version>\'.');
  });

  test('throws if chart version is not valid', async () => {
    const testUrl = 'helm:https://charts.bitnami.com/bitnami/mysql@9.10.+FooBar';
    const spec = parseImports(testUrl);

    await expect(() => ImportHelm.fromSpec(spec)).rejects.toThrow('Invalid chart version (9.10.+FooBar) in URL: helm:https://charts.bitnami.com/bitnami/mysql@9.10.+FooBar. Must follow SemVer-2 (see https://semver.org/).');
  });

  test('throws if url leads to no helm chart', async () => {
    const testUrl = 'helm:https://charts.bitnami.com/bitnami/mysql@1000.1000.1000';
    const spec = parseImports(testUrl);

    await expect(() => ImportHelm.fromSpec(spec)).rejects.toThrow();
  });
});