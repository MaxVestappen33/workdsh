import { createHash, randomUUID } from 'node:crypto';
import {gt as newerVersion} from 'semver';
import { defineDomain, type Domain, type DomainFacility } from '@deepseek-ai/dsh-storage-domain';
import { z } from 'zod';
import { posix, win32 } from 'node:path';
import { assertActorContext, type ActorContext, type WorkbenchDevelopmentIndexEntry, type WorkbenchInstallationRef, type WorkbenchRequirementsRevision } from 'workdsh-contracts';

const text = z.string().trim().min(1).max(128);
const targetSchema = z.object({ hostId: text, installationId: text, profileId: text, harnessVersion: text });
const sourceSchema = z.object({ hostId: text, directory: z.string().min(1).max(8192).refine(value => !value.includes('\0') && (posix.isAbsolute(value) || win32.isAbsolute(value))), revision: text }).strict();
const recordSchema = z.object({ id: text, workbenchId: text, packageName: z.string().min(1).max(214),
  owner: z.object({ organizationId: z.string().min(1), ownerPrincipalId: z.string().min(1), scope: z.literal('personal') }),
  source: sourceSchema.optional(), session: z.object({ hostId: text, sessionId: text }).strict().optional(), revision: text, requirementsRevision: text, iterationId: text, target: targetSchema,
  state: z.enum(['requirements', 'ready', 'developing', 'built', 'pending-install', 'pending-restart', 'trial', 'changes-requested', 'accepted', 'interrupted', 'failed']),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime() });
const entrySchema = z.object({ title: z.string().min(1).max(80), development: recordSchema });
const stateSchema = z.object({ organizationId: z.string(), principalId: z.string(), entries: z.array(entrySchema) });
function spec(actor: ActorContext) {
  const key = createHash('sha256').update(JSON.stringify([actor.organizationId, actor.principalId])).digest('hex').slice(0, 40);
  return defineDomain({ name: `workdsh_dev_index_${key}`, version: 1, global: { schema: stateSchema,
    initial: { organizationId: actor.organizationId, principalId: actor.principalId, entries: [] } }, tables: {} });
}
type IndexDomain = Domain<ReturnType<typeof spec>>;


/** Member-owned discovery index, independent of installed package inventory.
 * Only Host services may call this core, with a requirements revision actually
 * read from the requirements store and a target supplied by trusted Host metadata.
 * Source bindings accept only Host-verified facts. Operation receipts and install state are separate.
 */
