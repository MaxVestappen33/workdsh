import test from 'node:test';
import assert from 'node:assert/strict';
import {createLibraryOriginalRevisionSave} from '../dist/client/original-revision-save.js';
const sha=async(bytes)=>Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex');
function fixture(){const requests=[],saved=[];const source={assetId:'asset',revisionId:'old',kind:'xlsx'};
 const service=async(input,signal)=>{signal.throwIfAborted();requests.push(input);return {asset:{id:'asset'},revision:{id:'new',assetId:'asset',originalSha256:await sha(input.bytes)}};};
 return {requests,saved,source,service};}
test('save creates a fixed-base new revision and only proposes a verified receipt',async()=>{
 const f=fixture(),save=createLibraryOriginalRevisionSave(f.source,f.service,entry=>f.saved.push(entry)),bytes=new Uint8Array([1,2]);await save(bytes,new AbortController().signal);
 assert.equal(f.requests[0].assetId,'asset');assert.equal(f.requests[0].expectedRevisionId,'old');assert.match(f.requests[0].operationId,/^library-office-[a-f0-9]{64}$/);assert.equal(f.saved[0].revision.id,'new');assert.equal(f.source.revisionId,'old');
 await save(bytes,new AbortController().signal);assert.equal(f.requests[0].operationId,f.requests[1].operationId);
 await assert.rejects(save(new Uint8Array([3]),new AbortController().signal),/采用已保存的新版本/);assert.equal(f.requests.length,2);
});
test('unknown save outcome can retry with the same operation and does not propose success',async()=>{
 const f=fixture();let fail=true;const requests=[];const save=createLibraryOriginalRevisionSave(f.source,async(input,signal)=>{requests.push(input);if(fail){fail=false;throw Error('timeout');}return f.service(input,signal);},entry=>f.saved.push(entry));
 await assert.rejects(save(new Uint8Array([4]),new AbortController().signal));assert.equal(f.saved.length,0);await save(new Uint8Array([4]),new AbortController().signal);assert.equal(requests[0].operationId,requests[1].operationId);assert.equal(f.saved.length,1);
});
test('wrong revision/hash, CSV, and abort cannot create a successful receipt',async()=>{
 const f=fixture(),signal=new AbortController().signal;
 for(const revision of [{id:'old',assetId:'asset',originalSha256:await sha(new Uint8Array([1]))},{id:'new',assetId:'asset',originalSha256:'wrong'}]){
  const save=createLibraryOriginalRevisionSave(f.source,async()=>({asset:{id:'asset'},revision}),entry=>f.saved.push(entry));await assert.rejects(save(new Uint8Array([1]),signal),/结果未确认/);
 }
 const csv=createLibraryOriginalRevisionSave({...f.source,kind:'csv'},f.service,entry=>f.saved.push(entry));await assert.rejects(csv(new Uint8Array([1]),signal),/不支持保存/);
 const aborted=new AbortController();aborted.abort();await assert.rejects(createLibraryOriginalRevisionSave(f.source,f.service,entry=>f.saved.push(entry))(new Uint8Array([1]),aborted.signal));assert.equal(f.saved.length,0);assert.equal(f.requests.length,0);
});
