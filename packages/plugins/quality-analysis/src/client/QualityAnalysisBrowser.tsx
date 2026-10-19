import type {QualityFocusSelection} from '../domain/analysis-focus.js';
import type {QualityExpertDraft} from './QualityExpertTask.js';
import React,{useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {qualityWorkbenchStyles} from './workbench-styles.js';
import {QualityRecordWorkflow,type QualityRecordWorkflowProps} from './QualityRecordWorkflow.js';
import {QualityRecords} from './QualityRecords.js';
import {QualityHistory,type QualityHistoryLoadState} from './QualityHistory.js';
import {QualityHistoryResult} from './QualityHistoryResult.js';
import {QualityDrawer} from './QualityDrawer.js';
import {QualityRecordController} from './record-controller.js';
import type {createQualityRecordClient,QualityRecordDetail,QualityRunSummary} from './record-client.js';
import {qualityAiUpdateMatchesSelection,type QualityAiContext} from './ai-context.js';
export interface QualityNavigation {readonly recordId:string;readonly tab:'overview'|'data'|'reports';}
export interface QualityAnalysisBrowserProps {readonly identityScopeKey:string;readonly client:ReturnType<typeof createQualityRecordClient>;readonly onExpertDraft?:QualityExpertDraft;readonly onAiDraft?: (view:import('./run-view.js').QualityRunView,signal:AbortSignal,purpose?:'analysis'|'report'|'focus',report?:import('./analysis-instruction.js').QualityAiReportTarget,selection?:QualityFocusSelection)=>Promise<void>;readonly aiContext?:QualityAiContext;readonly conversationOpen?:boolean;readonly onOpenConversation?:()=>void;readonly onCloseConversation?:()=>void;readonly onBeforeRecordChange?:()=>boolean;readonly library?:Pick<QualityRecordWorkflowProps,'management'|'openLibrary'|'previewRegistry'|'openOriginal'|'originalRevisionSaved'>;readonly initialNavigation?:QualityNavigation;readonly onNavigation?:(navigation:QualityNavigation)=>void;}
export function QualityAnalysisBrowser(props:QualityAnalysisBrowserProps){return <BrowserBody key={props.identityScopeKey} {...props}/>;}
function BrowserBody({identityScopeKey,client,library,onAiDraft,onExpertDraft,initialNavigation,onNavigation,aiContext,conversationOpen,onOpenConversation,onCloseConversation,onBeforeRecordChange}:QualityAnalysisBrowserProps){
 const owner=useMemo(()=>({controller:new QualityRecordController(client),active:false}),[client]);
 const [tab,setTab]=useState<'overview'|'data'|'cleaning'|'tasks'|'reports'|'settings'>(initialNavigation?.tab??'overview');
 const resume=useRef(initialNavigation);
 const [record,setRecord]=useState<QualityRecordDetail>(),[run,setRun]=useState<Pick<QualityRunSummary,'runId'|'contentHash'>>();
 const [focus,setFocus]=useState<{runId:string;contentHash:string;selection:QualityFocusSelection}>();
 const [recordsOpen,setRecordsOpen]=useState(false),[historyOpen,setHistoryOpen]=useState(false),[settingsOpen,setSettingsOpen]=useState(false);
 const [history,setHistory]=useState<QualityHistoryLoadState>();
 const [pendingAiResult,setPendingAiResult]=useState<QualityAiContext>();
 const lastAiResult=useRef<{runId:string;contentHash:string}|undefined>(undefined);
 const lastAiRevision=useRef<string|undefined>(undefined);
 const leaveGuard=useRef<(()=>boolean)|undefined>(undefined);
 const registerLeaveGuard=useCallback((guard:(()=>boolean)|undefined)=>{leaveGuard.current=guard;},[]);
 const dataLeaveGuard=useRef<(()=>boolean)|undefined>(undefined);
 const registerDataLeaveGuard=useCallback((guard:(()=>boolean)|undefined)=>{dataLeaveGuard.current=guard;},[]);
 const mayLeave=()=>leaveGuard.current?.()??true;
 function changeTab(next:typeof tab){if(next!==tab&&mayLeave()){setTab(next);setSettingsOpen(false);}}
 function selectRun(next:Pick<QualityRunSummary,'runId'|'contentHash'>){if(owner.active&&(next.runId===run?.runId&&next.contentHash===run?.contentHash||mayLeave())){setRun(next);setHistoryOpen(false);lastAiResult.current=undefined;setPendingAiResult(undefined);}}
 useEffect(()=>{
  if(!record||!aiContext)return;
  const revision=`${aiContext.sessionId}/${aiContext.revision}`;
  if(lastAiRevision.current===revision)return;
  if(!qualityAiUpdateMatchesSelection(aiContext,record.id,run,lastAiResult.current))return;
  lastAiRevision.current=revision;
  if(run?.runId===aiContext.runId&&run.contentHash===aiContext.contentHash){lastAiResult.current={runId:aiContext.runId,contentHash:aiContext.contentHash};return;}
  if(tab==='reports'){setPendingAiResult(aiContext);return;}
  const next={runId:aiContext.runId,contentHash:aiContext.contentHash};lastAiResult.current=next;setRun(next);
 },[aiContext,record?.id,run,tab]);
 useEffect(()=>{
  owner.active=true;setRecord(undefined);setRun(undefined);setFocus(undefined);setHistory(undefined);
  return()=>{owner.active=false;owner.controller.cancel();queueMicrotask(()=>{if(!owner.active)owner.controller.dispose();});};
 },[owner]);
 useEffect(()=>{if(record)onNavigation?.({recordId:record.id,tab:tab==='reports'?'reports':tab==='overview'?'overview':'data'});},[record?.id,tab,onNavigation]);
 function open(next:QualityRecordDetail){if(!owner.active)return;if(next.id===record?.id){setRecord(next);setRecordsOpen(false);return;}if(onBeforeRecordChange?.()===false||!mayLeave()||!(dataLeaveGuard.current?.()??true))return;setRecord(next);setRun(undefined);setFocus(undefined);setHistory(undefined);lastAiResult.current=undefined;lastAiRevision.current=undefined;setPendingAiResult(undefined);setTab(resume.current?.recordId===next.id?resume.current.tab:next.configuration?'overview':'data');resume.current=undefined;setRecordsOpen(false);setHistoryOpen(false);}
 const focusSelection=focus?.runId===run?.runId&&focus?.contentHash===run?.contentHash?focus?.selection:undefined;
 const selectFocus=(selection:QualityFocusSelection|undefined)=>{if(!run)return;setFocus(selection?{...run,selection}:undefined);};
 const focusRequest=useRef<AbortController|undefined>(undefined);
 const current=useRef({recordId:record?.id,generation:record?.generation,sourceSnapshotId:record?.configuration?.sourceSnapshotId,run,tab});current.current={recordId:record?.id,generation:record?.generation,sourceSnapshotId:record?.configuration?.sourceSnapshotId,run,tab};
 useEffect(()=>()=>focusRequest.current?.abort(),[record?.id,record?.generation,record?.configuration?.sourceSnapshotId,run?.runId,run?.contentHash]);
 async function focusInspection(inspectionId:string,sourceHash:string){
  if(!record||!run||focusRequest.current)throw Error('quality/focus/no-run');
  const captured=current.current,controller=new AbortController();focusRequest.current=controller;
  try{const view=await client.view(record.id,run.runId,run.contentHash,false,controller.signal);controller.signal.throwIfAborted();
   const now=current.current;if(now.recordId!==captured.recordId||now.generation!==captured.generation||now.sourceSnapshotId!==captured.sourceSnapshotId||now.run?.runId!==captured.run?.runId||now.run?.contentHash!==captured.run?.contentHash||now.tab!==captured.tab||view.basis?.sources.inspections.sha256!==sourceHash)throw Error('quality/focus/source-changed');
   await client.focusInspections(view.recordId,view.runId,view.contentHash,{kind:'inspection',inspectionId},0,controller.signal);controller.signal.throwIfAborted();
   const after=current.current;if(after.recordId!==now.recordId||after.generation!==now.generation||after.sourceSnapshotId!==now.sourceSnapshotId||after.run?.runId!==now.run?.runId||after.run?.contentHash!==now.run?.contentHash||after.tab!==now.tab)throw Error('quality/focus/record-changed');
   setFocus({...run,selection:{kind:'inspection',inspectionId}});setTab('overview');
  }finally{if(focusRequest.current===controller)focusRequest.current=undefined;}
 }
 const currentHistory=history?.recordId===record?.id?history:undefined;
 const loading=!currentHistory||currentHistory.busy;
 const dataTab=['data','cleaning','tasks','settings'].includes(tab);
 const openLibrary=library?()=>{if(mayLeave()&&(dataLeaveGuard.current?.()??true))library.openLibrary();}:undefined;
 const recordPicker=<QualityRecords identityScopeKey={identityScopeKey} controller={owner.controller} onOpen={open} initialRecordId={initialNavigation?.recordId}/>;
 return <main className="wd-quality" aria-label="质量分析工作台">
  <style>{qualityWorkbenchStyles}</style>
  <header className="wd-quality-app-header"><div className="wd-quality-app-title"><span className="wd-quality-app-mark" aria-hidden="true">▥</span><h1>质量分析</h1>{record&&<button className="wd-quality-context" aria-haspopup="dialog" aria-expanded={recordsOpen} onClick={()=>setRecordsOpen(true)} title={record.title}>{record.title}<span aria-hidden="true">⌄</span></button>}</div>
   {record&&<div className="wd-quality-app-actions">{conversationOpen?<button className="wd-quality-text-button" onClick={onCloseConversation}>收起对话</button>:onOpenConversation&&aiContext?.recordId===record.id&&aiContext.runId===run?.runId&&aiContext.contentHash===run?.contentHash&&<button className="wd-quality-text-button" onClick={onOpenConversation}>继续对话</button>}<button className="wd-quality-text-button" aria-haspopup="dialog" onClick={()=>setHistoryOpen(true)}>分析历史</button><div className="wd-quality-more"><button aria-expanded={settingsOpen} onClick={()=>setSettingsOpen(value=>!value)}>更多 ···</button>{settingsOpen&&<div className="wd-quality-more-menu"><button onClick={()=>{setSettingsOpen(false);setRecordsOpen(true);}}>切换或新建分析</button><button onClick={()=>changeTab('settings')}>分析设置</button></div>}</div></div>}
  </header>
  <QualityDrawer open={recordsOpen||!record} inline={!record} title="我的分析" onClose={()=>setRecordsOpen(false)}>{!record&&<div className="wd-quality-start-heading"><h2>从一份检验表开始</h2><p>创建分析，导入检验数据，再查看趋势并生成报告。</p></div>}{recordPicker}</QualityDrawer>
  {record&&<section aria-label="当前分析记录">
   <QualityDrawer open={historyOpen} title="分析历史" onClose={()=>setHistoryOpen(false)}><QualityHistory selectLatestOnLoad={!run} identityScopeKey={identityScopeKey} recordId={record.id} client={client} onSelect={selectRun} onLoadState={setHistory}/></QualityDrawer>
   <nav aria-label="质量业务模块" className="wd-quality-module-nav">{([['overview','分析总览'],['data','检验数据'],['reports','报告']] as const).map(([key,label])=><button key={key} aria-current={tab===key||(key==='data'&&dataTab)?'page':undefined} onClick={()=>changeTab(key)}>{label}</button>)}</nav>
   <div className="wd-quality-page-content">
    {aiContext?.selectedFocus&&aiContext.recordId===record.id&&aiContext.runId===run?.runId&&aiContext.contentHash===run?.contentHash&&<p style={{fontSize:12,color:'var(--dsw-alias-label-secondary,#657185)'}}>AI 当前关注：<button className="wd-quality-text-button" onClick={()=>{if(!mayLeave()||!(dataLeaveGuard.current?.()??true))return;selectFocus(aiContext.selectedFocus);setTab('overview');}}>{aiContext.selectedFocus.kind==='inspection'?`检验记录 ${aiContext.selectedFocus.inspectionId}`:`${aiContext.selectedFocus.date.replaceAll('-','/')} 的检验记录`}</button></p>}
    {pendingAiResult&&<div className="wd-quality-ai-result-notice" role="status">AI 已完成新的分析。<button onClick={()=>{if(!mayLeave())return;const next={runId:pendingAiResult.runId,contentHash:pendingAiResult.contentHash};lastAiResult.current=next;setRun(next);setTab('overview');setPendingAiResult(undefined);}}>查看分析结果</button></div>}
    {library?<div hidden={!dataTab}><QualityRecordWorkflow active={dataTab} identityScopeKey={identityScopeKey} record={record} client={client} {...library} openLibrary={openLibrary!}
     onInspectionFocus={run?focusInspection:undefined} onLeaveGuard={registerDataLeaveGuard} onRecordChanged={next=>{if(owner.active&&next.id===record.id)setRecord(next);}} view={dataTab?tab as 'data'|'cleaning'|'tasks'|'settings':'data'} onNavigate={next=>{if(owner.active)changeTab(next);}} onBlocked={()=>{if(owner.active)changeTab('cleaning');}} onRun={next=>{if(owner.active&&mayLeave()){setRun(next);setTab('overview');}}}/></div>:dataTab&&<section className="wd-quality-empty"><h2>暂时无法打开检验资料</h2><p>资料库服务尚未就绪，请稍后重新打开工作台。</p></section>}
    {(tab==='overview'||tab==='reports')&&<>
     {run?<QualityHistoryResult focusSelection={focusSelection} onFocusChange={selectFocus} key={`${run.runId}/${tab}`} onLeaveGuard={registerLeaveGuard} mode={tab==='reports'?'report':'summary'} onNavigateReport={()=>changeTab('reports')} aiContext={aiContext} onAiDraft={onAiDraft?async(view,signal,purpose,report,selection)=>{await onAiDraft(view,signal,purpose,report,selection);}:undefined} onExpertDraft={onExpertDraft?async(session,instruction,signal)=>{if(!(dataLeaveGuard.current?.()??true))throw new Error('quality/unsaved-data');await onExpertDraft(session,instruction,signal);}:undefined} openLibrary={openLibrary} identityScopeKey={identityScopeKey} recordId={record.id} runId={run.runId} contentHash={run.contentHash} client={client}/>:loading?<section className="wd-quality-empty" role="status"><h2>正在读取分析结果…</h2></section>:currentHistory?.error?<section className="wd-quality-empty" role="alert"><h2>暂时无法读取分析结果</h2><p>{currentHistory.error}</p><button onClick={()=>setHistoryOpen(true)}>重试读取</button></section>:<section className="wd-quality-empty"><span className="wd-quality-empty-mark" aria-hidden="true">▥</span><h2>{record.configuration?'数据已准备好，开始第一次分析':'先导入检验数据'}</h2><p>{record.configuration?'分析完成后，这里会展示合格率和检验趋势。':'支持 CSV 和 Excel。导入后确认数据列，再开始分析。'}</p><button className="wd-quality-primary" disabled={!library} onClick={()=>changeTab('data')}>{record.configuration?'查看数据并开始分析':'导入检验数据'}</button></section>}
    </>}
   </div>
  </section>}
 </main>;
}
