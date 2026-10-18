import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {checkTabularArchiveBudget} from '../src/archive-budget.js';
async function archive(files){const zip=new JSZip();for(const [name,content]of Object.entries(files))zip.file(name,content);return zip.generateAsync({type:'uint8array',compression:'DEFLATE'});}
test('actual expansion counts and bounded entries reject oversized compressed data',async()=>{
 const bytes=await archive({'a.xml':'a'.repeat(100000),'b.xml':'b'.repeat(100000)});
 assert.equal((await checkTabularArchiveBudget(bytes)).expandedBytes,200000);
 await assert.rejects(checkTabularArchiveBudget(bytes,{entryBytes:50000}),/SINGLE_ENTRY_LIMIT/);
 await assert.rejects(checkTabularArchiveBudget(bytes,{entryBytes:150000,expandedBytes:150000}),/EXPANDED_LIMIT/);
 await assert.rejects(checkTabularArchiveBudget(bytes,{entries:1}),/ENTRY_LIMIT/);
 await assert.rejects(checkTabularArchiveBudget(bytes,{inputBytes:1}),/INPUT_LIMIT/);
});
test('unsafe paths, invalid archives and pre-cancellation reject',async()=>{
 await assert.rejects(checkTabularArchiveBudget(await archive({'../bad.xml':'bad'})),/UNSAFE_PATH/);
 await assert.rejects(checkTabularArchiveBudget(new Uint8Array([1,2,3])),/ARCHIVE_INVALID/);
 await assert.rejects(checkTabularArchiveBudget(await archive({'a.xml':'x'}),{},AbortSignal.abort()),{name:'AbortError'});
});
