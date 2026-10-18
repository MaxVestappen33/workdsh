import {createHash} from 'node:crypto';
import {defineDomain,type Domain,type DomainFacility} from '@deepseek-ai/dsh-storage-domain';
import {z} from 'zod';
import {assertActorContext,type ActorContext} from 'workdsh-contracts';
import type {QualityReportDraftSummary} from '../domain/report-draft.js';
import {qualityReportIdentifierSchema,qualityReportRevisionIdSchema} from '../domain/report-document.js';
import {qualityFocusSelectionSchema,type QualityFocusSelection} from '../domain/analysis-focus.js';

const id=z.string().min(1).max(256),hash=z.string().regex(/^[a-f0-9]{64}$/);
const draft=z.object({draftId:id,recordId:id,runId:id,contentHash:hash,draftRevision:id,sha256:hash,title:z.string().max(256),updatedAt:z.string().datetime(),status:z.enum(['active','archived']),reportId:id.optional(),baseRevisionId:id.optional()}).strict();
export const qualityAiReportTargetSchema=z.object({reportId:qualityReportIdentifierSchema,revisionId:qualityReportRevisionIdSchema}).strict();
export type QualityAiReportTarget=z.infer<typeof qualityAiReportTargetSchema>;
const context=z.object({recordId:id.max(128),sessionId:id,originRunId:id.max(128),originContentHash:hash,runId:id.max(128),contentHash:hash,revision:z.number().int().nonnegative(),reportDraft:draft.optional(),selectedReport:qualityAiReportTargetSchema.optional(),selectedFocus:qualityFocusSelectionSchema.optional()}).strict();
export type QualityAiContext=z.infer<typeof context>;
const operation=z.object({id:hash,requestHash:hash,result:context}).strict();
const stateSchema=z.object({organizationId:id,principalId:id,bindings:z.array(context).max(1000),operations:z.array(operation).max(1000)}).strict();
function spec(actor:ActorContext){const key=createHash('sha256').update(JSON.stringify([actor.organizationId,actor.principalId])).digest('hex').slice(0,40);
 return defineDomain({name:`workdsh_quality_ai_${key}`,version:1,global:{schema:stateSchema,initial:{organizationId:actor.organizationId,principalId:actor.principalId,bindings:[] as QualityAiContext[],operations:[] as z.infer<typeof operation>[]}},tables:{}});
}
/** The Host owns the Session -> immutable analytical basis binding. It contains
 * no credentials, model state or report body. The Session remains native. */
