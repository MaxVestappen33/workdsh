import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const web=createRequire(new URL('../../../../apps/web/package.json',import.meta.url));
const runtime=createRequire(new URL('../../projects/package.json',import.meta.url));
const built=await web('esbuild').build({entryPoints:[fileURLToPath(new URL('../src/runtime/creation-service.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false,alias:{'workdsh-contracts':fileURLToPath(new URL('../../../contracts/src/index.ts',import.meta.url))},plugins:[{name:'official',setup(builder){builder.onResolve({filter:/^(?:@deepseek-ai\/dsh-storage-domain|zod)$/},args=>({path:pathToFileURL(runtime.resolve(args.path)).href,external:true}));}}]});
const {WorkbenchCreationService,parseCreationProposal}=await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const load=name=>import(pathToFileURL(runtime.resolve(name)).href);
const {Context}=await load('@deepseek-ai/cordis');
const {default:Storage}=await load('@deepseek-ai/dsh-storage');
const Json=await load('@deepseek-ai/dsh-storage-json');
const Domain=await load('@deepseek-ai/dsh-storage-domain');
const actor={principalId:'member.a',organizationId:'org',requestId:'probe',resolvedBy:'trusted-fixture'};
const id='3d99de1e-c1c9-4e2a-9619-238c897c3f71';
const target={hostId:'host',installationId:'install',profileId:'test',harnessVersion:'0.2.1-rc.1'};
const complete={title:'周报助手',scenario:'整理每周数据',users:'业务负责人',dataSources:'用户提供CSV',workflow:'读取、核对、整理周报',firstIteration:'完成一张表的周报',acceptance:'周报中的数量与输入一致'};
async function boot(root){const ctx=new Context();await ctx.plugin(Storage);await ctx.plugin(Json,{root});await ctx.plugin(Domain,{backend:'json'});return ctx;}
function setup(ctx){
  let selected=actor,active=true,launches=0,confirms=0;const owners=new Map();
  const identity={async resolve(){return {...selected};},profile(){return {principalId:selected.principalId,organization:{id:selected.organizationId},resolvedBy:selected.resolvedBy};},membership(){return {state:active?'active':'suspended'};}};
  const ports={async target(){return target;},async authorizeSession(who,sid){if(owners.get(sid)!==who.principalId)throw Error('workbench/creation-access-denied');},async session(who,row,check){check();const sid=row.sessionId??`session-${row.id}`;if(!row.sessionId)launches++;owners.set(sid,who.principalId);return sid;},async confirm(who,row,requirements,check){check();confirms++;return {title:requirements.title,development:{id:row.id,session:{sessionId:row.sessionId},requirementsRevision:'saved',workbenchId:`workdsh.user-${row.id}`,packageName:`workdsh-workbench-${row.id}`}};}};
  return {service:new WorkbenchCreationService(ctx.storageDomain,identity,ports),ports,identity,owners,setActor(value){selected=value;},setActive(value){active=value;},counts:()=>({launches,confirms})};
}
test('one sentence creates only an intake; reopening retains Session and does not request a second opening',async()=>{
  const root=await mkdtemp(join(tmpdir(),'workdsh-creation-')),ctx=await boot(root),f=setup(ctx);
  try{
    const first=await f.service.open(id,'整理我的周报');assert.equal(first.needsOpening,true);assert.equal(first.phase,'discussing');assert.equal(first.proposal,undefined);
    const nativeOutput=await f.service.readSession(first.sessionId);
    assert.deepEqual(nativeOutput,JSON.parse(JSON.stringify(nativeOutput)),'official Tool JSON output is lossless before a proposal exists');
    const again=await f.service.open(id,'整理我的周报');assert.equal(again.needsOpening,false);assert.equal(again.sessionId,first.sessionId);assert.deepEqual(f.counts(),{launches:1,confirms:0});
    await assert.rejects(f.service.open(id,'悄悄改成另一应用'),/creation-conflict/);
    await assert.rejects(f.service.confirm(id,first.revision,{title:'不完整'}),/invalid-requirements/);assert.equal(f.counts().confirms,0);
  }finally{await f.service.close();await ctx.fiber.dispose();await rm(root,{recursive:true,force:true});}
});
test('partial summaries remain drafts; concurrent stale proposals cannot overwrite the accepted summary',async()=>{
  const root=await mkdtemp(join(tmpdir(),'workdsh-creation-summary-')),ctx=await boot(root),f=setup(ctx);
  try{
    const first=await f.service.open(id,'整理周报');
    const results=await Promise.allSettled([f.service.propose(first.sessionId,first.revision,{title:'周报助手'}),f.service.propose(first.sessionId,first.revision,{title:'晚到覆盖'})]);
    assert.equal(results.filter(row=>row.status==='fulfilled').length,1);assert.match(results.find(row=>row.status==='rejected').reason.message,/creation-conflict/);
    const current=await f.service.readSession(first.sessionId);assert.equal(current.proposal.title,'周报助手');assert.equal(current.proposal.users,undefined);assert.equal(current.phase,'discussing');
    current.proposal.title='外部修改';assert.equal((await f.service.readSession(first.sessionId)).proposal.title,'周报助手');
    await assert.rejects(f.service.propose('other-session',current.revision,complete),/creation-access-denied/);
    assert.throws(()=>parseCreationProposal({sourceDirectory:'/other'}),/invalid-creation-proposal/);
  }finally{await f.service.close();await ctx.fiber.dispose();await rm(root,{recursive:true,force:true});}
});
test('user confirmation keeps the original Session and confirmed requests reject later model proposals',async()=>{
  const root=await mkdtemp(join(tmpdir(),'workdsh-creation-confirm-')),ctx=await boot(root),f=setup(ctx);
  try{
    const first=await f.service.open(id,'整理周报');const summary=await f.service.propose(first.sessionId,first.revision,complete);
    await assert.rejects(f.service.confirm(id,first.revision,complete),/creation-conflict/);
    const result=await f.service.confirm(id,summary.revision,{...complete,title:'人工核对后的周报'});
    assert.equal(result.creation.phase,'confirmed');assert.equal(result.development.development.session.sessionId,first.sessionId);assert.equal(result.creation.proposal.title,'人工核对后的周报');assert.equal(f.counts().launches,1);
    await assert.rejects(f.service.propose(first.sessionId,result.creation.revision,complete),/creation-conflict/);
  }finally{await f.service.close();await ctx.fiber.dispose();await rm(root,{recursive:true,force:true});}
});
test('real official storage restores the idea and summary; another account and suspended member cannot read it',async()=>{
  const root=await mkdtemp(join(tmpdir(),'workdsh-creation-reopen-'));let ctx=await boot(root),f=setup(ctx);
  try{
    const first=await f.service.open(id,'保留我的想法');await f.service.propose(first.sessionId,first.revision,{title:'持久草稿'});
    await f.service.close();await ctx.fiber.dispose();ctx=await boot(root);f=setup(ctx);
    const rows=await f.service.list();assert.equal(rows[0].idea,'保留我的想法');assert.equal(rows[0].proposal.title,'持久草稿');assert.equal(rows[0].sessionId,first.sessionId);
    f.setActor({...actor,principalId:'member.b'});assert.deepEqual(await f.service.list(),[]);
    f.setActor(actor);f.setActive(false);await assert.rejects(f.service.list(),/creation-access-denied/);
  }finally{await f.service.close();await ctx.fiber.dispose();await rm(root,{recursive:true,force:true});}
});
