import {test} from 'node:test';
import assert from 'node:assert/strict';
import {recoverOperationOutput} from '../src/operation-output.mjs';
const value={kind:'foreground',exitCode:0,stdout:{truncated:true,text:'tail',spillPath:'/returned-by-bash/stdout'}};
const exec=()=>({signal:new AbortController().signal});
function fixture(bytes,override={}) {
 const target={targetKey:Symbol('opaque')};const calls=[];
 return {calls,fs:{
  resolve:async(path,options)=>{calls.push(['resolve',path,options]);return target;},
  stat:async(t,signal)=>{assert.equal(t,target);return {type:'file',version:'v1',size:bytes.byteLength};},
  readBytes:async(t,signal,cap)=>{assert.equal(t,target);calls.push(['read',signal,cap]);return bytes;},
  ...override,
 }};
}
test('complete bounded official spill replaces tail without changing exit or sandbox evidence',async()=>{
 const bytes=new TextEncoder().encode(JSON.stringify({contractVersion:1,ok:true,result:{data:'x'.repeat(200000)}}));
 const ctx=fixture(bytes),e=exec();const got=await recoverOperationOutput(ctx,e,value);
 assert.equal(got.stdout.truncated,false);assert.equal(JSON.parse(got.stdout.text).result.data.length,200000);
 assert.equal(got.exitCode,value.exitCode);assert.equal(ctx.calls[0][1],value.stdout.spillPath);
 assert.equal(ctx.calls[0][2].signal,e.signal);assert.equal(ctx.calls[1][1],e.signal);assert.equal(ctx.calls[1][2],9*1024*1024);
});
test('failed, denied, promoted and untruncated operations never read spill files',async()=>{
 for(const changed of [{exitCode:2},{timedOut:true},{aborted:true},{sandbox:{denied:true}},{sandbox:{runnerFailed:true}},{kind:'promoted'},{stdout:{text:'{}',truncated:false}}]) {
  const ctx=fixture(new Uint8Array());const v={...value,...changed};assert.equal(await recoverOperationOutput(ctx,exec(),v),v);assert.equal(ctx.calls.length,0);
 }
});
test('missing spill, missing fs, oversized files, changed files and denied reads fail closed',async()=>{
 await assert.rejects(recoverOperationOutput({},exec(),value),/TRUNCATED/);
 await assert.rejects(recoverOperationOutput(fixture(new Uint8Array()),exec(),{...value,stdout:{truncated:true}}),/TRUNCATED/);
 const large=fixture(new Uint8Array(),{stat:async()=>({type:'file',version:'v1',size:10*1024*1024})});
 await assert.rejects(recoverOperationOutput(large,exec(),value),/SIZE_LIMIT/);assert.equal(large.calls.length,1);
 let stats=0;await assert.rejects(recoverOperationOutput(fixture(new Uint8Array(),{stat:async()=>({type:'file',version:String(++stats)})}),exec(),value),/SPILL_CHANGED/);
 await assert.rejects(recoverOperationOutput(fixture(new Uint8Array(),{readBytes:async()=>{throw Error('FS_PERMISSION_DENIED');}}),exec(),value),/FS_PERMISSION_DENIED/);
});
test('cancellation and invalid UTF-8 never return a recovered result',async()=>{
 const c=new AbortController();c.abort();const ctx=fixture(new Uint8Array());
 await assert.rejects(recoverOperationOutput(ctx,{signal:c.signal},value));assert.equal(ctx.calls.length,0);
 await assert.rejects(recoverOperationOutput(fixture(new Uint8Array([255])),exec(),value),TypeError);
});
