import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {mkdtemp,rm,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const web=createRequire(new URL('../../../../apps/web/package.json',import.meta.url));
const runtime=createRequire(new URL('../../quality-analysis/package.json',import.meta.url));
const {build}=web('esbuild');
const {Context}=await import(pathToFileURL(runtime.resolve('@deepseek-ai/cordis')).href);
const {default:Tools}=await import(pathToFileURL(runtime.resolve('@deepseek-ai/dsh-tools')).href);
const compiled=await build({entryPoints:[fileURLToPath(new URL('../src/runtime/development-tools.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false,
  plugins:[{name:'published-tool-runtime',setup(b){b.onResolve({filter:/^@deepseek-ai\/dsh-tools$/},a=>({path:pathToFileURL(runtime.resolve(a.path)).href,external:true}));}}]});

async function fixture(t){
  const root=await mkdtemp(join(tmpdir(),'workbench-development-tools-'));
  await symlink(fileURLToPath(new URL('../node_modules',import.meta.url)),join(root,'node_modules'),'dir');
  const bundle=join(root,'tools.mjs');await writeFile(bundle,compiled.outputFiles[0].text);
  const {registerWorkbenchDevelopmentTools}=await import(pathToFileURL(bundle).href);
  const ctx=new Context(),calls=[],sessionId='session-bound-development';
  // Only prompt registration is stubbed; the registry and Fiber lifecycle are official.
  ctx.provide('systemPrompt',{tools(){return()=>{};}});await ctx.plugin(Tools);
  const values={context:{development:{session:{sessionId}},requirements:{title:'检验周报'},candidates:[{fileName:'candidate.tgz',candidate:{package:{version:'1.0.0',sha256:'a'.repeat(64)}}}]},installation:{state:'installed',activation:'restart-required',opened:false}};
  const api={async readContext(id,signal){calls.push(['read',id,signal]);if(id!==sessionId)throw Error('workbench/development-access-denied');return values.context;},
    async verifyNativeInstallation(id,input,signal){calls.push(['verify',id,input,signal]);if(id!==sessionId)throw Error('workbench/development-access-denied');return values.installation;}};
  let owned;
  await ctx.plugin({name:'test-workbench-development-tools',inject:['tools'],apply(child){owned=child;registerWorkbenchDevelopmentTools(child,api);}});
  t.after(async()=>{await ctx.fiber.dispose();await rm(root,{recursive:true,force:true});});
  const exec=(id=sessionId,signal=new AbortController().signal)=>({agent:id===null?undefined:{id},callId:'development-test',signal});
  const tool=name=>ctx.get('tools').get(name);
  const call=(name,args={},execution=exec())=>tool(name).execute(args,execution);
  return {ctx,owned,calls,values,api,sessionId,exec,tool,call};
}

test('official registry returns actual Host facts using only Agent Session and forwarded cancellation',async t=>{
  const f=await fixture(t),signal=new AbortController().signal;
  const context=await f.call('workbench_read_development_context',{},f.exec(f.sessionId,signal));
  assert.deepEqual(context,f.values.context);assert.notEqual(context,f.values.context);
  assert.deepEqual(f.calls[0],['read',f.sessionId,signal]);
  const input={version:'1.0.0-alpha.2',sha256:'b'.repeat(64)};
  const result=await f.call('workbench_verify_native_installation',input,f.exec(f.sessionId,signal));
  assert.deepEqual(result,{state:'installed',activation:'restart-required',opened:false});
  assert.deepEqual(f.calls[1],['verify',f.sessionId,input,signal]);
  const definition=f.tool('workbench_verify_native_installation');
  const rendered=definition.output.render(input,result);assert.ok(rendered[0].text.includes('restart-required'));assert.ok(rendered[0].text.includes('"opened":false'));
  const presentation=definition.presentResult(input,{isError:false,content:rendered});assert.equal(presentation.card,'generic');
  assert.equal(presentation.title,'工作台安装核对结果');assert.ok(presentation.content[0].text.includes('分别确认'));
  assert.equal(presentation.content[0].text.includes('restart-required'),false,'native labels use business language while canonical output retains actual facts');
});

test('missing Agent and model-chosen identity/path arguments cannot invoke Host APIs',async t=>{
  const f=await fixture(t),valid={version:'1.0.0',sha256:'a'.repeat(64)};
  await assert.rejects(f.call('workbench_read_development_context',{},f.exec(null)),/session-required/);
  await assert.rejects(f.call('workbench_verify_native_installation',valid,f.exec(null)),/session-required/);
  for(const value of [null,{},42,''])if(value!==null)await assert.rejects(f.call('workbench_read_development_context',{},f.exec(value)),/session-required/);
  for(const extra of [{developmentId:'another'},{sessionId:'another'},{path:'/tmp/other.tgz'},{packageName:'other'}]){
    await assert.rejects(f.call('workbench_read_development_context',extra),/invalid-arguments/);
    await assert.rejects(f.call('workbench_verify_native_installation',{...valid,...extra}),/invalid-arguments/);
  }
  assert.equal(f.calls.length,0);
  await assert.rejects(f.call('workbench_read_development_context',{},f.exec('foreign-session')),/access-denied/);
  assert.deepEqual(f.calls[0].slice(0,2),['read','foreign-session'],'authoritative Session is forwarded for Host ownership checks');
});

test('only exact complete SemVer and lowercase SHA256 are accepted without starting installation',async t=>{
  const f=await fixture(t),valid={version:'1.0.0',sha256:'a'.repeat(64)};
  for(const version of ['','1','1.2','v1.0.0','1.0.0 ','01.0.0','1.0.0-01','^1.0.0','../package',null,1])
    await assert.rejects(f.call('workbench_verify_native_installation',{...valid,version}));
  for(const sha256 of ['','a'.repeat(63),'A'.repeat(64),'g'.repeat(64),'a'.repeat(65),null,1])
    await assert.rejects(f.call('workbench_verify_native_installation',{...valid,sha256}));
  for(const args of [{},[],null,{version:'1.0.0'},{sha256:'a'.repeat(64)}])await assert.rejects(f.call('workbench_verify_native_installation',args));
  assert.equal(f.calls.length,0);
});

test('cancellation and real Host failures remain authoritative rather than rendering success',async t=>{
  const f=await fixture(t),controller=new AbortController();controller.abort();
  await assert.rejects(f.call('workbench_read_development_context',{},f.exec(f.sessionId,controller.signal)),{name:'AbortError'});
  assert.equal(f.calls.length,0);
  const later=new AbortController();f.api.verifyNativeInstallation=async(_id,_input,signal)=>{assert.equal(signal,later.signal);later.abort();return {state:'installed'};};
  await assert.rejects(f.call('workbench_verify_native_installation',{version:'1.0.0',sha256:'a'.repeat(64)},f.exec(f.sessionId,later.signal)),{name:'AbortError'});
  f.api.readContext=async()=>{throw Error('workbench/development-source-changed');};
  await assert.rejects(f.call('workbench_read_development_context'),/source-changed/);
  const error=f.tool('workbench_read_development_context').presentResult({},{isError:true,content:[{type:'text',text:'actual failure'}]});
  assert.equal(error.title,'开发上下文读取未完成');assert.equal(error.content,undefined,'native registry preserves its real failure content');
});

test('unloading the owning plugin removes both tools from the official managed registry',async t=>{
  const f=await fixture(t);assert.ok(f.tool('workbench_read_development_context'));assert.ok(f.tool('workbench_verify_native_installation'));
  await f.owned.fiber.dispose();assert.equal(f.tool('workbench_read_development_context'),undefined);assert.equal(f.tool('workbench_verify_native_installation'),undefined);
});

test('timing observes ordinary official dispatch without replacing results or granting access',async t=>{
 const f=await fixture(t),events=[];
 f.api.timing={async begin(scope,type){events.push(['begin',scope.key,type]);return async failed=>events.push(['end',failed]);}};
 f.api.resolveTimingScope=async id=>{if(id!==f.sessionId)throw Error('not-owned');return {key:'owned',source:'/source',sdkDirectory:'/sdk',guard:async()=>{}};};
 const runtime=f.ctx.get('tools'),signal=new AbortController().signal;
 const result=await runtime.execute({name:'workbench_read_development_context',arguments:{},callId:'timing-observed-1',agent:{id:f.sessionId},signal});
 assert.equal(result.isError,false,JSON.stringify(result));assert.deepEqual(result.value,f.values.context);assert.deepEqual(events,[['begin','owned','preparation'],['end',false]]);
 events.length=0;
 const denied=await runtime.execute({name:'workbench_read_development_context',arguments:{},callId:'timing-observed-2',agent:{id:'not-owned'},signal});
 assert.equal(denied.isError,true);assert.deepEqual(events,[]);
 f.api.timing.begin=async()=>{throw Error('timing-disk-failed');};
 const unaffected=await runtime.execute({name:'workbench_read_development_context',arguments:{},callId:'timing-observed-3',agent:{id:f.sessionId},signal});assert.equal(unaffected.isError,false);
});

test('native approval is timed separately and a missing approval owner still denies the operation',async t=>{
 const f=await fixture(t),events=[];f.api.resolveTimingScope=async()=>({key:'owned',source:'/source',sdkDirectory:'/sdk',guard:async()=>{}});f.api.timing={async begin(_scope,type){events.push(['begin',type]);return async failed=>events.push(['end',type,failed]);}};
 const runtime=f.ctx.get('tools'),signal=new AbortController().signal;
 await runtime.execute({name:'workbench_read_development_context',arguments:{},callId:'approval-bind',agent:{id:f.sessionId},signal});events.length=0;
 f.ctx.on('tools/pre-execute',async()=>({kind:'ask'}));
 const result=await runtime.execute({name:'workbench_read_development_context',arguments:{},callId:'approval-denied',agent:{id:f.sessionId},signal});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(result.isError,true);assert.deepEqual(events,[['begin','approval'],['end','approval',true]]);
});
