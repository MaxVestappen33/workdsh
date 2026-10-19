// Domain tests supply explicit Host facts. They do not infer ownership from the
// session ID passed to linkTask, which is untrusted request data.
export function provideSessionAuthority(ctx, actor, options = {}) {
  const sessions = new Set(options.sessions ?? ['session-1', 'session-2', 'empty', 'default', 'bad']);
  const owners = options.owners ?? new Map([...sessions].map(sessionId => [sessionId, {
    sessionId, organizationId: actor.organizationId, ownerPrincipalId: actor.principalId, revision: 'fixture-owner-1',
  }]));
  const inspections = [];
  const membership = { organizationId: actor.organizationId, principalId: actor.principalId, state: 'active' };
  ctx.provide('workdshIdentity', {
    id: options.enterprise ? 'workdsh-enterprise-desktop' : 'workdsh-identity-local',
    resolve: async (_evidence, signal) => { signal?.throwIfAborted(); return actor; },
    profile: () => ({ principalId: actor.principalId, organization: { id: actor.organizationId, kind: options.enterprise ? 'team' : 'personal' }, membership, resolvedBy: actor.resolvedBy }),
    membership: (organizationId, principalId) => organizationId === actor.organizationId && principalId === actor.principalId ? membership : undefined,
  });
  ctx.provide('workdshAccess', {
    sessionOwner: sessionId => owners.get(sessionId),
    bindSession: async (current, { sessionId }, signal) => {
      signal?.throwIfAborted();
      if (owners.has(sessionId)) throw new Error('fixture/owner-already-bound');
      const binding = { sessionId, organizationId: current.organizationId, ownerPrincipalId: current.principalId, revision: 'fixture-owner-2' };
      owners.set(sessionId, binding);
      return binding;
    },
  });
  ctx.provide('sessionController', {
    inspect: async (sessionId, signal) => {
      signal?.throwIfAborted(); inspections.push(sessionId);
      if (!sessions.has(sessionId)) throw new Error('session/not-found');
      return { sessionId };
    },
  });
  return { sessions, owners, inspections };
}
