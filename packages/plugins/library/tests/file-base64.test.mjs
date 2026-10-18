import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';
const require=createRequire(new URL('../../../../apps/web/package.json',import.meta.url));const built=await require('esbuild').build({entryPoints:[fileURLToPath(new URL('../src/client/file-base64.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false});
const {fileBase64}=await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
class Reader{static LOADING=1;static instances=[];readyState=0;aborts=0;constructor(){Reader.instances.push(this);}readAsDataURL(){this.readyState=1;}abort(){this.aborts++;this.readyState=2;this.onabort?.();}}
globalThis.FileReader=Reader;
test('closing owner aborts active encoding and detaches late callbacks',async()=>{
 const controller=new AbortController(),pending=fileBase64({},controller.signal),reader=Reader.instances.at(-1);const late=reader.onload;
 controller.abort();await assert.rejects(pending,{name:'AbortError'});assert.equal(reader.aborts,1);assert.equal(reader.onload,null);reader.result='data:application/octet-stream;base64,AQ==';late();assert.equal(reader.aborts,1);
});
test('already cancelled owner never starts a reader',async()=>{
 const n=Reader.instances.length,controller=new AbortController();controller.abort();await assert.rejects(fileBase64({},controller.signal));assert.equal(Reader.instances.length,n);
});
test('success returns base64 and removes cancellation listener',async()=>{
 const controller=new AbortController(),pending=fileBase64({},controller.signal),reader=Reader.instances.at(-1);reader.result='data:application/octet-stream;base64,AQID';reader.onload();assert.equal(await pending,'AQID');controller.abort();assert.equal(reader.aborts,0);
});
test('invalid encoding and reader errors reject instead of producing empty payload',async()=>{
 let pending=fileBase64({}),reader=Reader.instances.at(-1);reader.result=new ArrayBuffer(0);reader.onload();await assert.rejects(pending,/编码无效/);
 pending=fileBase64({});reader=Reader.instances.at(-1);reader.error=Error('read failed');reader.onerror();await assert.rejects(pending,/read failed/);
});
