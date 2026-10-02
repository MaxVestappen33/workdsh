import { test } from 'node:test';
import assert from 'node:assert/strict';
import { colleagueMentionSource } from '../dist/colleague-mentions.js';
const signal = new AbortController().signal;
const people = [{id:'a',displayName:'李明',email:'a@example.test'}, {id:'b',displayName:'李明',email:'b@example.test'}];
test('directory searches name and email, distinguishes duplicates, and selecting only inserts a reference', async () => {
 const source = colleagueMentionSource(async()=>people);
 const session = {sessionId:'session-a'};
 const list = await source.candidates(session,{query:'李明',signal});
 assert.equal(list.length,2); assert.notEqual(list[0].name,list[1].name);
 const found=await source.candidates(session,{query:'B@EXAMPLE',signal});
 assert.equal(found[0].value,'b');
 const pick=source.onPick({candidate:found[0]});
 assert.equal(pick.insert.ref,'b'); assert.equal(pick.claim,undefined);
 const serialized=await source.codec.serialize('b',signal);
 assert.match(serialized,/b@example.test/);assert.match(serialized,/不代表已发送/);
});
test('removed recipient or signed-out directory blocks reference serialization',async()=>{
 let current=people;
 const source=colleagueMentionSource(async()=>current);
 current=[];
 await assert.rejects(()=>source.codec.serialize('b',signal),/重新选择/);
 const loggedOut=colleagueMentionSource(async()=>{throw new Error('请先登录');});
 await assert.rejects(()=>loggedOut.codec.serialize('b',signal),/请先登录/);
});
