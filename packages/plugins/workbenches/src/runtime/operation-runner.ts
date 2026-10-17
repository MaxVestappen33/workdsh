import type { ActorContext, WorkbenchDevelopmentOperation } from 'workdsh-contracts';
import type { WorkbenchDevelopmentOperations, WorkbenchOperationIntent } from './development-operations.js';
export type WorkbenchOperationObservation =
  | { readonly state: 'succeeded'; readonly receipt: NonNullable<WorkbenchDevelopmentOperation['receipt']> }
  | { readonly state: 'failed'; readonly errorCode: string }
  | { readonly state: 'unknown' };
export interface WorkbenchOperationAdapter {
  /** Recheck target, identity and expected installed hash before submitting a new action. */
  preflight(operation: WorkbenchDevelopmentOperation, signal?: AbortSignal): Promise<void>;
  /** Actual executor; its return is not a success receipt. */
  execute(operation: WorkbenchDevelopmentOperation, signal?: AbortSignal): Promise<unknown>;
  verify(operation: WorkbenchDevelopmentOperation, result: unknown, signal?: AbortSignal): Promise<WorkbenchOperationObservation>;
  /** Inspect actual target facts after interruption; never resubmit the action. */
  inspect(operation: WorkbenchDevelopmentOperation, signal?: AbortSignal): Promise<WorkbenchOperationObservation>;
}

/** Host-only orchestration. Concrete build/session/install adapters are supplied
 * by the platform; this core is not an Agent-callable claim-success interface.
 */
export class WorkbenchOperationRunner {
  private readonly running = new Map<string, Promise<WorkbenchDevelopmentOperation>>();
  constructor(private readonly journal: WorkbenchDevelopmentOperations, private readonly adapter: WorkbenchOperationAdapter,
    private readonly assertCurrent: (operation: WorkbenchDevelopmentOperation) => void) {}

  async execute(intent: WorkbenchOperationIntent, actor: ActorContext, signal?: AbortSignal): Promise<WorkbenchDevelopmentOperation> {
    signal?.throwIfAborted();
    const operation = await this.journal.begin(intent, actor, signal);
    this.assertActor(operation, actor); this.assertCurrent(operation);
    const pending = this.running.get(operation.id);
    if (pending) {
      const result = await pending;
      signal?.throwIfAborted(); this.assertCurrent(result);
      return result;
    }
    // A durable running/unknown state must be inspected explicitly. Repeating
    // this command after restart is not permission to submit another side effect.
    if (operation.state !== 'intent') return operation;
    if (operation.kind === 'migrate') throw new Error('workbench/migration-receipt-unavailable');
    const task = this.submit(operation, signal);
    this.running.set(operation.id, task);
    try { return await task; }
    finally { if (this.running.get(operation.id) === task) this.running.delete(operation.id); }
  }
  async reconcile(id: string, actor: ActorContext, signal?: AbortSignal): Promise<WorkbenchDevelopmentOperation> {
    signal?.throwIfAborted();
    const operation = this.journal.list().find(row => row.id === id);
    if (!operation) throw new Error('workbench/operation-not-found');
    this.assertActor(operation, actor); this.assertCurrent(operation);
    const pending = this.running.get(id);
    if (pending) {
      const result = await pending;
      signal?.throwIfAborted(); this.assertCurrent(result);
      return result;
    }
    if (['intent', 'succeeded', 'failed'].includes(operation.state)) return operation;
    const task = this.inspect(operation, signal);
    this.running.set(id, task);
    try { return await task; }
    finally { if (this.running.get(id) === task) this.running.delete(id); }
  }
  private async submit(operation: WorkbenchDevelopmentOperation, signal?: AbortSignal) {
    await this.adapter.preflight(operation, signal);
    signal?.throwIfAborted(); this.assertCurrent(operation);
    const running = await this.journal.transition(operation.id, operation.revision, 'running', {}, signal, () => this.assertCurrent(operation));
    // The running intent is durable before the executor can perform any side effect.
    try {
      // Recheck after persistence because the target or identity can change during I/O.
      await this.adapter.preflight(running, signal);
      signal?.throwIfAborted(); this.assertCurrent(running);
    } catch {
      return this.journal.transition(running.id, running.revision, 'failed', { errorCode: 'workbench/operation-not-started' });
    }
    try {
      const result = await this.adapter.execute(running, signal);
      const observation = await this.adapter.verify(running, result, signal);
      signal?.throwIfAborted(); this.assertCurrent(running);
      return await this.finish(running, observation);
    } catch {
      // Submission may have committed even when the caller was cancelled or lost
      // the receipt. Preserve the original owner's journal for later inspection.
      return this.journal.transition(running.id, running.revision, 'unknown');
    }
  }
  private async inspect(operation: WorkbenchDevelopmentOperation, signal?: AbortSignal) {
    const current = operation.state === 'reconciling' ? operation : await this.journal.transition(operation.id, operation.revision, 'reconciling', {}, signal, () => this.assertCurrent(operation));
    try {
      const observation = await this.adapter.inspect(current, signal);
      signal?.throwIfAborted(); this.assertCurrent(current);
      return await this.finish(current, observation);
    } catch { return this.journal.transition(current.id, current.revision, 'unknown'); }
  }
  private finish(operation: WorkbenchDevelopmentOperation, observation: WorkbenchOperationObservation) {
    if (observation.state === 'succeeded') return this.journal.transition(operation.id, operation.revision, 'succeeded', { receipt: observation.receipt }, undefined, () => this.assertCurrent(operation));
    if (observation.state === 'failed') return this.journal.transition(operation.id, operation.revision, 'failed', { errorCode: observation.errorCode }, undefined, () => this.assertCurrent(operation));
    return this.journal.transition(operation.id, operation.revision, 'unknown');
  }
  private assertActor(operation: WorkbenchDevelopmentOperation, actor: ActorContext) {
    if (actor.principalId !== operation.actor.principalId || actor.organizationId !== operation.actor.organizationId) throw new Error('workbench/development-owner-mismatch');
  }
}
