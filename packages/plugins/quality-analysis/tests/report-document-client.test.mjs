import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
const require=createRequire(new URL('../../../../apps/web/package.json',import.meta.url));
const runtime=createRequire(new URL('../../projects/package.json',import.meta.url));
const {build}=require('esbuild');
const built=await build({stdin:{contents:"export * from './record-client';export * from './report-document-view';",resolveDir:fileURLToPath(new URL('../src/client/',import.meta.url))},bundle:true,platform:'node',format:'esm',write:false,plugins:[{name:'zod',setup(b){b.onResolve({filter:/^zod$/},()=>({path:pathToFileURL(runtime.resolve('zod')).href,external:true}));}}]});
const {createQualityRecordClient,parseQualityReportDocuments,parseQualityReportDocument}=await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const hash='a'.repeat(64),fields={title:'十月分析',analysis:'两日不合格率均为5%。',conclusion:'继续观察',recommendations:''},markdown='# 十月分析\n\n检验300，不合格15，合格率95%。';
const sha=createHash('sha256').update(markdown).digest('hex');
const view={reportId:'report-1',recordId:'record',runId:'run',contentHash:hash,fields,revisionId:'rev-1',currentRevisionId:'rev-1',version:1,
 versions:[{version:1,revisionId:'rev-1',sha256:sha,operationId:'intent-1',createdAt:'2026-10-11T00:00:00Z',title:fields.title}],markdown,
 receipt:{runId:'run',contentHash:hash,sha256:sha,operationId:'quality-document-library-op',assetId:'asset-1',revisionId:'rev-1',nodeId:'node-1',format:'markdown',detailKind:'markdown'}};
const read=value=>parseQualityReportDocument(value,'record','run',hash,{reportId:'report-1',revisionId:'rev-1'});
test('report readback verifies immutable revision receipt and actual Markdown bytes',async()=>{
 const result=await read(view);assert.equal(result.fields.conclusion,fields.conclusion);assert.equal(Object.isFrozen(result.versions[0]),true);
 for(const wrong of [{...view,recordId:'other'},{...view,runId:'other'},{...view,reportId:'report-2'},{...view,revisionId:'rev-2'},
  {...view,markdown:markdown+' altered'},{...view,receipt:{...view.receipt,revisionId:'rev-2'}},{...view,statistics:{total:999}},
  {...view,versions:[view.versions[0],view.versions[0]]},{...view,fields:{...fields,title:' 十月分析 '}}])await assert.rejects(read(wrong));
});
test('report list is bound to selected record/run and rejects duplicate identities',()=>{
 const summary={reportId:'report-1',recordId:'record',runId:'run',contentHash:hash,title:fields.title,currentRevisionId:'rev-1',version:1,updatedAt:view.versions[0].createdAt};
 assert.equal(parseQualityReportDocuments([summary],'record','run',hash)[0].title,fields.title);
 for(const invalid of [[summary,summary],[{...summary,contentHash:'b'.repeat(64)}],[{...summary,version:0}],[{...summary,assetId:'arbitrary'}]])assert.throws(()=>parseQualityReportDocuments(invalid,'record','run',hash));
});
test('save preserves one captured intent across transport and verifies matching edited fields',async()=>{
 let submitted;const client=createQualityRecordClient(async(path,init)=>{assert.equal(path,'/api/workdsh-quality-records');assert.equal(init.credentials,'same-origin');submitted=JSON.parse(init.body);return Response.json({ok:true,value:view});});
 const input={operationId:'intent-1',fields:structuredClone(fields)};const saving=client.saveReportDocument('record','run',hash,input);input.fields.conclusion='mutated after send';
 assert.equal((await saving).fields.conclusion,'继续观察');assert.equal(submitted.payload.fields.conclusion,'继续观察');assert.equal(submitted.endpoint,'save-report-document');
 const wrong=createQualityRecordClient(async()=>Response.json({ok:true,value:{...view,fields:{...fields,conclusion:'unrelated'}}}));
 await assert.rejects(wrong.saveReportDocument('record','run',hash,{operationId:'intent-1',fields}),error=>error.code==='quality/response/invalid');
});
test('unchanged save may return existing version but foreign operation cannot claim new revision',async()=>{
 const client=createQualityRecordClient(async()=>Response.json({ok:true,value:view}));
 assert.equal((await client.saveReportDocument('record','run',hash,{reportId:'report-1',expectedRevisionId:'rev-1',operationId:'noop-2',fields})).version,1);
 await assert.rejects(client.saveReportDocument('record','run',hash,{reportId:'report-1',expectedRevisionId:'earlier',operationId:'wrong-intent',fields}),error=>error.code==='quality/response/invalid');
});
