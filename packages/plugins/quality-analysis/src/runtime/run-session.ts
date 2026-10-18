import type {SessionCreateRequest,SessionCreateValue} from '@deepseek-ai/dsh-api-session-controller/types';
import {createHash} from 'node:crypto';
import {realpath} from 'node:fs/promises';
import type {Context} from '@deepseek-ai/cordis';
import type {IdentityService,RuntimeBindingService} from 'workdsh-contracts';
import type {QualityAiTools} from './ai-tools.js';
import type {QualityAiReportTarget} from './ai-session-store.js';
import {attachQualitySession,createQualityWorkspace,qualityWorkspacePorts,registerQualityWorkspace} from './session-workspace.js';
type RunView={recordId:string;runId:string;contentHash:string};
export type QualityAiRunSessionRequest=RunView&{reportTarget?:QualityAiReportTarget|null};

/** Reopening the exact current AI result continues its original owned native
 * Session. An older intermediate result is never silently retargeted. */
export async function ensureQualityAiRunSession(ctx:Context,view:QualityAiRunSessionRequest,ai:Pick<QualityAiTools,'findRunSession'|'bind'|'selectReport'>,verifyRun:(view:RunView,signal?:AbortSignal)=>Promise<unknown>,signal?:AbortSignal,workspaceRoot?:string){
 const basis={recordId:view.recordId,runId:view.runId,contentHash:view.contentHash};
 const continued=await ai.findRunSession(view,signal);
 if(continued){
  if(continued.recordId!==view.recordId||continued.runId!==view.runId||continued.contentHash!==view.contentHash)throw Error('quality/ai/context-conflict');
  const origin={recordId:view.recordId,runId:continued.originRunId,contentHash:continued.originContentHash};
  const receipt=await ensureQualityRunSession(ctx,origin,async()=>{await verifyRun(view,signal);await verifyRun(origin,signal);},signal,workspaceRoot);
  if(receipt.sessionId!==continued.sessionId)throw Error('quality/ai/session-selection-conflict');
  const current=await ai.findRunSession(view,signal);
  if(current?.sessionId!==continued.sessionId)throw Error('quality/ai/context-conflict');
  if(view.reportTarget!==undefined)await ai.selectReport(basis,receipt.sessionId,view.reportTarget,signal);
  return {...basis,sessionId:receipt.sessionId};
 }
 const receipt=await ensureQualityRunSession(ctx,view,()=>verifyRun(view,signal),signal,workspaceRoot);
 const bound=await ai.bind(receipt,signal);
 if(bound.recordId!==basis.recordId||bound.runId!==basis.runId||bound.contentHash!==basis.contentHash||bound.sessionId!==receipt.sessionId)throw Error('quality/ai/context-conflict');
 if(view.reportTarget!==undefined)await ai.selectReport(basis,receipt.sessionId,view.reportTarget,signal);
 return receipt;
}
/** Native Controller creates the Session; this adapter binds no model or tools. */
export async function ensureQualityRunSession(ctx:Context,view:RunView,verifyRun:()=>Promise<unknown>,signal?:AbortSignal,workspaceRoot?:string){
 if(!view.recordId.trim()||view.recordId.length>128||!view.runId.trim()||view.runId.length>128||!/^[a-f0-9]{64}$/.test(view.contentHash))throw Error('quality/request/invalid');
 const identity=ctx.get('workdshIdentity') as IdentityService|undefined;
 const access=ctx.get('workdshAccess') as RuntimeBindingService|undefined;
 type Native={create(request:SessionCreateRequest):Promise<SessionCreateValue>;inspect(sessionId:NonNullable<SessionCreateRequest['sessionId']>,signal?:AbortSignal):Promise<{meta:{cwd?:string}}>;};
 type Protected=Native&{create(request:SessionCreateRequest,signal?:AbortSignal):Promise<SessionCreateValue>};
 const native=ctx.get('sessionController') as Native|undefined;
 const protectedSessions=ctx.get('workdshSessionAccess') as Protected|undefined;
 if(!identity||!access||!native)throw Error('quality/service/session-unavailable');
 const actor=await identity.resolve(undefined,signal);
 const authorize=()=>{signal?.throwIfAborted();ctx.fiber.assertActive();const profile=identity.profile();if(profile.principalId!==actor.principalId||profile.organization.id!==actor.organizationId||profile.resolvedBy!==actor.resolvedBy||identity.membership(actor.organizationId,actor.principalId)?.state!=='active')throw Error('quality/service/access-denied');if(profile.organization.kind!=='personal'&&!protectedSessions)throw Error('quality/service/session-unavailable');};
 authorize();await verifyRun();authorize();
 const sessionId=`session-${createHash('sha256').update(JSON.stringify(['workdsh-quality-analysis',actor.organizationId,actor.principalId,view.recordId,view.runId,view.contentHash])).digest('hex').slice(0,32)}`;
 const matches=(owner:ReturnType<RuntimeBindingService['sessionOwner']>)=>owner?.organizationId===actor.organizationId&&owner?.ownerPrincipalId===actor.principalId;
 const prior=access.sessionOwner(sessionId);if(prior&&!matches(prior))throw Error('quality/service/access-denied');
 const ports=qualityWorkspacePorts(ctx),id=sessionId as NonNullable<SessionCreateRequest['sessionId']>;
 const authorizeSession=()=>{authorize();if(prior&&!matches(access.sessionOwner(sessionId)))throw Error('quality/service/access-denied');};
 // Earlier versions created owned Sessions with only default cwd. Attach the
 // same immutable native header path; no new Session, cwd, owner or history.
 if(prior&&prior.workspaceId===undefined){
  if(typeof (protectedSessions??native).inspect!=='function')throw Error('quality/service/session-unavailable');
  const inspected=await (protectedSessions??native).inspect(id,signal);authorizeSession();
  if(typeof inspected.meta?.cwd!=='string'||!inspected.meta.cwd)throw Error('quality/service/workspace-conflict');
  const workspace=await registerQualityWorkspace(ports,inspected.meta.cwd,authorizeSession);
  await attachQualitySession(workspace,id,authorizeSession);await verifyRun();authorizeSession();
  return {recordId:view.recordId,runId:view.runId,contentHash:view.contentHash,sessionId};
 }
 const workspace=prior?.workspaceId===undefined?await createQualityWorkspace(ports,actor,view.recordId,authorizeSession,workspaceRoot):ports.registry.get(prior.workspaceId as NonNullable<SessionCreateRequest['workspaceId']>);
 authorizeSession();if(!workspace)throw Error('quality/service/workspace-conflict');
 // Native headers keep their original cwd. A Host data-directory relocation
 // may retain that path as a compatibility link; inspect the existing owned
 // Session and its canonical Workspace instead of asking create to rewrite it.
 if(prior){
  const inspected=await (protectedSessions??native).inspect(id,signal);authorizeSession();
  if(typeof inspected.meta?.cwd!=='string'||!inspected.meta.cwd)throw Error('quality/service/workspace-conflict');
  if(await realpath(inspected.meta.cwd)!==await realpath(workspace.path))throw Error('quality/service/workspace-conflict');
  await verifyRun();authorizeSession();
  await attachQualitySession(workspace,id,authorizeSession);
  return {recordId:view.recordId,runId:view.runId,contentHash:view.contentHash,sessionId};
 }
 const request:SessionCreateRequest={sessionId:id,workspaceId:workspace.id};
 const result=protectedSessions?await protectedSessions.create(request,signal):await native.create(request);authorize();
 if(String(result.sessionId)!==sessionId)throw Error('quality/service/session-conflict');
 let owner=access.sessionOwner(sessionId);
 if(!owner&&identity.profile().organization.kind==='personal')owner=await access.bindSession(actor,{sessionId,workspaceId:String(workspace.id)},signal);
 authorize();if(!matches(owner))throw Error('quality/service/access-denied');
 if(owner?.workspaceId!==String(workspace.id))throw Error('quality/service/workspace-conflict');
 await attachQualitySession(workspace,id,()=>{authorize();if(!matches(access.sessionOwner(sessionId)))throw Error('quality/service/access-denied');});
 return {recordId:view.recordId,runId:view.runId,contentHash:view.contentHash,sessionId};
}

