import type { ActorContext, IdentityService } from 'workdsh-contracts';
/** Host identity owns profile management roles. Ordinary members need a
 * separately verified development association; caller role claims are ignored. */
export function createWorkbenchActivationAccess(identity: IdentityService, actor: ActorContext,
  assertActive: () => void, signal?: AbortSignal) {
  const checkIdentity = () => {
    signal?.throwIfAborted(); assertActive();
    const profile = identity.profile(), membership = identity.membership(actor.organizationId, actor.principalId);
    if (profile.principalId !== actor.principalId || profile.organization.id !== actor.organizationId || profile.resolvedBy !== actor.resolvedBy ||
        membership?.state !== 'active') throw new Error('workbench/development-access-denied');
    return membership;
  };
  const initial = checkIdentity();
  const profileManager = initial.role === 'owner' || initial.role === 'admin';
  let associated = false;
  return Object.freeze({ profileManager,
    checkIdentity: () => { checkIdentity(); },
    confirmDevelopmentAssociation: () => { checkIdentity(); associated = true; },
    authorize: () => {
      const current = checkIdentity();
      if (profileManager ? !['owner', 'admin'].includes(current.role) : !associated)
        throw new Error('workbench/development-access-denied');
    },
  });
}
