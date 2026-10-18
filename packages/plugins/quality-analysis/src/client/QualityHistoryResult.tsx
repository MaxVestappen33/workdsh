import type {QualityFocusSelection} from '../domain/analysis-focus.js';
import {QualityFocusReview} from './QualityFocusReview.js';
import type {QualityExpertDraft} from './QualityExpertTask.js';
import {QualityInterpretation} from './QualityInterpretation.js';
import {createQualityAnalysisInstruction,type QualityAiReportTarget} from './analysis-instruction.js';
import React,{useEffect,useRef,useState} from 'react';
import {QualityResults} from './QualityResults.js';
import {QualityReportDocument} from './report-document.js';
import {QualityReportEditor,type QualityReportDocumentClient} from './QualityReportEditor.js';
import type {QualityReportReceipt} from '../runtime/run-store.js';
import type {createQualityRecordClient} from './record-client.js';
import type {QualityRunView} from './run-view.js';
import type {QualityAiContext} from './ai-context.js';
export interface QualityHistoryResultProps {readonly focusSelection?:QualityFocusSelection;readonly onFocusChange?:(selection:QualityFocusSelection|undefined)=>void;readonly aiContext?:QualityAiContext;readonly onLeaveGuard?:(guard:(()=>boolean)|undefined)=>void;readonly onNavigateReport?:()=>void;readonly onExpertDraft?:QualityExpertDraft;readonly onAiDraft?:(view:QualityRunView,signal:AbortSignal,purpose?:'analysis'|'report'|'focus',report?:QualityAiReportTarget,selection?:QualityFocusSelection)=>Promise<void>;readonly mode?:'summary'|'report';readonly openLibrary?:()=>void;readonly identityScopeKey:string;readonly recordId:string;readonly runId:string;readonly contentHash:string;readonly client:Pick<ReturnType<typeof createQualityRecordClient>,'aiCandidate'|'adoptInterpretation'|'expertSources'|'expertCandidate'|'adoptExpertInterpretation'|'availableExperts'|'prepareExpertTask'|'createExpertTask'|'view'|'focusInspections'|'saveReport'|'saveStatistics'|'projects'|'linkReport'>&QualityReportDocumentClient;}
export function QualityHistoryResult(props:QualityHistoryResultProps){return <ResultBody key={`${props.identityScopeKey}/${props.recordId}/${props.runId}/${props.contentHash}`} {...props}/>;}
function ResultBody({focusSelection,onFocusChange,mode,openLibrary,onNavigateReport,onAiDraft,onExpertDraft,onLeaveGuard,recordId,runId,contentHash,client,aiContext}:QualityHistoryResultProps){
 const leaveGuard=useRef<(()=>boolean)|undefined>(undefined);
 const leaveNotifier=useRef(onLeaveGuard);leaveNotifier.current=onLeaveGuard;
 const registerLeaveGuard=useRef((guard:(()=>boolean)|undefined)=>{leaveGuard.current=guard;leaveNotifier.current?.(guard);}).current;
 const protectedExpertDraft:QualityExpertDraft|undefined=onExpertDraft?async(session,instruction,signal)=>{if(!(leaveGuard.current?.()??true))throw new Error('report/unsaved-edit');await onExpertDraft(session,instruction,signal);}:undefined;
 const saving=useRef<AbortController|undefined>(undefined);
 const currentReceipt=useRef<QualityReportReceipt|undefined>(undefined);
 const linking=useRef<{controller:AbortController;receiptKey:string;projectId:string}|undefined>(undefined);
 const [draftMessage,setDraftMessage]=useState<string>();
 const [draftPreview,setDraftPreview]=useState<string>();
 function previewAnalysis(){if(!result)return;try{setDraftPreview(createQualityAnalysisInstruction(recordId,result));setDraftMessage(undefined);}catch{setDraftPreview(undefined);setDraftMessage('分析上下文超过预算或运行标识不一致，未生成提示词。');}}
 const copying=useRef(false);
 const draftRequest=useRef<AbortController|undefined>(undefined);
 const [draftBusy,setDraftBusy]=useState(false);
 useEffect(()=>()=>{draftRequest.current?.abort();draftRequest.current=undefined;},[]);
 async function openAnalysis(report?:QualityAiReportTarget){if(!result||!onAiDraft||draftRequest.current)return;const request=new AbortController();draftRequest.current=request;setDraftBusy(true);try{await onAiDraft(result,request.signal,mode==='report'?'report':'analysis',report);if(!request.signal.aborted)setDraftMessage('已打开右侧原生对话，请核对当前输入后发送，查看实际执行过程。');}catch{if(!request.signal.aborted)setDraftMessage('对话请求暂未准备好，已有输入保持原状。请核对右侧状态后重试。');}finally{if(draftRequest.current===request){draftRequest.current=undefined;if(!request.signal.aborted)setDraftBusy(false);}}}
 async function copyAnalysis(){if(!result||copying.current)return;copying.current=true;try{await navigator.clipboard.writeText(createQualityAnalysisInstruction(recordId,result));setDraftMessage('提示词已复制，请在原生会话选择模型与需要的能力后发送。尚未执行 AI 解读。');}catch{setDraftMessage('提示词未复制，请核对剪贴板权限；统计过大时不会截断后发送。');}finally{copying.current=false;}}
 const [saved,setSaved]=useState<Awaited<ReturnType<QualityHistoryResultProps['client']['saveReport']>>>(),[saveBusy,setSaveBusy]=useState(false),[saveError,setSaveError]=useState<string>();
 function receiptKey(receipt:QualityReportReceipt|undefined){return receipt?JSON.stringify([receipt.runId,receipt.contentHash,receipt.assetId,receipt.revisionId,receipt.operationId,receipt.sha256,receipt.nodeId,receipt.format,receipt.detailKind]):undefined;}
 function adoptSavedReceipt(receipt:QualityReportReceipt|undefined){
  const changed=receiptKey(currentReceipt.current)!==receiptKey(receipt);currentReceipt.current=receipt;
  if(changed){
   // A reply for the previously displayed fixed version must not acknowledge
   // association of the next version. Cancel only that exact link request;
   // statistics export or a newer request retain their own controller.
   const previous=linking.current;
   if(previous){previous.controller.abort();if(linking.current===previous)linking.current=undefined;if(saving.current===previous.controller){saving.current=undefined;setSaveBusy(false);}}
   setLinked(undefined);
  }
  setSaved(receipt);
 }
 useEffect(()=>()=>saving.current?.abort(),[]);
 async function saveReport(){if(saving.current)return;const controller=new AbortController();saving.current=controller;setSaveBusy(true);setSaveError(undefined);
  try{const receipt=await client.saveReport(recordId,runId,contentHash,'质量分析报告',controller.signal);if(!controller.signal.aborted)adoptSavedReceipt(receipt);}
  catch{if(!controller.signal.aborted)setSaveError('保存结果未确认，可重试同一份报告；系统会复用原成果。');}
  finally{if(saving.current===controller){saving.current=undefined;if(!controller.signal.aborted)setSaveBusy(false);}}
 }
 const [statisticsKind,setStatisticsKind]=useState<'trend'|'products'|'pareto'>('trend'),[statisticsSaved,setStatisticsSaved]=useState<readonly string[]>([]);
 async function saveStatistics(){if(saving.current)return;const controller=new AbortController();saving.current=controller;setSaveBusy(true);setSaveError(undefined);const kind=statisticsKind;
  try{await client.saveStatistics(recordId,runId,contentHash,`质量分析-${{trend:'趋势统计',products:'产品统计',pareto:'缺陷帕累托'}[kind]}-${contentHash.slice(0,12)}`,kind,controller.signal);if(!controller.signal.aborted)setStatisticsSaved(previous=>previous.includes(kind)?previous:[...previous,kind]);}
  catch{if(!controller.signal.aborted)setSaveError('统计表保存未确认，可重试同一份结果。');}
  finally{if(saving.current===controller){saving.current=undefined;if(!controller.signal.aborted)setSaveBusy(false);}}
 }
 function downloadReport(){
  if(!result?.markdown)return;
  const blob=new Blob([result.markdown],{type:'text/markdown;charset=utf-8'}),url=URL.createObjectURL(blob);
  const anchor=document.createElement('a');anchor.href=url;anchor.download=`质量分析报告-${contentHash.slice(0,12)}.md`;
  document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 const [projects,setProjects]=useState<readonly {id:string;name:string}[]>(),[projectId,setProjectId]=useState(''),[linked,setLinked]=useState<string>();
 async function chooseProject(){if(saving.current)return;const controller=new AbortController();saving.current=controller;setSaveBusy(true);setSaveError(undefined);
  try{const rows=await client.projects(controller.signal);if(!controller.signal.aborted){setProjects(rows);setProjectId(rows[0]?.id??'');}}
  catch{if(!controller.signal.aborted)setSaveError('项目列表读取失败，报告仍保留在资料库。');}
  finally{if(saving.current===controller){saving.current=undefined;if(!controller.signal.aborted)setSaveBusy(false);}}
 }
 async function link(){
  const receipt=currentReceipt.current;if(saving.current||!receipt||!projectId)return;
  const controller=new AbortController(),request={controller,receiptKey:receiptKey(receipt)!,projectId};linking.current=request;saving.current=controller;setSaveBusy(true);setSaveError(undefined);
  const ownsResponse=()=>linking.current===request&&saving.current===controller&&!controller.signal.aborted&&receiptKey(currentReceipt.current)===request.receiptKey;
  try{const reference=await client.linkReport(recordId,receipt.operationId,request.projectId,receipt,controller.signal);if(ownsResponse()){if(reference.projectId!==request.projectId)throw Error('unmatched-project-association');setLinked(reference.projectId);}}
  catch{if(ownsResponse())setSaveError('关联结果未确认，报告仍保留；可以重试同一个项目。');}
  finally{if(linking.current===request)linking.current=undefined;if(saving.current===controller){saving.current=undefined;if(!controller.signal.aborted)setSaveBusy(false);}}
 }
 // Editable reports need a fixed analytical basis, not a generated legacy
 // Markdown artifact. An explicit legacy view can still request that artifact.
 const [result,setResult]=useState<QualityRunView>(),[error,setError]=useState<string>(),[reportError,setReportError]=useState<string>(),[wantReport,setWantReport]=useState(false),[attempt,setAttempt]=useState(0),[reading,setReading]=useState(true);
 useEffect(()=>{const controller=new AbortController();setError(undefined);setReportError(undefined);setReading(true);
  void client.view(recordId,runId,contentHash,wantReport,controller.signal).then(view=>{if(!controller.signal.aborted){setResult(view);
   const report=[...(view.reports??[])].reverse().find(item=>item.format==='markdown'&&item.detailKind==='markdown');
   if(report&&mode!=='report'&&!currentReceipt.current)adoptSavedReceipt(report);
   const kinds=(view.reports??[]).filter(item=>item.format==='csv'&&['trend','products','pareto'].includes(item.detailKind??'')).map(item=>item.detailKind!);
   setStatisticsSaved(previous=>[...new Set([...previous,...kinds])]);
  }}).catch(()=>{if(!controller.signal.aborted){if(wantReport)setReportError('报告读取失败，请重试。');else setError('历史分析读取失败，请核对来源或权限。');}}).finally(()=>{if(!controller.signal.aborted)setReading(false);});
  return()=>controller.abort();
 },[client,recordId,runId,contentHash,wantReport,attempt,mode,aiContext?.revision]);
 const reportActions:QualityHistoryContentProps['report']={saved,busy:saveBusy,error:saveError,statisticsKind,statisticsSaved,projects,projectId,linked,onSave:()=>void saveReport(),onDownload:downloadReport,onSaveStatistics:()=>void saveStatistics(),onChooseProject:()=>void chooseProject(),onLink:()=>void link(),onKind:setStatisticsKind,onProject:(id:string)=>{setProjectId(id);setLinked(undefined);}};
 return <QualityHistoryContent onPeriodSelect={onFocusChange?date=>onFocusChange({kind:'period',date}):undefined} selectedPeriod={focusSelection?.kind==='period'?focusSelection.date:undefined}
  focusReview={mode!=='report'&&result&&focusSelection&&onFocusChange?<QualityFocusReview key={JSON.stringify([runId,contentHash,focusSelection])} view={result} selection={focusSelection} client={client} aiContext={aiContext} disabled={draftBusy} onSelect={onFocusChange} onClose={()=>onFocusChange(undefined)} onOpenAi={onAiDraft?async(selection,signal)=>{if(draftRequest.current)throw Error('quality/request-pending');const controller=new AbortController();draftRequest.current=controller;setDraftBusy(true);try{await onAiDraft(result,AbortSignal.any([signal,controller.signal]),'focus',undefined,selection);}finally{if(draftRequest.current===controller){draftRequest.current=undefined;setDraftBusy(false);}}}:undefined}/>:undefined} mode={mode} view={result} reading={reading} error={error} reportError={reportError} contentHash={contentHash} openLibrary={openLibrary} onNavigateReport={onNavigateReport}
  reportEditor={mode==='report'&&result?<QualityReportEditor view={result} client={client} aiDraft={aiContext?.recordId===recordId&&aiContext.runId===runId&&aiContext.contentHash===contentHash?aiContext.reportDraft:undefined} onLeaveGuard={registerLeaveGuard} onSaved={adoptSavedReceipt} onOpenAi={onAiDraft?report=>void openAnalysis(report):undefined} aiBusy={draftBusy} additionalTools={<QualityReportTools view={result} report={reportActions} openLibrary={openLibrary} editable/>}/>:undefined}
  onRetry={()=>setAttempt(value=>value+1)} onViewReport={()=>setWantReport(true)}
  draft={{available:!!onAiDraft,busy:draftBusy,preview:draftPreview,message:draftMessage,onOpen:()=>void openAnalysis(),onPreview:previewAnalysis,onCopy:()=>void copyAnalysis(),onClose:()=>setDraftPreview(undefined)}}
  report={reportActions}
  interpretation={result&&<QualityInterpretation onExpertDraft={protectedExpertDraft} receipts={result.interpretations} client={client} recordId={recordId} runId={runId} contentHash={contentHash} openLibrary={openLibrary}/>}/>;
}

const border='var(--dsw-alias-border-l2, #dce2e9)';
const secondary='var(--dsw-alias-label-secondary, #657185)';
const panel:React.CSSProperties={padding:20,border:`1px solid ${border}`,borderRadius:12,background:'var(--dsw-alias-bg-layer-1, #fff)',minWidth:0};
const text:React.CSSProperties={color:secondary,fontSize:13,lineHeight:1.65,margin:'8px 0 12px'};
const actions:React.CSSProperties={display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'};
export interface QualityHistoryContentProps {readonly onPeriodSelect?:(date:string)=>void;readonly selectedPeriod?:string;readonly focusReview?:React.ReactNode;
 readonly mode?:'summary'|'report';readonly view?:QualityRunView;readonly reading:boolean;readonly error?:string;readonly reportError?:string;readonly contentHash:string;
 readonly openLibrary?:()=>void;readonly onNavigateReport?:()=>void;readonly onRetry:()=>void;readonly onViewReport:()=>void;readonly interpretation?:React.ReactNode;readonly reportEditor?:React.ReactNode;
 readonly draft:{readonly available:boolean;readonly busy:boolean;readonly preview?:string;readonly message?:string;readonly onOpen:()=>void;readonly onPreview:()=>void;readonly onCopy:()=>void;readonly onClose:()=>void};
 readonly report:{readonly saved?:QualityReportReceipt;readonly busy:boolean;readonly error?:string;readonly statisticsKind:'trend'|'products'|'pareto';readonly statisticsSaved:readonly string[];
  readonly projects?:readonly {id:string;name:string}[];readonly projectId:string;readonly linked?:string;readonly onSave:()=>void;readonly onDownload:()=>void;readonly onSaveStatistics:()=>void;readonly onChooseProject:()=>void;readonly onLink:()=>void;readonly onKind:(kind:'trend'|'products'|'pareto')=>void;readonly onProject:(id:string)=>void};
}
/** Read-only presentation receives one verified run and delegates actions to the
 * existing controller. Rendering does not request AI, save or change ownership. */
export function QualityHistoryContent(props:QualityHistoryContentProps){
 const {mode,view,reading,error,reportError,draft,report}=props;
 const delegation=view&&<aside className="wd-quality-analysis-delegation" aria-label="解读本次结果" style={panel}><header style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,flexWrap:'wrap'}}><h3 style={{margin:0,fontSize:16,fontWeight:650}}>解读本次结果</h3>{mode==='report'&&draft.available&&<button className="wd-quality-primary" disabled={draft.busy} onClick={draft.onOpen}>{draft.busy?'正在打开…':'让 AI 解读'}</button>}</header>
  <p style={text}>{draft.available?'打开 AI 对话后发送分析请求，完成后可将建议加入报告。':'暂时无法直接打开 AI 对话，可展开下方说明手动发送分析请求。'}</p>
  <details className="wd-quality-analysis-instruction"><summary>提示词与手动交接</summary><div style={{...actions,marginTop:12}}><button onClick={draft.onPreview}>查看解读提示词</button><button onClick={draft.onCopy}>复制解读提示词</button></div>{draft.preview&&<section aria-label="AI 解读提示词预览"><p style={text}>只含本次运行的统计与标识。发送前请核对数据范围。</p><textarea aria-label="完整 AI 解读提示词" readOnly value={draft.preview} rows={8} style={{width:'100%',boxSizing:'border-box',maxHeight:300}}/><button onClick={draft.onClose}>收起提示词</button></section>}</details>
  {draft.message&&<p role="status" style={text}>{draft.message}</p>}{props.interpretation}
 </aside>;
 const reportReady=mode!=='summary'&&view?.markdown!==undefined;
 return <section aria-label={mode==='report'?'分析报告':'质量分析结果'} className="wd-quality-history-result" style={{display:'grid',gap:16,minWidth:0}}>
  {mode!=='report'&&view&&<header className="wd-quality-results-toolbar"><h2>质量概览</h2><div>{draft.available&&<button disabled={draft.busy} onClick={draft.onOpen}>{draft.busy?'正在打开…':'与 AI 分析'}</button>}{props.onNavigateReport&&<button className="wd-quality-primary" onClick={props.onNavigateReport}>加工报告</button>}</div></header>}
  {mode!=='report'&&draft.message&&<p role="status">{draft.message}</p>}
  {mode!=='report'&&!view&&!error&&<p role="status" className="wd-quality-loading">正在读取分析结果…</p>}
  {mode!=='report'&&view&&!error&&<QualityResults onPeriodSelect={props.onPeriodSelect} selectedPeriod={props.selectedPeriod} title="质量分析结果" state={error?'failed':view?'ready':'running'} statistics={view?.statistics} hasDefectSource={view?.hasDefectSource??false} sourceDescription={view?`${new Date(view.createdAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})} · 已保存分析`:''} error={error}/>}
  {props.focusReview}{mode!=='report'&&view&&<div className="wd-quality-history-next" style={{...actions,justifyContent:'flex-end'}}>{props.onNavigateReport&&<button onClick={props.onNavigateReport}>加工报告</button>}{mode===undefined&&!view.markdown&&<button disabled={reading} onClick={props.onViewReport}>查看报告</button>}</div>}
  {mode!=='report'&&delegation&&<details className="wd-quality-ai-summary"><summary>AI 解读与保存的建议</summary>{delegation}</details>}
  {mode==='report'&&reading&&<p role="status" style={text}>正在读取报告…</p>}
  {(error||reportError)&&<div role="alert" style={panel}><p style={{margin:'0 0 12px'}}>{reportError??error}</p><button disabled={reading} onClick={props.onRetry}>{mode==='report'?'重试读取报告':'重试读取分析结果'}</button></div>}
  {mode==='report'&&view&&!view.markdown&&!props.reportEditor&&!reportError&&!reading&&<section style={panel}><p>报告正文尚未读取。</p><button onClick={props.onViewReport}>读取报告</button></section>}
  {props.reportEditor}
  {reportReady&&!props.reportEditor&&<>
   <header className="wd-quality-report-header" style={{...actions,justifyContent:'space-between'}}><div><h2 style={{margin:0,fontSize:18,fontWeight:650}}>分析报告</h2><p role="status" style={text}>{report.saved?'报告已保存到资料库，可随时查阅。':'报告尚未保存；保存后形成资料库中的固定版本。'}<br/>AI 解读另存为独立成果。</p></div><div style={actions}><button onClick={report.onDownload}>下载报告</button><button className="wd-quality-primary" disabled={report.busy||!!report.saved} onClick={report.onSave}>{report.saved?'已保存到资料库':report.busy?'正在处理…':'保存报告到资料库'}</button></div></header>
   {report.error&&<p role="alert">{report.error}</p>}
   <div className="wd-quality-report-paper" style={{...panel,padding:28}}><QualityReportDocument markdown={view!.markdown!}/></div>
  </>}
  {(reportReady||props.reportEditor)&&view&&<>
   {props.reportEditor&&report.error&&<p role="alert">{report.error}</p>}
   {!props.reportEditor&&<QualityReportTools view={view} report={report} openLibrary={props.openLibrary}/>}

   {!props.reportEditor&&<details className="wd-quality-report-ai"><summary>需要进一步解读报告数据？</summary><div style={{marginTop:12}}>{delegation}</div></details>}
  </>}
  {view&&<details className="wd-quality-history-identity" style={{color:secondary,fontSize:12}}><summary>查看追溯详情</summary><dl style={{overflowWrap:'anywhere'}}><dt>分析运行</dt><dd>{view.runId}</dd><dt>数据指纹</dt><dd>{props.contentHash}</dd></dl></details>}
 </section>;
}

