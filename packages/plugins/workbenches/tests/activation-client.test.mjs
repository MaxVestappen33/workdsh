import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const {build}=createRequire(new URL('../../../../apps/web/package.json',import.meta.url))('esbuild');
const built=await build({entryPoints:[fileURLToPath(new URL('../src/client/activation-client.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false});
const {createWorkbenchActivationClient}=await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const selection={developmentId:'dev',packageName:'quality-plugin',version:'1.0.0',workbenchId:'company.quality',sha256:'a'.repeat(64)};
const observed={packageName:selection.packageName,version:selection.version,selected:true,application:'restart-required',confirmed:false,pendingRestart:true};
test('activation retains pending restart without claiming applied and sends no paths',async()=>{
 const result=await createWorkbenchActivationClient(async(path,options)=>{assert.equal(path,'/api/workdsh-workbench-activation');assert.deepEqual(JSON.parse(options.body),{...selection,enabled:true});return Response.json({ok:true,value:{...observed,path:'/private'}});})({...selection,path:'/never-send'},true);
 assert.equal(result.confirmed,false);assert.equal(result.pendingRestart,true);assert.equal(result.path,undefined);assert.ok(Object.isFrozen(result));
});
test('activation rejects contradictory, foreign or late success without retry',async()=>{
 for(const value of [{...observed,confirmed:true},{...observed,version:'wrong'},{...observed,pendingRestart:false}])await assert.rejects(createWorkbenchActivationClient(async()=>Response.json({ok:true,value}))(selection,true),/invalid-response/);
 let calls=0;await assert.rejects(createWorkbenchActivationClient(async()=>{calls++;throw new Error('socket');})(selection,false),/activation-unconfirmed/);assert.equal(calls,1);
 const controller=new AbortController();await assert.rejects(createWorkbenchActivationClient(async()=>{controller.abort();return Response.json({ok:true,value:observed});})(selection,true,controller.signal),error=>error.name==='AbortError');
});
