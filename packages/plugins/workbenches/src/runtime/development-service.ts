import type { DomainFacility } from '@deepseek-ai/dsh-storage-domain';
import { assertActorContext, type ActorContext, type IdentityService, type WorkbenchInstallationRef, type WorkbenchDevelopment } from 'workdsh-contracts';
import { WorkbenchDevelopmentIndex } from './development-index.js';
import type { WorkbenchRequirementsService } from './requirements-service.js';

/** Supplied by the Host, never by the page's create payload. */
export type ResolveWorkbenchDevelopmentTarget = (actor: ActorContext, signal?: AbortSignal) => Promise<WorkbenchInstallationRef>;

/** Host-owned filesystem/snapshot verifier. Never accepted from RPC or the model. */
export type VerifyWorkbenchDevelopmentSource = (actor: ActorContext, development: WorkbenchDevelopment, signal?: AbortSignal) => Promise<NonNullable<WorkbenchDevelopment['source']>>;
export type VerifyWorkbenchDevelopmentSession = (actor: ActorContext, development: WorkbenchDevelopment, signal?: AbortSignal) => Promise<NonNullable<WorkbenchDevelopment['session']>>;

export class WorkbenchDevelopmentService {
  private readonly indexes = new Map<string, Promise<WorkbenchDevelopmentIndex>>();
  private closing?: Promise<void>;
  constructor(private readonly storage: DomainFacility, private readonly identity: IdentityService,
    private readonly requirements: Pick<WorkbenchRequirementsService, 'history'>, private readonly target: ResolveWorkbenchDevelopmentTarget,
    private readonly sessionVerifier?: VerifyWorkbenchDevelopmentSession,
    private readonly sourceVerifier?: VerifyWorkbenchDevelopmentSource,
    private readonly checkpointReader?: (development:WorkbenchDevelopment,check:()=>void,signal?:AbortSignal)=>Promise<readonly {sha256:string;fileCount:number;byteLength:number;verified:false}[]>,
    private readonly checkpointVerifier?: (development:WorkbenchDevelopment,sha256:string,check:()=>void,signal?:AbortSignal)=>Promise<{sha256:string;fileCount:number;byteLength:number;verified:true}>,
    private readonly recoveryPreparer?: (development:WorkbenchDevelopment,sha256:string,check:()=>void,signal?:AbortSignal)=>Promise<{journalId:string;beforeSha256:string;targetSha256:string;state:'prepared'}>) {}

  async sourceCheckpoints(developmentId:string,signal?:AbortSignal){
    if(!this.checkpointReader)throw new Error('workbench/checkpoint-service-unavailable');
    const {actor,index}=await this.resolve(signal),entry=index.find(developmentId);
    if(!entry)throw new Error('workbench/development-not-found');
    const development=structuredClone(entry.development);
    const target=await this.target(actor,signal);this.checkActive(actor,signal);
    if(JSON.stringify(target)!==JSON.stringify(development.target))throw new Error('workbench/installation-target-changed');
    const check=()=>this.checkActive(actor,signal);
    const checkpoints=await this.checkpointReader(development,check,signal);check();
    if(index.find(developmentId)?.development.revision!==development.revision)throw new Error('workbench/development-revision-conflict');
    return checkpoints;
  }

  async verifySourceCheckpoint(developmentId:string,sha256:string,signal?:AbortSignal){
    if(!this.checkpointVerifier)throw new Error('workbench/checkpoint-service-unavailable');
    if(!/^[a-f0-9]{64}$/.test(sha256))throw new Error('workbench/invalid-request');
    const {actor,index}=await this.resolve(signal),entry=index.find(developmentId);
    if(!entry)throw new Error('workbench/development-not-found');
    const development=structuredClone(entry.development);
    const target=await this.target(actor,signal);this.checkActive(actor,signal);
    if(JSON.stringify(target)!==JSON.stringify(development.target))throw new Error('workbench/installation-target-changed');
    const check=()=>this.checkActive(actor,signal);
    const result=await this.checkpointVerifier(development,sha256,check,signal);check();
    if(index.find(developmentId)?.development.revision!==development.revision)throw new Error('workbench/development-revision-conflict');
    return result;
  }

