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
const built=await build({stdin:{contents:"export * from './QualityHistoryResult';export * from './QualityInterpretation';export * from './report-document';export * from './run-view';export * from '../runtime/analysis-run';export * from '../runtime/report';export * from '../runtime/interpretation-candidate';",resolveDir:fileURLToPath(new URL('../src/client/',import.meta.url)),loader:'tsx'},bundle:true,platform:'node',format:'esm',write:false,
 plugins:[{name:'one-react-owner',setup(builder){builder.onResolve({filter:/^react(?:\/jsx-runtime)?$/},args=>({path:pathToFileURL(featureRequire.resolve(args.path)).href,external:true}));}}]});
const {QualityHistoryResult,QualityHistoryContent,QualityInterpretation,QualityInterpretationCandidate,QualityReportDocument,qualityReportSections,parseQualityRunView,createQualityAnalysisRun,renderQualityMarkdownReport,readQualityInterpretationCandidate}=await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const mapping={inspectionId:'id',inspectionDate:'date',inspectedQuantity:'total',nonconformingQuantity:'bad',quantityUnit:'unit',inspectionType:'type'};
const run=createQualityAnalysisRun({runId:'saved-run',createdAt:'2026-10-10T17:23:45.855Z',sourceNamespace:'fixed-source',rules:{timeZone:'Asia/Shanghai',dateFormat:'yyyy/mm/dd',inspectionTypes:{初检:'initial'}},inspections:{imported:{sha256:createHash('sha256').update('headless-fixture').digest('hex'),table:{complete:true,encoding:'utf-8',byteLength:16,headers:Object.values(mapping),rows:[['INS-1','2026/10/10','100','5','piece','初检'],['INS-2','2026/10/11','200','10','piece','初检']],locations:[{record:2,line:2},{record:3,line:3}],ignoredBlankRecords:0}},mapping}});
assert.equal(run.status,'complete');
const markdown=renderQualityMarkdownReport(run,'质量分析');
const view=()=>parseQualityRunView({recordId:'record',runId:run.runId,createdAt:run.createdAt,contentHash:run.contentHash,statistics:run.content.statistics,hasDefectSource:false,markdown,reports:[],interpretations:[]},'record',run.runId,run.contentHash,true);
const unused=()=>{throw Error('SSR must not execute controller actions');};
const props=()=>({mode:'summary',view:view(),reading:false,contentHash:run.contentHash,onRetry:unused,onViewReport:unused,onNavigateReport:unused,
 draft:{available:true,busy:false,onOpen:unused,onPreview:unused,onCopy:unused,onClose:unused},
 report:{busy:false,statisticsKind:'trend',statisticsSaved:[],projectId:'',onSave:unused,onDownload:unused,onSaveStatistics:unused,onChooseProject:unused,onLink:unused,onKind:unused,onProject:unused}});
const render=(component,props)=>renderToStaticMarkup(React.createElement(component,props));
function visibleText(html){let hidden=0,output='';for(const match of html.matchAll(/<\/?details\b[^>]*>|<[^>]*>|[^<]+/g)){const token=match[0];if(/^<details\b/.test(token))hidden++;else if(/^<\/details\b/.test(token))hidden--;else if(!hidden&&!token.startsWith('<'))output+=token;}return output;}

