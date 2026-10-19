import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const { build } = createRequire(new URL('../../../../apps/web/package.json', import.meta.url))('esbuild');
const built = await build({ entryPoints: [fileURLToPath(new URL('../src/client/registration-client.ts', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false, alias: { 'workdsh-contracts': fileURLToPath(new URL('../../../contracts/src/index.ts', import.meta.url)) } });
const { createWorkbenchRegistrationClient: client } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const descriptor={id:'company.quality',title:'质量分析',description:'',protocolVersion:'1.0',layout:'full-page',hostCompatibility:{sdk:'^1.0.0',harness:'0.2.1-rc.1'},capabilities:[]};
const authority=()=>({descriptor,package:{packageName:'quality-plugin',version:'1.0.0',sha256:'a'.repeat(64)},enabled:true,compatible:true});
test('registration Client checks exact receipt and discards unexpected response data',async()=>{
 const result=await client(async(_url,options)=>{assert.deepEqual(JSON.parse(options.body),{endpoint:'client-authority',payload:{packageName:'quality-plugin'}});return Response.json({ok:true,value:{...authority(),token:'unused'}});})('quality-plugin');
 assert.equal(result.token,undefined);assert.equal(Object.isFrozen(result),true);assert.equal(Object.isFrozen(result.package),true);
 for(const value of [{...authority(),enabled:false},{...authority(),compatible:undefined},{...authority(),package:{...authority().package,packageName:'other'}},{...authority(),package:{...authority().package,sha256:'bad'}}])
 await assert.rejects(client(async()=>Response.json({ok:true,value}))('quality-plugin'));
 const blocked=await client(async()=>Response.json({ok:true,value:{...authority(),compatible:false}}))('quality-plugin');
 assert.equal(blocked.compatible,false);assert.deepEqual(blocked.package,authority().package);
});
test('cancelled lookup cannot return late authority',async()=>{
 const controller=new AbortController();
 await assert.rejects(client(async()=>{controller.abort();return Response.json({ok:true,value:authority()});})('quality-plugin',controller.signal),{name:'AbortError'});
});
