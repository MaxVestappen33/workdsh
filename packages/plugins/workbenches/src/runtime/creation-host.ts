import {createHash} from 'node:crypto';
import {mkdir,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import type {Context} from '@deepseek-ai/cordis';
import type {ProfileContext} from '@deepseek-ai/dsh-app-boot';
import type {DomainFacility} from '@deepseek-ai/dsh-storage-domain';
import type {HostConnectionHandle} from '@deepseek-ai/dsh-client-connection';
import type {IdentityService,RuntimeBindingService} from 'workdsh-contracts';
import type {} from '@deepseek-ai/dsh-api-session-controller';
import type {} from '@deepseek-ai/dsh-api-workspace-controller';
import {WorkbenchCreationService} from './creation-service.js';
import {createProfileWorkbenchTarget} from './profile-target.js';
import {createProfileWorkbenchDevelopmentSourceVerifier} from './profile-development-source.js';
import {createNativeWorkbenchDevelopmentSessionVerifier} from './native-development-session.js';
import type {mountProfileWorkbenchAuthoringHost} from './profile-authoring-host.js';
import {handleWorkbenchCreationRequest} from './creation-rpc.js';
import {defineTool,type ToolRunContext} from '@deepseek-ai/dsh-tools';
import {confirmCreationDevelopment} from './creation-development.js';

export const workbenchCreationPath='/api/workdsh-workbench-creation';
export async function mountWorkbenchCreationHost(ctx:Context,authoring:Awaited<ReturnType<typeof mountProfileWorkbenchAuthoringHost>>){
  const identity=ctx.get('workdshIdentity') as IdentityService;
  const access=ctx.get('workdshAccess') as RuntimeBindingService;
  const storage=ctx.get('storageDomain') as DomainFacility;
  const connection=ctx.get('connection') as HostConnectionHandle;
  const profile=ctx.get('profileContext') as ProfileContext;
  const captured={name:profile.name,dir:profile.dir,home:profile.home};
  const target=await createProfileWorkbenchTarget(ctx);
  const source=createProfileWorkbenchDevelopmentSourceVerifier(ctx);
  const protectedSessions=ctx.get('workdshSessionAccess') as {create(request:Parameters<Context['sessionController']['create']>[0],signal?:AbortSignal):ReturnType<Context['sessionController']['create']>;inspect:Context['sessionController']['inspect']}|undefined;
  const sessionAuthority=async(actor:import('workdsh-contracts').ActorContext,id:string,signal?:AbortSignal)=>{
    signal?.throwIfAborted();ctx.fiber.assertActive();
    const actual=await identity.resolve({sessionId:id},signal),owner=access.sessionOwner(id);
    if(actual.principalId!==actor.principalId||actual.organizationId!==actor.organizationId||!owner||owner.ownerPrincipalId!==actor.principalId||owner.organizationId!==actor.organizationId)throw Error('workbench/creation-access-denied');
    if(identity.profile().organization.kind!=='personal'&&!protectedSessions)throw Error('workbench/session-authority-unavailable');
    signal?.throwIfAborted();ctx.fiber.assertActive();
  };
  const service=new WorkbenchCreationService(storage,identity,{
    target,
    authorizeSession:sessionAuthority,
    async session(actor,row,check,signal){
      check();ctx.fiber.assertActive();
      if(!row.sessionId&&(await authoring.development.list(signal)).some(entry=>entry.development.id===row.id))throw Error('workbench/creation-conflict');
      const current=ctx.get('profileContext') as ProfileContext;
      if(current.name!==captured.name||current.dir!==captured.dir||current.home!==captured.home)throw Error('workbench/creation-conflict');
      if(identity.profile().organization.kind!=='personal'&&!protectedSessions)throw Error('workbench/session-authority-unavailable');
      // Reserve an empty workspace for this explicit creation. The existing
      // source verifier later writes the scaffold into this exact directory.
      const root=join(await realpath(captured.dir),'workdsh-workbench-sources');check();
      await mkdir(root,{recursive:true,mode:0o700});check();
      if(await realpath(root)!==root)throw Error('workbench/source-directory-outside');
      const key=createHash('sha256').update(JSON.stringify([actor.organizationId,actor.principalId,row.target.hostId,row.id])).digest('hex');
      const directory=join(root,key);await mkdir(directory,{recursive:true,mode:0o700});check();
      if(await realpath(directory)!==directory)throw Error('workbench/source-directory-outside');
      const id=`session-${createHash('sha256').update(JSON.stringify(['workdsh-creation',actor.organizationId,actor.principalId,row.target.installationId,row.id])).digest('hex').slice(0,32)}`;
      const owner=access.sessionOwner(id);
      if(owner&&(owner.ownerPrincipalId!==actor.principalId||owner.organizationId!==actor.organizationId))throw Error('workbench/creation-access-denied');
      const {workspace,created}=await ctx.workspaceController.create({path:directory});check();
      if(created){await ctx.workspaceController.rename({workspaceId:workspace.workspaceId,title:`制作 · ${row.idea.replace(/\s+/g,' ').slice(0,32)}`});check();}
      const request:Parameters<Context['sessionController']['create']>[0]={sessionId:id as never,workspaceId:workspace.workspaceId,agentPreset:'cordis'};
      const native=protectedSessions?await protectedSessions.create(request,signal):await ctx.sessionController.create(request);check();
      if(String(native.sessionId)!==id||native.agentPreset!=='cordis')throw Error('workbench/development-creator-required');
      if(!access.sessionOwner(id)&&identity.profile().organization.kind==='personal')await access.bindSession(actor,{sessionId:id},signal);
      await sessionAuthority(actor,id,signal);check();
      const inspected=await (protectedSessions??ctx.sessionController).inspect(id as never);check();
      if(!inspected.meta.cwd||await realpath(inspected.meta.cwd)!==directory)throw Error('workbench/session-workspace-mismatch');
      return id;
    },
    async confirm(_actor,row,requirements,check,signal){
      return confirmCreationDevelopment(row,requirements,{requirements:authoring.requirements,development:authoring.development,source,
        session:createNativeWorkbenchDevelopmentSessionVerifier(ctx,row.sessionId!)},check,signal);
    },
  });
  ctx.effect(()=>()=>service.close(),'workdsh.creation.close');
  ctx.effect(()=>connection.fetch.register({path:workbenchCreationPath,methods:['POST'],requestBody:'streaming',fetch:request=>handleWorkbenchCreationRequest(request,service)}),'workdsh.creation.rpc');
  const session=(exec:ToolRunContext)=>{exec.signal.throwIfAborted();if(!exec.agent?.id)throw Error('workbench/creation-session-required');return exec.agent.id;};
  ctx.tools.register(defineTool({name:'workbench_read_creation_request',description:'读取当前原生制作会话的用户想法和已保存需求摘要。先区分需求梳理与已确认开发阶段，不能指定其他会话或制作记录。',parameters:{},output:{schema:{type:'json'},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},presentCall:()=>({card:'generic',title:'读取应用想法',kind:'read'}),async execute(args,exec){if(Object.keys(args).length)throw Error('workbench/invalid-creation-request');return service.readSession(session(exec),exec.signal);}}));
  ctx.tools.register(defineTool({name:'workbench_propose_requirements',description:'为当前制作会话保存可修改的需求摘要。只记录已知内容和明确的设计建议，未知项可省略；不确认需求，不生成源码或安装应用。用户在业务面板核对后才进入开发。先读取当前 revision，不能指定其他记录。',parameters:{expectedRevision:{type:'string',required:true},proposal:{type:'object',required:true,properties:Object.fromEntries(['title','scenario','users','dataSources','workflow','firstIteration','acceptance'].map(key=>[key,{type:'string'}])),additionalProperties:false}},output:{schema:{type:'json'},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},presentCall:()=>({card:'generic',title:'整理应用需求摘要',kind:'other'}),async execute(args,exec){if(typeof args.expectedRevision!=='string'||Object.keys(args).some(key=>!['expectedRevision','proposal'].includes(key)))throw Error('workbench/invalid-creation-request');return service.propose(session(exec),args.expectedRevision,args.proposal,exec.signal);}}));
  return service;
}