test('summary retains fixed statistics with compact actions and puts AI details below the results',()=>{
 const data=props(),before=JSON.stringify(data.view),html=render(QualityHistoryContent,data),visible=visibleText(html);
 assert.match(visible,/95\.00%/);assert.match(visible,/300/);assert.match(visible,/15/);assert.ok(html.indexOf('aria-label="质量指标"')<html.indexOf('wd-quality-ai-summary'));assert.match(visible,/加工报告/);
 assert.doesNotMatch(visible,new RegExp(run.contentHash));assert.match(html,/查看追溯详情/);assert.equal(JSON.stringify(data.view),before);
});
test('missing native draft integration is explicit and does not render a fake AI launch button',()=>{
 const data=props();data.draft.available=false;const html=render(QualityHistoryContent,data);
 assert.match(html,/暂时无法直接打开 AI 对话/);assert.doesNotMatch(html,/>让 AI 解读<\/button>/);assert.match(html,/复制解读提示词/);
});
test('report body is readable by default and saving is primary while CSV and project tools stay secondary',()=>{
 const data=props();data.mode='report';const html=render(QualityHistoryContent,data),visible=visibleText(html);
 assert.match(visible,/质量分析.*质量分析报告/);assert.match(visible,/统计口径与汇总/);assert.match(visible,/报告尚未保存/);assert.match(html,/class="wd-quality-primary"[^>]*>保存报告到资料库/);
 assert.doesNotMatch(visible,/CSV|关联已有项目|数据指纹|内容 SHA-256/);assert.doesNotMatch(html,/展开报告正文|<textarea/);assert.match(visible,/未进行 AI 解读/);
 assert.equal(data.view.markdown,markdown,'read-only presentation preserves the downloadable and saved report');
});
test('confirmed saved receipt changes report status and exposes association inside secondary tools',()=>{
 const receipt={runId:run.runId,contentHash:run.contentHash,sha256:createHash('sha256').update(markdown).digest('hex'),operationId:'saved-report',assetId:'asset',revisionId:'revision',nodeId:'node',format:'markdown',detailKind:'markdown'};
 const checked=parseQualityRunView({...view(),reports:[receipt]},'record',run.runId,run.contentHash,true),data=props();data.mode='report';data.view=checked;data.report.saved=checked.reports[0];
 const html=render(QualityHistoryContent,data);assert.match(visibleText(html),/报告已保存到资料库/);assert.match(html,/disabled=""[^>]*>已保存到资料库/);assert.match(html,/关联已有项目/);assert.doesNotMatch(visibleText(html),/关联已有项目/);
});
test('read-only report structure preserves escaped cells and treats unsupported HTML as literal text',()=>{
 const content='# <script>literal</script>\n\n| 项目 | 结果 |\n| --- | --- |\n| A\\|B | 15 |\n\n<a href="javascript:evil()">literal</a>';
 const sections=qualityReportSections(content);assert.equal(sections.flatMap(section=>section.blocks).find(block=>block.kind==='table').rows[0][0],'A|B');
 const html=render(QualityReportDocument,{markdown:content});assert.match(html,/A\|B/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script|<a href/);assert.match(html,/<table/);
});
test('a completed native reply is read-only and remains a separate candidate until confirmed adoption',()=>{
 const source={recordId:'record',runId:run.runId,contentHash:run.contentHash,sessionId:'session-native'};
 const candidate=readQualityInterpretationCandidate(source,[{seq:0,type:'turn/start',data:{turn:1}},{seq:1,type:'assistant/message',data:{turn:1,message:{content:[{type:'text',text:'核查样本与工艺记录。'}]}}},{seq:2,type:'turn/end',data:{turn:1,reason:{kind:'completed'}}}]);
 const html=render(QualityInterpretationCandidate,{candidate,contentHash:run.contentHash,busy:false,adopted:false,onAdopt:unused});
 assert.match(visibleText(html),/核查样本与工艺记录/);assert.match(visibleText(html),/确认采纳并保存到资料库/);assert.doesNotMatch(visibleText(html),/候选|指纹|session-native/);assert.doesNotMatch(html,/<textarea/);
 const adopted=render(QualityInterpretationCandidate,{candidate,contentHash:run.contentHash,busy:false,adopted:true,onAdopt:unused});assert.match(adopted,/disabled=""[^>]*>已采纳并保存/);
 const receipt={recordId:'record',runId:run.runId,contentHash:run.contentHash,candidateHash:candidate.candidateHash,assetId:'interpretation-asset',revisionId:'interpretation-version',operationId:'quality-interpretation-'+candidate.candidateHash};
 const checked=parseQualityRunView({...view(),interpretations:[receipt]},'record',run.runId,run.contentHash,true);
 const catalog=render(QualityInterpretation,{client:{},recordId:'record',runId:run.runId,contentHash:run.contentHash,receipts:checked.interpretations});
 assert.match(visibleText(catalog),/资料库中的独立成果/);assert.match(visibleText(catalog),/现有统计报告正文保持不变/);assert.doesNotMatch(visibleText(catalog),/interpretation-version/);assert.match(catalog,/1 份已保存/);
});
test('the real history controller starts with a loading state and does not invoke Host or AI while SSR renders',()=>{
 const html=render(QualityHistoryResult,{identityScopeKey:'scope',recordId:'record',runId:run.runId,contentHash:run.contentHash,client:{view:unused},onAiDraft:unused,mode:'report'});
 assert.match(html,/正在读取报告/);assert.doesNotMatch(html,/保存报告到资料库|报告正文|95\.00%/);
});
