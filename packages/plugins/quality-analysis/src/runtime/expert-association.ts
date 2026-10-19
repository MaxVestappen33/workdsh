import type { Context } from '@deepseek-ai/cordis';
import type { ExpertsService, ExecutionCreation, IdentityService, RuntimeBindingService } from 'workdsh-contracts';

export interface QualityExpertAssociation {
  readonly recordId: string;
  readonly runId: string;
  readonly contentHash: string;
  readonly sessionId: string;
  readonly expertId: string;
  readonly expertRevisionId: string;
  readonly compositionDigest: string;
  readonly creationOperationId: string;
}

/** Internal Host admission after governed expert task creation. Never pass a
 * page-supplied creation receipt here. The caller persists this association
 * against the same fixed run before exposing the expert Session as a source. */
export async function verifyQualityExpertAssociation(
  ctx: Context,
  view: Pick<QualityExpertAssociation, 'recordId' | 'runId' | 'contentHash'>,
  creation: ExecutionCreation,
  verifyRun: () => Promise<unknown>,
  signal?: AbortSignal,
): Promise<Readonly<QualityExpertAssociation>> {
  const identity = ctx.get('workdshIdentity') as IdentityService | undefined;
  const access = ctx.get('workdshAccess') as RuntimeBindingService | undefined;
  const experts = ctx.get('workdshExperts') as Pick<ExpertsService, 'verifyBinding'> | undefined;
  if (!identity || !access || !experts) throw Error('quality/service/expert-unavailable');
  if (!view.recordId.trim() || view.recordId.length > 128 || !view.runId.trim() || view.runId.length > 128 || !/^[a-f0-9]{64}$/.test(view.contentHash)) throw Error('quality/request/invalid');
  const actor = await identity.resolve(undefined, signal);
  const authorize = () => {
    signal?.throwIfAborted(); ctx.fiber.assertActive();
    const profile = identity.profile(), owner = access.sessionOwner(creation.sessionId);
    if (profile.principalId !== actor.principalId || profile.organization.id !== actor.organizationId || profile.resolvedBy !== actor.resolvedBy || identity.membership(actor.organizationId, actor.principalId)?.state !== 'active' || owner?.organizationId !== actor.organizationId || owner.ownerPrincipalId !== actor.principalId) throw Error('quality/service/access-denied');
  };
  authorize(); await verifyRun(); authorize();
  const binding = await experts.verifyBinding(actor, creation.sessionId, signal);
  authorize(); await verifyRun(); authorize();
  const expected = creation.binding;
  if (binding.sessionId !== creation.sessionId || expected.sessionId !== creation.sessionId || binding.owner.organizationId !== actor.organizationId || binding.owner.ownerPrincipalId !== actor.principalId || binding.delegation || binding.creationOperationId !== expected.creationOperationId || binding.compositionDigest !== expected.compositionDigest || binding.presetRevisionRef !== expected.presetRevisionRef || binding.expertRevisionRef.expertId !== expected.expertRevisionRef.expertId || binding.expertRevisionRef.revisionId !== expected.expertRevisionRef.revisionId) throw Error('quality/service/expert-binding-conflict');
  return Object.freeze({ recordId: view.recordId, runId: view.runId, contentHash: view.contentHash, sessionId: binding.sessionId, expertId: binding.expertRevisionRef.expertId, expertRevisionId: binding.expertRevisionRef.revisionId, compositionDigest: binding.compositionDigest, creationOperationId: binding.creationOperationId });
}

/** Revalidate a persisted association before reading its existing native events.
 * No task creation, Agent resume, model request or broadened tool permission. */
export async function readQualityExpertInterpretation(
  ctx: Context,
  association: QualityExpertAssociation,
  verifyRun: () => Promise<unknown>,
  signal?: AbortSignal,
) {
  const identity = ctx.get('workdshIdentity') as IdentityService | undefined;
  const experts = ctx.get('workdshExperts') as Pick<ExpertsService, 'verifyBinding'> | undefined;
  if (!identity || !experts) throw Error('quality/service/expert-unavailable');
  const actor = await identity.resolve(undefined, signal);
  const binding = await experts.verifyBinding(actor, association.sessionId, signal);
  if (binding.expertRevisionRef.expertId !== association.expertId || binding.expertRevisionRef.revisionId !== association.expertRevisionId || binding.compositionDigest !== association.compositionDigest || binding.creationOperationId !== association.creationOperationId) throw Error('quality/service/expert-binding-conflict');
  const creation = { sessionId: association.sessionId, binding, handoffId: '' };
  await verifyQualityExpertAssociation(ctx, association, creation, verifyRun, signal);
  type Inspector = { inspect(sessionId: string, signal?: AbortSignal): Promise<{ events: readonly unknown[] }> };
  const protectedSessions = ctx.get('workdshSessionAccess') as Inspector | undefined;
  const native = ctx.get('sessionController') as Inspector | undefined;
  if (!native || (identity.profile().organization.kind !== 'personal' && !protectedSessions)) throw Error('quality/service/session-unavailable');
  const inspected = await (protectedSessions ?? native).inspect(association.sessionId, signal);
  const verified = await verifyQualityExpertAssociation(ctx, association, creation, verifyRun, signal);
  const { readQualityInterpretationCandidate } = await import('./interpretation-candidate.js');
  const candidate = readQualityInterpretationCandidate({ recordId: association.recordId, runId: association.runId, contentHash: association.contentHash, sessionId: association.sessionId }, inspected.events);
  return { association: verified, candidate };
}
