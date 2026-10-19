import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
const web=createRequire(new URL('../../../../apps/web/package.json',import.meta.url)),runtime=createRequire(new URL('../../projects/package.json',import.meta.url)),{build}=web('esbuild');
const built=await build({stdin:{contents:"export * from './domain/analysis-focus';export * from './domain/statistics';export * from './client/record-client';",resolveDir:fileURLToPath(new URL('../src/',import.meta.url))},bundle:true,platform:'node',format:'esm',write:false,plugins:[{name:'published-zod',setup(b){b.onResolve({filter:/^zod$/},()=>({path:pathToFileURL(runtime.resolve('zod')).href,external:true}));}}]});
const {resolveQualityFocus:resolve,qualityFocusSelectionSchema:schema,calculateQualityStatistics:calculate,parseQualityFocusedInspectionPage:parse,createQualityRecordClient}=await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const row=(inspectionId,inspectionDate,lineId='一号线',inspectionType='initial')=>({inspectionId,inspectionDate,lineId,inspectionType,quantityUnit:'piece',inspectedQuantity:100,nonconformingQuantity:5});
const inspections=[row('a','2026-10-05'),row('b','2026-10-10'),row('c','2026-10-10','二号线'),row('d','2026-10-10','一号线','retest'),row('e','2026-10-12')];
const dataset={complete:true,sourceNamespace:'fixture',timeZone:'Asia/Shanghai',inspections,defects:[]};
test('focusing obeys actual included IDs for line, date and initial/retest filters',()=>{
 const statistics=calculate(dataset,{lineIds:['一号线'],dateFrom:'2026-10-10',dateTo:'2026-10-10',retestPolicy:'exclude'});
 const focus=resolve(statistics,inspections,{kind:'period',date:'2026-10-10'});assert.deepEqual([...focus.inspectionIds],['b']);
 assert.deepEqual(focus.range,{dateFrom:'2026-10-10',dateTo:'2026-10-10',trendGranularity:'day'});
 for(const inspectionId of ['a','c','d','e','unknown'])assert.throws(()=>resolve(statistics,inspections,{kind:'inspection',inspectionId}),/not-found/);
});
test('week and month selections resolve the exact displayed period and report actual evidence dates',()=>{
 const weekly=calculate(dataset,{trendGranularity:'week',retestPolicy:'include-separately'}),first=resolve(weekly,inspections,{kind:'period',date:'2026-10-05'});
 assert.deepEqual([...first.inspectionIds],['a','b','c','d']);assert.deepEqual(first.range,{dateFrom:'2026-10-05',dateTo:'2026-10-10',trendGranularity:'week'});
 assert.deepEqual([...resolve(weekly,inspections,{kind:'period',date:'2026-10-12'}).inspectionIds],['e']);
 assert.throws(()=>resolve(weekly,inspections,{kind:'period',date:'2026-10-10'}),/not-found/);
 const monthly=calculate(dataset,{trendGranularity:'month',retestPolicy:'include-separately'}),month=resolve(monthly,inspections,{kind:'period',date:'2026-10-01'});
 assert.equal(month.inspectionIds.size,5);assert.equal(month.range.dateTo,'2026-10-12');assert.throws(()=>resolve(monthly,inspections,{kind:'period',date:'2026-11-01'}),/not-found/);
});
test('focus accepts only a valid calendar date or inspection identifier, never authority fields',()=>{
 for(const selection of [{kind:'period',date:'2026-02-30'},{kind:'period',date:'2026/10/10'},{kind:'period',date:'2026-10-10',grain:'month'},{kind:'inspection',inspectionId:' '},{kind:'inspection',inspectionId:'id\ncommand'},{kind:'inspection',inspectionId:'b',runId:'foreign'}])assert.equal(schema.safeParse(selection).success,false);
 assert.throws(()=>resolve({status:'blocked',issues:[]},inspections,{kind:'inspection',inspectionId:'b'}),/unavailable/);
});
const basis={recordId:'record',runId:'run',contentHash:'a'.repeat(64)},selection={kind:'inspection',inspectionId:'b'};
const receipt={...basis,selection,range:{dateFrom:'2026-10-10',dateTo:'2026-10-10',trendGranularity:'day'},offset:0,total:1,rows:[{sourceRow:2,location:{record:3,line:4},inspection:row('b','2026-10-10')}],nextOffset:null};
test('evidence decoder rejects another basis, unrelated record, invalid origin and incomplete pagination',()=>{
 const expected={...basis,selection,offset:0};assert.equal(parse(receipt,expected).rows[0].location.line,4);
 for(const wrong of [{...receipt,recordId:'other'},{...receipt,runId:'other'},{...receipt,contentHash:'b'.repeat(64)},{...receipt,selection:{kind:'inspection',inspectionId:'c'}},{...receipt,total:2},{...receipt,nextOffset:1},{...receipt,rows:[]},{...receipt,rows:[{...receipt.rows[0],sourceRow:0}]},{...receipt,rows:[{...receipt.rows[0],inspection:row('c','2026-10-10')}]},{...receipt,rows:[{...receipt.rows[0],inspection:{...receipt.rows[0].inspection,nonconformingQuantity:101}}]}])assert.throws(()=>parse(wrong,expected),/invalid-page/);
});
test('Client sends bounded focus requests and validates the same view and selected focus receipt',async()=>{
 let submitted;const client=createQualityRecordClient(async(path,init)=>{assert.equal(path,'/api/workdsh-quality-records');submitted=JSON.parse(init.body);return Response.json({ok:true,value:receipt});});
 assert.equal((await client.focusInspections(basis.recordId,basis.runId,basis.contentHash,selection,0)).rows[0].inspection.inspectionId,'b');
 assert.deepEqual(submitted,{endpoint:'focus-inspections',payload:{...basis,selection,offset:0}});
 const context={...basis,sessionId:'session',originRunId:'original',originContentHash:'b'.repeat(64),revision:4,selectedFocus:selection};
 const ai=createQualityRecordClient(async(_path,init)=>{submitted=JSON.parse(init.body);return Response.json({ok:true,value:context});});
 const selected=await ai.aiFocus(basis.recordId,basis.runId,basis.contentHash,'session',selection);assert.equal(selected.sessionId,'session');assert.deepEqual(selected.selectedFocus,selection);assert.deepEqual(submitted,{endpoint:'ai-focus',payload:{...basis,sessionId:'session',selection}});
 for(const wrong of [{...context,runId:'old'},{...context,contentHash:'c'.repeat(64)},{...context,sessionId:'other'},{...context,selectedFocus:{kind:'inspection',inspectionId:'a'}},{...context,selectedFocus:undefined}]){
  const stale=createQualityRecordClient(async()=>Response.json({ok:true,value:wrong}));await assert.rejects(stale.aiFocus(basis.recordId,basis.runId,basis.contentHash,'session',selection),error=>error.code==='quality/response/invalid');
 }
});
