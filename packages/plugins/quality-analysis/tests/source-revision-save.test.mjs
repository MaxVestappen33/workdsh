import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';
const require=createRequire(new URL('../../../../apps/web/package.json',import.meta.url));
const result=await require('esbuild').build({entryPoints:[fileURLToPath(new URL('../src/client/source-revision-save.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false});
const {createQualitySourceRevisionSave}=await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
const source={assetId:'asset-a',revisionId:'revision-1',title:'检验.xlsx',format:'xlsx'};
const receipt=input=>({kind:'asset',assetId:input.assetId,name:source.title,asset:{id:input.assetId,status:'active',kind:'xlsx'},revision:{id:'revision-2',assetId:input.assetId,originalSha256:createHash('sha256').update(input.bytes).digest('hex')}});
test('unknown result retries the same operation and proposes without modifying selected source',async()=>{
 const calls=[],proposals=[];let fail=true;const save=createQualitySourceRevisionSave(source,async input=>{calls.push(input);if(fail){fail=false;throw Error('lost receipt');}return receipt(input);},value=>proposals.push(value));
 const signal=new AbortController().signal,bytes=new Uint8Array([1,2]);await assert.rejects(save(bytes,signal));await save(bytes,signal);
 assert.equal(calls[0].operationId,calls[1].operationId);assert.equal(source.revisionId,'revision-1');assert.equal(proposals[0].revisionId,'revision-2');
 await assert.rejects(save(new Uint8Array([3]),signal));assert.equal(calls.length,2);
});
test('another source or bytes has a different operation identity',async()=>{
 const ids=[];const persist=async input=>{ids.push(input.operationId);return receipt(input);};const signal=new AbortController().signal;
 await createQualitySourceRevisionSave(source,persist,()=>{})(new Uint8Array([1]),signal);
 await createQualitySourceRevisionSave({...source,revisionId:'revision-0'},persist,()=>{})(new Uint8Array([1]),signal);
 await createQualitySourceRevisionSave(source,persist,()=>{})(new Uint8Array([2]),signal);assert.equal(new Set(ids).size,3);
});
test('cancelled owner ignores a late committed receipt',async()=>{
 const controller=new AbortController();let proposals=0;
 const save=createQualitySourceRevisionSave(source,async input=>{controller.abort();return receipt(input);},()=>proposals++);
 await assert.rejects(save(new Uint8Array([1]),controller.signal));assert.equal(proposals,0);
});
test('foreign revision, unchanged revision and wrong byte receipt never propose a source',async()=>{
 for(const mutate of [r=>({...r,assetId:'other',asset:{...r.asset,id:'other'},revision:{...r.revision,assetId:'other'}}),r=>({...r,revision:{...r.revision,id:source.revisionId}}),r=>({...r,revision:{...r.revision,originalSha256:'0'.repeat(64)}})]){
  let proposals=0;const save=createQualitySourceRevisionSave(source,async input=>mutate(receipt(input)),()=>proposals++);
  await assert.rejects(save(new Uint8Array([1]),new AbortController().signal));assert.equal(proposals,0);
 }
});
test('unsupported format and invalid byte budgets never reach persistence',async()=>{
 let calls=0;const persist=async input=>{calls++;return receipt(input);},signal=new AbortController().signal;
 await assert.rejects(createQualitySourceRevisionSave({...source,format:'csv'},persist,()=>{})(new Uint8Array([1]),signal));
 const save=createQualitySourceRevisionSave(source,persist,()=>{});await assert.rejects(save(new Uint8Array(),signal));await assert.rejects(save(new Uint8Array(10*1024*1024+1),signal));assert.equal(calls,0);
});
test('overlapping Office saves cannot create competing source revisions and failure releases the guard',async()=>{
 let finish,calls=0;const proposals=[];
 const save=createQualitySourceRevisionSave(source,input=>{calls++;return new Promise(resolve=>{finish=()=>resolve(receipt(input));});},value=>proposals.push(value));
 const signal=new AbortController().signal;
 const first=save(new Uint8Array([1]),signal);
 await assert.rejects(save(new Uint8Array([2]),signal),/正在保存/);
 while(!finish)await new Promise(resolve=>setImmediate(resolve));
 finish();await first;
 assert.equal(calls,1);assert.equal(proposals.length,1);
 let attempts=0;const retry=createQualitySourceRevisionSave(source,async input=>{if(++attempts===1)throw Error('offline');return receipt(input);},()=>{});
 await assert.rejects(retry(new Uint8Array([3]),signal),/offline/);
 await retry(new Uint8Array([3]),signal);assert.equal(attempts,2);
});
