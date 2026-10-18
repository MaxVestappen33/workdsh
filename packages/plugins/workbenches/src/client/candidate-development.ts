import type { WorkbenchDevelopment } from 'workdsh-contracts';
import type { createWorkbenchDevelopmentClient } from './development-client.js';

export type WorkbenchCandidateDevelopment = Pick<WorkbenchDevelopment,
  'id' | 'revision' | 'requirementsRevision' | 'iterationId' | 'workbenchId' | 'packageName' | 'target'>;

/** Read the persisted development binding instead of inventing an offline import
 * or a new iteration for an Agent-produced package. This is not an install receipt. */
export async function readWorkbenchCandidateDevelopment(
  client: Pick<ReturnType<typeof createWorkbenchDevelopmentClient>, 'list'>,
  developmentId: string, expected?: WorkbenchCandidateDevelopment, signal?: AbortSignal,
): Promise<WorkbenchCandidateDevelopment> {
  const entries = await client.list(signal);
  signal?.throwIfAborted();
  const development = entries.find(row => row.development.id === developmentId)?.development;
  if (!development) throw new Error('workbench/development-not-found');
  if (expected && (development.id !== expected.id || development.revision !== expected.revision ||
    development.requirementsRevision !== expected.requirementsRevision || development.iterationId !== expected.iterationId ||
    development.workbenchId !== expected.workbenchId || development.packageName !== expected.packageName ||
    JSON.stringify(development.target) !== JSON.stringify(expected.target)))
    throw new Error('workbench/development-revision-conflict');
  return Object.freeze({ id: development.id, revision: development.revision,
    requirementsRevision: development.requirementsRevision, iterationId: development.iterationId,
    workbenchId: development.workbenchId, packageName: development.packageName,
    target: Object.freeze({ ...development.target }) });
}

export function assertWorkbenchCandidateIdentity(development: WorkbenchCandidateDevelopment,
  candidate: { readonly package: { readonly packageName: string }; readonly descriptor: { readonly id: string } }) {
  if (candidate.package.packageName !== development.packageName || candidate.descriptor.id !== development.workbenchId)
    throw new Error('workbench/package-identity-mismatch');
}
