import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const web=createRequire(new URL('../../../../apps/web/package.json',import.meta.url));
const runtime=createRequire(new URL('../../projects/package.json',import.meta.url));
const built=await web('esbuild').build({entryPoints:[fileURLToPath(new URL('../src/runtime/shortcuts-service.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false,alias:{'workdsh-contracts':fileURLToPath(new URL('../../../contracts/src/index.ts',import.meta.url))},plugins:[{name:'official',setup(builder){builder.onResolve({filter:/^(?:@deepseek-ai\/dsh-storage-domain|zod)$/},args=>({path:pathToFileURL(runtime.resolve(args.path)).href,external:true}));}}]});
const {WorkbenchShortcutsService}=await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const load=name=>import(pathToFileURL(runtime.resolve(name)).href);
const {Context}=await load('@deepseek-ai/cordis');
const {default:Storage}=await load('@deepseek-ai/dsh-storage');
const Json=await load('@deepseek-ai/dsh-storage-json');
const Domain=await load('@deepseek-ai/dsh-storage-domain');
const actor={principalId:'member.a',organizationId:'org',requestId:'probe',resolvedBy:'trusted-fixture'};

async function boot(root){const ctx=new Context();await ctx.plugin(Storage);await ctx.plugin(Json,{root});await ctx.plugin(Domain,{backend:'json'});return ctx;}
function setup(ctx){let selected=actor,active=true;const identity={async resolve(){return {...selected};},profile(){return {principalId:selected.principalId,organization:{id:selected.organizationId},resolvedBy:selected.resolvedBy};},membership(){return {state:active?'active':'suspended'};}};return {service:new WorkbenchShortcutsService(ctx.storageDomain,identity,id=>id.startsWith('app.')),setActor(value){selected=value;},setActive(value){active=value;}};}
test('native storage retains shortcuts after restart, isolates accounts and rejects inactive membership',async()=>{
 const root=await mkdtemp(join(tmpdir(),'workdsh-shortcuts-'));let ctx=await boot(root),f=setup(ctx);
 try{
  await Promise.all([f.service.invoke('app.a',true),f.service.invoke('app.b',true)]);assert.deepEqual((await f.service.invoke()).ids,['app.a','app.b']);
  await f.service.close();await ctx.fiber.dispose();ctx=await boot(root);f=setup(ctx);
  assert.deepEqual((await f.service.invoke()).ids,['app.a','app.b']);f.setActor({...actor,principalId:'other'});assert.deepEqual((await f.service.invoke()).ids,[]);
  await f.service.invoke('app.c',true);f.setActor(actor);assert.deepEqual((await f.service.invoke()).ids,['app.a','app.b']);
  await f.service.invoke('app.a',false);assert.deepEqual((await f.service.invoke()).ids,['app.b']);
  f.setActive(false);await assert.rejects(f.service.invoke(),/shortcuts-access-denied/);
 }finally{await f.service.close();await ctx.fiber.dispose();await rm(root,{recursive:true,force:true});}
});
test('unknown applications cannot be pinned, duplicate pins are idempotent and limits do not erase saved entries',async()=>{
 const root=await mkdtemp(join(tmpdir(),'workdsh-shortcuts-limit-')),ctx=await boot(root),f=setup(ctx);
 try{
  await assert.rejects(f.service.invoke('unknown',true),/shortcut-unavailable/);
  await f.service.invoke('app.a',true);await f.service.invoke('app.a',true);assert.equal((await f.service.invoke()).ids.length,1);
  for(let i=1;i<8;i++)await f.service.invoke('app.'+i,true);
  await assert.rejects(f.service.invoke('app.extra',true),/shortcuts-limit/);assert.equal((await f.service.invoke()).ids.length,8);
  await f.service.invoke('app.a',false);await f.service.invoke('app.extra',true);assert.equal((await f.service.invoke()).ids.length,8);
 }finally{await f.service.close();await ctx.fiber.dispose();await rm(root,{recursive:true,force:true});}
});
