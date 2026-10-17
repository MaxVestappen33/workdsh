import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const require=createRequire(new URL('../../../../apps/web/package.json',import.meta.url));const {build}=require('esbuild');const result=await build({stdin:{contents:"export * from './packages/plugins/quality-analysis/src/client/cleaning-rows.ts';export * from './packages/plugins/quality-analysis/src/client/cleaning-budget.ts';",resolveDir:new URL('../../../..',import.meta.url).pathname},bundle:true,platform:'node',format:'esm',write:false});const {parseQualityCleaningPage,qualityCleaningFitsRequest,qualityCleaningFitsDraft}=await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
const expected={recordId:'r',tableKind:'inspections',generation:2,offset:0,limit:20};const page={recordId:'r',tableKind:'inspections',generation:2,sourceSnapshotId:'a'.repeat(64),offset:0,total:1,headers:['数量'],rows:[{row:1,location:{line:2,record:1},values:[100]}]};
test('cleaning client rejects wrong scope, stale generation and inconsistent original cells',()=>{
 assert.equal(parseQualityCleaningPage(page,expected).rows[0].values[0],100);
 for(const invalid of [{...page,recordId:'other'},{...page,generation:1},{...page,tableKind:'defects'},{...page,rows:[{...page.rows[0],row:2}]},{...page,rows:[{...page.rows[0],values:[100,2]}]}])assert.throws(()=>parseQualityCleaningPage(invalid,expected));
});
test('cleaning budget measures UTF-8 decisions without truncation',()=>{
 const request={sourceSnapshotId:'a'.repeat(64),expectedGeneration:2,inspections:[{kind:'correct',row:1,header:'数量',expected:100,value:'200',reason:'核对原单'}]};assert.equal(qualityCleaningFitsRequest('r',1,request),true);assert.equal(qualityCleaningFitsRequest('r',1,{...request,inspections:[{...request.inspections[0],value:'数'.repeat(6000)}]}),false);assert.equal(request.inspections[0].value,'200');
});

test('draft budget is stricter than analysis request and preserves oversized decisions',()=>{
 const draft={sourceSnapshotId:'a'.repeat(64),expectedGeneration:2,inspections:[{kind:'correct',row:1,header:'数量',expected:100,value:'数'.repeat(4500),reason:'核对'}]};
 assert.equal(qualityCleaningFitsRequest('r',1,draft),true);assert.equal(qualityCleaningFitsDraft(draft),false);assert.equal(draft.inspections[0].value.length,4500);
});
