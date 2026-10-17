import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
const require=createRequire(new URL('../../../../apps/web/package.json',import.meta.url));
const {build}=require('esbuild');
const featureRequire=createRequire(new URL('../package.json',import.meta.url));
const React=featureRequire('react');
const layoutRequire=createRequire(featureRequire.resolve('@deepseek-ai/dsh-client-ui-layout/client'));
const rendererRequire=createRequire(layoutRequire.resolve('@deepseek-ai/dsh-client-ui-renderer/client'));
const {renderToStaticMarkup}=rendererRequire('react-dom/server');
const built=await build({stdin:{contents:"export * from './QualityResults';export * from './result-presentation';export * from '../domain/statistics';",resolveDir:fileURLToPath(new URL('../src/client/',import.meta.url)),loader:'tsx'},bundle:true,platform:'node',format:'esm',write:false,
 plugins:[{name:'one-react-owner',setup(builder){builder.onResolve({filter:/^react(?:\/jsx-runtime)?$/},args=>({path:pathToFileURL(featureRequire.resolve(args.path)).href,external:true}));}}]});
const {QualityResults,qualityResultMetrics,qualityResultSourceLabel,calculateQualityStatistics}=await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const inspection=(id,patch={})=>({inspectionId:id,productId:'P1',inspectionDate:'2026-10-10',inspectedQuantity:100,nonconformingQuantity:5,quantityUnit:'piece',inspectionType:'initial',...patch});
const dataset=(inspections,defects=[])=>({sourceNamespace:'fixed-source',complete:true,timeZone:'Asia/Shanghai',inspections,defects});
const normal=()=>calculateQualityStatistics(dataset([inspection('INS-1'),inspection('INS-2',{productId:'P2',inspectionDate:'2026-10-11',inspectedQuantity:200,nonconformingQuantity:10})]));
const render=(statistics,hasDefectSource=false)=>renderToStaticMarkup(React.createElement(QualityResults,{title:'质量分析结果',state:'ready',statistics,hasDefectSource,sourceDescription:'2026-10-10T17:23:45.855Z · 已保存分析'}));

test('normal 300/15 statistics display pass rate first and keep absent defect detail distinct from zero',()=>{
 const result=normal();assert.equal(result.status,'complete');const before=JSON.stringify(result);
 const metrics=qualityResultMetrics(result,false);
 assert.deepEqual(metrics.map(metric=>[metric.label,metric.value]),[['合格率','95.00%'],['检验数量','300'],['不合格数量','15'],['缺陷次数','未提供']]);
 const html=render(result);assert.match(html,/95\.00%/);assert.match(html,/尚未导入缺陷明细/);assert.match(html,/不能据此判断缺陷为零/);
 assert.equal((html.match(/<article class="wd-quality-result-metric(?: wd-quality-result-metric-primary)?"/g)??[]).length,3);
 assert.ok(html.indexOf('合格率')<html.indexOf('检验数量'));assert.match(html,/产品对比/);assert.match(html,/P1/);assert.match(html,/P2/);
 assert.doesNotMatch(html,/Asia\/Shanghai|piece|2026-10-10T17:23/);assert.match(html,/2026\/10\/11 01:23/);
 assert.equal(JSON.stringify(result),before,'rendering never changes the saved statistical snapshot');
});

test('pass-rate presentation preserves the Host weighted ratio rather than averaging products',()=>{
 const result=calculateQualityStatistics(dataset([inspection('A',{nonconformingQuantity:10}),inspection('B',{productId:'P2',inspectedQuantity:900,nonconformingQuantity:0})]));
 assert.equal(result.status,'complete');assert.equal(qualityResultMetrics(result,false)[0].value,'99.00%');assert.match(render(result),/99\.00%/);
});

test('zero denominator stays unavailable in metrics and rendered result instead of showing 100% pass',()=>{
 const result=calculateQualityStatistics(dataset([inspection('ZERO',{inspectedQuantity:0,nonconformingQuantity:0})]));
 assert.equal(result.status,'complete');const metrics=qualityResultMetrics(result,false);
 assert.equal(metrics[0].value,'无法计算');assert.equal(metrics[0].caption,'检验数量为 0，无法计算比例');
 const html=render(result);assert.match(html,/检验数量为 0，无法计算比例/);assert.match(html,/不合格率 无法计算/);assert.doesNotMatch(html,/>100\.00%</);
});

