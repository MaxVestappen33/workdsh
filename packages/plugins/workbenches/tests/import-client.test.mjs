import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const {build}=createRequire(new URL('../../../../apps/web/package.json',import.meta.url))('esbuild');
const built=await build({entryPoints:[fileURLToPath(new URL('../src/client/import-client.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false});
const {createWorkbenchImportClient}=await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const selection={developmentId:'dev',operationId:'op',iterationId:'iteration',packageName:'quality-plugin',version:'1.0.0',workbenchId:'company.quality',sha256:'a'.repeat(64),kind:'install'};
const status={id:'op',developmentId:'dev',iterationId:'iteration',kind:'install',inputHash:selection.sha256,revision:'revision',state:'unknown'};
test('interrupted import is submitted once; explicit recovery preserves the same operation',async()=>{
 let calls=0;
 await assert.rejects(createWorkbenchImportClient(async()=>{calls++;throw new Error('network');})(selection,false),/import-unconfirmed/);assert.equal(calls,1);
 const result=await createWorkbenchImportClient(async(path,options)=>{assert.equal(path,'/api/workdsh-workbench-import');assert.deepEqual(JSON.parse(options.body),{...selection,recover:true});return Response.json({ok:true,value:{...status,target:'/private'}});})(selection,true);
 assert.equal(result.state,'unknown');assert.equal(result.target,undefined);
});
test('a successful state requires the exact package receipt; cancellation rejects late status',async()=>{
 await assert.rejects(createWorkbenchImportClient(async()=>Response.json({ok:true,value:{...status,state:'succeeded'}}))(selection,false),/invalid-response/);
 const receipt={package:{packageName:selection.packageName,version:selection.version,sha256:selection.sha256},pendingRestart:false};
 const result=await createWorkbenchImportClient(async()=>Response.json({ok:true,value:{...status,state:'succeeded',receipt}}))(selection,false);
 assert.ok(Object.isFrozen(result.receipt.package));
 const controller=new AbortController();
 await assert.rejects(createWorkbenchImportClient(async()=>{controller.abort();return Response.json({ok:true,value:status});})(selection,true,controller.signal),error=>error.name==='AbortError');
});
