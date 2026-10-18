import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';

const require=createRequire(new URL('../../../../apps/web/package.json',import.meta.url));
const {build}=require('esbuild');
const featureRequire=createRequire(new URL('../package.json',import.meta.url));
const React=featureRequire('react');
const layoutRequire=createRequire(featureRequire.resolve('@deepseek-ai/dsh-client-ui-layout/client'));
const rendererRequire=createRequire(layoutRequire.resolve('@deepseek-ai/dsh-client-ui-renderer/client'));
const {renderToStaticMarkup}=rendererRequire('react-dom/server');
const built=await build({stdin:{contents:"export * from './QualityReportEditor';export * from './QualityHistoryResult';export * from './report-editor-state';export * from './run-view';export * from '../runtime/analysis-run';",resolveDir:fileURLToPath(new URL('../src/client/',import.meta.url)),loader:'tsx'},bundle:true,platform:'node',format:'esm',write:false,
 plugins:[{name:'one-react-owner',setup(builder){builder.onResolve({filter:/^react(?:\/jsx-runtime)?$/},args=>({path:pathToFileURL(featureRequire.resolve(args.path)).href,external:true}));}}]});
const {QualityReportEditor,QualityReportPaper,QualityHistoryContent,reportDocumentMatchesRun,reportFieldsEqual,reportSaveInput,reportSaveReadbackMatches,parseQualityRunView,createQualityAnalysisRun}=await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const hash=value=>createHash('sha256').update(value).digest('hex');
const mapping={inspectionId:'id',inspectionDate:'date',inspectedQuantity:'total',nonconformingQuantity:'bad',quantityUnit:'unit',inspectionType:'type'};
const run=createQualityAnalysisRun({runId:'report-fixed-run',createdAt:'2026-10-10T17:23:45.855Z',sourceNamespace:'report-test-source',rules:{timeZone:'Asia/Shanghai',dateFormat:'yyyy/mm/dd',inspectionTypes:{初检:'initial'}},inspections:{imported:{sha256:hash('report-fixture'),table:{complete:true,encoding:'utf-8',byteLength:16,headers:Object.values(mapping),rows:[['INS-1','2026/10/10','100','5','piece','初检'],['INS-2','2026/10/11','200','10','piece','初检']],locations:[{record:2,line:2},{record:3,line:3}],ignoredBlankRecords:0}},mapping}});
assert.equal(run.status,'complete');
const view=parseQualityRunView({recordId:'record',runId:run.runId,createdAt:run.createdAt,contentHash:run.contentHash,statistics:run.content.statistics,hasDefectSource:false,reports:[],interpretations:[]},'record',run.runId,run.contentHash,false);
const fields=()=>({title:'质量报告',analysis:' 第一行\n第二行\t保留空格 ',conclusion:'核查样本后再确定原因。',recommendations:'复核检验记录。'});
function document(){
 const markdown='# 质量报告\n\n300 / 15 / 95.00%\n',sha256=hash(markdown);
 return {reportId:'report-1',recordId:view.recordId,runId:view.runId,contentHash:view.contentHash,fields:fields(),revisionId:'library-revision-1',currentRevisionId:'library-revision-1',version:1,
 versions:[{version:1,revisionId:'library-revision-1',sha256,operationId:'business-create',createdAt:run.createdAt,title:'质量报告'}],markdown,
 receipt:{runId:view.runId,contentHash:view.contentHash,sha256,operationId:'host-library-operation',assetId:'asset-1',revisionId:'library-revision-1',nodeId:'node-1',format:'markdown',detailKind:'markdown'}};
}
const render=(component,props)=>renderToStaticMarkup(React.createElement(component,props));
const unused=()=>{throw Error('Rendering must not execute Host actions');};

