import { promises } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { crdsArePresent, deriveFileName, findManifests, hashAndEncode, isHelmImport, isK8sImport, parseImports } from '../src/util';

describe('findManifests', () => {

  test('test read files', async () => {

    //WHEN we have this folder structure

    // Only look for files of this type
    const extensionFilter = 'k8s.yaml';
    // Create folders
    const baseDir: string = await promises.mkdtemp(path.join(tmpdir(), 'cdk8s-getFiles-test'));
    const emptySubDir: string = await promises.mkdtemp(path.join(baseDir, 'emptyDir'));
    const populatedSubDir: string = await promises.mkdtemp(path.join(baseDir, 'populatedDir'));
    const populatedSubDir2: string = await promises.mkdtemp(path.join(populatedSubDir, 'populatedDir2'));
    // Do not create a folder in this path
    const nonDir: string = path.join(baseDir, 'nonDir');
    //Create Files
    await promises.writeFile(path.join(populatedSubDir, `example.${extensionFilter}`), 'contents');
    await promises.writeFile(path.join(populatedSubDir, `example2.${extensionFilter}`), 'contents');
    await promises.writeFile(path.join(populatedSubDir2, `example3.${extensionFilter}`), 'contents');
    await promises.writeFile(path.join(populatedSubDir2, 'example4.txt'), 'contents');


    // THEN

    // Get the contents of the different folders
    const noFiles: string[] = await findManifests(emptySubDir);
    const yamlFiles: string[] = await findManifests(populatedSubDir);
    const noFilesEither: string[] = await findManifests(nonDir);

    // Empty sub directory should yield empty array
    expect(noFiles).toEqual([]);

    // Directory with files
    const expectedFiles: string [] = [
      path.join(populatedSubDir, `example.${extensionFilter}`),
      path.join(populatedSubDir, `example2.${extensionFilter}`),
      path.join(populatedSubDir2, `example3.${extensionFilter}`),
    ];
    expect(yamlFiles).toEqual(expectedFiles);

    //Bad directory name (non-existent) should yield an empty array
    expect(noFilesEither).toEqual([]);
  });
});

test('derive file name from url', () => {
  const devUrl = 'github:crossplane/crossplane@0.14.0';
  const rawUrl = 'https://raw.githubusercontent.com/jenkinsci/kubernetes-operator/master/chart/jenkins-operator/crds/jenkins-crd.yaml';
  const YamlFile = './foo/bar/baz/fooz.yaml';
  const YmlFile = './foo/bar/baz/fooz.yml';

  expect(deriveFileName(devUrl)).toEqual('crossplane');
  expect(deriveFileName(rawUrl)).toEqual('jenkins-crd');
  expect(deriveFileName(YamlFile)).toEqual('fooz');
  expect(deriveFileName(YmlFile)).toEqual('fooz');
});

test('parsing imports', () => {
  expect(parseImports('k8s@x.y.z').source).toEqual('k8s@x.y.z');
  expect(parseImports('k8s@x.y.z').moduleNamePrefix).toBeUndefined();

  expect(parseImports('crd:=url.com/crd.yaml').source).toEqual('url.com/crd.yaml');
  expect(parseImports('crd:=url.com/crd.yaml').moduleNamePrefix).toEqual('crd');
});

test('import is k8s', () => {
  expect(isK8sImport('k8s')).toBeTruthy();
  expect(isK8sImport('foo')).toBeFalsy();
});

test('import is helm', () => {
  expect(isHelmImport('helm:https://charts.bitnami.com/bitnami/mysql@9.10.10')).toBeTruthy();
  expect(isHelmImport('helm:https://kubernetes.github.io/ingress-nginx/ingress-nginx@4.8.0')).toBeTruthy();
  expect(isHelmImport('helm:https://lacework.github.io/helm-charts/lacework-agent@6.9.0')).toBeTruthy();
  expect(isK8sImport('foo')).toBeFalsy();
});

test('are crds presents in imports', () => {
  const imprts = [
    'k8s',
    'k8s@1.22',
    'foo.yaml',
    'github:crossplane/crossplane@0.14.0',
    'helm:https://charts.bitnami.com/bitnami/mysql@9.10.10',
    'helm:https://kubernetes.github.io/ingress-nginx/ingress-nginx@4.8.0',
    'helm:https://lacework.github.io/helm-charts/lacework-agent@6.9.0',
  ];

  expect(crdsArePresent(imprts)).toBeTruthy();
  expect(crdsArePresent(undefined)).toBeFalsy();
});

test('hash and encoding a string', () => {
  const testString = 'foo';
  const first = hashAndEncode(testString);
  const second = hashAndEncode(testString);

  expect(first === second).toBeTruthy();
});