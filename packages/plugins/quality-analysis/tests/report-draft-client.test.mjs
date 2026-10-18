import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
const require=createRequire(new URL('../../../../apps/web/package.json',import.meta.url)),runtime=createRequire(new URL('../../projects/package.json',import.meta.url));
const {build}=require('esbuild');
const built=await build({stdin:{contents:"export * from './record-client';export * from './report-draft-view';",resolveDir:fileURLToPath(new URL('../src/client/',import.meta.url))},bundle:true,platform:'node',format:'esm',write:false,plugins:[{name:'zod',setup(b){b.onResolve({filter:/^zod$/},()=>({path:pathToFileURL(runtime.resolve('zod')).href,external:true}));}}]});
const {createQualityRecordClient,parseQualityReportDrafts,parseQualityReportDraft}=await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const source={recordId:'record',runId:'run',contentHash:'a'.repeat(64)},fields={title:'',analysis:'保留\r\n原始空白  ',conclusion:'',recommendations:''};
const draft={...source,draftId:'draft-1',draftRevision:'rev-1',sha256:'b'.repeat(64),updatedAt:'2026-10-11T00:00:00Z',title:'',status:'active',fields};
test('draft response permits unfinished text but rejects foreign scope or body authority',()=>{
 const parsed=parseQualityReportDraft(draft,source.recordId,source.runId,source.contentHash,{draftId:'draft-1'});assert.equal(parsed.fields.analysis,fields.analysis);assert.equal(parsed.title,'');assert.equal(Object.isFrozen(parsed.fields),true);
 for(const wrong of [{...draft,recordId:'other'},{...draft,runId:'other'},{...draft,contentHash:'c'.repeat(64)},{...draft,assetId:'arbitrary'},{...draft,actor:{id:'another'}},{...draft,fields:{...fields,statistics:{total:999}}},{...draft,reportId:'report-1'},{...draft,title:'not-body-title'}])assert.throws(()=>parseQualityReportDraft(wrong,source.recordId,source.runId,source.contentHash));
});
test('draft lists contain pointers only and reject duplicate identities',()=>{
 const {fields:ignored,...summary}=draft;
 assert.equal(parseQualityReportDrafts([summary],source.recordId,source.runId,source.contentHash)[0].draftId,'draft-1');
 for(const wrong of [[summary,summary],[draft],[{...summary,status:'published'}],[{...summary,draftRevision:'has space'}]])assert.throws(()=>parseQualityReportDrafts(wrong,source.recordId,source.runId,source.contentHash));
});
test('client captures the draft save intent and rejects unrelated save readback',async()=>{
 let submitted;let release;const deferred=new Promise(resolve=>release=resolve);
 const client=createQualityRecordClient(async(path,init)=>{assert.equal(path,'/api/workdsh-quality-records');assert.equal(init.credentials,'same-origin');submitted=JSON.parse(init.body);await deferred;return Response.json({ok:true,value:draft});});
 const input={operationId:'intent-1',fields:structuredClone(fields)},pending=client.saveReportDraft(source.recordId,source.runId,source.contentHash,input);input.fields.analysis='mutated';release();
 assert.equal((await pending).fields.analysis,fields.analysis);assert.equal(submitted.endpoint,'save-report-draft');assert.equal(submitted.payload.fields.analysis,fields.analysis);
 for(const wrong of [{...draft,fields:{...fields,analysis:'unrelated'}},{...draft,status:'archived'},{...draft,reportId:'other',baseRevisionId:'other-version'}]){
  const rejecting=createQualityRecordClient(async()=>Response.json({ok:true,value:wrong}));await assert.rejects(rejecting.saveReportDraft(source.recordId,source.runId,source.contentHash,{operationId:'intent-1',fields}),error=>error.code==='quality/response/invalid');
 }
});
test('archive does not claim completion from an active or different draft',async()=>{
 for(const wrong of [draft,{...draft,status:'archived',draftId:'other'}]){
  const client=createQualityRecordClient(async()=>Response.json({ok:true,value:wrong}));await assert.rejects(client.archiveReportDraft(source.recordId,source.runId,source.contentHash,'draft-1','rev-1','archive-1'),error=>error.code==='quality/response/invalid');
 }
 const client=createQualityRecordClient(async()=>Response.json({ok:true,value:{...draft,status:'archived',draftRevision:'rev-2'}}));
 assert.equal((await client.archiveReportDraft(source.recordId,source.runId,source.contentHash,'draft-1','rev-1','archive-1')).status,'archived');
});
