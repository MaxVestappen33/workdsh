import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(new URL('../../../../apps/web/package.json', import.meta.url));
const { build } = require('esbuild');
const built = await build({ stdin:{contents:"export * from '../domain/configuration';export * from './analysis-run'; export * from './report';export * from './statistics-export';",resolveDir:fileURLToPath(new URL('../src/runtime/',import.meta.url)),loader:'ts'}, bundle: true, platform: 'node', format: 'esm', write: false });
const { defineQualityAnalysisConfiguration,createQualityAnalysisRun, renderQualityMarkdownReport,exportQualityStatisticsCsv } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
import {createHash} from 'node:crypto';
const headers=['id','date','total','bad','unit','type'];
const mapping={inspectionId:'id',inspectionDate:'date',inspectedQuantity:'total',nonconformingQuantity:'bad',quantityUnit:'unit',inspectionType:'type'};
const source=()=>({imported:{sha256:createHash('sha256').update('fixture').digest('hex'),table:{complete:true,encoding:'utf-8',byteLength:7,headers:[...headers],rows:[['001','2026/10/10','100','2','piece','初检']],locations:[{record:2,line:2}],ignoredBlankRecords:0}},mapping:{...mapping}});
const input=()=>({runId:'run1',createdAt:'2026-10-10T00:00:00Z',sourceNamespace:'fixture',inspections:source(),rules:{timeZone:'Asia/Shanghai',dateFormat:'yyyy/mm/dd',inspectionTypes:{初检:'initial'}}});
test('run freezes source, normalization, filter and deterministic results independently of caller',()=>{
 const request=input(); const run=createQualityAnalysisRun(request);
 assert.equal(run.status,'complete');assert.equal(run.content.statistics.summary.nonconformingRate,.02);
 assert.equal(run.content.transformations.inspections.length,2);
 request.inspections.imported.table.rows[0][2]='999';request.rules.inspectionTypes.初检='retest';
 assert.equal(run.content.sources.inspections.imported.table.rows[0][2],'100');
 assert.equal(run.content.rules.inspectionTypes.初检,'initial');
 assert.equal(Object.isFrozen(run.content.dataset.inspections[0]),true);
 const again=createQualityAnalysisRun({...input(),runId:'run2',createdAt:'2026-10-11T00:00:00Z'});
 assert.equal(run.contentHash,again.contentHash);
 const changed=input();changed.filter={productIds:[]};
 assert.notEqual(createQualityAnalysisRun(changed).contentHash,run.contentHash);
});
test('mapping and normalization errors prevent successful snapshots',()=>{
 const invalid=input();invalid.inspections.imported.table.rows[0][2]='';
 assert.equal(createQualityAnalysisRun(invalid).status,'blocked');
 const unknown=input();unknown.inspections.imported.table.rows[0][5]='未知';
 assert.equal(createQualityAnalysisRun(unknown).status,'blocked');
 const malformed=input();malformed.inspections.imported.sha256='fake';
 assert.throws(()=>createQualityAnalysisRun(malformed),/invalid-source/);
});

test('run captures reviewed cleaning decisions and refuses missing actor',()=>{
 const request=input();request.inspections.imported.table.rows[0][2]='bad';
 request.inspections.decisions=[{kind:'correct',row:1,header:'total',expected:'bad',value:'100',reason:'核对原单'}];
 assert.throws(()=>createQualityAnalysisRun(request),/cleaning-actor-required/);
 request.cleaningActor={principalId:'host-principal',decidedAt:request.createdAt};
 const run=createQualityAnalysisRun(request);assert.equal(run.status,'complete');
 assert.equal(run.content.cleaning.inspections[0].expected,'bad');
 assert.equal(run.content.sources.inspections.imported.table.rows[0][2],'bad');
 assert.equal(run.content.dataset.inspections[0].inspectedQuantity,100);
});

test('report references frozen run, escapes user text and distinguishes missing defects',()=>{
 const run=createQualityAnalysisRun(input());
 const report=renderQualityMarkdownReport(run,'<script> | [test](url)');
 assert.ok(report.includes('&lt;script&gt;'));assert.ok(!report.includes('<script>'));
 assert.ok(report.includes(run.contentHash));assert.ok(report.includes('2.00%'));
 assert.ok(report.includes('未提供缺陷明细'));assert.ok(report.includes('未进行 AI 解读'));
 assert.equal(report,renderQualityMarkdownReport(run,'<script> | [test](url)'));
 const tampered=JSON.parse(JSON.stringify(run));tampered.content.statistics.summary.inspectedQuantity=1;
 assert.throws(()=>renderQualityMarkdownReport(tampered,'report'),/invalid-run/);
});

