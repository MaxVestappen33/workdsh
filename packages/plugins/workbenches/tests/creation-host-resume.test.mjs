import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const web=createRequire(new URL('../../../../apps/web/package.json',import.meta.url));
const runtime=createRequire(new URL('../../projects/package.json',import.meta.url));
const localRuntime=createRequire(new URL('../package.json',import.meta.url));
const built=await web('esbuild').build({stdin:{contents:"export {mountWorkbenchCreationHost} from './creation-host.ts';export {createProfileWorkbenchTarget} from './profile-target.ts';export {WorkbenchRequirementsService} from './requirements-service.ts';export {WorkbenchDevelopmentService} from './development-service.ts';export {restoreCreationReview} from '../client/creation-review.ts';",resolveDir:fileURLToPath(new URL('../src/runtime',import.meta.url))},bundle:true,platform:'node',format:'esm',write:false,alias:{'workdsh-contracts':fileURLToPath(new URL('../../../contracts/src/index.ts',import.meta.url))},plugins:[{name:'official',setup(builder){builder.onResolve({filter:/^(?:@deepseek-ai\/|zod$)/},args=>({path:pathToFileURL(localRuntime.resolve(args.path)).href,external:true}));}}]});
const {mountWorkbenchCreationHost,createProfileWorkbenchTarget,WorkbenchRequirementsService,WorkbenchDevelopmentService,restoreCreationReview}=await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const load=name=>import(pathToFileURL(runtime.resolve(name)).href);
const {Context}=await load('@deepseek-ai/cordis');const {default:Storage}=await load('@deepseek-ai/dsh-storage');const Json=await load('@deepseek-ai/dsh-storage-json');const Domain=await load('@deepseek-ai/dsh-storage-domain');
for(const existingBehavior of ['mint-new-id','reject-existing'])test(`the mounted Host reopens a started Session (${existingBehavior}) after partial confirmation without creating another Session`,async()=>{
 const root=await mkdtemp(join(tmpdir(),'workdsh-host-creation-resume-')),profileDir=join(root,'profile');await mkdir(profileDir);await writeFile(join(profileDir,'package.json'),'{}');
 const owners=new Map(),sessions=new Map(),workspaces=new Map();let creates=0,boot;
 const actor={principalId:'member',organizationId:'personal',requestId:'fixture',resolvedBy:'fixture'};
 const identity={resolve:async()=>actor,profile:()=>({principalId:actor.principalId,organization:{id:actor.organizationId,kind:'personal'},resolvedBy:actor.resolvedBy}),membership:()=>({state:'active'})};
 const access={sessionOwner:id=>owners.get(id),bindSession:async(_actor,{sessionId})=>{const owner={ownerPrincipalId:actor.principalId,organizationId:actor.organizationId};owners.set(sessionId,owner);return owner;}};
 const native={
  create:async request=>{creates++;const previous=sessions.get(request.sessionId);if(previous?.started){if(existingBehavior==='reject-existing')throw Error('already-started');return {sessionId:'new-blank-instead-of-started',agentPreset:'cordis'};}const cwd=workspaces.get(request.workspaceId);sessions.set(request.sessionId,{meta:{id:request.sessionId,cwd,agentPreset:'cordis'},started:false});return {sessionId:request.sessionId,agentPreset:'cordis'};},
  inspect:async id=>{const found=sessions.get(id);if(!found)throw Object.assign(Error('missing-session'),{code:'session/not-found'});return {meta:found.meta,events:found.started?[{type:'turn/start',seq:1}]:[]};},
  projections:async({sessionId})=>({kind:'sequenced',asOfSeq:sessions.get(sessionId)?.started?1:0,values:{agentPreset:'cordis'}}),
 };
 async function start(){
  const storageCtx=new Context();await storageCtx.plugin(Storage);await storageCtx.plugin(Json,{root:join(root,'storage')});await storageCtx.plugin(Domain,{backend:'json'});
  const services={profileContext:{name:'test',dir:profileDir,home:root},workdshIdentity:identity,workdshAccess:access,storageDomain:storageCtx.storageDomain,sessionController:native,connection:{fetch:{register:()=>()=>{}}}};
  const ctx={get:key=>services[key],fiber:{assertActive(){}},effect:()=>{},tools:{register(){}},sessionController:native,workspaceController:{create:async({path})=>{let entry=[...workspaces].find(([,cwd])=>cwd===path);const created=!entry;if(!entry){entry=[`workspace-${workspaces.size}`,path];workspaces.set(...entry);}return {workspace:{workspaceId:entry[0]},created};},rename:async()=>{}}};
  const requirements=new WorkbenchRequirementsService(storageCtx.storageDomain,identity),development=new WorkbenchDevelopmentService(storageCtx.storageDomain,identity,requirements,await createProfileWorkbenchTarget(ctx));services.workdshWorkbenchRequirements=requirements;
  const service=await mountWorkbenchCreationHost(ctx,{requirements,development});
  return {service,requirements,development,close:async()=>{await service.close();await development.close();await requirements.close();await storageCtx.fiber.dispose();}};
 }
 const draft={title:'旅行管家·实测',scenario:'管理多次旅行',users:'个人',dataSources:'手动录入',workflow:'旅行列表、行程、费用、待办',firstIteration:'新增和独立管理多次旅行',acceptance:'关闭重开数据保留'},id='d22cc68e-4b3d-4c97-825d-2db6f3769bbe';
 try{
  boot=await start();const first=await boot.service.open(id,'长期管理多次旅行');sessions.get(first.sessionId).started=true;
  const proposed=await boot.service.propose(first.sessionId,first.revision,{...draft,title:'AI旧标题'});
  await assert.rejects(boot.service.confirm(id,proposed.revision,draft),error=>error.message==='workbench/sdk-package-unavailable'&&error.requirementsSaved);
  await boot.close();boot=undefined;
  await mkdir(join(profileDir,'node_modules','workdsh-plugin-workbenches'),{recursive:true});await writeFile(join(profileDir,'node_modules','workdsh-plugin-workbenches','package.json'),JSON.stringify({name:'workdsh-plugin-workbenches',version:'3.0.0-alpha.49'}));
  boot=await start();const reopened=await boot.service.open(id,'长期管理多次旅行');
  assert.equal(reopened.sessionId,first.sessionId);assert.equal(reopened.needsOpening,false);assert.equal(creates,1);assert.equal(sessions.size,1);
  const recovered=restoreCreationReview(reopened,await boot.requirements.history(id));assert.equal(recovered.draft.title,'旅行管家·实测');
  const confirmed=await boot.service.confirm(id,recovered.revision,recovered.draft);assert.equal(confirmed.creation.phase,'confirmed');assert.equal(confirmed.development.development.session.sessionId,first.sessionId);
  await boot.service.confirm(id,recovered.revision,recovered.draft);
  assert.equal((await boot.requirements.history(id)).length,1);assert.equal((await boot.development.list()).length,1);assert.equal(creates,1);assert.equal(sessions.size,1);
 }finally{await boot?.close();await rm(root,{recursive:true,force:true});}
});
