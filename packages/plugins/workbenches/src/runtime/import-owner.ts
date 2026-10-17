import type { WorkbenchDescriptor } from 'workdsh-contracts';
import { inspectWorkbenchPackageArtifact } from './package-artifact.js';
import { validateWorkbenchPackageLayout } from './package-layout.js';
import { retainWorkbenchArtifact } from './retain-artifact.js';
import type { WorkbenchInstallationArchives } from './installation-archives.js';

/** Internal installation owner. The adapter must use the official installer and
 * journal unknown outcomes. This helper never declares a page active or performs
 * migrations, rollback, dependency resolution or activation on its own. */
export async function importWorkbenchArchive(input: {
  readonly installationRoot: string;
  readonly archivePath: string;
  readonly expected: { readonly packageName: string; readonly version: string; readonly workbenchId: string; readonly sha256?: string };
  readonly host: { readonly harnessVersion: string; readonly cordisVersion: string };
  readonly archives: Pick<WorkbenchInstallationArchives, 'retainVerified' | 'resolve'>;
  readonly isCompatible: (descriptor: WorkbenchDescriptor) => boolean;
  readonly authorize: () => void;
  readonly install: (retainedPath: string, signal?: AbortSignal, beforeInstall?: () => Promise<void>) => Promise<{ readonly exitCode: number }>;
}, signal?: AbortSignal) {
  signal?.throwIfAborted(); input.authorize();
  const artifact = await inspectWorkbenchPackageArtifact(input.archivePath, input.expected, signal);
  validateWorkbenchPackageLayout(artifact, input.host);
  if (!input.isCompatible(artifact.manifest.descriptor)) throw new Error('workbench/incompatible-package');
  try {
    const previous = input.archives.resolve(artifact.receipt.packageName, artifact.receipt.version);
    if (previous.sha256 !== artifact.receipt.sha256 || previous.workbenchId !== artifact.manifest.descriptor.id)
      throw new Error('workbench/installation-version-conflict');
  } catch (cause) {
    if (!(cause instanceof Error) || cause.message !== 'workbench/installation-archive-unavailable') throw cause;
  }
  signal?.throwIfAborted(); input.authorize();
  // Installation consumes this captured generation, not the selectable source
  // file which a developer could rebuild while the import is running.
  const expected = { ...artifact.receipt, workbenchId: artifact.manifest.descriptor.id };
  const path = await retainWorkbenchArtifact(input.installationRoot, input.archivePath, expected, signal);
  signal?.throwIfAborted(); input.authorize();
  const result = await input.install(path, signal);
  if (result.exitCode !== 0) throw new Error('workbench/package-install-failed');
  signal?.throwIfAborted(); input.authorize();
  // This verifies actual installed files before persisting their registration
  // authority. A package-manager receipt alone is insufficient.
  await input.archives.retainVerified({ ...expected, path }, input.authorize, signal);
  return Object.freeze({ installed: artifact.receipt, descriptor: artifact.manifest.descriptor });
}
