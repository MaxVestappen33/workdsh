import { realpath } from 'node:fs/promises';
import { join } from 'node:path';
import type { WorkbenchDevelopmentOperation } from 'workdsh-contracts';
import { importWorkbenchArchive } from './import-owner.js';
import { verifyInstalledWorkbenchArtifact } from './installed-artifact.js';
import { inspectWorkbenchPackageArtifact } from './package-artifact.js';
import { validateWorkbenchPackageLayout } from './package-layout.js';
import { InstalledWorkbenchManifestReader } from './installed-manifest-reader.js';
import type { WorkbenchOperationAdapter } from './operation-runner.js';

type ImportInput = Parameters<typeof importWorkbenchArchive>[0];
/** Concrete journal adapter. Recovery inspects retained bytes and installed
 * files, never invokes the installer a second time. No activation claim. */
export function createWorkbenchImportOperationAdapter(input: ImportInput & {
  readonly expected: ImportInput['expected'] & { readonly sha256: string };
  readonly target: WorkbenchDevelopmentOperation['target'];
  readonly checkInstalledBaseline?: (operation: WorkbenchDevelopmentOperation, signal?: AbortSignal) => Promise<void>;
}): WorkbenchOperationAdapter {
  const expected = Object.freeze({ ...input.expected });
  const target = Object.freeze({ ...input.target });
  const check = (operation: WorkbenchDevelopmentOperation, signal?: AbortSignal) => {
    signal?.throwIfAborted(); input.authorize();
    if (!['install', 'update'].includes(operation.kind) || operation.inputHash !== expected.sha256 ||
        JSON.stringify(operation.target) !== JSON.stringify(target)) throw new Error('workbench/operation-input-conflict');
  };
  const inspect = async (operation: WorkbenchDevelopmentOperation, signal?: AbortSignal) => {
    check(operation, signal);
    const root = await realpath(input.installationRoot);
    const archive = join(root, '.workdsh-workbench-archives', `${expected.sha256}.tgz`);
    const verified = await verifyInstalledWorkbenchArtifact(root, archive, expected, signal);
    check(operation, signal);
    await input.archives.retainVerified({ ...expected, path: archive }, input.authorize, signal);
    check(operation, signal);
    return { state: 'succeeded' as const, receipt: { package: verified.receipt, pendingRestart: false } };
  };
  const checkBaseline = async (operation: WorkbenchDevelopmentOperation, signal?: AbortSignal) => {
    if (operation.kind === 'update') {
      if (!operation.expectedInstalledHash) throw new Error('workbench/installation-baseline-unavailable');
      const manifest = await new InstalledWorkbenchManifestReader(input.installationRoot).read(expected.packageName, signal);
      if (!manifest || manifest.descriptor.id !== expected.workbenchId) throw new Error('workbench/installation-baseline-conflict');
      const retained = input.archives.resolve(expected.packageName, manifest.version);
      if (retained.sha256 !== operation.expectedInstalledHash || retained.workbenchId !== expected.workbenchId)
        throw new Error('workbench/installation-baseline-conflict');
      await verifyInstalledWorkbenchArtifact(input.installationRoot, retained.path,
        { packageName: expected.packageName, version: manifest.version, workbenchId: expected.workbenchId, sha256: operation.expectedInstalledHash }, signal);
    } else {
      if (operation.expectedInstalledHash) throw new Error('workbench/operation-input-conflict');
      // Missing package permits a first install. Existing or unreadable packages
      // require an explicit update; malformed manifests must never count as absent.
      try {
        await new InstalledWorkbenchManifestReader(input.installationRoot).read(expected.packageName, signal);
      } catch (cause) {
        if (cause && typeof cause === 'object' && 'code' in cause && cause.code === 'ENOENT') return;
        throw cause;
      }
      throw new Error('workbench/installation-already-present');
    }
  };
  return {
    async preflight(operation, signal) {
      check(operation, signal);
      const artifact = await inspectWorkbenchPackageArtifact(input.archivePath, expected, signal);
      validateWorkbenchPackageLayout(artifact, input.host);
      if (!input.isCompatible(artifact.manifest.descriptor)) throw new Error('workbench/incompatible-package');
      check(operation, signal);
      await checkBaseline(operation, signal);
      await input.checkInstalledBaseline?.(operation, signal); check(operation, signal);
    },
    async execute(operation, signal) { check(operation, signal); return importWorkbenchArchive({ ...input, expected, install: (path, installSignal) => input.install(path, installSignal, async () => {
      check(operation, installSignal); await checkBaseline(operation, installSignal);
      await input.checkInstalledBaseline?.(operation, installSignal); check(operation, installSignal);
    }) }, signal); },
    async verify(operation, _result, signal) { return inspect(operation, signal); },
    async inspect(operation, signal) { return inspect(operation, signal); },
  };
}
