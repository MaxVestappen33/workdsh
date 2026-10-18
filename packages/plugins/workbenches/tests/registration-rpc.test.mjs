import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const { build } = createRequire(new URL('../../../../apps/web/package.json', import.meta.url))('esbuild');
const built = await build({ entryPoints: [fileURLToPath(new URL('../src/runtime/registration-rpc.ts', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false });
const { handleWorkbenchRegistrationRequest: handle } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const request = payload => new Request('http://localhost/api/workdsh-workbench-registration',{method:'POST',body:JSON.stringify({endpoint:'client-authority',payload})});
test('registration facts reject identity/path claims and recheck access after installation lookup',async()=>{
 let calls=0,active=true;
 const resolve=async()=>()=>{if(!active)throw new Error('workbench/development-access-denied');};
 const service={async clientAuthority(name){calls++;assert.equal(name,'quality-plugin');return {enabled:true};}};
 for(const payload of [{packageName:'../source'},{packageName:'quality-plugin',owner:{}},{packageName:'quality-plugin',directory:'/private'}])assert.equal((await handle(request(payload),service,resolve)).status,400);
 assert.equal(calls,0);assert.equal((await handle(request({packageName:'quality-plugin'}),service,resolve)).status,200);
 const revoked={async clientAuthority(){active=false;return {};}};
 assert.equal((await handle(request({packageName:'quality-plugin'}),revoked,resolve)).status,403);
});
test('registration errors preserve unavailable state without exposing filesystem diagnostics',async()=>{
 for(const [code,status] of [['workbench/unregistered-package',404],['workbench/package-disabled',409],['private /source/file',500]]){
 const response=await handle(request({packageName:'quality-plugin'}),{async clientAuthority(){throw new Error(code);}},async()=>()=>{});
 assert.equal(response.status,status);assert.equal((await response.text()).includes('/source/file'),false);
 }
});
