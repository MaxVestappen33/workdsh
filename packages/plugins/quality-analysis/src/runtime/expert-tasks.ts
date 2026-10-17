import {createHash} from 'node:crypto';
import type {Context} from '@deepseek-ai/cordis';
import type {ExpertsService,IdentityService} from 'workdsh-contracts';
import type {QualityAnalysisRunService} from './run-service.js';
import {verifyQualityExpertAssociation} from './expert-association.js';
import {createQualityAnalysisInstruction} from '../client/analysis-instruction.js';

type Source={recordId:string;runId:string;contentHash:string};
/** Uses the shared experts owner's plans and native task creation. No model
 * selection, publishing, credential access or automatic prompt submission. */
export function createQualityExpertTasks(ctx:Context,service:QualityAnalysisRunService){
 async function authority(signal?:AbortSignal){
  const identity=ctx.get('workdshIdentity') as IdentityService|undefined;
  const experts=ctx.get('workdshExperts') as ExpertsService|undefined;
  if(!identity||!experts)throw Error('quality/service/expert-unavailable');
  const actor=await identity.resolve(undefined,signal);
  const check=()=>{signal?.throwIfAborted();ctx.fiber.assertActive();const profile=identity.profile();
   if(profile.principalId!==actor.principalId||profile.organization.id!==actor.organizationId||profile.resolvedBy!==actor.resolvedBy||identity.membership(actor.organizationId,actor.principalId)?.state!=='active')throw Error('quality/service/access-denied');
  };check();return {actor,experts,check};
 }
 return {
  async list(source:Source,signal?:AbortSignal){
   const {actor,experts,check}=await authority(signal);
   await service.readRunView(source.recordId,source.runId,source.contentHash,false,signal);check();
   const choices:{id:string;name:string;revisionId:string}[]=[];let cursor:string|undefined;
   const cursors=new Set<string>();
   do{
    const page=await experts.list(actor,{availability:'enabled',limit:100,...(cursor?{cursor}:{})},signal);check();
    for(const item of page.items)if(item.canUse&&item.publishedRevisionRef)choices.push({id:item.id,name:item.name,revisionId:item.publishedRevisionRef.revisionId});
    cursor=page.nextCursor;
    if(choices.length>1000||cursors.size>=20||(cursor&&cursors.has(cursor)))throw Error('quality/service/expert-list-budget');
    if(cursor)cursors.add(cursor);
   }while(cursor);
   return choices;
  },
  async prepare(source:Source,expertId:string,signal?:AbortSignal){
   const {actor,experts,check}=await authority(signal);
   const view=await service.readRunView(source.recordId,source.runId,source.contentHash,false,signal);check();
   const instruction=createQualityAnalysisInstruction(source.recordId,view);
   const plan=await experts.prepareExecution(actor,expertId,undefined,undefined,undefined,instruction,signal);check();
   if(plan.missing.length)throw Error('quality/service/expert-not-ready');
   if(plan.expertRevisionRef.expertId!==expertId)throw Error('quality/service/expert-binding-conflict');
   const operationId='quality-expert-'+createHash('sha256').update(JSON.stringify([actor.organizationId,actor.principalId,source.recordId,source.runId,source.contentHash,plan.executionPlanId])).digest('hex');
   await service.rememberExpertPlan({...source,executionPlanId:plan.executionPlanId,operationId,expertId,expertRevisionId:plan.expertRevisionRef.revisionId,expiresAt:plan.expiresAt,instruction},signal);check();
   return {...source,executionPlanId:plan.executionPlanId,expertId,expertRevisionId:plan.expertRevisionRef.revisionId,expiresAt:plan.expiresAt};
  },
  async create(source:Source,executionPlanId:string,signal?:AbortSignal){
   const {actor,experts,check}=await authority(signal);
   const plan=await service.readExpertPlan(source.recordId,source.runId,source.contentHash,executionPlanId,signal);check();
   // Let the shared owner replay a committed operation even after plan expiry.
   // A missing/expired uncommitted plan is rejected by that owner.
   const creation=await experts.createExecution(actor,executionPlanId,{operationId:plan.operationId},signal);check();
   if(creation.binding.expertRevisionRef.expertId!==plan.expertId||creation.binding.expertRevisionRef.revisionId!==plan.expertRevisionId||creation.binding.creationOperationId!==plan.operationId)throw Error('quality/service/expert-binding-conflict');
   const verifyRun=()=>service.readRunView(source.recordId,source.runId,source.contentHash,false,signal);
   const reverify=()=>verifyQualityExpertAssociation(ctx,source,creation,verifyRun,signal);
   const association=await reverify();check();
   await service.rememberExpertAssociation(association,reverify,signal);check();
   return {association,instruction:plan.instruction};
  },
 };
}
