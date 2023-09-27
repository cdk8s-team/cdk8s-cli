import { testImportMatchSnapshot } from './util';
import { ImportHelm } from '../../src/import/helm';
import { parseImports } from '../../src/util';

const testChartUrl = 'helm:https://charts.bitnami.com/bitnami/mysql@9.10.10';

describe('importing helm chart', () => {
  // TODO add multiple chart urls to test. Especially after fixing Json2Jsii issues
  const spec = parseImports(testChartUrl);
  testImportMatchSnapshot(testChartUrl, async () => new ImportHelm(spec));
});

describe('helm chart import validations', () => {
  test('throws if url is not valid', () => {
    const testUrl = 'helm:fooBar@9.10.10';
    const spec = parseImports(testUrl);

    expect(() => {new ImportHelm(spec);}).toThrow('There was an error processing the helm chart url you passed in: helm:fooBar@9.10.10. Make sure it matches the format of \'helm:<repo-url>/<chart-name>@<chart-version>\'.');
  });

  test('throws if chart version is not valid', () => {
    const testUrl = 'helm:https://charts.bitnami.com/bitnami/mysql@9.10.+FooBar';
    const spec = parseImports(testUrl);

    expect(() => {new ImportHelm(spec);}).toThrow('helm:https://charts.bitnami.com/bitnami/mysql@9.10.+FooBar\' for chart version: \'9.10.+FooBar\' does not follow SemVer-2(https://semver.org/).');
  });
});