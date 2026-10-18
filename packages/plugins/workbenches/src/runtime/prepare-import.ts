import { join } from 'node:path';
import { inspectWorkbenchPackageArtifact } from './package-artifact.js';
import { validateWorkbenchPackageLayout } from './package-layout.js';
import { InstalledWorkbenchManifestReader } from './installed-manifest-reader.js';
import { verifyInstalledWorkbenchArtifact } from './installed-artifact.js';
import type { WorkbenchDescriptor } from 'workdsh-contracts';
import type { WorkbenchInstallationArchives } from './installation-archives.js';
/** Read-only Host preparation. It derives update baseline from actual installed
 * files; confirmation still rechecks it before any package mutation. */
export async function prepareWorkbenchImport(input: {
  installationRoot: string;
  expected: { packageName: string; version: string; workbenchId: string; sha256: string };
  host: { harnessVersion: string; cordisVersion: string };
  archives: Pick<WorkbenchInstallationArchives, 'resolve'>;
  isCompatible: (descriptor: WorkbenchDescriptor) => boolean;
  authorize: () => void;
}, signal?: AbortSignal) {
  const expected = Object.freeze({ ...input.expected });
  const check = () => { signal?.throwIfAborted(); input.authorize(); };
  check();
  if (!/^[a-f0-9]{64}$/.test(expected.sha256)) throw new Error('workbench/package-hash-mismatch');
  const artifact = await inspectWorkbenchPackageArtifact(join(input.installationRoot, '.workdsh-workbench-archives', `${expected.sha256}.tgz`), expected, signal);
  validateWorkbenchPackageLayout(artifact, input.host);
  if (!input.isCompatible(artifact.manifest.descriptor)) throw new Error('workbench/incompatible-package');
  check();
  let manifest;
  try { manifest = await new InstalledWorkbenchManifestReader(input.installationRoot).read(expected.packageName, signal); }
  catch (cause) {
    if (cause && typeof cause === 'object' && 'code' in cause && cause.code === 'ENOENT') {
      check(); return Object.freeze({ kind: 'install' as const, package: artifact.receipt });
    }
    throw cause;
  }
  if (!manifest || manifest.descriptor.id !== expected.workbenchId) throw new Error('workbench/installation-baseline-conflict');
  const retained = input.archives.resolve(expected.packageName, manifest.version);
  const verified = await verifyInstalledWorkbenchArtifact(input.installationRoot, retained.path,
    { packageName: expected.packageName, version: manifest.version, workbenchId: expected.workbenchId, sha256: retained.sha256 }, signal);
  check();
  return Object.freeze({ kind: 'update' as const, package: artifact.receipt, installedVersion: manifest.version, expectedInstalledHash: verified.receipt.sha256 });
}
