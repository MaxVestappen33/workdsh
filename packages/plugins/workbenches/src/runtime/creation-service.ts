import {gt as newerVersion} from 'semver';
import {createHash, randomUUID} from 'node:crypto';
import {defineDomain, type DomainFacility,type Domain} from '@deepseek-ai/dsh-storage-domain';
import {z} from 'zod';
import {assertActorContext, parseWorkbenchRequirementsDraft, type ActorContext,
  type IdentityService, type WorkbenchInstallationRef, type WorkbenchRequirementsDraft,
  type WorkbenchDevelopmentIndexEntry} from 'workdsh-contracts';

const fields=['title','scenario','users','dataSources','workflow','firstIteration','acceptance'] as const;
export type CreationProposal={[Key in typeof fields[number]]?:string};
export interface CreationRecord {
  id:string; revision:string; idea:string; target:WorkbenchInstallationRef;
  phase:'discussing'|'confirmed'; sessionId?:string; proposal?:CreationProposal;
  requirementsRevision?:string; createdAt:string;
}
export type CreationView=Pick<CreationRecord,'id'|'revision'|'idea'|'phase'|'sessionId'|'proposal'|'createdAt'>&{needsOpening?:boolean};
export interface CreationPorts {
  target(actor:ActorContext,signal?:AbortSignal):Promise<WorkbenchInstallationRef>;
  session(actor:ActorContext,record:CreationRecord,check:()=>void,signal?:AbortSignal):Promise<string>;
  authorizeSession(actor:ActorContext,sessionId:string,signal?:AbortSignal):Promise<void>;
  confirm(actor:ActorContext,record:CreationRecord,requirements:WorkbenchRequirementsDraft,check:()=>void,signal?:AbortSignal):Promise<WorkbenchDevelopmentIndexEntry>;
}
const rowSchema=z.object({id:z.string(),revision:z.string(),idea:z.string(),target:z.object({hostId:z.string(),installationId:z.string(),profileId:z.string(),harnessVersion:z.string()}),phase:z.enum(['discussing','confirmed']),sessionId:z.string().optional(),proposal:z.record(z.string(),z.string()).optional(),requirementsRevision:z.string().optional(),createdAt:z.string()});
function spec(actor:ActorContext){
  const key=createHash('sha256').update(JSON.stringify([actor.organizationId,actor.principalId])).digest('hex').slice(0,40);
  return defineDomain({name:`workdsh_creation_${key}`,version:1,global:{schema:z.object({organizationId:z.string(),principalId:z.string(),rows:z.array(rowSchema)}),initial:{organizationId:actor.organizationId,principalId:actor.principalId,rows:[]}},tables:{}});
}
export function parseCreationProposal(value:unknown):CreationProposal {
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('workbench/invalid-creation-proposal');
  const result:CreationProposal={};
  for(const [key,text] of Object.entries(value)){
    if(!fields.includes(key as typeof fields[number])||typeof text!=='string'||text.length>(key==='title'?80:8000))throw Error('workbench/invalid-creation-proposal');
    if(text.trim())result[key as typeof fields[number]]=text.trim();
  }
  if(!Object.keys(result).length)throw Error('workbench/invalid-creation-proposal');
  return result;
}
// Native Tool JSON output must be lossless; optional fields are absent rather
// than present with undefined, which the official tool validator rejects.
const view=(row:CreationRecord):CreationView=>structuredClone({id:row.id,revision:row.revision,idea:row.idea,phase:row.phase,
  ...(row.sessionId?{sessionId:row.sessionId}:{}),...(row.proposal?{proposal:row.proposal}:{}),createdAt:row.createdAt});

/** Incomplete ideas are separate from formal requirements. Session tools can
 * propose a summary; only the user-facing confirmation creates development. */
