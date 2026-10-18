import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const {build}=createRequire(new URL('../../../../apps/web/package.json',import.meta.url))('esbuild');
const built=await build({entryPoints:[fileURLToPath(new URL('../src/client/package-preview-client.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false});
const {createWorkbenchPackagePreviewClient}=await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const descriptor={id:'company.quality',title:'质量分析',description:'',protocolVersion:'1.0',layout:'full-page',hostCompatibility:{sdk:'^1.0.0',harness:'0.2.1-rc.1'},capabilities:[]};
const receipt={packageName:'quality-plugin',version:'1.0.0',sha256:'a'.repeat(64)};
const value={package:receipt,descriptor,compatible:true};
test('first-import preview sends bytes without caller-supplied package identity and drops private fields',async()=>{
 const file=new Blob(['archive']);
 const result=await createWorkbenchPackagePreviewClient(async(path,options)=>{
  assert.equal(path,'/api/workdsh-workbench-package-preview');
  assert.equal(options.body,file);assert.equal(options.credentials,'same-origin');
  assert.deepEqual(options.headers,{'content-type':'application/octet-stream'});
  return Response.json({ok:true,value:{...value,path:'/private',package:{...receipt,path:'/private'}}});
 })(file);
 assert.deepEqual(result.package,receipt);assert.equal(result.path,undefined);
 assert.equal(result.descriptor.id,descriptor.id);assert.ok(Object.isFrozen(result));assert.ok(Object.isFrozen(result.package));
});
test('preview rejects invalid receipts, failed HTTP and cancellation without retrying upload',async()=>{
 for(const bad of [{...value,compatible:'true'},{...value,package:{...receipt,packageName:'../bad'}},{...value,package:{...receipt,sha256:'bad'}},{...value,descriptor:{id:'bad'}}])
  await assert.rejects(createWorkbenchPackagePreviewClient(async()=>Response.json({ok:true,value:bad}))(new Blob(['x'])));
 let calls=0;
 await assert.rejects(createWorkbenchPackagePreviewClient(async()=>{calls++;return Response.json({ok:false},{status:403});})(new Blob(['x'])),/preview-failed/);
 assert.equal(calls,1);
 const controller=new AbortController();
 await assert.rejects(createWorkbenchPackagePreviewClient(async()=>{controller.abort();return Response.json({ok:true,value});})(new Blob(['x']),controller.signal),error=>error.name==='AbortError');
});
test('preview refuses empty or oversized archives before transport',async()=>{
 let calls=0;const preview=createWorkbenchPackagePreviewClient(async()=>{calls++;throw new Error('unexpected');});
 for(const file of [new Blob([]),new Blob([new Uint8Array(8*1024*1024+1)])]) await assert.rejects(preview(file),/size-limit/);
 assert.equal(calls,0);
});
