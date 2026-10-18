import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(new URL('../../../../apps/web/package.json',import.meta.url));
const {build}=require('esbuild');
const built=await build({entryPoints:[fileURLToPath(new URL('../src/client/source-views.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false});
const {parseQualitySourceViews:parse}=await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const entry={sourceSnapshotId:'a'.repeat(64),inspections:{headers:['id'],rowCount:1,sha256:'b'.repeat(64),provenance:{kind:'library',assetId:'asset',revisionId:'rev'}}};
test('source recovery keeps immutable metadata without raw rows',()=>{
 const raw={recordId:'record',generation:0,entries:[structuredClone(entry)]};const result=parse(raw,'record');raw.entries[0].inspections.headers[0]='changed';
 assert.deepEqual(result.entries[0].inspections.headers,['id']);assert.ok(Object.isFrozen(result.entries));assert.ok(Object.isFrozen(result.entries[0].inspections.provenance));
});
test('source recovery rejects cross-record, duplicate, over-budget and raw-data responses',()=>{
 for(const value of [{recordId:'other',generation:0,entries:[entry]},{recordId:'record',generation:0,entries:[entry,entry]},{recordId:'record',generation:0,entries:Array(11).fill(entry)},{recordId:'record',generation:0,entries:[{...entry,inspections:{...entry.inspections,rows:[['secret']]}}]}])assert.throws(()=>parse(value,'record'));
});

test('oversized header metadata is rejected rather than silently truncated',()=>{
 assert.throws(()=>parse({recordId:'record',generation:0,entries:[{...entry,inspections:{...entry.inspections,headers:['x'.repeat(256*1024)]}}]},'record'));
});