/** Read an existing owned Session only; this path never creates or resumes an Agent. */
export async function readQualityRunInterpretation(ctx:Context,view:{recordId:string;runId:string;contentHash:string},verifyRun:()=>Promise<unknown>,signal?:AbortSignal){
 const {readQualityInterpretationCandidate}=await import('./interpretation-candidate.js');
 const identity=ctx.get('workdshIdentity') as IdentityService|undefined;
 const access=ctx.get('workdshAccess') as RuntimeBindingService|undefined;
 type Inspector={inspect(sessionId:string,signal?:AbortSignal):Promise<{events:readonly unknown[]}>};
 const native=ctx.get('sessionController') as Inspector|undefined;
 const protectedSessions=ctx.get('workdshSessionAccess') as Inspector|undefined;
 if(!identity||!access||!native)throw Error('quality/service/session-unavailable');
 const actor=await identity.resolve(undefined,signal);
 const sessionId=`session-${createHash('sha256').update(JSON.stringify(['workdsh-quality-analysis',actor.organizationId,actor.principalId,view.recordId,view.runId,view.contentHash])).digest('hex').slice(0,32)}`;
 const authorize=()=>{signal?.throwIfAborted();ctx.fiber.assertActive();const profile=identity.profile(),owner=access.sessionOwner(sessionId);
  if(profile.principalId!==actor.principalId||profile.organization.id!==actor.organizationId||profile.resolvedBy!==actor.resolvedBy||identity.membership(actor.organizationId,actor.principalId)?.state!=='active'||owner?.organizationId!==actor.organizationId||owner?.ownerPrincipalId!==actor.principalId)throw Error('quality/service/access-denied');
  if(profile.organization.kind!=='personal'&&!protectedSessions)throw Error('quality/service/session-unavailable');
 };
 authorize();await verifyRun();authorize();
 const inspected=await (protectedSessions??native).inspect(sessionId,signal);authorize();
 await verifyRun();authorize();
 return readQualityInterpretationCandidate({...view,sessionId},inspected.events);
}
