import {createHash} from 'node:crypto';
import {defineDomain,type Domain,type DomainFacility} from '@deepseek-ai/dsh-storage-domain';
import {z} from 'zod';
import {assertActorContext,type ActorContext,type IdentityService} from 'workdsh-contracts';
export interface AcceptanceBinding{developmentId:string;requirementsRevision:string;packageName:string;version:string;sha256:string;hostId:string;profileId:string;installationId:string}
export interface AcceptanceFacts{binding?:AcceptanceBinding;ready:boolean;criteria?:string}
export const acceptanceBindingSchema=z.object({developmentId:z.string().min(1).max(128),requirementsRevision:z.string().min(1).max(128),packageName:z.string().min(1).max(214),version:z.string().min(1).max(128),sha256:z.string().regex(/^[a-f0-9]{64}$/),hostId:z.string().min(1).max(128),profileId:z.string().min(1).max(128),installationId:z.string().min(1).max(128)}).strict();
const receipt=acceptanceBindingSchema.extend({acceptedAt:z.string(),principalId:z.string(),organizationId:z.string()});
function spec(actor:ActorContext){return defineDomain({name:'workdsh_acceptance_'+createHash('sha256').update(JSON.stringify([actor.organizationId,actor.principalId])).digest('hex').slice(0,40),version:1,global:{schema:z.object({receipts:z.array(receipt).max(1000)}),initial:{receipts:[] as z.infer<typeof receipt>[]}},tables:{}});}
const same=(a:AcceptanceBinding,b:AcceptanceBinding)=>Object.keys(a).length===Object.keys(b).length&&(Object.keys(a) as (keyof AcceptanceBinding)[]).every(key=>a[key]===b[key]);
/** Explicit user acceptance of an exact installed revision; never inferred from model text. */
export class WorkbenchAcceptanceService{
 private closed=false;private stores=new Map<string,Promise<{domain:Domain<ReturnType<typeof spec>>;serial:Promise<unknown>}>>();
 constructor(private storage:DomainFacility,private identity:IdentityService,private facts:(developmentId:string,actor:ActorContext,signal?:AbortSignal)=>Promise<AcceptanceFacts>){}
 private check(actor:ActorContext,signal?:AbortSignal){signal?.throwIfAborted();if(this.closed)throw Error('workbench/acceptance-closed');const p=this.identity.profile();if(p.principalId!==actor.principalId||p.organization.id!==actor.organizationId||p.resolvedBy!==actor.resolvedBy||this.identity.membership(actor.organizationId,actor.principalId)?.state!=='active')throw Error('workbench/development-access-denied');}
 async invoke(developmentId:string,expected?:AcceptanceBinding,signal?:AbortSignal){
  if(typeof developmentId!=='string'||!developmentId.trim()||developmentId.length>128)throw Error('workbench/invalid-request');
  if(expected){expected=acceptanceBindingSchema.parse(expected);if(expected.developmentId!==developmentId)throw Error('workbench/invalid-request');}
  const actor=await this.identity.resolve(undefined,signal);assertActorContext(actor);this.check(actor,signal);
  const key=JSON.stringify([actor.organizationId,actor.principalId]);let pending=this.stores.get(key);if(!pending){pending=this.storage.open(spec(actor)).then(domain=>({domain,serial:Promise.resolve()}));this.stores.set(key,pending);pending.catch(()=>{if(this.stores.get(key)===pending)this.stores.delete(key);});}
  const store=await pending;this.check(actor,signal);
  const run=store.serial.then(async()=>{
   this.check(actor,signal);const facts=await this.facts(developmentId,actor,signal);this.check(actor,signal);
   const receipts=store.domain.global.get().receipts;
   if(expected){
    if(!facts.ready||!facts.binding||!same(expected,facts.binding))throw Error('workbench/acceptance-stale');
    const again=await this.facts(developmentId,actor,signal);this.check(actor,signal);if(!again.ready||!again.binding||!same(expected,again.binding))throw Error('workbench/acceptance-stale');
    const existing=receipts.find(row=>sameBinding(row,expected!));
    if(existing)return {...facts,accepted:existing};
    if(receipts.length>=1000)throw Error('workbench/acceptance-limit');
    const accepted={...expected,acceptedAt:new Date().toISOString(),principalId:actor.principalId,organizationId:actor.organizationId};
    this.check(actor,signal);await store.domain.global.set({receipts:[...receipts,accepted]});this.check(actor,signal);return {...facts,accepted};
   }
   return {...facts,accepted:facts.binding?receipts.find(row=>sameBinding(row,facts.binding!)):undefined};
  });store.serial=run.catch(()=>undefined);return run;
 }
 async close(){this.closed=true;await Promise.allSettled([...this.stores.values()].map(async p=>{const s=await p;await s.serial;await s.domain.close();}));this.stores.clear();}
}
function sameBinding(a:AcceptanceBinding,b:AcceptanceBinding){return same({developmentId:a.developmentId,requirementsRevision:a.requirementsRevision,packageName:a.packageName,version:a.version,sha256:a.sha256,hostId:a.hostId,profileId:a.profileId,installationId:a.installationId},b);}
