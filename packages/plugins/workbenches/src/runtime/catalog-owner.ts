import type { WorkbenchDescriptor } from 'workdsh-contracts';
import { readWorkbenchCatalog } from './catalog.js';
import { InstalledWorkbenchManifestReader } from './installed-manifest-reader.js';
import { verifyInstalledWorkbenchArtifact } from './installed-artifact.js';
import type { WorkbenchInstallationArchives } from './installation-archives.js';
import type { WorkbenchBundleManager } from './activation-owner.js';
import { observeWorkbenchRuntime, type WorkbenchRuntimeStatus, type WorkbenchPluginObservation } from './runtime-observation.js';
export type WorkbenchCatalogManager = WorkbenchBundleManager & { listPlugins(): Promise<readonly WorkbenchPluginObservation[]> };
export interface InstalledWorkbenchCatalogEntry{packageName:string;selected:boolean;descriptor?:WorkbenchDescriptor;version?:string;compatible?:boolean;registered?:boolean;installed?:{packageName:string;version:string;sha256:string};runtimeStatus?:WorkbenchRuntimeStatus;errorCode?:string}
/** Catalog includes disabled installed bundles. Selection, verified bytes and
 * live Host registration are separate facts; none claims a Client page rendered. */
export async function readInstalledWorkbenchCatalog(input: {
  installationRoot: string; archives: Pick<WorkbenchInstallationArchives, 'resolve'>;
  manager: WorkbenchCatalogManager; isCompatible: (descriptor: WorkbenchDescriptor) => boolean;
  registered: (packageName: string, version: string, sha256: string) => boolean;
  authorize: () => void;
}, signal?: AbortSignal):Promise<readonly InstalledWorkbenchCatalogEntry[]> {
  const check = () => { signal?.throwIfAborted(); input.authorize(); };
  check(); const bundles = await input.manager.listBundles(); check();
  const plugins = await input.manager.listPlugins(); check();
  const catalog = await readWorkbenchCatalog(new InstalledWorkbenchManifestReader(input.installationRoot),
    bundles.filter(row => row.installed && row.availability === 'profile').map(row => ({ packageName: row.name, enabled: row.enabled })), signal);
  const result:InstalledWorkbenchCatalogEntry[] = [];
  for (const row of catalog) {
    check();
    if (!row.manifest) { result.push(Object.freeze({ packageName: row.packageName, selected: row.enabled, errorCode: row.errorCode })); continue; }
    const manifest = row.manifest;
    const bundle = bundles.find(bundle => bundle.name === manifest.packageName && bundle.version === manifest.version);
    const runtimeStatus = bundle ? observeWorkbenchRuntime(bundle, plugins) : 'unknown';
    let errorCode = row.errorCode, installed, registered = false;
    if (!errorCode) try {
      const archive = input.archives.resolve(manifest.packageName, manifest.version);
      const verified = await verifyInstalledWorkbenchArtifact(input.installationRoot, archive.path,
        { packageName: manifest.packageName, version: manifest.version, workbenchId: manifest.descriptor.id, sha256: archive.sha256 }, signal);
      check(); installed = verified.receipt;
      registered = input.registered(manifest.packageName, manifest.version, verified.receipt.sha256);
    } catch { check(); errorCode = 'workbench/installation-unverified'; }
    result.push(Object.freeze({ packageName: manifest.packageName, descriptor: manifest.descriptor,
      version: manifest.version, selected: row.enabled, compatible: input.isCompatible(manifest.descriptor), installed, registered, runtimeStatus, errorCode }));
  }
  check(); return Object.freeze(result);
}
