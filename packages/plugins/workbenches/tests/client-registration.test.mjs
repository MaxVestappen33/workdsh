import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const { build } = createRequire(new URL('../../../../apps/web/package.json', import.meta.url))('esbuild');
const built = await build({ entryPoints: [fileURLToPath(new URL('../src/client/client-registration.ts', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false, alias: { 'workdsh-contracts': fileURLToPath(new URL('../../../contracts/src/index.ts', import.meta.url)) } });
const { ClientWorkbenchRegistration: Registration } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const descriptor = { id:'company.quality',title:'质量分析',description:'',protocolVersion:'1.0',layout:'full-page',hostCompatibility:{sdk:'^1.0.0',harness:'0.2.1-rc.1'},capabilities:[] };
const authority = { descriptor, package:{packageName:'quality-plugin',version:'1.0.0',sha256:'a'.repeat(64)},enabled:true,compatible:true };
const caller = {fiber:{assertActive(){}}};
function fixture(verify) {
 let disabled=false, pages=0, navigation=0;
 const loader={locate:()=> 'quality-entry',resolve:()=>({options:{name:'quality-plugin/client'},disabled})};
 const ports={mountPage(){pages++;return()=>pages--;},mountNavigation(){navigation++;return()=>navigation--;},selectedPanel:()=>undefined,openManager(){}};
 return { registration:new Registration(loader,verify,ports),disable(){disabled=true;},counts:()=>[pages,navigation] };
}
test('verified Client contributes one page without a sidebar item and rejects mismatched declarations',async()=>{
 const f=fixture(async()=>authority);
 await assert.rejects(f.registration.register(caller,{...descriptor,title:'different'},()=>null),/declaration-mismatch/);assert.deepEqual(f.counts(),[0,0]);
 const stop=await f.registration.register(caller,descriptor,()=>null);assert.deepEqual(f.counts(),[1,0]);
 await assert.rejects(f.registration.register(caller,descriptor,()=>null),/registration-conflict/);
 stop();stop();assert.deepEqual(f.counts(),[0,0]);f.registration.close();
});
test('disablement and shutdown during installation verification prevent late pages',async()=>{
 let resolve;const f=fixture(()=>new Promise(yes=>resolve=yes));
 const pending=f.registration.register(caller,descriptor,()=>null);f.disable();resolve(authority);await assert.rejects(pending,/package-disabled/);assert.deepEqual(f.counts(),[0,0]);
 let finish;const g=fixture(()=>new Promise(yes=>finish=yes));const abandoned=g.registration.register(caller,descriptor,()=>null);g.registration.close();finish(authority);await assert.rejects(abandoned,{name:'AbortError'});assert.deepEqual(g.counts(),[0,0]);
});

test('managed caller lifetime withdraws page and failed lifecycle attachment rolls back',async()=>{
 const f=fixture(async()=>authority);let release;
 const managed={...caller,effect(body){release=body();return release;}};
 await f.registration.registerManaged(managed,descriptor,()=>null);assert.deepEqual(f.counts(),[1,0]);release();assert.deepEqual(f.counts(),[0,0]);
 await assert.rejects(f.registration.registerManaged({...caller,effect(){throw new Error('caller-disposed');}},descriptor,()=>null),/caller-disposed/);
 assert.deepEqual(f.counts(),[0,0]);f.registration.close();
});
