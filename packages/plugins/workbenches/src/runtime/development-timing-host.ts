import type {Context} from '@deepseek-ai/cordis';
import type {ProfileContext} from '@deepseek-ai/dsh-app-boot';
import type {HostConnectionHandle} from '@deepseek-ai/dsh-client-connection';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {assertActorContext,type IdentityService} from 'workdsh-contracts';
import type {WorkbenchDevelopmentService} from './development-service.js';
import type {WorkbenchRequirementsService} from './requirements-service.js';
import type {WorkbenchDevelopmentToolsApi} from './development-tools.js';
import {createProfileWorkbenchTarget} from './profile-target.js';
import {createNativeWorkbenchDevelopmentSessionVerifier} from './native-development-session.js';
import {readWorkbenchSdkMetadata} from './sdk-metadata.js';
import {readWorkbenchRequestBody} from './request-body.js';
import {WorkbenchDevelopmentTiming,timingScopeKey} from './development-timing.js';
/** Diagnostic owner is separate from installation/reconciliation authority. */
export async function mountWorkbenchDevelopmentTimingHost<T extends WorkbenchDevelopmentToolsApi>(ctx:Context,directory:string,development:WorkbenchDevelopmentService,requirements:WorkbenchRequirementsService,api:T){
 const identity=ctx.get('workdshIdentity') as IdentityService,profile=ctx.get('profileContext') as ProfileContext,connection=ctx.get('connection') as HostConnectionHandle;
 const target=await createProfileWorkbenchTarget(ctx),sdk=await readWorkbenchSdkMetadata(profile.installAnchor),timing=new WorkbenchDevelopmentTiming(join(directory,'workdsh-workbench-timings'));
 let closed=false;ctx.effect(()=>()=>{closed=true;},'workdsh.workbench.timing.close');
 async function scope(id:string|undefined,sessionId:string|undefined,signal?:AbortSignal){
  const actor=await identity.resolve(sessionId?{sessionId}:undefined,signal);assertActorContext(actor);
  const check=()=>{signal?.throwIfAborted();ctx.fiber.assertActive();const current=identity.profile();if(closed||current.principalId!==actor.principalId||current.organization.id!==actor.organizationId||current.resolvedBy!==actor.resolvedBy||identity.membership(actor.organizationId,actor.principalId)?.state!=='active')throw Error('workbench/development-access-denied');};
  check();const actual=await target(actor,signal);check();const entries=await development.list(signal);check();
  const rows=entries.filter(row=>sessionId?row.development.session?.sessionId===sessionId:row.development.id===id);if(rows.length!==1)throw Error('workbench/development-owner-mismatch');
  const baseline=structuredClone(rows[0]!.development);
  const key=createHash('sha256').update(JSON.stringify([actor.organizationId,actor.principalId,actual.hostId,baseline.id])).digest('hex');
  if(!baseline.source||baseline.source.directory!==join(directory,'workdsh-workbench-sources',key)||baseline.source.hostId!==actual.hostId||JSON.stringify(baseline.target)!==JSON.stringify(actual))throw Error('workbench/source-identity-mismatch');
  const guard=async()=>{check();const latestTarget=await target(actor,signal);check();if(JSON.stringify(latestTarget)!==JSON.stringify(actual))throw Error('workbench/installation-target-changed');
   if(sessionId){await createNativeWorkbenchDevelopmentSessionVerifier(ctx,sessionId)(actor,baseline,signal);check();}
   const latest=(await requirements.history(baseline.id,signal)).at(-1);check();if(latest?.id!==baseline.requirementsRevision)throw Error('workbench/requirements-revision-conflict');
   const current=(await development.list(signal)).find(row=>row.development.id===baseline.id)?.development;check();if(current?.revision!==baseline.revision)throw Error('workbench/development-revision-conflict');};
  await guard();return {key:timingScopeKey(key,baseline.iterationId),source:baseline.source.directory,sdkDirectory:sdk.status==='available'?sdk.packageDirectory:undefined,guard};
 }
 ctx.effect(()=>connection.fetch.register({path:'/api/workdsh-workbench-timing',methods:['POST'],requestBody:'streaming',fetch:async request=>{try{
  const body=await readWorkbenchRequestBody(request) as Record<string,unknown>;
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==1||typeof body.developmentId!=='string'||!body.developmentId.trim()||body.developmentId.length>128)throw Error('workbench/invalid-request');
  const value=await timing.read(await scope(body.developmentId,undefined,request.signal));return Response.json({ok:true,value});
 }catch{return Response.json({ok:false,error:{code:'workbench/timing-unavailable'}},{status:409});}}}),'workdsh.workbench.timing.rpc');
 return {...api,timing,resolveTimingScope:(sessionId:string)=>scope(undefined,sessionId)};
}
