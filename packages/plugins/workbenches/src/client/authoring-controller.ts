import type { WorkbenchRequirementsRevision } from 'workdsh-contracts';
import type { createWorkbenchDevelopmentClient } from './development-client.js';
import { createWorkbenchDevelopmentInstruction } from './development-instruction.js';

type DevelopmentClient = ReturnType<typeof createWorkbenchDevelopmentClient>;
/** Build the handoff only after the saved revision has a confirmed development receipt. */
export async function prepareSavedWorkbenchDevelopment(client: DevelopmentClient, saved: WorkbenchRequirementsRevision,
  identity: { readonly workbenchId: string; readonly packageName: string }, signal?: AbortSignal) {
  const entry = await associateSavedRequirements(client, saved, identity, signal);
  signal?.throwIfAborted();
  return Object.freeze({ entry, instruction: createWorkbenchDevelopmentInstruction(saved, entry.development) });
}
/** Reconcile a persisted requirements revision before attempting a guarded write.
 * This never saves requirements again or assumes a failed transport means no write.
 */
export async function associateSavedRequirements(client: DevelopmentClient, saved: WorkbenchRequirementsRevision,
  identity: { readonly workbenchId: string; readonly packageName: string }, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const entries = await client.list(signal);
  signal?.throwIfAborted();
  const current = entries.find(entry => entry.development.id === saved.developmentId);
  const confirm = (entry: Awaited<ReturnType<DevelopmentClient['create']>>) => {
    signal?.throwIfAborted();
    const development = entry.development;
    if (development.id !== saved.developmentId || development.requirementsRevision !== saved.id ||
      development.owner.organizationId !== saved.owner.organizationId || development.owner.ownerPrincipalId !== saved.owner.ownerPrincipalId ||
      development.workbenchId !== identity.workbenchId || development.packageName !== identity.packageName) throw new Error('workbench/development-response-mismatch');
    return entry;
  };
  if (!current) return confirm(await client.create(saved.developmentId, identity.workbenchId, identity.packageName, saved.id, signal));
  const development = current.development;
  if (development.owner.organizationId !== saved.owner.organizationId || development.owner.ownerPrincipalId !== saved.owner.ownerPrincipalId ||
    development.workbenchId !== identity.workbenchId || development.packageName !== identity.packageName) throw new Error('workbench/development-identity-conflict');
  if (development.requirementsRevision === saved.id) return confirm(current);
  if (saved.parentRevisionId !== development.requirementsRevision) throw new Error('workbench/requirements-revision-conflict');
  return confirm(await client.advanceRequirements(saved.developmentId, saved.id, development.revision, signal));
}
