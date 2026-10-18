import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {fileURLToPath,pathToFileURL} from 'node:url';
const require=createRequire(new URL('../../../../apps/web/package.json',import.meta.url)),runtime=createRequire(new URL('../../projects/package.json',import.meta.url));
const {build}=require('esbuild');const built=await build({entryPoints:[fileURLToPath(new URL('../src/runtime/record-rpc.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false,plugins:[{name:'zod',setup(b){b.onResolve({filter:/^zod$/},()=>({path:pathToFileURL(runtime.resolve('zod')).href,external:true}));}}]});
const {handleQualityRecordsRequest:handle}=await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const source={recordId:'record',runId:'run',contentHash:'a'.repeat(64)},fields={title:'报告',analysis:'文字',conclusion:'',recommendations:''};
function request(endpoint,payload){return new Request('http://fixture/api/workdsh-quality-records',{method:'POST',body:JSON.stringify({endpoint,payload})});}
test('report RPC only delegates selected business scope and editable text',async()=>{
 let saved;const service={async saveReportDocument(...args){saved=args;return {verified:true};}};
 const response=await handle(request('save-report-document',{...source,operationId:'intent',fields}),service,undefined,undefined,{});
 assert.equal(response.status,200);assert.deepEqual(saved.slice(0,4),['record','run',source.contentHash,{operationId:'intent',fields}]);assert.equal(saved[5] instanceof AbortSignal,true);
 for(const extra of [{assetId:'arbitrary'},{actor:{principalId:'other'}},{statistics:{total:999}},{expectedRevisionId:'unbound'}]){
  const rejected=await handle(request('save-report-document',{...source,operationId:'intent',fields,...extra}),service,undefined,undefined,{});assert.equal(rejected.status,400);
 }
 assert.equal((await handle(request('save-report-document',{...source,operationId:'intent',fields:{...fields,statistics:{total:999}}}),service,undefined,undefined,{})).status,400);
});
test('report reads reject unknown keys and versions while list needs no asset authority',async()=>{
 const service={async listReportDocuments(){return [];},async readReportDocument(){return {verified:true};}};
 assert.equal((await handle(request('report-documents',source),service)).status,200);
 assert.equal((await handle(request('report-document',{...source,reportId:'report'}),service)).status,503);
 assert.equal((await handle(request('report-document',{...source,reportId:'report',revisionId:'rev'}),service,undefined,undefined,{})).status,200);
 for(const extra of [{assetId:'asset'},{revisionId:''},{revisionId:'has whitespace'},{contentHash:'not-a-hash'}])assert.equal((await handle(request('report-document',{...source,reportId:'report',...extra}),service,undefined,undefined,{})).status,400);
});
test('report conflicts, inactive identity, and bounded UTF-8 request have explicit outcomes',async()=>{
 for(const [code,status] of [['library/base-revision-conflict',409],['quality/report-document/operation-conflict',409],['quality/service/access-denied',403],['quality/report-document/version-service-unavailable',503]]){
  const response=await handle(request('save-report-document',{...source,operationId:'intent',fields}),{async saveReportDocument(){throw Error(code);}},undefined,undefined,{});assert.equal(response.status,status);assert.equal((await response.json()).error.code,code);
 }
 assert.equal((await handle(request('save-report-document',{...source,operationId:'intent',fields:{...fields,analysis:'质'.repeat(4100)}}),{},undefined,undefined,{})).status,400);
 assert.equal((await handle(request('save-report-document',{...source,operationId:'intent',fields:{...fields,analysis:'质'.repeat(6000)}}),{},undefined,undefined,{})).status,413);
});
