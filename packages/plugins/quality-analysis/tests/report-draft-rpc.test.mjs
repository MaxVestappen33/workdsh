import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {fileURLToPath,pathToFileURL} from 'node:url';
const require=createRequire(new URL('../../../../apps/web/package.json',import.meta.url)),runtime=createRequire(new URL('../../projects/package.json',import.meta.url));
const {build}=require('esbuild');const built=await build({entryPoints:[fileURLToPath(new URL('../src/runtime/record-rpc.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false,plugins:[{name:'zod',setup(b){b.onResolve({filter:/^zod$/},()=>({path:pathToFileURL(runtime.resolve('zod')).href,external:true}));}}]});
const {handleQualityRecordsRequest:handle}=await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const source={recordId:'record',runId:'run',contentHash:'a'.repeat(64)},fields={title:'',analysis:'草稿原文\r\n',conclusion:'',recommendations:''};
function request(endpoint,payload){return new Request('http://fixture/api/workdsh-quality-records',{method:'POST',body:JSON.stringify({endpoint,payload})});}
test('draft RPC admits only finite editable text and fixed analysis identity',async()=>{
 let saved;const service={async saveReportDraft(...args){saved=args;return {verified:true};}};
 assert.equal((await handle(request('save-report-draft',{...source,operationId:'intent',fields}),service,undefined,undefined,{})).status,200);assert.deepEqual(saved.slice(0,4),['record','run',source.contentHash,{operationId:'intent',fields}]);assert.equal(saved[5] instanceof AbortSignal,true);
 for(const extra of [{assetId:'arbitrary'},{libraryDraftId:'wrong'},{actor:{principalId:'another'}},{draftId:'unpaired'},{reportId:'unpaired'},{statistics:{total:999}}])assert.equal((await handle(request('save-report-draft',{...source,operationId:'intent',fields,...extra}),service,undefined,undefined,{})).status,400);
 assert.equal((await handle(request('save-report-draft',{...source,operationId:'intent',fields:{...fields,statistics:{total:999}}}),service,undefined,undefined,{})).status,400);
});
test('draft read and archive cannot choose arbitrary Library ids or omit CAS',async()=>{
 let args;const service={async listReportDrafts(){return [];},async readReportDraft(){return {};},async archiveReportDraft(...input){args=input;return {};}};
 assert.equal((await handle(request('report-drafts',source),service)).status,200);
 assert.equal((await handle(request('report-draft',{...source,draftId:'draft'}),service)).status,503);
 assert.equal((await handle(request('archive-report-draft',{...source,draftId:'draft',expectedDraftRevision:'rev',operationId:'archive'}),service,undefined,undefined,{})).status,200);assert.deepEqual(args.slice(0,6),['record','run',source.contentHash,'draft','rev','archive']);
 for(const payload of [{...source,draftId:'draft',assetId:'wrong'},{...source,draftId:'draft',operationId:'archive'},{...source,draftId:'draft',expectedDraftRevision:'has space',operationId:'archive'}])assert.equal((await handle(request('archive-report-draft',payload),service,undefined,undefined,{})).status,400);
});
test('draft CAS, superseded save, permission loss and absent capability remain explicit',async()=>{
 for(const [code,status] of [['library/content-draft-revision-conflict',409],['library/content-draft-operation-superseded',409],['quality/service/access-denied',403],['quality/report-draft/service-unavailable',503],['quality/report-draft/not-found',404],['library/content-draft-budget-exceeded',413]]){
  const response=await handle(request('save-report-draft',{...source,operationId:'intent',fields}),{async saveReportDraft(){throw Error(code);}},undefined,undefined,{});assert.equal(response.status,status);assert.equal((await response.json()).error.code,code);
 }
});
