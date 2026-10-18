import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(new URL('../../../../apps/web/package.json',import.meta.url));
const built=await require('esbuild').build({entryPoints:[fileURLToPath(new URL('../src/client/data-presentation.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false});
const {qualitySourceLibraryChoice}=await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const source=Object.freeze({headers:['id'],rowCount:2,sha256:'a'.repeat(64),provenance:Object.freeze({kind:'library',assetId:'asset1',revisionId:'imported-revision'})});
function asset({kind='csv',currentRevisionId='saved-revision',revisionId=currentRevisionId,revisionAssetId='asset1',status='active'}={}){return {id:'node1',kind:'asset',assetId:'asset1',name:`十月检验.${kind}`,asset:{id:'asset1',kind,status,currentRevisionId},revision:{id:revisionId,assetId:revisionAssetId}};}
async function resolve(entry,input=source){const offered=[],controller=new AbortController();const result=await qualitySourceLibraryChoice(input,async parent=>parent==='folder'?[entry]:[{id:'folder',kind:'folder',name:'检验资料'}],controller.signal,choice=>offered.push(choice));return {result,offered};}

test('Library readback offers its validated new revision while the imported source remains pinned',async()=>{
 const {result,offered}=await resolve(asset());assert.deepEqual(result,{assetId:'asset1',revisionId:'imported-revision',title:'十月检验.csv',format:'csv'});assert.deepEqual(offered,[{assetId:'asset1',revisionId:'saved-revision',title:'十月检验.csv',format:'csv'}]);assert.equal(source.provenance.revisionId,'imported-revision');assert.equal(Object.isFrozen(result),true);assert.equal(Object.isFrozen(offered[0]),true);
});
test('same Library revision does not advertise an unnecessary new version',async()=>{
 const {result,offered}=await resolve(asset({currentRevisionId:'imported-revision'}));assert.equal(result.revisionId,'imported-revision');assert.deepEqual(offered,[]);
});
test('stale or cross-asset revision metadata cannot advertise a new source',async()=>{
 for(const entry of [asset({revisionId:'stale-revision'}),asset({revisionAssetId:'other-asset'})]){
  const {result,offered}=await resolve(entry);assert.equal(result.revisionId,'imported-revision');assert.deepEqual(offered,[]);
 }
 const entry=asset();delete entry.asset.currentRevisionId;const {offered}=await resolve(entry);assert.deepEqual(offered,[]);
});
test('a change in file format cannot silently substitute the imported CSV',async()=>{
 const {result,offered}=await resolve(asset({kind:'xlsx'}));assert.equal(result,undefined);assert.deepEqual(offered,[]);
});
test('XLSX saved revision is offered only for an XLSX imported source',async()=>{
 const input={...source,format:{kind:'xlsx',worksheet:'检验记录',headerRow:1,valuePolicy:'reject-formulas'}};const {result,offered}=await resolve(asset({kind:'xlsx'}),input);assert.equal(result.format,'xlsx');assert.equal(result.revisionId,'imported-revision');assert.equal(offered[0].revisionId,'saved-revision');
});
test('cancelled Library readback cannot publish a late revision proposal',async()=>{
 const controller=new AbortController(),offered=[];let finish;const waiting=new Promise(resolve=>finish=resolve);
 const reading=qualitySourceLibraryChoice(source,async()=>{await waiting;return [asset()];},controller.signal,choice=>offered.push(choice));controller.abort();finish();await assert.rejects(reading,{name:'AbortError'});assert.deepEqual(offered,[]);
});
