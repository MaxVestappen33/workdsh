import { createHash, randomUUID } from 'node:crypto';
import { defineDomain, type Domain, type DomainFacility } from '@deepseek-ai/dsh-storage-domain';
import { z } from 'zod';
import { assertActorContext, type ActorContext, type WorkbenchDevelopmentOperation } from 'workdsh-contracts';
const text = z.string().min(1).max(256);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const target = z.object({ hostId: text, installationId: text, profileId: text, harnessVersion: text });
const actorSchema = z.object({ principalId: text, organizationId: text, requestId: text, resolvedBy: text, sessionId: text.optional(), runId: text.optional(), delegatedByPrincipalId: text.optional() });
const packageSchema = z.object({ packageName: z.string().min(1).max(214), version: text, sha256: hash });
const receiptSchema = z.object({ sessionId: text.optional(), package: packageSchema.optional(), pendingRestart: z.boolean() });
const operationSchema = z.object({ id: text, revision: text, inputHash: hash, developmentId: text, iterationId: text,
  actor: actorSchema, target, kind: z.enum(['create-session', 'build', 'install', 'update', 'migrate']),
  state: z.enum(['intent', 'running', 'reconciling', 'unknown', 'succeeded', 'failed']), candidate: packageSchema.extend({ workbenchId: text }).optional(), expectedInstalledHash: hash.optional(),
  receipt: receiptSchema.optional(), errorCode: z.string().regex(/^workbench\/[a-z0-9-]+$/).optional(), createdAt: z.string().datetime(), updatedAt: z.string().datetime() });
const stateSchema = z.object({ organizationId: text, principalId: text, developmentId: text, operations: z.array(operationSchema) });
function spec(actor: ActorContext, developmentId: string) {
  const key = createHash('sha256').update(JSON.stringify([actor.organizationId, actor.principalId, developmentId])).digest('hex').slice(0, 40);
  return defineDomain({ name: `workdsh_dev_ops_${key}`, version: 1, global: { schema: stateSchema,
    initial: { organizationId: actor.organizationId, principalId: actor.principalId, developmentId, operations: [] } }, tables: {} });
}
type OperationsDomain = Domain<ReturnType<typeof spec>>;
export type WorkbenchOperationIntent = Pick<WorkbenchDevelopmentOperation, 'id' | 'iterationId' | 'kind' | 'target' | 'inputHash' | 'expectedInstalledHash' | 'candidate'>;
const transitions: Record<WorkbenchDevelopmentOperation['state'], readonly WorkbenchDevelopmentOperation['state'][]> = {
  intent: ['running', 'failed'], running: ['unknown', 'reconciling', 'succeeded', 'failed'],
  unknown: ['reconciling'], reconciling: ['unknown', 'succeeded', 'failed'], succeeded: [], failed: [],
};
/** Durable intent/status journal. Execution and receipt verification belong to trusted
 * Host adapters; no API lets an Agent or page assert that an installation succeeded.
 */