  async prepareSourceRecovery(developmentId:string,expectedRevision:string,sha256:string,signal?:AbortSignal){
    if(!this.recoveryPreparer)throw new Error('workbench/checkpoint-service-unavailable');
    if(!/^[a-f0-9]{64}$/.test(sha256))throw new Error('workbench/invalid-request');
    const {actor,index}=await this.resolve(signal),entry=index.find(developmentId);
    if(!entry)throw new Error('workbench/development-not-found');
    const development=structuredClone(entry.development);
    const check=()=>{this.checkActive(actor,signal);if(index.find(developmentId)?.development.revision!==expectedRevision)throw new Error('workbench/development-revision-conflict');};check();
    if(!development.source||!/^source-sha256:[a-f0-9]{64}$/.test(development.source.revision))throw new Error('workbench/development-source-unavailable');
    const target=await this.target(actor,signal);check();
    if(JSON.stringify(target)!==JSON.stringify(development.target))throw new Error('workbench/installation-target-changed');
    const result=await this.recoveryPreparer(development,sha256,check,signal);check();return result;
  }

  async ensureSession(developmentId: string, expectedRevision: string, signal?: AbortSignal) {
    if (!this.sessionVerifier) throw new Error('workbench/session-authority-unavailable');
    const { actor, index } = await this.resolve(signal);
    let entry = index.find(developmentId);
    if (!entry) throw new Error('workbench/development-not-found');
    if (entry.development.revision !== expectedRevision) throw new Error('workbench/development-revision-conflict');
    const target = await this.target(actor, signal);
    this.checkActive(actor, signal);
    if (JSON.stringify(entry.development.target) !== JSON.stringify(target)) throw new Error('workbench/installation-target-changed');
    const baseline = (await this.requirements.history(developmentId, signal)).at(-1);
    this.checkActive(actor, signal);
    if (!baseline || baseline.id !== entry.development.requirementsRevision)
      throw new Error('workbench/requirements-revision-conflict');
    // Keep the same authorized actor throughout source preparation and Session
    // creation. Persist source first so a failed native launch can be retried.
    if (this.sourceVerifier) {
      const source = await this.sourceVerifier({ ...actor }, structuredClone(entry.development), signal);
      this.checkActive(actor, signal);
      entry = await index.bindSource(developmentId, entry.development.revision, source, signal, () => this.authorize(actor));
    }
    const beforeLaunch = (await this.requirements.history(developmentId, signal)).at(-1);
    this.checkActive(actor, signal);
    if (beforeLaunch?.id !== entry.development.requirementsRevision) throw new Error('workbench/requirements-revision-conflict');
    const session = await this.sessionVerifier({ ...actor }, structuredClone(entry.development), signal);
    this.checkActive(actor, signal);
    const afterLaunch = (await this.requirements.history(developmentId, signal)).at(-1);
    this.checkActive(actor, signal);
    if (afterLaunch?.id !== entry.development.requirementsRevision) throw new Error('workbench/requirements-revision-conflict');
    return index.bindSession(developmentId, entry.development.revision, session, signal, () => this.authorize(actor));
  }

  /** UI cache/remount key only; each operation independently resolves authority. */
  async identityScope(signal?: AbortSignal) {
    signal?.throwIfAborted();
    const actor = await this.identity.resolve(undefined, signal);
    assertActorContext(actor); this.checkActive(actor, signal);
    return Object.freeze({ organizationId: actor.organizationId, principalId: actor.principalId });
  }

