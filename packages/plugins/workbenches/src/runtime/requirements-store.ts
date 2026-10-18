import { createHash, randomUUID } from 'node:crypto';
import { defineDomain, type Domain, type DomainFacility } from '@deepseek-ai/dsh-storage-domain';
import { z } from 'zod';
import { assertActorContext, parseWorkbenchSystemDefinition, parseWorkbenchRequirementsDraft, type ActorContext, type WorkbenchRequirementsRevision } from 'workdsh-contracts';

const draftSchema = z.object({ title: z.string().min(1).max(80), scenario: z.string().min(1).max(8000), users: z.string().min(1).max(8000), dataSources: z.string().min(1).max(8000), workflow: z.string().min(1).max(8000), firstIteration: z.string().min(1).max(8000), acceptance: z.string().min(1).max(8000), system: z.unknown().transform(parseWorkbenchSystemDefinition).optional() });
const revisionSchema = z.object({ id: z.string(), developmentId: z.string(), parentRevisionId: z.string().optional(), owner: z.object({ organizationId: z.string(), ownerPrincipalId: z.string(), scope: z.literal('personal') }), requirements: draftSchema, createdAt: z.string(), createdBy: z.string() });
const stateSchema = z.object({ organizationId: z.string(), principalId: z.string(), developmentId: z.string(), revisions: z.array(revisionSchema) });
function spec(actor: ActorContext, developmentId: string) {
  const key = createHash('sha256').update(JSON.stringify([actor.organizationId, actor.principalId, developmentId])).digest('hex').slice(0, 40);
  return defineDomain({ name: `workdsh_req_${key}`, version: 1, global: { schema: stateSchema, initial: { organizationId: actor.organizationId, principalId: actor.principalId, developmentId, revisions: [] } }, tables: {} });
}
type RequirementsDomain = Domain<ReturnType<typeof spec>>;

/** Host-owned per-development domain; the actor must be resolved at the trusted service boundary. */
export class WorkbenchRequirementsStore {
  private serial: Promise<unknown> = Promise.resolve();
  private closing?: Promise<void>;
  private constructor(private readonly domain: RequirementsDomain, private readonly actor: ActorContext, private readonly developmentId: string) {}
  static async open(storage: DomainFacility, actor: ActorContext, developmentId: string) {
    assertActorContext(actor);
    if (!developmentId.trim() || developmentId.length > 128) throw new Error('workbench/invalid-development-id');
    return new WorkbenchRequirementsStore(await storage.open(spec(actor, developmentId)), { ...actor }, developmentId);
  }
  history(): readonly WorkbenchRequirementsRevision[] {
    this.assertOpen();
    const state = this.domain.global.get();
    this.assertOwner(state);
    return Object.freeze(structuredClone(state.revisions));
  }
  async append(input: unknown, expectedRevisionId?: string, signal?: AbortSignal, authorizeBeforeWrite?: () => void): Promise<WorkbenchRequirementsRevision> {
    this.assertOpen();
    signal?.throwIfAborted();
    const requirements = parseWorkbenchRequirementsDraft(input);
    const revision: WorkbenchRequirementsRevision = { id: randomUUID(), developmentId: this.developmentId, ...(expectedRevisionId ? { parentRevisionId: expectedRevisionId } : {}), owner: { organizationId: this.actor.organizationId, ownerPrincipalId: this.actor.principalId, scope: 'personal' }, requirements, createdAt: new Date().toISOString(), createdBy: this.actor.principalId };
    const write = this.serial.then(async () => {
      const state = this.domain.global.get();
      signal?.throwIfAborted();
      authorizeBeforeWrite?.();
      this.assertOwner(state);
      if (state.revisions.at(-1)?.id !== expectedRevisionId) throw new Error('workbench/requirements-revision-conflict');
      await this.domain.global.set({ ...state, revisions: [...state.revisions, revisionSchema.parse(revision)] });
    });
    this.serial = write.catch(() => undefined);
    await write;
    return structuredClone(revision);
  }
  close(): Promise<void> {
    if (!this.closing) this.closing = this.serial.then(() => this.domain.close());
    return this.closing;
  }
  private assertOpen() { if (this.closing) throw new Error('workbench/development-store-closed'); }
  private assertOwner(state: z.infer<typeof stateSchema>) {
    if (state.organizationId !== this.actor.organizationId || state.principalId !== this.actor.principalId || state.developmentId !== this.developmentId) throw new Error('workbench/development-owner-mismatch');
  }
}
