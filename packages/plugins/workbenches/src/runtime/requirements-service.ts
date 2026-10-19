import type { DomainFacility } from '@deepseek-ai/dsh-storage-domain';
import { assertActorContext, type ActorContext, type IdentityService } from 'workdsh-contracts';
import { WorkbenchRequirementsStore } from './requirements-store.js';

/** Host service core: callers provide business ids, never identity claims or storage paths. */
export class WorkbenchRequirementsService {
  private readonly stores = new Map<string, Promise<WorkbenchRequirementsStore>>();
  private closing?: Promise<void>;
  constructor(private readonly storage: DomainFacility, private readonly identity: IdentityService) {}

  async history(developmentId: string, signal?: AbortSignal) {
    const { actor, store } = await this.resolve(developmentId, signal);
    this.authorize(actor);
    return store.history();
  }
  async append(developmentId: string, requirements: unknown, expectedRevisionId?: string, signal?: AbortSignal) {
    const { actor, store } = await this.resolve(developmentId, signal);
    return store.append(requirements, expectedRevisionId, signal, () => this.authorize(actor));
  }
  close(): Promise<void> {
    if (!this.closing) this.closing = Promise.allSettled([...this.stores.values()].map(async pending => (await pending).close())).then(results => {
      const failed = results.find(row => row.status === 'rejected');
      if (failed?.status === 'rejected') throw failed.reason;
    });
    return this.closing;
  }
  private async resolve(developmentId: string, signal?: AbortSignal) {
    if (this.closing) throw new Error('workbench/development-service-closed');
    signal?.throwIfAborted();
    const actor = await this.identity.resolve(undefined, signal);
    assertActorContext(actor);
    this.authorize(actor);
    if (this.closing) throw new Error('workbench/development-service-closed');
    const key = JSON.stringify([actor.organizationId, actor.principalId, developmentId]);
    let pending = this.stores.get(key);
    if (!pending) {
      pending = WorkbenchRequirementsStore.open(this.storage, actor, developmentId);
      this.stores.set(key, pending);
      pending.catch(() => { if (this.stores.get(key) === pending) this.stores.delete(key); });
    }
    const store = await pending;
    signal?.throwIfAborted();
    if (this.closing) throw new Error('workbench/development-service-closed');
    this.authorize(actor);
    return { actor, store };
  }
  private authorize(actor: ActorContext) {
    const profile = this.identity.profile();
    if (profile.principalId !== actor.principalId || profile.organization.id !== actor.organizationId || profile.resolvedBy !== actor.resolvedBy || this.identity.membership(actor.organizationId, actor.principalId)?.state !== 'active') throw new Error('workbench/development-access-denied');
  }
}
