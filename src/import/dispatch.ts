import { ImportBase, ImportOptions } from './base';
import { ImportCustomResourceDefinition } from './crd';
import { matchCrdsDevUrl } from './crds-dev';
import { ImportKubernetesApi } from './k8s';
import { ImportSpec, addImportToConfig } from '../config';
import { PREFIX_DELIM } from '../util';

export async function importDispatch(imports: ImportSpec[], argv: any, options: ImportOptions) {
  for (const importSpec of imports) {
    const importer = await matchImporter(importSpec, argv);

    if (!importer) {
      throw new Error(`unable to determine import type for "${importSpec}"`);
    }

    console.error('Importing resources, this may take a few moments...');

    await importer.import({
      moduleNamePrefix: importSpec.moduleNamePrefix,
      ...options,
    });

    if (options.save ?? true) {
      const spec = importSpec.moduleNamePrefix ? `${importSpec.moduleNamePrefix}${PREFIX_DELIM}${importSpec.source}` : importSpec.source;
      await addImportToConfig(spec);
    }
  }
}

async function matchImporter(importSpec: ImportSpec, argv: any): Promise<ImportBase> {

  // first check if its a `k8s@` import
  const k8s = await ImportKubernetesApi.match(importSpec, argv);
  if (k8s) {
    return new ImportKubernetesApi(k8s);
  }

  // now check if its a crds.dev import
  const crdsDevUrl = matchCrdsDevUrl(importSpec.source);
  if (crdsDevUrl) {
    return ImportCustomResourceDefinition.fromSpec({ source: crdsDevUrl, moduleNamePrefix: importSpec.moduleNamePrefix });
  }

  // default to a normal CRD
  return ImportCustomResourceDefinition.fromSpec(importSpec);
}
