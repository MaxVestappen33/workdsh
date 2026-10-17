import type { WorkbenchDescriptor } from 'workdsh-contracts';
import { verifyInstalledWorkbenchArtifact } from './installed-artifact.js';
import type { WorkbenchInstallationArchives } from './installation-archives.js';
export interface WorkbenchBundleManager {
  listBundles(): Promise<readonly { name: string; version?: string; installed: boolean; enabled: boolean; availability: string; error?: unknown; rows?: readonly {entryId?: string}[] }[]>;
  setBundleEnabled(name: string, enabled: boolean): Promise<{ target: string; application: string; enabled?: boolean }>;
}
/** Official bundle selection controls persistence. Active business registration
 * is a separate observation; selection alone never proves a rendered page. */
export async function setWorkbenchBundleEnabled(input: {
  installationRoot: string; expected: { packageName: string; version: string; workbenchId: string; sha256: string };
  enabled: boolean; isCompatible: (descriptor: WorkbenchDescriptor) => boolean; archives: Pick<WorkbenchInstallationArchives, 'resolve'>;
  manager: WorkbenchBundleManager; authorize: () => void;
}, signal?: AbortSignal) {
  const expected = { ...input.expected }, enabled = input.enabled;
  const check = () => { signal?.throwIfAborted(); input.authorize(); };
  check();
  const retained = input.archives.resolve(expected.packageName, expected.version);
  if (retained.sha256 !== expected.sha256 || retained.workbenchId !== expected.workbenchId) throw new Error('workbench/installation-changed');
  const verified = await verifyInstalledWorkbenchArtifact(input.installationRoot, retained.path, expected, signal); check();
  if (enabled && !input.isCompatible(verified.manifest.descriptor)) throw new Error('workbench/incompatible-package');
  const bundles = await input.manager.listBundles(); check();
  const matches = bundles.filter(row => row.name === expected.packageName);
  if (matches.length !== 1 || !matches[0].installed || matches[0].version !== expected.version || matches[0].availability !== 'profile' || matches[0].error)
    throw new Error('workbench/bundle-unavailable');
  const result = await input.manager.setBundleEnabled(expected.packageName, enabled); check();
  if (result.target !== expected.packageName || !['applied', 'restart-required', 'overridden', 'failed', 'cancelled'].includes(result.application))
    throw new Error('workbench/invalid-activation-result');
  // Re-read desired selection instead of assuming the mutation result is final.
  const observed = (await input.manager.listBundles()).filter(row => row.name === expected.packageName); check();
  if (observed.length !== 1 || observed[0].version !== expected.version) throw new Error('workbench/installation-changed');
  await verifyInstalledWorkbenchArtifact(input.installationRoot, retained.path, expected, signal); check();
  return Object.freeze({ packageName: expected.packageName, version: expected.version,
    selected: observed[0].enabled, application: result.application,
    confirmed: result.application === 'applied' && observed[0].enabled === enabled && !observed[0].error,
    pendingRestart: result.application === 'restart-required' });
}
