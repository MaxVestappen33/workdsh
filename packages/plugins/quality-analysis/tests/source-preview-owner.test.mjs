import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';
const require=createRequire(new URL('../../../../apps/web/package.json',import.meta.url));const result=await require('esbuild').build({entryPoints:[fileURLToPath(new URL('../src/client/source-preview-owner.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false});
const {mountQualitySourcePreview}=await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
const tick=()=>new Promise(resolve=>setImmediate(resolve));const input={name:'检验.xlsx',kind:'xlsx'};
test('closing before source bytes arrive prevents Office mounting',async()=>{
 let resolve,mounts=0,removed=0;const states=[];const stop=mountQualitySourcePreview({remove:()=>removed++},input,()=>new Promise(done=>resolve=done),async()=>{mounts++;return()=>{};},s=>states.push(s));
 stop();stop();resolve(new Uint8Array([1]));await tick();assert.equal(mounts,0);assert.equal(removed,1);assert.deepEqual(states,[]);
});
test('a late Office mount is disposed without publishing into a replacement preview',async()=>{
 let resolve,disposed=0;const states=[];const stop=mountQualitySourcePreview({remove(){}},input,async()=>new Uint8Array([1]),()=>new Promise(done=>resolve=done),s=>states.push(s));
 await tick();stop();resolve(()=>disposed++);await tick();assert.equal(disposed,1);assert.deepEqual(states,[]);
});
test('authorized bytes pass unchanged and successful preview cleans up exactly once',async()=>{
 const bytes=new Uint8Array([1,2]);let received,disposed=0;const states=[];
 const stop=mountQualitySourcePreview({remove(){}},input,async()=>bytes,async(target,value)=>{received=value;return()=>disposed++;},s=>states.push(s));await tick();assert.equal(received.bytes,bytes);assert.deepEqual(states,['ready']);stop();stop();assert.equal(disposed,1);
});
test('original read failure reports error without invoking Office',async()=>{
 const states=[];const stop=mountQualitySourcePreview({remove(){}},input,async()=>{throw Error('forbidden');},async()=>{throw Error('unexpected mount');},s=>states.push(s));await tick();assert.deepEqual(states,['error']);stop();
});
test('closing a preview aborts the pending original read without reporting a new error',async()=>{
 let observed,mounts=0;const states=[];
 const stop=mountQualitySourcePreview({remove(){}},input,signal=>{observed=signal;return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));},async()=>{mounts++;return()=>{};},status=>states.push(status));
 assert.equal(observed.aborted,false);stop();await tick();assert.equal(observed.aborted,true);assert.equal(mounts,0);assert.deepEqual(states,[]);
});
