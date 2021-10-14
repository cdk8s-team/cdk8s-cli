import * as path from 'path';
import { promisify } from 'util';
import * as fs from 'fs-extra';
import { glob } from 'glob';
import { ImportBase, ImportOptions, Language } from '../../src/import/base';
import { mkdtemp } from '../../src/util';


jest.setTimeout(10 * 60_000);

export function testImportMatchSnapshot(name: string, fn: () => Promise<ImportBase>, options?: Partial<ImportOptions>) {

  test(name, async () => {
    await expectImportMatchSnapshot(fn, options);
  });
}

export async function expectImportMatchSnapshot(fn: () => Promise<ImportBase>, options?: Partial<ImportOptions>) {
  await mkdtemp(async workdir => {
    const importer = await fn();

    const languages = [Language.TYPESCRIPT];

    for (const lang of languages) {
      const jsiiPath = lang === Language.TYPESCRIPT ? path.join(workdir, '.jsii') : undefined;

      if (lang === Language.GO) {
        fs.writeFileSync(path.join(workdir, 'go.mod'), 'module integtest');
      }

      await importer.import({
        outdir: workdir,
        outputJsii: jsiiPath,
        targetLanguage: lang,
        ...options,
      });

      if (jsiiPath) {
        const manifest = JSON.parse((await fs.readFile(jsiiPath)).toString('utf-8'));

        // patch dependency versions in manifest because they are not stable
        manifest.dependencies = '__omitted__';
        manifest.jsiiVersion = '__omitted__';
        manifest.fingerprint = '<fingerprint>';
        expect(manifest).toMatchSnapshot();
      }

      const files = await promisify(glob)('**', {
        cwd: workdir,
        ignore: ['**/*.tgz'],
        nodir: true,
      });

      const map: Record<string, string> = {};
      for (const file of files) {
        const source = fs.readFileSync(path.join(workdir, file), 'utf-8');
        map[file] = source;
      }

      expect(map).toMatchSnapshot();
    }
  });
}
