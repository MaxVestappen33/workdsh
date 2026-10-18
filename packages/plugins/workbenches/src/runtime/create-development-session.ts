import { createHash } from 'node:crypto';
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-api-session-controller';
import type { ActorContext, IdentityService, RuntimeBindingService, WorkbenchDevelopment } from 'workdsh-contracts';
import { ensureWorkbenchDevelopmentWorkspace } from './development-workspace.js';

/** Deterministic native identity survives a lost creation response. Official
 * create owns same-id adoption; source/access validation remains mandatory. */
export async function createNativeWorkbenchDevelopmentSession(ctx: Context, actor: ActorContext,
  development: WorkbenchDevelopment, title: string, signal?: AbortSignal) {
  const identity = ctx.get('workdshIdentity') as IdentityService | undefined;
  const access = ctx.get('workdshAccess') as RuntimeBindingService | undefined;
  const native = ctx.get('sessionController') as Context['sessionController'] | undefined;
  type SessionRequest = Parameters<Context['sessionController']['create']>[0];
  type SessionResult = Awaited<ReturnType<Context['sessionController']['create']>>;
  const protectedSessions = ctx.get('workdshSessionAccess') as { create(request: SessionRequest, signal?: AbortSignal): Promise<SessionResult> } | undefined;
  if (!identity || !access || !native) throw new Error('workbench/session-authority-unavailable');
  const authorize = () => {
    signal?.throwIfAborted(); ctx.fiber.assertActive();
    const profile = identity.profile();
    if (profile.principalId !== actor.principalId || profile.organization.id !== actor.organizationId ||
      profile.resolvedBy !== actor.resolvedBy || identity.membership(actor.organizationId, actor.principalId)?.state !== 'active' ||
      development.owner.ownerPrincipalId !== actor.principalId || development.owner.organizationId !== actor.organizationId)
      throw new Error('workbench/development-access-denied');
    if (profile.organization.kind !== 'personal' && !protectedSessions) throw new Error('workbench/session-authority-unavailable');
  };
  authorize();
  if (development.session) return development.session;
  const id = `session-${createHash('sha256').update(JSON.stringify([actor.organizationId, actor.principalId,
    development.target.hostId, development.target.installationId, development.id])).digest('hex').slice(0, 32)}`;
  const prior = access.sessionOwner(id);
  if (prior && (prior.ownerPrincipalId !== actor.principalId || prior.organizationId !== actor.organizationId)) throw new Error('workbench/development-access-denied');
  const workspace = await ensureWorkbenchDevelopmentWorkspace(ctx, development, title, authorize, signal);
  authorize();
  const request: SessionRequest = { sessionId: id as SessionRequest['sessionId'], workspaceId: workspace.workspaceId, agentPreset: 'cordis' };
  const created = protectedSessions ? await protectedSessions.create(request, signal) : await native.create(request);
  authorize();
  if (String(created.sessionId) !== id) throw new Error('workbench/development-session-conflict');
  // Creation can adopt an existing id. Its actual preset, rather than our
  // requested value, decides whether the official development tools are present.
  if (created.agentPreset !== 'cordis') throw new Error('workbench/development-creator-required');
  let owner = access.sessionOwner(id);
  if (!owner && identity.profile().organization.kind === 'personal') owner = await access.bindSession(actor, { sessionId: id }, signal);
  authorize();
  if (!owner || owner.ownerPrincipalId !== actor.principalId || owner.organizationId !== actor.organizationId) throw new Error('workbench/development-access-denied');
  return Object.freeze({ hostId: development.target.hostId, sessionId: id });
}
