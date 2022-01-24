import { promises } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { getFiles } from '../src/util';

describe('getFiles', () => {


  afterEach(() => {
    jest.clearAllMocks();
  });

  test('test read files', async () => {

    //WHEN we have this folder structure

    // Only look for files of this type
    const extensionFilter = 'k8s.yaml';
    // Create folders
    const baseDir: string = await promises.mkdtemp(path.join(tmpdir(), 'cdk8s-getFiles-test'));
    const emptySubDir: string = await promises.mkdtemp(path.join(baseDir, 'emptyDir'));
    const PopulatedSubDir: string = await promises.mkdtemp(path.join(baseDir, 'populatedDir'));
    const PopulatedSubDir2: string = await promises.mkdtemp(path.join(PopulatedSubDir, 'populatedDir2'));
    // Do not create a folder in this path
    const nonDir: string = path.join(baseDir, 'nonDir');
    //Create Files
    await promises.writeFile(path.join(PopulatedSubDir, `example.${extensionFilter}`), 'contents');
    await promises.writeFile(path.join(PopulatedSubDir, `example2.${extensionFilter}`), 'contents');
    await promises.writeFile(path.join(PopulatedSubDir2, `example3.${extensionFilter}`), 'contents');
    await promises.writeFile(path.join(PopulatedSubDir2, 'example4.txt'), 'contents');


    // THEN

    // Get the contents of the different folders
    const noFiles : string[] = await getFiles(emptySubDir);
    const yamlFiles : string[] = await getFiles(PopulatedSubDir);
    const NoFilesEither : string[] = await getFiles(nonDir);

    // Empty sub directory should yield empty array
    expect(noFiles).toEqual([]);

    // Directory with files
    const expectedFiles: string [] = [
      path.join(PopulatedSubDir, `example.${extensionFilter}`),
      path.join(PopulatedSubDir, `example2.${extensionFilter}`),
      path.join(PopulatedSubDir2, `example3.${extensionFilter}`),
    ];
    expect(yamlFiles).toEqual(expectedFiles);

    //Bad directory name (non-existent) should yield an empty array
    expect(NoFilesEither).toEqual([]);
  });
});