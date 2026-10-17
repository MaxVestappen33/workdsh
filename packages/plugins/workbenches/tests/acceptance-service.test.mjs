import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const web=createRequire(new URL('../../../../apps/web/package.json',import.meta.url));
const runtime=createRequire(new URL('../../projects/package.json',import.meta.url));
const built=await web('esbuild').build({entryPoints:[fileURLToPath(new URL('../src/runtime/acceptance-service.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false,alias:{'workdsh-contracts':fileURLToPath(new URL('../../../contracts/src/index.ts',import.meta.url))},plugins:[{name:'official',setup(builder){builder.onResolve({filter:/^(?:@deepseek-ai\/dsh-storage-domain|zod)$/},args=>({path:pathToFileURL(runtime.resolve(args.path)).href,external:true}));}}]});
const {WorkbenchAcceptanceService}=await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const load=name=>import(pathToFileURL(runtime.resolve(name)).href);
const {Context}=await load('@deepseek-ai/cordis');
const {default:Storage}=await load('@deepseek-ai/dsh-storage');
const Json=await load('@deepseek-ai/dsh-storage-json');
const Domain=await load('@deepseek-ai/dsh-storage-domain');
const actor={principalId:'member.a',organizationId:'org',requestId:'probe',resolvedBy:'trusted-fixture'};

async function boot(root){const ctx=new Context();await ctx.plugin(Storage);await ctx.plugin(Json,{root});await ctx.plugin(Domain,{backend:'json'});return ctx;}

const binding={developmentId:'dev',requirementsRevision:'req1',packageName:'app.demo',version:'0.1.0',sha256:'a'.repeat(64),hostId:'host',profileId:'preview',installationId:'install'};
function setup(ctx){let selected=actor,active=true,facts={binding:{...binding},ready:true};const identity={async resolve(){return {...selected};},profile(){return {principalId:selected.principalId,organization:{id:selected.organizationId},resolvedBy:selected.resolvedBy};},membership(){return {state:active?'active':'suspended'};}};return {service:new WorkbenchAcceptanceService(ctx.storageDomain,identity,async()=>structuredClone(facts)),setActor(a){selected=a;},setActive(a){active=a;},setFacts(f){facts=f;}};}
test('acceptance persists for exact version, account and requirements, and duplicate confirmation is idempotent',async()=>{
 const root=await mkdtemp(join(tmpdir(),'wd-acceptance-'));let ctx=await boot(root),f=setup(ctx);
 try{
  assert.equal((await f.service.invoke('dev')).accepted,undefined);
  const a=await f.service.invoke('dev',binding),b=await f.service.invoke('dev',binding);assert.equal(a.accepted.acceptedAt,b.accepted.acceptedAt);
  await f.service.close();await ctx.fiber.dispose();ctx=await boot(root);f=setup(ctx);
  assert.equal((await f.service.invoke('dev')).accepted.acceptedAt,a.accepted.acceptedAt);
  f.setActor({...actor,principalId:'member.b'});assert.equal((await f.service.invoke('dev')).accepted,undefined);f.setActor(actor);
  f.setFacts({binding:{...binding,requirementsRevision:'req2'},ready:true});assert.equal((await f.service.invoke('dev')).accepted,undefined);await assert.rejects(f.service.invoke('dev',binding),/acceptance-stale/);
  f.setFacts({binding:{...binding,sha256:'b'.repeat(64)},ready:true});assert.equal((await f.service.invoke('dev')).accepted,undefined);await assert.rejects(f.service.invoke('dev',binding),/acceptance-stale/);
  f.setFacts({binding,ready:false});await assert.rejects(f.service.invoke('dev',binding),/acceptance-stale/);
  f.setActive(false);await assert.rejects(f.service.invoke('dev'),/access-denied/);
 }finally{await f.service.close();await ctx.fiber.dispose();await rm(root,{recursive:true,force:true});}
});
