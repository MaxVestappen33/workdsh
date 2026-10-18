import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(new URL('../../../../apps/web/package.json',import.meta.url));
const {build}=require('esbuild');
const built=await build({stdin:{contents:"export * from './analysis-run';export * from '../domain/cleaning';export * from '../domain/mapping';export * from '../domain/normalization';export * from '../domain/statistics';export * from '../domain/csv';",resolveDir:fileURLToPath(new URL('../src/runtime/',import.meta.url)),loader:'ts'},bundle:true,platform:'node',format:'esm',write:false});
const {createQualityAnalysisRun,cleanQualityTable,mapQualityTable,normalizeQualityTable,calculateQualityStatistics,parseCompleteQualityCsv}=await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const headers=['id','date','total','bad','unit','type'];
const mapping={inspectionId:'id',inspectionDate:'date',inspectedQuantity:'total',nonconformingQuantity:'bad',quantityUnit:'unit',inspectionType:'type'};
const rules={timeZone:'UTC',dateFormat:'yyyy/mm/dd',inspectionTypes:{初检:'initial'}};
const actor={principalId:'location-test',decidedAt:'2026-10-11T00:00:00Z'};
const exclude=row=>({kind:'exclude',row,reason:'核对后排除'});
function table(rows){return {complete:true,byteLength:100,headers,rows,locations:rows.map((_,index)=>({record:[3,4,7][index],line:[3,5,9][index]}))};}
const inspection=(id,patch={})=>[id,patch.date??'2026/10/10',patch.total??'100',patch.bad??'1','piece',patch.type??'初检'];
function input(rows){return {runId:'source-location',createdAt:actor.decidedAt,sourceNamespace:'location-test',rules,cleaningActor:actor,inspections:{mapping,decisions:[exclude(1)],imported:{sha256:'a'.repeat(64),table:table(rows)}}};}

test('mapping reports the original data row after exclusions and retains physical source locations',()=>{
 const original=table([inspection('001'),inspection('002',{total:'bad'}),inspection('003')]);
 const cleaned=cleanQualityTable(original,[exclude(1)],actor);
 assert.deepEqual(cleaned.sourceRows,[2,3]);assert.equal(Object.isFrozen(cleaned.sourceRows),true);
 const mapped=mapQualityTable(cleaned.table,'inspections',mapping,cleaned.sourceRows);
 assert.deepEqual(mapped.issues,[{row:2,field:'inspectedQuantity',code:'invalid-integer'}]);
 assert.deepEqual(mapped.locations,[{record:4,line:5},{record:7,line:9}]);
 assert.deepEqual(mapped.sourceRows,[2,3]);assert.equal(original.rows.length,3);
 const blocked=createQualityAnalysisRun(input(original.rows));
 assert.deepEqual(blocked.issues,[{row:2,field:'inspectedQuantity',code:'invalid-integer',table:'inspections'}]);
});

test('normalization errors and transformation audit rows address the original imported rows',()=>{
 const original=table([inspection('001'),inspection('002',{date:'unknown',type:'unknown'}),inspection('003')]);
 const cleaned=cleanQualityTable(original,[exclude(1)],actor);
 const normalized=normalizeQualityTable(mapQualityTable(cleaned.table,'inspections',mapping,cleaned.sourceRows),rules);
 assert.deepEqual(normalized.issues,[{row:2,field:'inspectionDate',code:'invalid-date'},{row:2,field:'inspectionType',code:'unmapped-inspection-type'}]);
 assert.deepEqual(normalized.changes.map(change=>change.row),[3,3]);
 assert.deepEqual(normalized.table.locations,[{record:4,line:5},{record:7,line:9}]);
 const blocked=createQualityAnalysisRun(input(original.rows));
 assert.deepEqual(blocked.issues.map(issue=>issue.row),[2,2]);
});

test('statistics-stage inspection issues use original rows after earlier records are excluded',()=>{
 for(const rows of [[inspection('001'),inspection('002',{bad:'101'})],[inspection('001'),inspection('same'),inspection('same')]]){
  const blocked=createQualityAnalysisRun(input(rows));assert.equal(blocked.status,'blocked');
  assert.deepEqual(blocked.issues,[{table:'inspections',code:rows.length===2?'invalid-inspection':'duplicate-inspection-id',row:rows.length}]);
 }
});

test('defect mapping and orphan validation retain the separate defect table original row identities',()=>{
 const defectMapping={defectId:'id',inspectionId:'inspection',defectCode:'code',defectLabel:'label',occurrences:'count'};
 for(const [count,inspectionId,code] of [['bad','002','invalid-integer'],['1','missing','orphan-defect']]){
  const request=input([inspection('001'),inspection('002')]);
  request.defects={mapping:defectMapping,decisions:[exclude(1),exclude(2)],imported:{sha256:'b'.repeat(64),table:{...table([['d1','002','a','划痕','1'],['d2','002','a','划痕','1'],['d3',inspectionId,'a','划痕',count]]),headers:['id','inspection','code','label','count']}}};
  const blocked=createQualityAnalysisRun(request);assert.equal(blocked.status,'blocked');
  assert.deepEqual(blocked.issues,[code==='invalid-integer'?{row:3,field:'occurrences',code,table:'defects'}:{table:'defects',code,row:3}]);
 }
});

test('successful runs retain original source bytes/rows and record normalization and exclusion provenance',()=>{
 const request=input([inspection('001'),inspection('002'),inspection('003')]);
 const run=createQualityAnalysisRun(request);assert.equal(run.status,'complete');
 assert.deepEqual(run.content.transformations.inspections.map(change=>change.row),[2,2,3,3]);
 assert.deepEqual(run.content.cleaning.inspections[0].location,{record:3,line:3});
 assert.equal(run.content.cleaning.inspections[0].row,1);
 assert.equal(run.content.sources.inspections.imported.table.rows.length,3);
 assert.equal(run.content.sources.inspections.imported.table.rows[1][1],'2026/10/10');
 assert.equal(run.content.statistics.summary.inspectedQuantity,200);
 assert.equal('sourceRows' in run.content.sources.inspections.imported.table,false,'internal row provenance does not change the original source schema');
});

test('CSV blank and multiline records remain distinct from one-based original data row numbers',()=>{
 const csv='id,date,total,bad,unit,type,product\n\n001,2026/10/10,100,1,piece,初检,"A\nB"\n\n002,2026/10/10,bad,1,piece,初检,C';
 const original=parseCompleteQualityCsv(new TextEncoder().encode(csv));
 assert.equal(original.locations[1].line,6);
 const cleaned=cleanQualityTable(original,[exclude(1)],actor);
 const mapped=mapQualityTable(cleaned.table,'inspections',mapping,cleaned.sourceRows);
 assert.equal(mapped.issues[0].row,2);assert.equal(mapped.locations[0].line,6);
});

test('inconsistent row provenance fails before it can point to an unrelated record',()=>{
 const original=table([inspection('001'),inspection('002')]);
 for(const rows of [[1],[1,1],[1,0],[1,1.5]])assert.throws(()=>mapQualityTable(original,'inspections',mapping,rows),/invalid-source-rows/);
 const mapped=mapQualityTable(original,'inspections',mapping);
 assert.throws(()=>normalizeQualityTable({...mapped,sourceRows:[1]},rules),/invalid-source-rows/);
 const normalized=normalizeQualityTable(mapped,rules).table.rows;
 assert.throws(()=>calculateQualityStatistics({sourceNamespace:'test',timeZone:'UTC',complete:true,inspections:normalized,defects:[]},{},{inspections:[1]}),/invalid-source-rows/);
});