function QualityReportTools({view,report,openLibrary,editable=false}:{view:QualityRunView;report:QualityHistoryContentProps['report'];openLibrary?:()=>void;editable?:boolean}){return <>   <details className="wd-quality-report-tools" style={panel}><summary>导出统计表与关联项目</summary><div style={{...actions,marginTop:14}}><select aria-label="统计表类型" value={report.statisticsKind} disabled={report.busy} onChange={event=>report.onKind(event.currentTarget.value as 'trend'|'products'|'pareto')}><option value="trend">趋势统计</option><option value="products">产品统计</option>{view.hasDefectSource&&<option value="pareto">缺陷帕累托</option>}</select><button disabled={report.busy||report.statisticsSaved.includes(report.statisticsKind)} onClick={report.onSaveStatistics}>{report.statisticsSaved.includes(report.statisticsKind)?'统计表已保存':'保存 CSV 统计表到资料库'}</button>{report.saved&&<button disabled={report.busy} onClick={report.onChooseProject}>关联已有项目</button>}{openLibrary&&(report.saved||report.statisticsSaved.length>0)&&<button onClick={openLibrary}>在资料库查看成果</button>}</div>
    {report.saved&&report.projects&&<div style={{marginTop:14}}><div style={actions}><select aria-label="选择报告关联项目" value={report.projectId} disabled={report.busy} onChange={event=>report.onProject(event.currentTarget.value)}>{report.projects.length?report.projects.map(project=><option key={project.id} value={project.id}>{project.name}</option>):<option value="">暂无可关联项目</option>}</select><button disabled={report.busy||!report.projectId||report.linked===report.projectId} onClick={report.onLink}>{report.linked===report.projectId?'已关联':'确认关联'}</button></div><p style={text}>{editable?'关联的是当前已读取的保存版本；尚未保存的文字不包含在引用中。':'项目保存报告引用，原报告仍由资料库管理。'}</p></div>}
   </details></>;}
