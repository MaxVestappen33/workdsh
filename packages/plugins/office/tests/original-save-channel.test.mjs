import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';
const {build}=createRequire(new URL('../../../../apps/web/package.json',import.meta.url))('esbuild');
const built=await build({entryPoints:[fileURLToPath(new URL('../src/original-save-channel.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false});
const {createOfficeOriginalSaveChannel:create}=await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const frame={},message={type:'workdsh-office-save',requestId:'save-1',bytes:new Uint8Array([1,2])};
test('only exact iframe and bounded save message may invoke owner',async()=>{
 let calls=0;const replies=[];const channel=create(()=>frame,async()=>{calls++;},value=>replies.push(value));
 for(const [sender,data] of [[{},message],[frame,{...message,token:'private'}],[frame,{...message,requestId:'other'}],[frame,{...message,bytes:[]}],[frame,{...message,bytes:new Uint8Array(10*1024*1024+1)}]])assert.equal(await channel.handle(sender,data),false);
 assert.equal(calls,0);assert.equal(await channel.handle(frame,message),true);assert.equal(calls,1);assert.deepEqual(replies,[{type:'workdsh-office-save-result',requestId:'save-1',ok:true}]);channel.dispose();
});
test('concurrent save ignored; copied bytes and cancellation prevent late receipt',async()=>{
 let finish,signal,copy;const replies=[];const bytes=new Uint8Array([3]);
 const channel=create(()=>frame,(value,lifetime)=>{copy=value;signal=lifetime;return new Promise(resolve=>finish=resolve);},value=>replies.push(value));
 const pending=channel.handle(frame,{...message,bytes});bytes[0]=9;assert.equal(copy[0],3);
 assert.equal(await channel.handle(frame,{...message,requestId:'save-2'}),false);
 channel.dispose();assert.equal(signal.aborted,true);finish();await pending;assert.deepEqual(replies,[]);assert.equal(await channel.handle(frame,message),false);
});
test('owner failure is a failed receipt without private error text',async()=>{
 const replies=[];const channel=create(()=>frame,async()=>{throw Error('private token');},value=>replies.push(value));
 await channel.handle(frame,message);assert.deepEqual(replies,[{type:'workdsh-office-save-result',requestId:'save-1',ok:false}]);channel.dispose();
});
