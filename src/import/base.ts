import * as path from 'path';
import { CodeMaker } from 'codemaker';
import * as fs from 'fs-extra';
import * as srcmak from 'jsii-srcmak';
import { mkdtemp } from '../util';

export enum Language {
  TYPESCRIPT = 'typescript',
  PYTHON = 'python',
  CSHARP = 'csharp',
  JAVA = 'java',
  GO = 'go',
}

export interface ImportOptions {
  readonly moduleNamePrefix?: string;
  readonly targetLanguage: Language;
  readonly outdir: string;
  readonly save?: boolean;

  /**
   * Path to copy the output .jsii file.
   * @default - jsii file is not emitted
   */
  readonly outputJsii?: string;

  /**
   * A prefix for all construct classes.
   *
   * @default - default is determined by the specific import type. For example
   * k8s imports will add a "Kube" prefix by default.
   */
  readonly classNamePrefix?: string;
}

export interface GenerateOptions {
  readonly classNamePrefix?: string;
}

export abstract class ImportBase {
  public abstract get moduleNames(): string[];

  protected abstract generateTypeScript(code: CodeMaker, moduleName: string, options: GenerateOptions): Promise<void>;

  public async import(options: ImportOptions) {
    const code = new CodeMaker();

    const outdir = path.resolve(options.outdir);
    await fs.mkdirp(outdir);
    const isTypescript = options.targetLanguage === Language.TYPESCRIPT;
    const { moduleNamePrefix } = options;

    if (this.moduleNames.length === 0) {
      console.error('warning: no definitions to import');
    }

    const mapFunc = ( origName: string ) => {
      let name = origName;
      switch (options.targetLanguage) {
        case Language.PYTHON:
        case Language.JAVA:
          name = name.split('.').reverse().join('.');
          break;
      }
      return {
        origName: origName,
        name: name,
      };
    };

    // sort to ensure python writes parent packages first, so children are not deleted
    const modules = this.moduleNames.map(mapFunc).sort((a: any, b: any) => a.name.localeCompare(b.name));

    for (const module of modules) {
      // output the name of the imported resource
      console.log(module.origName);

      const fileName = moduleNamePrefix ? `${moduleNamePrefix}-${module.name}.ts` : `${module.name}.ts`;
      code.openFile(fileName);
      code.indentation = 2;
      await this.generateTypeScript(code, module.origName, {
        classNamePrefix: options.classNamePrefix,
      });

      code.closeFile(fileName);

      if (isTypescript) {
        await code.save(outdir);
      }

      if (!isTypescript || options.outputJsii) {
        await mkdtemp(async staging => {

          // this is not typescript, so we generate in a staging directory and
          // use jsii-srcmak to compile and extract the language-specific source
          // into our project.
          await code.save(staging);

          // these are the module dependencies we compile against
          const deps = ['@types/node', 'constructs', 'cdk8s'];

          const opts: srcmak.Options = {
            entrypoint: fileName,
            moduleKey: moduleNamePrefix ? `${moduleNamePrefix}_${module.name}` : module.name,
            deps: deps.map(dep => path.dirname(require.resolve(`${dep}/package.json`))),
          };

          // used for testing.
          if (options.outputJsii) {
            opts.jsii = { path: options.outputJsii };
          }

          // python!
          if (options.targetLanguage === Language.PYTHON) {
            const moduleName = `${moduleNamePrefix ? `${moduleNamePrefix}.${module.name}` : module.name}`.replace(/-/g, '_');
            opts.python = {
              outdir: outdir,
              moduleName,
            };
          }

          // java!
          if (options.targetLanguage === Language.JAVA) {
            const javaName = module.name.replace(/\//g, '.').replace(/-/g, '_');
            opts.java = {
              outdir: '.',
              package: `imports.${moduleNamePrefix ? moduleNamePrefix + '.' + javaName : javaName}`,
            };
          }

          // go!
          if (options.targetLanguage === Language.GO) {
            const { userModuleName, userModulePath } = this.getGoModuleName(outdir);
            const relativeDir = path.relative(userModulePath, outdir);

            // go package names may only consist of letters or digits.
            // underscores are allowed too, but they are less idiomatic
            // this converts e.g. "cert-manager.path.to.url" to "certmanagerpathtourl"
            const importModuleName = module.name.replace(/[^A-Za-z0-9]/g, '').toLocaleLowerCase();

            opts.golang = {
              outdir: outdir,
              moduleName: `${userModuleName}/${relativeDir}`,
              packageName: moduleNamePrefix ? moduleNamePrefix + '_' + importModuleName : importModuleName,
            };
          }

          // csharp!
          if (options.targetLanguage === Language.CSHARP) {
            const csharpName = module.name.replace(/\//g, '.').replace(/-/g, '_').replace(/(?:^|_)([a-z])/g, (_, char) => char.toUpperCase());
            opts.csharp = {
              outdir: outdir,
              namespace: `Imports.${moduleNamePrefix ? moduleNamePrefix + '.' + csharpName : csharpName}`,
            };
          }

          await srcmak.srcmak(staging, opts);
        });
      }
    }
  }

  /**
   * Traverses up directories until it finds a directory with a go.mod file,
   * and parses the module name from the file.
   */
  private getGoModuleName(origOutdir: string) {
    let outdir = path.resolve(origOutdir);

    while (outdir !== path.dirname(outdir)) {
      const file = path.join(outdir, 'go.mod');

      if (fs.existsSync(file)) {
        const contents = fs.readFileSync(file, 'utf8');
        const matches = /module (.*)/.exec(contents);

        if (!matches) {
          throw new Error('Invalid go.mod file - could not find module path.');
        }

        return {
          userModuleName: matches[1],
          userModulePath: outdir,
        };
      }

      outdir = path.dirname(outdir);
    }

    throw new Error(`Cannot find go.mod file within ${origOutdir} or any of its parent directories.`);
  }
}