test('provided defect detail displays its independently calculated occurrences and genuine empty detail displays zero',()=>{
 const result=calculateQualityStatistics(dataset([inspection('INS-1')],[{defectId:'D1',inspectionId:'INS-1',defectCode:'SCRATCH',defectLabel:'划伤',occurrences:8}]));
 assert.equal(result.status,'complete');assert.equal(qualityResultMetrics(result,true)[3].value,'8');
 const html=render(result,true);assert.match(html,/划伤/);assert.match(html,/缺陷分布/);assert.match(html,/8 次 · 1 类缺陷/);assert.doesNotMatch(html,/尚未导入缺陷明细/);
 const noDefects=normal();assert.equal(qualityResultMetrics(noDefects,true)[3].value,'0');assert.match(render(noDefects,true),/当前分析范围内没有缺陷记录/);assert.match(render(noDefects,true),/0 次 · 0 类缺陷/);
});

test('unassigned-only product summary remains missing information rather than one product comparison',()=>{
 const result=calculateQualityStatistics(dataset([inspection('UNASSIGNED',{productId:undefined})]));assert.equal(result.status,'complete');assert.equal(result.products[0].productId,null);
 const before=JSON.stringify(result),html=render(result);
 assert.match(html,/未提供产品信息，暂不能按产品比较/);assert.doesNotMatch(html,/aria-label="产品对比"|1 项产品/);assert.equal(JSON.stringify(result),before);
 const mixed=calculateQualityStatistics(dataset([inspection('UNASSIGNED',{productId:undefined}),inspection('NAMED',{productId:'P1',inspectedQuantity:900,nonconformingQuantity:0})]));assert.equal(mixed.status,'complete');
 const mixedHtml=render(mixed);assert.match(mixedHtml,/1 项产品 · 含未标注记录/);assert.match(mixedHtml,/未标注产品/);assert.match(mixedHtml,/P1/);assert.match(mixedHtml,/99\.50%/);
});

test('display uses the actual quantity unit without treating every measurement as pieces',()=>{
 const result=calculateQualityStatistics(dataset([inspection('MASS',{quantityUnit:'kg'})]));assert.equal(result.status,'complete');
 const html=render(result);assert.match(html,/>kg</);assert.match(html,/检验 100 kg · 不合格 5 kg/);assert.doesNotMatch(html,/100 件/);
 const mixed=calculateQualityStatistics(dataset([inspection('MASS',{quantityUnit:'kg'}),inspection('PIECES')]));assert.equal(mixed.status,'blocked');
});

test('empty filtered statistics render business empty states without fabricated trend or products',()=>{
 const result=calculateQualityStatistics(dataset([inspection('INS-1')]),{productIds:['NO_MATCH']});assert.equal(result.status,'complete');
 const html=render(result);assert.match(html,/当前分析范围没有检验记录/);assert.match(html,/当前分析范围没有产品统计/);assert.match(html,/无法计算/);
 assert.doesNotMatch(html,/aria-label="最近最多30个周期的不合格率趋势/);
});

test('blocked statistics show issue count and business row locations without a formal metric or raw issue code',()=>{
 const result=calculateQualityStatistics(dataset([inspection('INVALID',{nonconformingQuantity:101})]));assert.equal(result.status,'blocked');
 const html=render(result);assert.match(html,/数据需要核对/);assert.match(html,/检验数据 · 第 1 条数据/);assert.doesNotMatch(html,/invalid-inspection|aria-label="质量指标"/);
});

test('saved timestamp labels preserve the source suffix and ordinary descriptions unchanged',()=>{
 assert.equal(qualityResultSourceLabel('检验记录：已确认版本','Asia/Shanghai'),'检验记录：已确认版本');
 assert.equal(qualityResultSourceLabel('2026-10-10T17:23:45.855Z · 已保存分析','Asia/Shanghai'),'2026/10/11 01:23 · 已保存分析');
});