export class QualityAiSessionStore {
 private serial:Promise<unknown>=Promise.resolve();private closing?:Promise<void>;
 private constructor(private readonly domain:Domain<ReturnType<typeof spec>>,private readonly actor:ActorContext){}
 static async open(storage:DomainFacility,actor:ActorContext){assertActorContext(actor);return new QualityAiSessionStore(await storage.open(spec(actor)),{...actor});}
 read(sessionId:string){return structuredClone(this.state().bindings.find(row=>row.sessionId===sessionId));}
 /** Reverse lookup is scoped by this actor-owned domain and the exact current
  * immutable result. Historical intermediate runs never retarget a Session. */
 findRun(recordId:string,runId:string,contentHash:string){
  const matches=this.state().bindings.filter(row=>row.recordId===recordId&&row.runId===runId&&row.contentHash===contentHash);
  if(matches.length>1)throw Error('quality/ai/session-selection-conflict');
  return structuredClone(matches[0]);
 }
 async selectReport(binding:QualityAiContext,target:QualityAiReportTarget|null,guard:()=>void,signal?:AbortSignal){
  const selected=target===null?undefined:qualityAiReportTargetSchema.parse(target);
  return this.write(async()=>{signal?.throwIfAborted();guard();const state=this.state(),current=state.bindings.find(row=>row.sessionId===binding.sessionId);
   if(!current||current.recordId!==binding.recordId||current.runId!==binding.runId||current.contentHash!==binding.contentHash||current.revision!==binding.revision)throw Error('quality/ai/context-conflict');
   if(current.selectedReport?.reportId===selected?.reportId&&current.selectedReport?.revisionId===selected?.revisionId)return structuredClone(current);
   const next=context.parse({...current,selectedReport:selected,revision:current.revision+1});
   await this.domain.global.set({...state,bindings:state.bindings.map(row=>row.sessionId===binding.sessionId?next:row)});guard();return structuredClone(next);
  });
 }
 async bind(source:{recordId:string;runId:string;contentHash:string;sessionId:string},guard:()=>void,signal?:AbortSignal){
  const proposed=context.parse({...source,originRunId:source.runId,originContentHash:source.contentHash,revision:0});
  return this.write(async()=>{signal?.throwIfAborted();guard();const state=this.state(),prior=state.bindings.find(row=>row.sessionId===source.sessionId);
   if(prior){if(prior.recordId!==source.recordId||prior.originRunId!==source.runId||prior.originContentHash!==source.contentHash)throw Error('quality/ai/binding-conflict');return structuredClone(prior);}
   if(state.bindings.length>=1000)throw Error('quality/ai/binding-budget');
   await this.domain.global.set({...state,bindings:[...state.bindings,proposed]});guard();return structuredClone(proposed);
  });
 }
 async selectFocus(binding:QualityAiContext,target:QualityFocusSelection|null,guard:()=>void,signal?:AbortSignal){
  const selected=target===null?undefined:qualityFocusSelectionSchema.parse(target);
  return this.write(async()=>{signal?.throwIfAborted();guard();const state=this.state(),current=state.bindings.find(row=>row.sessionId===binding.sessionId);
   if(!current||current.recordId!==binding.recordId||current.runId!==binding.runId||current.contentHash!==binding.contentHash||current.revision!==binding.revision)throw Error('quality/ai/context-conflict');
   if(JSON.stringify(current.selectedFocus)===JSON.stringify(selected))return structuredClone(current);
   const next=context.parse({...current,selectedFocus:selected,revision:current.revision+1});
   await this.domain.global.set({...state,bindings:state.bindings.map(row=>row.sessionId===binding.sessionId?next:row)});guard();return structuredClone(next);
  });
 }
 async mutate(sessionId:string,operationId:string,requestHash:string,guard:()=>void,execute:(before:QualityAiContext)=>Promise<{runId?:string;contentHash?:string;reportDraft?:QualityReportDraftSummary}>,signal?:AbortSignal){
  if(!hash.safeParse(operationId).success||!hash.safeParse(requestHash).success)throw Error('quality/ai/invalid-operation');
  return this.write(async()=>{signal?.throwIfAborted();guard();let state=this.state();const prior=state.operations.find(row=>row.id===operationId);
   if(prior){if(prior.requestHash!==requestHash||prior.result.sessionId!==sessionId)throw Error('quality/ai/operation-conflict');return structuredClone(prior.result);}
   if(state.operations.length>=1000)throw Error('quality/ai/operation-budget');
   const before=state.bindings.find(row=>row.sessionId===sessionId);if(!before)throw Error('quality/ai/not-bound');
   const patch=await execute(structuredClone(before));signal?.throwIfAborted();guard();state=this.state();
   const current=state.bindings.find(row=>row.sessionId===sessionId);if(!current||current.revision!==before.revision)throw Error('quality/ai/context-conflict');
   const next=context.parse({...before,...patch,revision:before.revision+1,...(patch.runId?{reportDraft:undefined,selectedReport:undefined,selectedFocus:undefined}:{})});
   if(next.reportDraft&&(next.reportDraft.recordId!==next.recordId||next.reportDraft.runId!==next.runId||next.reportDraft.contentHash!==next.contentHash))throw Error('quality/ai/draft-binding-conflict');
   await this.domain.global.set({...state,bindings:state.bindings.map(row=>row.sessionId===sessionId?next:row),operations:[...state.operations,{id:operationId,requestHash,result:next}]});guard();return structuredClone(next);
  });
 }
 close(){return this.closing??=this.serial.then(()=>this.domain.close());}
 private write<T>(run:()=>Promise<T>):Promise<T>{if(this.closing)return Promise.reject(Error('quality/ai/closed'));const pending=this.serial.then(run);this.serial=pending.catch(()=>undefined);return pending;}
 private state(){if(this.closing)throw Error('quality/ai/closed');const state=this.domain.global.get();if(state.organizationId!==this.actor.organizationId||state.principalId!==this.actor.principalId)throw Error('quality/ai/owner-mismatch');return state;}
}