test('statistics CSV retains exact fractions, unknown dimensions and fixed run provenance',()=>{
 const request=input();request.inspections.imported.table.rows[0][2]='3';request.inspections.imported.table.rows[0][3]='1';
 const run=createQualityAnalysisRun(request);const output=exportQualityStatisticsCsv(run);
 assert.equal(output.contentHash,run.contentHash);assert.equal(output.hasDefectSource,false);
 const trend=output.files.find(file=>file.kind==='trend');assert.ok(trend.content.includes('0.3333333333333333'));
 assert.equal(trend.sha256,createHash('sha256').update(trend.content).digest('hex'));
 assert.ok(trend.content.includes('0.3333333333333333,\r\n'),'missing defect source stays empty');
 assert.ok(output.files.find(file=>file.kind==='products').content.includes(',"是",'));
 assert.deepEqual(output,exportQualityStatisticsCsv(run));
});
test('CSV protects formula-leading strings without changing source snapshot',()=>{
 const request=input();request.inspections.imported.table.headers.push('product');request.inspections.imported.table.rows[0].push('=SUM(A1),"quoted"');request.inspections.mapping.productId='product';
 const run=createQualityAnalysisRun(request);const products=exportQualityStatisticsCsv(run).files.find(file=>file.kind==='products');
 assert.equal(products.protectedTextCells,1);assert.ok(products.content.includes("'="));
 assert.equal(run.content.dataset.inspections[0].productId,'=SUM(A1),"quoted"');
 assert.ok(products.content.includes('""quoted""'));
});

test('period selection is frozen with algorithm version and reflected in report and CSV labels',()=>{
 const weekly=createQualityAnalysisRun({...input(),filter:{trendGranularity:'week'}}),monthly=createQualityAnalysisRun({...input(),filter:{trendGranularity:'month'}});
 assert.equal(weekly.content.algorithmVersion,'quality-statistics/2');assert.equal(weekly.content.filter.trendGranularity,'week');assert.equal(weekly.content.statistics.trend[0].date,'2026-10-05');assert.equal(monthly.content.statistics.trend[0].date,'2026-10-01');assert.notEqual(weekly.contentHash,monthly.contentHash);
 assert.ok(renderQualityMarkdownReport(weekly,'周分析').includes('## 周趋势'));assert.ok(renderQualityMarkdownReport(monthly,'月分析').includes('## 月趋势'));
 assert.ok(exportQualityStatisticsCsv(weekly).files[0].content.includes('周一开始的周'));assert.ok(exportQualityStatisticsCsv(monthly).files[0].content.includes('2026-10-01'));
});

test('explicit mapping configuration feeds a complete run and blocks incomplete, reused and unbound columns',()=>{
 const config={inspectionsMapping:mapping,rules:{timeZone:'Asia/Shanghai',dateFormat:'yyyy/mm/dd',inspectionTypes:{初检:'initial'}},filter:{trendGranularity:'month'}};
 const defined=defineQualityAnalysisConfiguration(headers,undefined,config),request=input();request.inspections.mapping=defined.inspectionsMapping;request.rules=defined.rules;request.filter=defined.filter;
 const result=createQualityAnalysisRun(request);assert.equal(result.content.statistics.trend[0].date,'2026-10-01');assert.equal(result.content.statistics.summary.inspectedQuantity,100);
 assert.throws(()=>defineQualityAnalysisConfiguration(headers,undefined,{...config,inspectionsMapping:{...mapping,inspectionDate:'id'}}),/同一列/);
 assert.throws(()=>defineQualityAnalysisConfiguration(headers,undefined,{...config,inspectionsMapping:{...mapping,inspectionDate:'missing'}}),/不存在/);
 assert.throws(()=>defineQualityAnalysisConfiguration(headers,undefined,{...config,rules:{...config.rules,timeZone:''}}),/时区/);
 assert.throws(()=>defineQualityAnalysisConfiguration(headers,undefined,{...config,defectsMapping:{}}),/缺陷来源/);
});
