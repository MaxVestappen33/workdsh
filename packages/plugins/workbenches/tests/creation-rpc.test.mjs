import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(new URL('../../../../apps/web/package.json',import.meta.url));
const built=await require('esbuild').build({entryPoints:[fileURLToPath(new URL('../src/runtime/creation-rpc.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false});
const {handleWorkbenchCreationRequest}=await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const request=body=>new Request('http://localhost/api/workdsh-workbench-creation',{method:'POST',body:JSON.stringify(body)});
test('creation RPC never accepts caller Session, source, owner or confirmation authority',async()=>{
 let opens=0,confirms=0;
 const service={open:async(id,idea)=>{opens++;return {id,idea};},confirm:async()=>{confirms++;return {};}};
 for(const extra of [{sessionId:'foreign'},{directory:'/foreign'},{owner:'foreign'},{target:{}}]){
  assert.equal((await handleWorkbenchCreationRequest(request({endpoint:'open',payload:{id:'id',idea:'idea',...extra}}),service)).status,400);
  assert.equal((await handleWorkbenchCreationRequest(request({endpoint:'confirm',payload:{id:'id',expectedRevision:'rev',requirements:{},...extra}}),service)).status,400);
 }
 assert.equal(opens+confirms,0);
 assert.equal((await handleWorkbenchCreationRequest(request({endpoint:'open',payload:{id:'id',idea:'idea'}}),service)).status,200);
 assert.equal(opens,1);
});
test('creation errors distinguish stale summaries and access denial without exposing internal paths',async()=>{
 for(const [message,status,code] of [['workbench/creation-conflict',409,'workbench/creation-conflict'],['workbench/creation-access-denied',403,'workbench/creation-access-denied'],['ENOENT /home/private/source',503,'workbench/creation-failed']]){
  const response=await handleWorkbenchCreationRequest(request({endpoint:'list',payload:{}}),{list:async()=>{throw Error(message);}});
  assert.equal(response.status,status);const body=await response.json();assert.equal(body.error.code,code);assert.equal(JSON.stringify(body).includes('/home/private'),false);
 }
});
test('cancelled intake request never reaches a service',async()=>{
 const controller=new AbortController();let called=false,cancelled=false;
 const stream=new ReadableStream({cancel(){cancelled=true;}});
 const pending=handleWorkbenchCreationRequest(new Request('http://localhost/api/workdsh-workbench-creation',{method:'POST',body:stream,duplex:'half',signal:controller.signal}),{list:async()=>{called=true;}});
 controller.abort();assert.equal((await pending).status,408);assert.equal(called,false);assert.equal(cancelled,true);
});
