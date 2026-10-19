import type { WorkbenchDescriptor } from 'workdsh-contracts';
import type { VerifyWorkbenchInstallation } from './host-registration.js';
import { verifyInstalledWorkbenchArtifact } from './installed-artifact.js';

export interface RetainedWorkbenchArchive {
  readonly path: string;
  readonly sha256: string;
  readonly workbenchId: string;
}
/** Owner resolves retained archive facts from its installation journal, never RPC. */
export function createWorkbenchInstallationVerifier(installationRoot: string,
  resolveArchive: (packageName: string, version: string, signal?: AbortSignal) => Promise<RetainedWorkbenchArchive>,
  isCompatible: (descriptor: WorkbenchDescriptor) => boolean): VerifyWorkbenchInstallation {
  return async (packageName, version, signal) => {
    const retained = { ...await resolveArchive(packageName,version,signal) };
    signal?.throwIfAborted();
    const artifact = await verifyInstalledWorkbenchArtifact(installationRoot,retained.path,
      { packageName,version,sha256:retained.sha256,workbenchId:retained.workbenchId },signal);
    return Object.freeze({ package:artifact.receipt, descriptor:artifact.manifest.descriptor,
      compatible:isCompatible(artifact.manifest.descriptor) });
  };
}
