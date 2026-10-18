import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(new URL('../../../../apps/web/package.json',import.meta.url));
const {build}=require('esbuild');
const built=await build({entryPoints:[fileURLToPath(new URL('../src/client/analysis-instruction.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false});
const {createQualityAnalysisInstruction:instruction,createQualityToolInstruction:tools}=await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const view={recordId:'record',runId:'run',contentHash:'a'.repeat(64),createdAt:'2026-10-10T00:00:00Z',hasDefectSource:false,statistics:{status:'complete',summary:{nonconformingRate:null},trend:[],products:[],pareto:[]},markdown:'private report',token:'private token'};
test('analysis context binds fixed run, preserves unknown rate and excludes unrelated fields',()=>{
 const text=instruction('record',view),context=JSON.parse(text.slice(text.indexOf('{')));
 assert.equal(context.recordId,'record');assert.equal(context.runId,'run');assert.equal(context.contentHash,view.contentHash);
 assert.equal(context.statistics.summary.nonconformingRate,null);assert.equal(context.hasDefectSource,false);
 assert.equal(text.includes('private report'),false);assert.equal(text.includes('private token'),false);
 assert.throws(()=>instruction('other',view),/invalid-analysis-context/);
});
test('oversized analysis context rejects the whole prompt without partial statistics',()=>{
 assert.throws(()=>instruction('record',{...view,statistics:{...view.statistics,products:[{productId:'检'.repeat(30000)}]}}),/budget-exceeded/);
});
test('native requests keep the authorized basis out of the visible business prompt',()=>{
 const analysis=tools('record',view),report=tools('record',view,'report',{reportId:'selected-report',revisionId:'selected-version'});
 assert.match(analysis,/重新计算/);assert.match(analysis,/每日趋势/);assert.match(analysis,/更新图表/);assert.match(analysis,/数据依据/);
 assert.match(report,/已有报告/);assert.match(report,/保留其他段落/);assert.match(report,/独立草稿供我确认/);
 assert.doesNotMatch(report,/重新计算|重算/);
 for(const text of [analysis,report]){
  assert.ok(text.length<100);
  assert.doesNotMatch(text,/quality_|expected_draft_revision|report_id|base_revision_id|draftRevision|runId|contentHash|CAS|selected-report|selected-version|private token|private report|JSON/);
 }
 assert.throws(()=>tools('record',view,'report',{reportId:'',revisionId:'x'}),/invalid-report-context/);
 assert.throws(()=>tools('other',view),/invalid-analysis-context/);
 assert.throws(()=>tools('record',{...view,statistics:{status:'blocked'}}),/invalid-analysis-context/);
});
