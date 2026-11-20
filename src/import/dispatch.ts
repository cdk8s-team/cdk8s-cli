import { ImportBase, ImportOptions } from './base';
import { ImportCustomResourceDefinition } from './crd';
import { matchCrdsDevUrl } from './crds-dev';
import { ImportHelm } from './helm';
import { ImportKubernetesApi } from './k8s';
import { ImportSpec, addImportToConfig } from '../config';
import { PREFIX_DELIM } from '../util';

/**
 * Categorized import specs for processing.
 */
interface CategorizedImports {
  /** Kubernetes API imports (k8s@version) */
  k8s: Array<{ spec: ImportSpec; importer: ImportKubernetesApi }>;
  /** Helm chart imports */
  helm: ImportSpec[];
  /** CRD imports without module name prefix (will be aggregated) */
  crdUnprefixed: ImportSpec[];
  /** CRD imports with module name prefix (processed individually to preserve prefix) */
  crdPrefixed: ImportSpec[];
}

/**
 * Categorizes import specs by type for appropriate processing.
 *
 * CRD imports without a module name prefix are grouped together so they can be
 * aggregated - this ensures CRDs from the same API group across different sources
 * are consolidated into a single module instead of overwriting each other.
 *
 * CRD imports with a module name prefix are kept separate since the prefix
 * indicates the user wants them in distinct modules.
 */
async function categorizeImports(imports: ImportSpec[], argv: any): Promise<CategorizedImports> {
  const result: CategorizedImports = {
    k8s: [],
    helm: [],
    crdUnprefixed: [],
    crdPrefixed: [],
  };

  for (const importSpec of imports) {
    // Check if it's a k8s@ import
    const k8sMatch = await ImportKubernetesApi.match(importSpec, argv);
    if (k8sMatch) {
      result.k8s.push({ spec: importSpec, importer: new ImportKubernetesApi(k8sMatch) });
      continue;
    }

    const prefix = importSpec.source.split(':')[0];

    // Check if it's a helm import
    if (prefix === 'helm') {
      result.helm.push(importSpec);
      continue;
    }

    // It's a CRD import - categorize by whether it has a module name prefix
    if (importSpec.moduleNamePrefix) {
      result.crdPrefixed.push(importSpec);
    } else {
      result.crdUnprefixed.push(importSpec);
    }
  }

  return result;
}

export async function importDispatch(imports: ImportSpec[], argv: any, options: ImportOptions) {
  const categorized = await categorizeImports(imports, argv);

  // Process k8s imports
  for (const { spec, importer } of categorized.k8s) {
    console.error('Importing resources, this may take a few moments...');
    await importer.import({
      moduleNamePrefix: spec.moduleNamePrefix,
      ...options,
    });
    if (options.save ?? true) {
      const specStr = spec.moduleNamePrefix ? `${spec.moduleNamePrefix}${PREFIX_DELIM}${spec.source}` : spec.source;
      await addImportToConfig(specStr);
    }
  }

  // Process helm imports
  for (const spec of categorized.helm) {
    const importer = await ImportHelm.fromSpec(spec);
    console.error('Importing resources, this may take a few moments...');
    await importer.import({
      moduleNamePrefix: spec.moduleNamePrefix,
      ...options,
    });
    if (options.save ?? true) {
      const specStr = spec.moduleNamePrefix ? `${spec.moduleNamePrefix}${PREFIX_DELIM}${spec.source}` : spec.source;
      await addImportToConfig(specStr);
    }
  }

  // Process CRD imports with prefix (individually, to preserve their prefixes)
  for (const spec of categorized.crdPrefixed) {
    // Check for crds.dev URL format
    const crdsDevUrl = matchCrdsDevUrl(spec.source);
    const importer = crdsDevUrl
      ? await ImportCustomResourceDefinition.fromSpec({ source: crdsDevUrl, moduleNamePrefix: spec.moduleNamePrefix })
      : await ImportCustomResourceDefinition.fromSpec(spec);

    console.error('Importing resources, this may take a few moments...');
    await importer.import({
      moduleNamePrefix: spec.moduleNamePrefix,
      ...options,
    });
    if (options.save ?? true) {
      const specStr = `${spec.moduleNamePrefix}${PREFIX_DELIM}${spec.source}`;
      await addImportToConfig(specStr);
    }
  }

  // Process unprefixed CRD imports together (aggregated)
  // This ensures CRDs from the same API group across different sources
  // are consolidated into a single module
  if (categorized.crdUnprefixed.length > 0) {
    // Transform sources to handle crds.dev URLs
    const resolvedSpecs = categorized.crdUnprefixed.map(spec => {
      const crdsDevUrl = matchCrdsDevUrl(spec.source);
      return crdsDevUrl ? { ...spec, source: crdsDevUrl } : spec;
    });

    console.error('Importing resources, this may take a few moments...');
    const importer = await ImportCustomResourceDefinition.fromSpecs(resolvedSpecs);
    await importer.import(options);

    // Save all sources to config
    if (options.save ?? true) {
      for (const spec of categorized.crdUnprefixed) {
        await addImportToConfig(spec.source);
      }
    }
  }
}

export async function matchImporter(importSpec: ImportSpec, argv: any): Promise<ImportBase> {

  // first check if its a `k8s@` import
  const k8s = await ImportKubernetesApi.match(importSpec, argv);
  if (k8s) {
    return new ImportKubernetesApi(k8s);
  }

  const prefix = importSpec.source.split(':')[0];

  if (prefix === 'helm') {
    return ImportHelm.fromSpec(importSpec);
  }

  // now check if its a crds.dev import
  const crdsDevUrl = matchCrdsDevUrl(importSpec.source);
  if (crdsDevUrl) {
    return ImportCustomResourceDefinition.fromSpec({ source: crdsDevUrl, moduleNamePrefix: importSpec.moduleNamePrefix });
  }

  // default to a normal CRD
  return ImportCustomResourceDefinition.fromSpec(importSpec);
}