export class WorkbenchCreationService {
  private stores=new Map<string,Promise<{domain:Domain<ReturnType<typeof spec>>;serial:Promise<unknown>}>>();
  private closed=false;
  constructor(private storage:DomainFacility,private identity:IdentityService,private ports:CreationPorts){}
  private check(actor:ActorContext,signal?:AbortSignal){
    signal?.throwIfAborted();if(this.closed)throw Error('workbench/creation-closed');
    const current=this.identity.profile();
    if(current.principalId!==actor.principalId||current.organization.id!==actor.organizationId||current.resolvedBy!==actor.resolvedBy||this.identity.membership(actor.organizationId,actor.principalId)?.state!=='active')throw Error('workbench/creation-access-denied');
  }
  private async context(sessionId?:string,signal?:AbortSignal){
    const actor=await this.identity.resolve(sessionId?{sessionId}:undefined,signal);assertActorContext(actor);this.check(actor,signal);
    if(sessionId)await this.ports.authorizeSession(actor,sessionId,signal);
    this.check(actor,signal);
    const key=JSON.stringify([actor.organizationId,actor.principalId]);
    let pending=this.stores.get(key);
    if(!pending){pending=this.storage.open(spec(actor)).then(domain=>({domain,serial:Promise.resolve()}));this.stores.set(key,pending);pending.catch(()=>this.stores.delete(key));}
    const store=await pending;this.check(actor,signal);
    return {actor,store};
  }
  private rows(store:Awaited<ReturnType<WorkbenchCreationService['context']>>['store'],actor:ActorContext):CreationRecord[]{
    const state=store.domain.global.get() as {organizationId:string;principalId:string;rows:CreationRecord[]};
    if(state.organizationId!==actor.organizationId||state.principalId!==actor.principalId)throw Error('workbench/creation-access-denied');
    return structuredClone(state.rows);
  }
  private async save(store:Awaited<ReturnType<WorkbenchCreationService['context']>>['store'],actor:ActorContext,rows:CreationRecord[],signal?:AbortSignal){
    this.check(actor,signal);await store.domain.global.set({organizationId:actor.organizationId,principalId:actor.principalId,rows} as never);this.check(actor,signal);
  }
  private async transaction<T>(sessionId:string|undefined,signal:AbortSignal|undefined,body:(context:Awaited<ReturnType<WorkbenchCreationService['context']>>)=>Promise<T>):Promise<T>{
    const context=await this.context(sessionId,signal);
    const run=context.store.serial.then(()=>{this.check(context.actor,signal);return body(context);});
    context.store.serial=run.catch(()=>undefined);return run;
  }
  async list(signal?:AbortSignal){const {actor,store}=await this.context(undefined,signal);return this.rows(store,actor).map(view);}
  async open(id:string,idea:string,signal?:AbortSignal){
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)||typeof idea!=='string'||!idea.trim()||idea.length>4000)throw Error('workbench/invalid-creation-request');
    return this.transaction(undefined,signal,async({actor,store})=>{
      const rows=this.rows(store,actor);let row=rows.find(item=>item.id===id);
      const target=await this.ports.target(actor,signal);this.check(actor,signal);
      const needsOpening=!row?.sessionId;
      if(row&&row.idea!==idea.trim())throw Error('workbench/creation-conflict');
      if(row&&JSON.stringify(row.target)!==JSON.stringify(target)){
        if(['hostId','installationId','profileId'].some(key=>row!.target[key as keyof WorkbenchInstallationRef]!==target[key as keyof WorkbenchInstallationRef])||!newerVersion(target.harnessVersion,row.target.harnessVersion))throw Error('workbench/creation-conflict');
        row.target=target;row.revision=randomUUID();await this.save(store,actor,rows,signal);
      }
      if(!row){row={id,idea:idea.trim(),revision:randomUUID(),target,phase:'discussing',createdAt:new Date().toISOString()};rows.push(row);await this.save(store,actor,rows,signal);}
      const sessionId=await this.ports.session(actor,structuredClone(row),()=>this.check(actor,signal),signal);
      this.check(actor,signal);
      if(row.sessionId&&row.sessionId!==sessionId)throw Error('workbench/creation-conflict');
      if(!row.sessionId){row.sessionId=sessionId;row.revision=randomUUID();await this.save(store,actor,rows,signal);}
      return {...view(row),needsOpening};
    });
  }
  async readSession(sessionId:string,signal?:AbortSignal){
    const {actor,store}=await this.context(sessionId,signal);const row=this.rows(store,actor).find(item=>item.sessionId===sessionId);
    if(!row)throw Error('workbench/creation-not-found');return view(row);
  }
  async propose(sessionId:string,expectedRevision:string,proposal:unknown,signal?:AbortSignal){
    const summary=parseCreationProposal(proposal);
    return this.transaction(sessionId,signal,async({actor,store})=>{
      const rows=this.rows(store,actor),row=rows.find(item=>item.sessionId===sessionId);
      if(!row)throw Error('workbench/creation-not-found');
      if(row.phase!=='discussing'||row.revision!==expectedRevision)throw Error('workbench/creation-conflict');
      row.proposal=summary;row.revision=randomUUID();await this.save(store,actor,rows,signal);return view(row);
    });
  }
  async confirm(id:string,expectedRevision:string,input:unknown,signal?:AbortSignal){
    const requirements=parseWorkbenchRequirementsDraft(input);
    return this.transaction(undefined,signal,async({actor,store})=>{
      const rows=this.rows(store,actor),row=rows.find(item=>item.id===id);
      if(!row?.sessionId)throw Error('workbench/creation-not-found');
      if(row.revision!==expectedRevision)throw Error('workbench/creation-conflict');
      await this.ports.authorizeSession(actor,row.sessionId,signal);this.check(actor,signal);
      const target=await this.ports.target(actor,signal);this.check(actor,signal);
      if(JSON.stringify(row.target)!==JSON.stringify(target)){
        if(['hostId','installationId','profileId'].some(key=>row.target[key as keyof WorkbenchInstallationRef]!==target[key as keyof WorkbenchInstallationRef])||!newerVersion(target.harnessVersion,row.target.harnessVersion))throw Error('workbench/creation-conflict');
        row.target=target;row.revision=randomUUID();await this.save(store,actor,rows,signal);
      }
      const development=await this.ports.confirm(actor,structuredClone(row),requirements,()=>this.check(actor,signal),signal);
      this.check(actor,signal);row.phase='confirmed';row.proposal=Object.fromEntries(fields.map(key=>[key,requirements[key]]));
      // Keep the revision for idempotent retry after a lost confirmation response.
      await this.save(store,actor,rows,signal);return {creation:view(row),development};
    });
  }
  async close(){this.closed=true;await Promise.all([...this.stores.values()].map(async pending=>{const store=await pending;await store.serial;await store.domain.close();}));}
}
