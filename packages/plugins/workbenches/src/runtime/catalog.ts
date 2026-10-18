import type { InstalledWorkbenchManifest } from './manifest.js';

export interface InstalledPackageSelection { readonly packageName: string; readonly enabled: boolean }
export interface WorkbenchCatalogRow {
  readonly packageName: string;
  readonly enabled: boolean;
  readonly manifest?: InstalledWorkbenchManifest;
  readonly errorCode?: string;
}
export interface WorkbenchManifestReader {
  read(packageName: string, signal?: AbortSignal): Promise<InstalledWorkbenchManifest | undefined>;
}
/** Inputs are the official Host inventory, including disabled bundles; not page-supplied names. */
export async function readWorkbenchCatalog(reader: WorkbenchManifestReader, packages: readonly InstalledPackageSelection[], signal?: AbortSignal): Promise<readonly WorkbenchCatalogRow[]> {
  signal?.throwIfAborted();
  if (packages.length > 1000) throw new Error('workbench/inventory-limit');
  if (new Set(packages.map(row => row.packageName)).size !== packages.length) throw new Error('workbench/duplicate-package-selection');
  const rows: WorkbenchCatalogRow[] = [];
  // Sequential bounded reads keep memory predictable; no package executable is imported.
  for (const selection of packages) {
    signal?.throwIfAborted();
    try {
      const manifest = await reader.read(selection.packageName, signal);
      signal?.throwIfAborted();
      if (manifest) rows.push({ ...selection, manifest });
    } catch (cause) {
      signal?.throwIfAborted();
      const message = cause instanceof Error ? cause.message : '';
      // Do not expose filesystem paths or arbitrary parser messages to clients.
      const errorCode = /^workbench\/[a-z-]+$/.test(message) ? message : 'workbench/manifest-unavailable';
      rows.push({ ...selection, errorCode });
    }
  }
  const counts = new Map<string, number>();
  for (const row of rows) if (row.manifest) counts.set(row.manifest.descriptor.id, (counts.get(row.manifest.descriptor.id) ?? 0) + 1);
  return Object.freeze(rows.map(row => Object.freeze(row.manifest && counts.get(row.manifest.descriptor.id)! > 1 ? { ...row, errorCode: 'workbench/duplicate-workbench-id' } : row)));
}
