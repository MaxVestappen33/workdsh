import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-api-session-controller';
import { assertActorContext } from 'workdsh-contracts';
import type { ActorContext, IdentityService, RuntimeBindingService, SessionOwnerBinding } from 'workdsh-contracts';
import type { ProjectTaskLink } from 'workdsh-contracts/projects';

const ownedBy = (owner: SessionOwnerBinding, actor: ActorContext): boolean =>
  owner.organizationId === actor.organizationId && owner.ownerPrincipalId === actor.principalId;

/** Request data cannot bind ownership. Use the Host identity and native cold read. */
export async function assertSessionAssociationAccess(ctx: Context, actor: ActorContext, sessionId: string, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  assertActorContext(actor);
  const access = ctx.get('workdshAccess') as RuntimeBindingService | undefined;
  const identity = ctx.get('workdshIdentity') as IdentityService | undefined;
  const controller = ctx.get('sessionController') as Context['sessionController'] | undefined;
  const protectedSessions = ctx.get('workdshSessionAccess') as Pick<Context['sessionController'], 'inspect'> | undefined;
  if (!access || !identity || !controller) throw new Error('projects/session-authority-unavailable');
  const resolved = await identity.resolve({ sessionId }, signal);
  if (resolved.principalId !== actor.principalId || resolved.organizationId !== actor.organizationId
    || identity.membership(actor.organizationId, actor.principalId)?.state !== 'active') throw new Error('projects/session-access-denied');
  const prior = access.sessionOwner(sessionId);
  if (prior && !ownedBy(prior, actor)) throw new Error('projects/session-access-denied');
  if (!prior && identity.profile().organization.kind !== 'personal' && !protectedSessions) throw new Error('projects/session-access-denied');
  const inspector = protectedSessions ?? controller;
  try { await inspector.inspect(sessionId as Parameters<typeof controller.inspect>[0], signal); }
  catch (cause) { signal?.throwIfAborted(); throw new Error('projects/session-unavailable', { cause }); }
  signal?.throwIfAborted();
  const current = await identity.resolve({ sessionId }, signal);
  if (current.principalId !== actor.principalId || current.organizationId !== actor.organizationId) throw new Error('projects/session-access-denied');
  let owner = access.sessionOwner(sessionId);
  if (!owner) {
    // Personal native sessions can predate Access bindings. Only a fixed
    // personal Host may adopt one that its native controller actually found.
    // Enterprise adoption remains exclusively owned by SessionAccessBridge.
    const profile = identity.profile();
    if (profile.organization.kind !== 'personal' || profile.principalId !== actor.principalId || profile.organization.id !== actor.organizationId) throw new Error('projects/session-access-denied');
    owner = await access.bindSession(current, { sessionId }, signal);
  }
  if (!ownedBy(owner, actor)) throw new Error('projects/session-access-denied');
}

/** Canonical comparison ignores ordering of selected refs, not their revisions. */
export function sameTaskBinding(left: ProjectTaskLink, right: ProjectTaskLink): boolean {
  const canonical = (task: ProjectTaskLink): string => JSON.stringify({
    projectId: task.projectId, sessionId: task.sessionId, title: task.title,
    configRevisionId: task.configRevisionId, workItemId: task.workItemId ?? null,
    capabilities: [...(task.capabilities ?? [])].map(ref => [ref.kind, ref.id, ref.revision ?? null]).sort(),
    references: [...(task.references ?? [])].map(ref => [ref.kind, ref.id, ref.revision]).sort(),
  });
  return canonical(left) === canonical(right);
}