export class WorkbenchDevelopmentIndex {
  private serial: Promise<unknown> = Promise.resolve();
  private closing?: Promise<void>;
  private constructor(private readonly domain: IndexDomain, private readonly actor: ActorContext) {}
  static async open(storage: DomainFacility, actor: ActorContext) {
    assertActorContext(actor);
    return new WorkbenchDevelopmentIndex(await storage.open(spec(actor)), { ...actor });
  }
  list(): readonly WorkbenchDevelopmentIndexEntry[] {
    this.assertOpen();
    return Object.freeze(structuredClone(this.read().entries));
  }
  find(developmentId: string): WorkbenchDevelopmentIndexEntry | undefined {
    return this.list().find(entry => entry.development.id === developmentId);
  }
  async create(requirements: WorkbenchRequirementsRevision, workbenchId: string, packageName: string, target: WorkbenchInstallationRef,
    signal?: AbortSignal, authorizeBeforeWrite?: () => void): Promise<WorkbenchDevelopmentIndexEntry> {
    this.assertOpen(); this.assertRequirementsOwner(requirements);
    if (!/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/.test(workbenchId) ||
      !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(packageName)) throw new Error('workbench/invalid-development-identity');
    const now = new Date().toISOString();
    const candidate = entrySchema.parse({ title: requirements.requirements.title, development: {
      id: requirements.developmentId, workbenchId, packageName,
      owner: { organizationId: this.actor.organizationId, ownerPrincipalId: this.actor.principalId, scope: 'personal' },
      revision: randomUUID(), requirementsRevision: requirements.id, iterationId: randomUUID(), target,
      state: 'ready', createdAt: now, updatedAt: now } });
    return this.write(() => {
      const state = this.read();
      const existing = state.entries.find(entry => entry.development.id === candidate.development.id);
      if (existing) {
        const old = existing.development, next = candidate.development;
        if (old.workbenchId !== next.workbenchId || old.packageName !== next.packageName || old.requirementsRevision !== next.requirementsRevision ||
          JSON.stringify(old.target) !== JSON.stringify(next.target)) throw new Error('workbench/development-conflict');
        return { state, result: existing, changed: false };
      }
      if (state.entries.some(entry => entry.development.workbenchId === workbenchId || entry.development.packageName === packageName)) throw new Error('workbench/development-identity-conflict');
      return { state: { ...state, entries: [...state.entries, candidate] }, result: candidate, changed: true };
    }, signal, authorizeBeforeWrite);
  }
  /** Host-only runtime migration. Identity/location cannot change; a new
   * iteration invalidates old delivery acceptance while keeping source/session. */
  async upgradeRuntime(developmentId:string,expectedRevision:string,target:WorkbenchInstallationRef,signal?:AbortSignal,authorizeBeforeWrite?:()=>void){
    const captured=targetSchema.parse(target);
    return this.write(()=>{
      const state=this.read(),position=state.entries.findIndex(row=>row.development.id===developmentId);
      if(position<0)throw Error('workbench/development-not-found');
      const current=state.entries[position],before=current.development;
      if(before.revision!==expectedRevision)throw Error('workbench/development-revision-conflict');
      if(['hostId','installationId','profileId'].some(key=>before.target[key as keyof WorkbenchInstallationRef]!==captured[key as keyof WorkbenchInstallationRef]))throw Error('workbench/installation-target-changed');
      if(before.target.harnessVersion===captured.harnessVersion)return {state,result:current,changed:false};
      if(!newerVersion(captured.harnessVersion,before.target.harnessVersion))throw Error('workbench/runtime-downgrade');
      const updated=entrySchema.parse({...current,development:{...before,target:captured,revision:randomUUID(),iterationId:randomUUID(),state:'changes-requested',updatedAt:new Date().toISOString()}});
      const entries=[...state.entries];entries[position]=updated;
      return {state:{...state,entries},result:updated,changed:true};
    },signal,authorizeBeforeWrite);
  }
  async advanceRequirements(requirements: WorkbenchRequirementsRevision, expectedRevision: string,
    signal?: AbortSignal, authorizeBeforeWrite?: () => void): Promise<WorkbenchDevelopmentIndexEntry> {
    this.assertOpen(); this.assertRequirementsOwner(requirements);
    return this.write(() => {
      const state = this.read();
      const index = state.entries.findIndex(entry => entry.development.id === requirements.developmentId);
      if (index < 0) throw new Error('workbench/development-not-found');
      const current = state.entries[index];
      if (current.development.revision !== expectedRevision) throw new Error('workbench/development-revision-conflict');
      if (requirements.id === current.development.requirementsRevision) return { state, result: current, changed: false };
      if (requirements.parentRevisionId !== current.development.requirementsRevision) throw new Error('workbench/requirements-revision-conflict');
      const updated = entrySchema.parse({ title: requirements.requirements.title, development: { ...current.development,
        revision: randomUUID(), requirementsRevision: requirements.id, iterationId: randomUUID(), updatedAt: new Date().toISOString(),
        state: current.development.state === 'ready' ? 'ready' : 'changes-requested' } });
      const entries = [...state.entries]; entries[index] = updated;
      return { state: { ...state, entries }, result: updated, changed: true };
    }, signal, authorizeBeforeWrite);
  }
  /** Internal Host entry. The caller verifies filesystem identity, access and source revision;
   * persisting this reference does not copy or back up the source tree. */
  async bindSource(developmentId: string, expectedRevision: string, source: { hostId: string; directory: string; revision: string },
    signal?: AbortSignal, authorizeBeforeWrite?: () => void): Promise<WorkbenchDevelopmentIndexEntry> {
    this.assertOpen();
    const captured = sourceSchema.parse(source);
    return this.write(() => {
      const state = this.read(), index = state.entries.findIndex(row => row.development.id === developmentId);
      if (index < 0) throw new Error('workbench/development-not-found');
      const current = state.entries[index];
      if (current.development.revision !== expectedRevision) throw new Error('workbench/development-revision-conflict');
      if (current.development.target.hostId !== captured.hostId) throw new Error('workbench/source-host-mismatch');
      // Existing native Sessions retain their workspace. A source revision update
      // may change bytes in that workspace, but cannot silently redirect it.
      if (current.development.session && current.development.source && current.development.source.directory !== captured.directory)
        throw new Error('workbench/source-identity-mismatch');
      if (JSON.stringify(current.development.source) === JSON.stringify(captured)) return { state, result: current, changed: false };
      const updated = entrySchema.parse({ ...current, development: { ...current.development, source: captured,
        revision: randomUUID(), updatedAt: new Date().toISOString() } });
      const entries = [...state.entries]; entries[index] = updated;
      return { state: { ...state, entries }, result: updated, changed: true };
    }, signal, authorizeBeforeWrite);
  }
  close(): Promise<void> {
    if (!this.closing) this.closing = this.serial.then(() => this.domain.close());
    return this.closing;
  }
  /** Internal Host entry: caller verifies Session existence, owner and workspace.
   * A page-supplied Session ID alone is not sufficient evidence. */
  async bindSession(developmentId: string, expectedRevision: string, session: { hostId: string; sessionId: string },
    signal?: AbortSignal, authorizeBeforeWrite?: () => void): Promise<WorkbenchDevelopmentIndexEntry> {
    this.assertOpen();
    const captured = z.object({ hostId: text, sessionId: text }).strict().parse(session);
    return this.write(() => {
      const state = this.read(), index = state.entries.findIndex(row => row.development.id === developmentId);
      if (index < 0) throw new Error('workbench/development-not-found');
      const current = state.entries[index];
      if (current.development.revision !== expectedRevision) throw new Error('workbench/development-revision-conflict');
      if (captured.hostId !== current.development.target.hostId) throw new Error('workbench/session-host-mismatch');
      if (current.development.session) {
        if (JSON.stringify(current.development.session) !== JSON.stringify(captured)) throw new Error('workbench/development-session-conflict');
        return { state, result: current, changed: false };
      }
      const updated = entrySchema.parse({ ...current, development: { ...current.development, session: captured,
        revision: randomUUID(), updatedAt: new Date().toISOString() } });
      const entries = [...state.entries]; entries[index] = updated;
      return { state: { ...state, entries }, result: updated, changed: true };
    }, signal, authorizeBeforeWrite);
  }
  private async write(action: () => { state: z.infer<typeof stateSchema>; result: z.infer<typeof entrySchema>; changed: boolean }, signal?: AbortSignal, authorize?: () => void) {
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
    if (state.organizationId !== this.actor.organizationId || state.principalId !== this.actor.principalId || state.entries.some(entry =>
      entry.development.owner.organizationId !== this.actor.organizationId || entry.development.owner.ownerPrincipalId !== this.actor.principalId)) throw new Error('workbench/development-owner-mismatch');
    return state;
  }
  private assertRequirementsOwner(requirements: WorkbenchRequirementsRevision) {
    if (requirements.owner.scope !== 'personal' || requirements.owner.organizationId !== this.actor.organizationId || requirements.owner.ownerPrincipalId !== this.actor.principalId || requirements.createdBy !== this.actor.principalId) throw new Error('workbench/development-owner-mismatch');
  }
  private assertOpen() { if (this.closing) throw new Error('workbench/development-store-closed'); }
}
