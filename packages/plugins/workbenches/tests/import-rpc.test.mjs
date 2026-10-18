import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const {build}=createRequire(new URL('../../../../apps/web/package.json',import.meta.url))('esbuild');
const built=await build({entryPoints:[fileURLToPath(new URL('../src/runtime/import-rpc.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false});
const {handleWorkbenchImportRequest}=await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const input={developmentId:'dev',operationId:'op',iterationId:'iteration',packageName:'quality-plugin',version:'1.0.0',workbenchId:'company.quality',sha256:'a'.repeat(64),kind:'install',recover:false};
const request=value=>new Request('https://workdsh.invalid/api/workdsh-workbench-import',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(value)});
test('import endpoint rejects path, actor and target claims before invoking owner',async()=>{
 let calls=0;const execute=async()=>{calls++;};
 for(const extra of [{path:'/private'},{actor:{principalId:'admin'}},{target:{profileId:'other'}}])assert.equal((await handleWorkbenchImportRequest(request({...input,...extra}),execute)).status,400);
 assert.equal((await handleWorkbenchImportRequest(request({...input,kind:'update'}),execute)).status,400);
 assert.equal(calls,0);
});
test('import passes fixed inputs, preserves unknown result and hides diagnostics',async()=>{
 const response=await handleWorkbenchImportRequest(request(input),async(value)=>{assert.deepEqual(value,input);return {id:'op',state:'unknown'};});
 assert.equal(response.status,200);assert.equal((await response.json()).value.state,'unknown');
 const failure=await handleWorkbenchImportRequest(request(input),async()=>{throw new Error('/private/profile/path');});
 assert.equal(failure.status,500);assert.doesNotMatch(await failure.text(),/private/);
 const conflict=await handleWorkbenchImportRequest(request({...input,recover:true}),async()=>{throw new Error('workbench/operation-input-conflict');});
 assert.equal(conflict.status,409);
});