export class WorkbenchDevelopmentOperations {
  private serial: Promise<unknown> = Promise.resolve();
  private closing?: Promise<void>;
  private constructor(private readonly domain: OperationsDomain, private readonly owner: ActorContext, private readonly developmentId: string) {}
  static async open(storage: DomainFacility, actor: ActorContext, developmentId: string) {
    assertActorContext(actor);
    if (!developmentId.trim() || developmentId.length > 128) throw new Error('workbench/invalid-development-id');
    return new WorkbenchDevelopmentOperations(await storage.open(spec(actor, developmentId)), { ...actor }, developmentId);
  }
  list(): readonly WorkbenchDevelopmentOperation[] { this.assertOpen(); return Object.freeze(structuredClone(this.read().operations)); }
  async begin(intent: WorkbenchOperationIntent, actor: ActorContext, signal?: AbortSignal, authorize?: () => void): Promise<WorkbenchDevelopmentOperation> {
    this.assertOpen(); assertActorContext(actor);
    if (actor.organizationId !== this.owner.organizationId || actor.principalId !== this.owner.principalId) throw new Error('workbench/development-owner-mismatch');
    const now = new Date().toISOString();
    const operation = operationSchema.parse({ id: intent.id, iterationId: intent.iterationId, kind: intent.kind, target: intent.target,
      inputHash: intent.inputHash, candidate: intent.candidate, expectedInstalledHash: intent.expectedInstalledHash, revision: randomUUID(), developmentId: this.developmentId,
      actor, state: 'intent', createdAt: now, updatedAt: now });
    if (operation.candidate && (!['install', 'update'].includes(operation.kind) || operation.candidate.sha256 !== operation.inputHash)) throw new Error('workbench/operation-input-conflict');
    return this.write(() => {
      const state = this.read(), existing = state.operations.find(row => row.id === operation.id);
      if (existing) {
        if (existing.iterationId !== operation.iterationId || existing.kind !== operation.kind || existing.inputHash !== operation.inputHash ||
          JSON.stringify(existing.candidate) !== JSON.stringify(operation.candidate) || existing.expectedInstalledHash !== operation.expectedInstalledHash || JSON.stringify(existing.target) !== JSON.stringify(operation.target)) throw new Error('workbench/operation-id-conflict');
        return { state, result: existing, changed: false };
      }
      return { state: { ...state, operations: [...state.operations, operation] }, result: operation, changed: true };
    }, signal, authorize);
  }
  async transition(id: string, expectedRevision: string, next: WorkbenchDevelopmentOperation['state'],
    facts: Pick<WorkbenchDevelopmentOperation, 'receipt' | 'errorCode'> = {}, signal?: AbortSignal, authorize?: () => void): Promise<WorkbenchDevelopmentOperation> {
    this.assertOpen();
    // Snapshot trusted receipt data before joining the queue; callers may retain
    // and mutate their objects while earlier writes are still pending.
    const captured = z.object({ receipt: receiptSchema.optional(), errorCode: z.string().regex(/^workbench\/[a-z0-9-]+$/).optional() }).strict().parse(facts);
    return this.write(() => {
      const state = this.read(), index = state.operations.findIndex(row => row.id === id);
      if (index < 0) throw new Error('workbench/operation-not-found');
      const current = state.operations[index];
      if (current.revision !== expectedRevision) throw new Error('workbench/operation-revision-conflict');
      if (!transitions[current.state].includes(next)) throw new Error('workbench/invalid-operation-transition');
      if ((next !== 'succeeded' && captured.receipt !== undefined) || (next !== 'failed' && captured.errorCode !== undefined)) throw new Error('workbench/invalid-operation-receipt');
      if (next === 'succeeded') {
        const receipt = receiptSchema.parse(captured.receipt);
        if (current.kind === 'create-session' && (!receipt.sessionId || receipt.package || receipt.pendingRestart)) throw new Error('workbench/invalid-operation-receipt');
        if (['build', 'install', 'update'].includes(current.kind) && (!receipt.package || receipt.sessionId || (current.kind === 'build' && receipt.pendingRestart))) throw new Error('workbench/invalid-operation-receipt');
        // Migration requires a separate verified migration journal; this receipt schema
        // cannot prove its commit or data safety and therefore does not permit completion.
        if (current.kind === 'migrate') throw new Error('workbench/migration-receipt-unavailable');
      }
      const updated = operationSchema.parse({ ...current, state: next, revision: randomUUID(), receipt: captured.receipt, errorCode: captured.errorCode, updatedAt: new Date().toISOString() });
      const operations = [...state.operations]; operations[index] = updated;
      return { state: { ...state, operations }, result: updated, changed: true };
    }, signal, authorize);
  }
  close(): Promise<void> { if (!this.closing) this.closing = this.serial.then(() => this.domain.close()); return this.closing; }
  private async write(action: () => { state: z.infer<typeof stateSchema>; result: z.infer<typeof operationSchema>; changed: boolean }, signal?: AbortSignal, authorize?: () => void) {
    const pending = this.serial.then(async () => {
      signal?.throwIfAborted(); authorize?.();
      const { state, result, changed } = action();
      if (changed) await this.domain.global.set(state);
      return structuredClone(result);
    });
    this.serial = pending.catch(() => undefined);
    return pending;
  }
  private read() {
    const state = this.domain.global.get();
    if (state.organizationId !== this.owner.organizationId || state.principalId !== this.owner.principalId || state.developmentId !== this.developmentId || state.operations.some(row => row.developmentId !== this.developmentId || row.actor.organizationId !== this.owner.organizationId || row.actor.principalId !== this.owner.principalId)) throw new Error('workbench/development-owner-mismatch');
    return state;
  }
  private assertOpen() { if (this.closing) throw new Error('workbench/development-store-closed'); }
}
