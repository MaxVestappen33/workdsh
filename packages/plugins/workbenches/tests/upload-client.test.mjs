import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const {build}=createRequire(new URL('../../../../apps/web/package.json',import.meta.url))('esbuild');
const built=await build({entryPoints:[fileURLToPath(new URL('../src/client/upload-client.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false});
const {createWorkbenchUploadClient}=await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const metadata={developmentId:'dev',packageName:'quality-plugin',version:'1.0.0',workbenchId:'company.quality'};
test('upload sends binary data and fixed metadata, validates receipt and drops paths',async()=>{
 const file=new Blob(['tgz-fixture']);
 const upload=createWorkbenchUploadClient(async(path,options)=>{
  assert.equal(path,'/api/workdsh-workbench-upload');assert.equal(options.body,file);
  assert.deepEqual(JSON.parse(options.headers['x-workdsh-upload']),metadata);
  return Response.json({ok:true,value:{...metadata,sha256:'a'.repeat(64),path:'/private/path'}});
 });
 const receipt=await upload({...metadata,path:'/never-send'},file);
 assert.equal(receipt.path,undefined);assert.ok(Object.isFrozen(receipt));
 await assert.rejects(createWorkbenchUploadClient(async()=>Response.json({ok:true,value:{...metadata,version:'other',sha256:'a'.repeat(64)}}))(metadata,file),/invalid-response/);
});
test('network interruption does not retry and cancellation rejects late success',async()=>{
 let calls=0;const file=new Blob(['fixture']);
 await assert.rejects(createWorkbenchUploadClient(async()=>{calls++;throw new TypeError('socket closed');})(metadata,file),/upload-interrupted/);
 assert.equal(calls,1);assert.equal(file.size,7);
 const controller=new AbortController();
 await assert.rejects(createWorkbenchUploadClient(async()=>{controller.abort();return Response.json({ok:true,value:{...metadata,sha256:'a'.repeat(64)}});})(metadata,file,controller.signal),error=>error.name==='AbortError');
});