test('report text has exact dirty equality, preserves body whitespace, and rejects oversized or unsafe fields',()=>{
 const input=fields(),before=structuredClone(input),saved=reportSaveInput({...input,title:'  质量报告  '},'same-operation');
 assert.equal(saved.fields.title,'质量报告');assert.equal(saved.fields.analysis,input.analysis);assert.deepEqual(input,before);
 assert.ok(reportFieldsEqual(input,{...input}));assert.equal(reportFieldsEqual(input,{...input,analysis:input.analysis+' '}),false);
 assert.throws(()=>reportSaveInput({...input,title:' '},'save'));
 assert.throws(()=>reportSaveInput({...input,analysis:'汉'.repeat(4100)},'save'),/size-limit/);
 assert.throws(()=>reportSaveInput({...input,conclusion:'bad\u0000text'},'save'),/invalid-fields/);
 assert.throws(()=>reportSaveInput({...input,recommendations:'\ud800'},'save'),/invalid-fields/);
});
test('only a report from the exact record, saved run, and fixed Library version can be adopted',()=>{
 const saved=document();assert.ok(reportDocumentMatchesRun(saved,view));
 for(const changed of [{recordId:'other'},{runId:'other'},{contentHash:hash('other')},{receipt:{...saved.receipt,revisionId:'other'}},{versions:[{...saved.versions[0],sha256:hash('other')}]},{fields:{...saved.fields,title:'other'}}]){
  assert.equal(reportDocumentMatchesRun({...saved,...changed},view),false);
 }
});
test('readback must match submitted fields and exact receipt, while no-change saves may reuse the original operation',()=>{
 const saved=document(),input=reportSaveInput(fields(),'retry-business-operation',saved),readback=structuredClone(saved);
 assert.ok(reportSaveReadbackMatches(saved,readback,input,view),'Host Library operation and creating business operation may differ from a no-change retry');
 assert.equal(reportSaveReadbackMatches(saved,{...readback,fields:{...readback.fields,conclusion:'different'}},input,view),false);
 assert.equal(reportSaveReadbackMatches(saved,{...readback,markdown:readback.markdown+'changed'},input,view),false);
 assert.equal(reportSaveReadbackMatches(saved,{...readback,receipt:{...readback.receipt,assetId:'other'}},input,view),false);
 assert.equal(reportSaveReadbackMatches(saved,readback,{...input,reportId:'other'},view),false);
});
test('historical versions can be viewed but cannot supply an update base; concurrent newer versions do not invalidate a fixed save readback',()=>{
 const saved=document(),input=reportSaveInput(fields(),'save-operation',saved),old={...saved,currentRevisionId:'library-revision-2'};
 assert.ok(reportDocumentMatchesRun(old,view));assert.throws(()=>reportSaveInput(fields(),'save-operation',old),/最新版/);
 assert.ok(reportSaveReadbackMatches(saved,old,input,view),'Confirmation concerns the saved fixed version, even when current pointer has advanced');
});
test('paper renders readonly fixed statistics and trend, escapes user text, and distinguishes missing defects from zero',()=>{
 const before=JSON.stringify(view),html=render(QualityReportPaper,{view,fields:{...fields(),analysis:'<script>alert(1)</script>\n下一行'}});
 assert.match(html,/300/);assert.match(html,/15/);assert.match(html,/95\.00%/);assert.match(html,/未提供明细/);assert.match(html,/不合格率趋势/);
 assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script|<input|<textarea/);assert.equal(JSON.stringify(view),before);
 assert.match(html,/不合格率 · 检验日期/);
 for(const [granularity,label,start] of [['week','周起始日期（周一）','2026/10/05'],['month','月起始日期','2026/10/01']]){
  const grouped=createQualityAnalysisRun({runId:`report-${granularity}-run`,createdAt:run.createdAt,sourceNamespace:run.content.dataset.sourceNamespace,rules:run.content.rules,inspections:run.content.sources.inspections,filter:{trendGranularity:granularity}});
  assert.equal(grouped.status,'complete');
  const groupedView=parseQualityRunView({recordId:'record',runId:grouped.runId,createdAt:grouped.createdAt,contentHash:grouped.contentHash,statistics:grouped.content.statistics,hasDefectSource:false,reports:[],interpretations:[]},'record',grouped.runId,grouped.contentHash,false);
  const snapshot=JSON.stringify(groupedView),paper=render(QualityReportPaper,{view:groupedView,fields:fields()});
  assert.ok(paper.includes(`不合格率 · ${label}`));assert.ok(paper.includes(start));assert.doesNotMatch(paper,/不合格率 · 检验日期/);assert.equal(JSON.stringify(groupedView),snapshot);
  assert.equal(groupedView.statistics.summary.inspectedQuantity,300);assert.equal(groupedView.statistics.summary.nonconformingQuantity,15);
 }
});
test('actual editor starts protected before reading and actual report slot replaces legacy save/body, retaining independent AI and secondary tools',()=>{
 const editor=render(QualityReportEditor,{view,client:{reportDocuments:unused,reportDocument:unused,saveReportDocument:unused}});
 assert.match(editor,/正在打开报告/);assert.doesNotMatch(editor,/<fieldset|<textarea|报告纸张预览/);assert.match(editor,/<button[^>]+disabled/);
 const html=render(QualityHistoryContent,{mode:'report',view,reading:false,contentHash:view.contentHash,onRetry:unused,onViewReport:unused,reportEditor:React.createElement('div',{'data-report-editor':'actual-slot'},'实际报告编辑器'),
 draft:{available:true,busy:false,onOpen:unused,onPreview:unused,onCopy:unused,onClose:unused},
 report:{busy:false,statisticsKind:'trend',statisticsSaved:[],projectId:'',onSave:unused,onDownload:unused,onSaveStatistics:unused,onChooseProject:unused,onLink:unused,onKind:unused,onProject:unused}});
 assert.match(html,/data-report-editor="actual-slot"/);assert.doesNotMatch(html,/保存 CSV 统计表|需要进一步解读|提示词与手动交接/);assert.doesNotMatch(html,/保存报告到资料库|报告正文尚未读取/);
});
