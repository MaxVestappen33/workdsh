import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {mkdtemp,realpath,rm,mkdir,symlink,rename} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const require=createRequire(new URL('../../../../apps/web/package.json',import.meta.url));
const runtime=createRequire(new URL('../../projects/package.json',import.meta.url));
const workspaceRuntime=createRequire(runtime.resolve('@deepseek-ai/dsh-api-workspace-controller'));
const load=name=>import(pathToFileURL(runtime.resolve(name)).href);
const {Context}=await load('@deepseek-ai/cordis'),{default:Storage}=await load('@deepseek-ai/dsh-storage');
const JsonStorage=await load('@deepseek-ai/dsh-storage-json'),StorageDomain=await load('@deepseek-ai/dsh-storage-domain');
const {WorkspaceRegistry}=await import(pathToFileURL(workspaceRuntime.resolve('@deepseek-ai/dsh-workspace')).href);
const {build}=require('esbuild');
const built=await build({entryPoints:[fileURLToPath(new URL('../src/runtime/run-session.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false});
const {ensureQualityRunSession:nativeEnsure,ensureQualityAiRunSession:ensureAi,readQualityRunInterpretation:readInterpretation}=await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const roots=new WeakMap();
const ensure=(ctx,view,verify,signal)=>nativeEnsure(ctx,view,verify,signal,roots.get(ctx));
const view={recordId:'record',runId:'run',contentHash:'a'.repeat(64)};
async function fixture(t,kind='personal'){
 let principal='member',creates=0;const owners=new Map(),sessions=new Map();
 const root=await realpath(await mkdtemp(join(tmpdir(),'quality-native-workspace-'))),native=new Context();
 t.after(async()=>{await native.fiber.dispose();await rm(root,{recursive:true,force:true});});
 await native.plugin(Storage);await native.plugin(JsonStorage,{root:join(root,'storage')});await native.plugin(StorageDomain,{backend:'json'});
 native.provide('sessionPersistence',{async list(){return [...sessions.values()].map(session=>({header:session.meta}));}});
 await native.plugin(WorkspaceRegistry);
 const actor={principalId:'member',organizationId:'org',resolvedBy:'identity'};
 const services={workdshIdentity:{resolve:async()=>actor,profile:()=>({principalId:principal,resolvedBy:'identity',organization:{id:'org',kind}}),membership:()=>({state:'active'})},workdshAccess:{sessionOwner:id=>owners.get(id),bindSession:async(actor,{sessionId,workspaceId})=>{const owner={ownerPrincipalId:actor.principalId,organizationId:actor.organizationId,...workspaceId?{workspaceId}:{}};const prior=owners.get(sessionId);if(prior){assert.deepEqual(prior,owner);return prior;}owners.set(sessionId,owner);return owner;}},
 workspaceRegistry:native.workspaceRegistry,
 workspaceController:{async create({path}){const prior=native.workspaceRegistry.list().find(w=>w.path===path),workspace=await native.workspaceRegistry.create(path);return {workspace:{workspaceId:workspace.id,path:workspace.path},created:!prior};}},
 sessionController:{async create({sessionId,workspaceId}){creates++;const workspace=native.workspaceRegistry.get(workspaceId);assert.ok(workspace,'native creation requires a real registered Workspace');const prior=sessions.get(sessionId);if(prior)assert.equal(prior.meta.cwd,workspace.path,'native Session immutable cwd');else sessions.set(sessionId,{meta:{id:sessionId,cwd:workspace.path},events:[]});await workspace.attachSession(sessionId);return {sessionId};},async inspect(sessionId){const value=sessions.get(sessionId);if(!value)throw Error('fixture/session-not-found');return structuredClone(value);}}};
 const ctx={get:key=>services[key],fiber:{assertActive(){}}};roots.set(ctx,root);
 return {ctx,native,root,actor,services,owners,sessions,creates:()=>creates,switchAccount:()=>{principal='other';}};
}
test('same immutable run reuses native identity and real Workspace membership; another run shares the record workspace',async t=>{
 const f=await fixture(t);const first=await ensure(f.ctx,view,async()=>{}),again=await ensure(f.ctx,view,async()=>{}),other=await ensure(f.ctx,{...view,runId:'other'},async()=>{});
 assert.equal(first.sessionId,again.sessionId);assert.notEqual(first.sessionId,other.sessionId);assert.equal(f.owners.size,2);assert.equal(first.contentHash,view.contentHash);
 const owner=f.owners.get(first.sessionId),workspace=f.native.workspaceRegistry.get(owner.workspaceId);assert.ok(workspace.sessionIds.includes(first.sessionId));assert.ok(workspace.sessionIds.includes(other.sessionId));assert.equal(workspace.title,'质量分析');assert.equal(f.owners.get(other.sessionId).workspaceId,owner.workspaceId);
 const another=await ensure(f.ctx,{...view,recordId:'another-record'},async()=>{});assert.notEqual(f.owners.get(another.sessionId).workspaceId,owner.workspaceId);
});
test('reopening the current AI run continues the original native Session and history while receipts describe the requested result',async t=>{
 const f=await fixture(t),original=await ensure(f.ctx,view,async()=>{}),current={...view,runId:'quality-ai-current',contentHash:'b'.repeat(64)};
 const binding={...current,sessionId:original.sessionId,originRunId:view.runId,originContentHash:view.contentHash,revision:1};
 const history=[{type:'assistant/message',text:'已有质量分析对话'}];f.sessions.get(original.sessionId).events=history;
 const verified=[],api={findRunSession:async requested=>requested.runId===binding.runId&&requested.contentHash===binding.contentHash?binding:undefined,bind:async()=>{throw Error('must not rebind current run as immutable origin');}};
 const reopened=await ensureAi(f.ctx,current,api,async basis=>verified.push(basis),undefined,f.root);
 assert.deepEqual(reopened,{...current,sessionId:original.sessionId});assert.equal(f.sessions.size,1);assert.equal(f.owners.size,1);
 assert.deepEqual(f.sessions.get(original.sessionId).events,history);assert.deepEqual(verified.slice(0,2),[current,view]);
 assert.ok(verified.every(basis=>basis.runId===current.runId||basis.runId===view.runId));
 const target={reportId:'saved-report',revisionId:'revision-1'};let selected;
 const selectedReceipt=await ensureAi(f.ctx,{...current,reportTarget:target},{...api,selectReport:async(basis,sessionId,reportTarget)=>{selected={basis,sessionId,reportTarget};}},async()=>{},undefined,f.root);
 assert.deepEqual(selectedReceipt,{...current,sessionId:original.sessionId});assert.deepEqual(selected,{basis:current,sessionId:original.sessionId,reportTarget:target});
 // Historical intermediate results get their own fixed basis, not this
 // Session's newer working result.
 const intermediate={...view,runId:'older-ai-result',contentHash:'c'.repeat(64)};let bound;
 const older=await ensureAi(f.ctx,intermediate,{...api,bind:async receipt=>{bound=receipt;return receipt;}},async()=>{},undefined,f.root);
 assert.notEqual(older.sessionId,original.sessionId);assert.deepEqual(bound,older);assert.equal(f.sessions.size,2);
 f.owners.set(original.sessionId,{...f.owners.get(original.sessionId),ownerPrincipalId:'other'});
 await assert.rejects(ensureAi(f.ctx,current,api,async()=>{},undefined,f.root),/access-denied/);assert.equal(f.sessions.size,2);
});
test('Host directory relocation preserves the owned Session header and history without native recreation',async t=>{
 const f=await fixture(t),first=await ensure(f.ctx,view,async()=>{});
 const session=f.sessions.get(first.sessionId),workspace=f.native.workspaceRegistry.get(f.owners.get(first.sessionId).workspaceId);
 session.events=[{type:'assistant/message',text:'原生对话历史'}];
 const before=structuredClone(session),moved=join(f.root,'relocated-business-directory');
 await rename(workspace.path,moved);await symlink(moved,workspace.path,'dir');
 f.services.sessionController.create=async()=>{throw Error('must not recreate an existing native Session');};
 const reopened=await ensure(f.ctx,view,async()=>{});
 assert.deepEqual(reopened,first);assert.deepEqual(f.sessions.get(first.sessionId),before);
 assert.equal(await realpath(session.meta.cwd),moved);
 const foreign=join(f.root,'foreign');await mkdir(foreign);
 f.services.sessionController.inspect=async()=>({meta:{cwd:foreign}});
 await assert.rejects(ensure(f.ctx,view,async()=>{}),/workspace-conflict/);
});
test('continuation refuses a changed exact basis or stale reverse lookup instead of returning another Session',async t=>{
 const f=await fixture(t),original=await ensure(f.ctx,view,async()=>{}),current={...view,runId:'quality-ai-current',contentHash:'b'.repeat(64)};
 const binding={...current,sessionId:original.sessionId,originRunId:view.runId,originContentHash:view.contentHash,revision:1};
 await assert.rejects(ensureAi(f.ctx,current,{findRunSession:async()=>({...binding,recordId:'another-record'}),bind:async()=>{}},async()=>{},undefined,f.root),/context-conflict/);
 let calls=0;await assert.rejects(ensureAi(f.ctx,current,{findRunSession:async()=>++calls===1?binding:undefined,bind:async()=>{}},async()=>{},undefined,f.root),/context-conflict/);
 assert.equal(f.sessions.size,1);assert.equal(f.owners.size,1);
});
test('opening a historical origin does not redirect to the Session newer result or alter its selected report',async t=>{
 const f=await fixture(t),original=await ensure(f.ctx,view,async()=>{}),current={...view,runId:'quality-ai-current',contentHash:'b'.repeat(64)};
 const binding={...current,sessionId:original.sessionId,originRunId:view.runId,originContentHash:view.contentHash,revision:1,selectedReport:{reportId:'current-report',revisionId:'version-1'}};let selected=false;
 const api={findRunSession:async()=>undefined,bind:async receipt=>{assert.equal(receipt.sessionId,original.sessionId);return binding;},selectReport:async()=>{selected=true;}};
 await assert.rejects(ensureAi(f.ctx,{...view,reportTarget:null},api,async()=>{},undefined,f.root),/quality\/ai\/context-conflict/);
 assert.equal(selected,false);assert.equal(f.sessions.size,1);assert.deepEqual(binding.selectedReport,{reportId:'current-report',revisionId:'version-1'});
});
test('changed account during run verification cannot create a native session',async t=>{
 const f=await fixture(t);await assert.rejects(ensure(f.ctx,view,async()=>f.switchAccount()),/access-denied/);assert.equal(f.creates(),0);assert.equal(f.native.workspaceRegistry.list().length,0);
});
test('enterprise mode requires protected creation and never adopts unowned native sessions',async t=>{
 const f=await fixture(t,'enterprise');await assert.rejects(ensure(f.ctx,view,async()=>{}),/session-unavailable/);assert.equal(f.creates(),0);
 f.services.workdshSessionAccess=f.services.sessionController;
 await assert.rejects(ensure(f.ctx,view,async()=>{}),/access-denied/);assert.equal(f.owners.size,0);
});
test('native mismatched receipt and pre-cancelled requests cannot bind ownership',async t=>{
 const f=await fixture(t);f.services.sessionController.create=async()=>({sessionId:'wrong'});await assert.rejects(ensure(f.ctx,view,async()=>{}),/session-conflict/);assert.equal(f.owners.size,0);
 const c=new AbortController();c.abort();await assert.rejects(ensure(f.ctx,view,async()=>{},c.signal),{name:'AbortError'});
});

test('failed run authorization prevents creation',async t=>{const f=await fixture(t);await assert.rejects(ensure(f.ctx,view,async()=>{throw Error('revoked');}),/revoked/);assert.equal(f.creates(),0);assert.equal(f.owners.size,0);});

test('interpretation reads existing owned native history without another create or Agent resume',async t=>{
 const f=await fixture(t);const receipt=await ensure(f.ctx,view,async()=>{});const creates=f.creates();
 f.services.sessionController.inspect=async id=>{assert.equal(id,receipt.sessionId);return {events:[{seq:0,type:'turn/start',data:{turn:1}},{seq:1,type:'assistant/message',data:{turn:1,message:{content:[{type:'text',text:'核查抽样记录。'}]}}},{seq:2,type:'turn/end',data:{turn:1,reason:{kind:'completed'}}}]};};
 const candidate=await readInterpretation(f.ctx,view,async()=>{});assert.equal(candidate.text,'核查抽样记录。');assert.equal(candidate.sessionId,receipt.sessionId);assert.equal(f.creates(),creates);
 f.services.sessionController.inspect=async()=>{f.switchAccount();return {events:[]};};
 await assert.rejects(readInterpretation(f.ctx,view,async()=>{}),/access-denied/);
});
test('interpretation cannot adopt unowned Session or bypass enterprise inspector',async t=>{
 const f=await fixture(t);let inspected=false;f.services.sessionController.inspect=async()=>{inspected=true;return {events:[]};};
 await assert.rejects(readInterpretation(f.ctx,view,async()=>{}),/access-denied/);assert.equal(inspected,false);assert.equal(f.creates(),0);
 const enterprise=await fixture(t);await ensure(enterprise.ctx,view,async()=>{});const profile=enterprise.services.workdshIdentity.profile;enterprise.services.workdshIdentity.profile=()=>({...profile(),organization:{id:'org',kind:'enterprise'}});
 await assert.rejects(readInterpretation(enterprise.ctx,view,async()=>{}),/session-unavailable/);
});

test('older owned Session gains native membership in its original cwd, without recreation or history mutation',async t=>{
 const f=await fixture(t),sessionId=`session-${createHash('sha256').update(JSON.stringify(['workdsh-quality-analysis','org','member',view.recordId,view.runId,view.contentHash])).digest('hex').slice(0,32)}`;
 const cwd=join(f.root,'older-authorized-cwd');await mkdir(cwd);
 const events=[{seq:0,type:'assistant/message',data:{message:'existing history'}}],owner={organizationId:'org',ownerPrincipalId:'member'};
 f.owners.set(sessionId,owner);f.sessions.set(sessionId,{meta:{id:sessionId,cwd},events});
 const first=await ensure(f.ctx,view,async()=>{}),second=await ensure(f.ctx,view,async()=>{});
 assert.equal(first.sessionId,sessionId);assert.deepEqual(second,first);assert.equal(f.creates(),0);
 assert.deepEqual(f.sessions.get(sessionId),{meta:{id:sessionId,cwd},events});assert.deepEqual(f.owners.get(sessionId),owner);
 const workspace=f.native.workspaceRegistry.list().find(workspace=>workspace.path===cwd);assert.deepEqual(workspace.sessionIds,[sessionId]);
});

test('legacy repair cannot attach a foreign owned Session, misrepresent its cwd, or run after identity revocation',async t=>{
 const f=await fixture(t),sessionId=`session-${createHash('sha256').update(JSON.stringify(['workdsh-quality-analysis','org','member',view.recordId,view.runId,view.contentHash])).digest('hex').slice(0,32)}`;
 const cwd=join(f.root,'legacy'),wrong=join(f.root,'other');await mkdir(cwd);await mkdir(wrong);
 f.sessions.set(sessionId,{meta:{id:sessionId,cwd},events:[]});f.owners.set(sessionId,{organizationId:'org',ownerPrincipalId:'other'});
 await assert.rejects(ensure(f.ctx,view,async()=>{}),/access-denied/);assert.equal(f.native.workspaceRegistry.list().length,0);
 f.owners.set(sessionId,{organizationId:'org',ownerPrincipalId:'member'});
 f.services.sessionController.inspect=async()=>({meta:{cwd:wrong}});
 await assert.rejects(ensure(f.ctx,view,async()=>{}),/cannot attach/);assert.equal(f.native.workspaceRegistry.list().some(workspace=>workspace.sessionIds.includes(sessionId)),false);
 f.services.sessionController.inspect=async()=>{f.switchAccount();return {meta:{cwd}};};
 await assert.rejects(ensure(f.ctx,view,async()=>{}),/access-denied/);assert.equal(f.creates(),0);
});

test('app-owned working directory rejects symlink escape before native creation',async t=>{
 const f=await fixture(t),scope=join(f.root,'workdsh-quality-analysis');await symlink(f.root,scope,'dir');
 await assert.rejects(ensure(f.ctx,view,async()=>{}),/workspace-conflict/);assert.equal(f.creates(),0);assert.equal(f.owners.size,0);
});