  async list(signal?: AbortSignal) {
    const { actor, index } = await this.resolve(signal);
    this.authorize(actor);
    const target=await this.target(actor,signal);this.checkActive(actor,signal);
    for(const entry of index.list()){
      const before=entry.development;
      if(before.target.hostId===target.hostId&&before.target.installationId===target.installationId&&before.target.profileId===target.profileId&&before.target.harnessVersion!==target.harnessVersion){
        await index.upgradeRuntime(before.id,before.revision,target,signal,()=>this.authorize(actor));
        this.checkActive(actor,signal);
      }
    }
    return index.list();
  }
  async create(developmentId: string, workbenchId: string, packageName: string, expectedRequirementsRevision: string, signal?: AbortSignal) {
    const { actor, index } = await this.resolve(signal);
    const target = await this.target(actor, signal);
    this.checkActive(actor, signal);
    const requirement = (await this.requirements.history(developmentId, signal)).at(-1);
    this.checkActive(actor, signal);
    if (!requirement || requirement.id !== expectedRequirementsRevision) throw new Error('workbench/requirements-revision-conflict');
    return index.create(requirement, workbenchId, packageName, target, signal, () => this.authorize(actor));
  }
  async advanceRequirements(developmentId: string, expectedRequirementsRevision: string, expectedDevelopmentRevision: string, signal?: AbortSignal) {
    const { actor, index } = await this.resolve(signal);
    const requirement = (await this.requirements.history(developmentId, signal)).at(-1);
    this.checkActive(actor, signal);
    if (!requirement || requirement.id !== expectedRequirementsRevision) throw new Error('workbench/requirements-revision-conflict');
    return index.advanceRequirements(requirement, expectedDevelopmentRevision, signal, () => this.authorize(actor));
  }
  /** Internal orchestration entry: bind facts returned by the trusted source verifier. */
  async bindVerifiedSource(developmentId: string, expectedRevision: string, verify: VerifyWorkbenchDevelopmentSource, signal?: AbortSignal) {
    const { actor, index } = await this.resolve(signal);
    const entry = index.find(developmentId);
    if (!entry) throw new Error('workbench/development-not-found');
    if (entry.development.revision !== expectedRevision) throw new Error('workbench/development-revision-conflict');
    const source = await verify({ ...actor }, structuredClone(entry.development), signal);
    this.checkActive(actor, signal);
    return index.bindSource(developmentId, expectedRevision, source, signal, () => this.authorize(actor));
  }
  close(): Promise<void> {
    if (!this.closing) this.closing = Promise.allSettled([...this.indexes.values()].map(async pending => (await pending).close())).then(results => {
      const failed = results.find(row => row.status === 'rejected');
      if (failed?.status === 'rejected') throw failed.reason;
    });
    return this.closing;
  }
  /** Internal Host orchestration only. Verification must consult official Session
   * and workspace metadata, and enforce actor access before returning facts. */
  async bindVerifiedSession(developmentId: string, expectedRevision: string, verify: VerifyWorkbenchDevelopmentSession, signal?: AbortSignal) {
    const { actor, index } = await this.resolve(signal);
    const entry = index.find(developmentId);
    if (!entry) throw new Error('workbench/development-not-found');
    if (entry.development.revision !== expectedRevision) throw new Error('workbench/development-revision-conflict');
    const session = await verify({ ...actor }, structuredClone(entry.development), signal);
    this.checkActive(actor, signal);
    return index.bindSession(developmentId, expectedRevision, session, signal, () => this.authorize(actor));
  }
  private async resolve(signal?: AbortSignal) {
    if (this.closing) throw new Error('workbench/development-service-closed');
    signal?.throwIfAborted();
    const actor = await this.identity.resolve(undefined, signal);
    assertActorContext(actor);
    this.checkActive(actor, signal);
    const key = JSON.stringify([actor.organizationId, actor.principalId]);
    let pending = this.indexes.get(key);
    if (!pending) {
      pending = WorkbenchDevelopmentIndex.open(this.storage, actor);
      this.indexes.set(key, pending);
      pending.catch(() => { if (this.indexes.get(key) === pending) this.indexes.delete(key); });
    }
    const index = await pending;
    this.checkActive(actor, signal);
    return { actor, index };
  }
  private checkActive(actor: ActorContext, signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (this.closing) throw new Error('workbench/development-service-closed');
    this.authorize(actor);
  }
  private authorize(actor: ActorContext) {
    const profile = this.identity.profile();
    if (profile.principalId !== actor.principalId || profile.organization.id !== actor.organizationId || profile.resolvedBy !== actor.resolvedBy || this.identity.membership(actor.organizationId, actor.principalId)?.state !== 'active') throw new Error('workbench/development-access-denied');
  }
}
