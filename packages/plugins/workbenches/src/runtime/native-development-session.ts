import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-api-session-controller';
import type { ActorContext, IdentityService, RuntimeBindingService } from 'workdsh-contracts';
import { createWorkbenchDevelopmentSessionVerifier } from './development-session.js';

/** Native Host adaptation. Session creation/access binding is owned by the
 * existing platform; this adapter cannot adopt someone else's or unowned Session. */
export function createNativeWorkbenchDevelopmentSessionVerifier(ctx: Context, sessionId: string) {
  const identity = ctx.get('workdshIdentity') as IdentityService | undefined;
  const access = ctx.get('workdshAccess') as RuntimeBindingService | undefined;
  const native = ctx.get('sessionController') as Context['sessionController'] | undefined;
  const protectedSessions = ctx.get('workdshSessionAccess') as Pick<Context['sessionController'], 'inspect'> | undefined;
  if (!identity || !access || !native) throw new Error('workbench/session-authority-unavailable');
  const authorize = async (actor: ActorContext, id: string, signal?: AbortSignal) => {
    signal?.throwIfAborted();
    const current = await identity.resolve({ sessionId: id }, signal);
    signal?.throwIfAborted();
    const owner = access.sessionOwner(id);
    const profile = identity.profile();
    if (current.principalId !== actor.principalId || current.organizationId !== actor.organizationId ||
      profile.principalId !== actor.principalId || profile.organization.id !== actor.organizationId ||
      current.resolvedBy !== actor.resolvedBy || identity.membership(actor.organizationId, actor.principalId)?.state !== 'active' ||
      !owner || owner.ownerPrincipalId !== actor.principalId || owner.organizationId !== actor.organizationId ||
      (profile.organization.kind !== 'personal' && !protectedSessions)) throw new Error('workbench/development-access-denied');
  };
  const inspector = protectedSessions ?? native;
  return createWorkbenchDevelopmentSessionVerifier(sessionId, {
    authorize,
    inspect: (id, signal) => inspector.inspect(id as Parameters<typeof native.inspect>[0], signal),
  });
}
