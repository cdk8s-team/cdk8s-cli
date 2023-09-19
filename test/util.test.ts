import { promises } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { crdsArePresent, deriveFileName, findManifests, isK8sImport, parseImports } from '../src/util';

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
  const localFile = './foo/bar/baz/fooz.yaml';

  expect(deriveFileName(devUrl)).toEqual('crossplane');
  expect(deriveFileName(localFile)).toEqual('fooz');
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

test('are crds presents in imports', () => {
  const imprts = [
    'k8s',
    'foo.yaml',
    'github:crossplane/crossplane@0.14.0',
  ];

  expect(crdsArePresent(imprts)).toBeTruthy();
  expect(crdsArePresent(undefined)).toBeFalsy();
});