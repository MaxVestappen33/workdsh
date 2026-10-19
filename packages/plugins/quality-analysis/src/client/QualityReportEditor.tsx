import React,{useEffect,useRef,useState} from 'react';
import type {QualityReportDocumentSummary,QualityReportDocumentView,QualityReportFields,QualitySaveReportDocumentInput} from '../domain/report-document.js';
import type {QualityReportDraftSummary,QualityReportDraftView,QualitySaveReportDraftInput} from '../domain/report-draft.js';
import type {QualityReportReceipt} from '../runtime/run-store.js';
import type {QualityRunView} from './run-view.js';
import type {QualityInterpretationCandidate} from '../runtime/interpretation-candidate.js';
import type {QualityExpertAssociation} from '../runtime/expert-association.js';
import {appendReportAnalysisCandidate,reportCandidateMatchesRun,reportCandidatesEqual} from './report-candidate.js';
import {QualityTrendChart} from './QualityTrendChart.js';
import {qualityCount,qualityPercentage,qualityResultSourceLabel} from './result-presentation.js';
import {initialReportFields,reportDocumentMatchesRun,reportDraftArchiveReadbackMatches,reportDraftMatchesRun,reportDraftParentMatches,reportDraftReadbackMatches,reportDraftSaveInput,reportFieldsEqual,reportSaveInput,reportSaveReadbackMatches} from './report-editor-state.js';
import {reportEditorStyles} from './report-editor-styles.js';
import type {QualityAiReportTarget} from './analysis-instruction.js';

export interface QualityReportDocumentClient {
 reportDocuments:(recordId:string,runId:string,contentHash:string,signal?:AbortSignal)=>Promise<readonly QualityReportDocumentSummary[]>;
 reportDocument:(recordId:string,runId:string,contentHash:string,reportId:string,revisionId?:string,signal?:AbortSignal)=>Promise<QualityReportDocumentView>;
 saveReportDocument:(recordId:string,runId:string,contentHash:string,input:QualitySaveReportDocumentInput,signal?:AbortSignal)=>Promise<QualityReportDocumentView>;
 reportDrafts?:(recordId:string,runId:string,contentHash:string,signal?:AbortSignal)=>Promise<readonly QualityReportDraftSummary[]>;
 reportDraft?:(recordId:string,runId:string,contentHash:string,draftId:string,signal?:AbortSignal)=>Promise<QualityReportDraftView>;
 saveReportDraft?:(recordId:string,runId:string,contentHash:string,input:QualitySaveReportDraftInput,signal?:AbortSignal)=>Promise<QualityReportDraftView>;
 archiveReportDraft?:(recordId:string,runId:string,contentHash:string,draftId:string,expectedDraftRevision:string,operationId:string,signal?:AbortSignal)=>Promise<QualityReportDraftView>;
 aiCandidate?:(recordId:string,runId:string,contentHash:string,signal?:AbortSignal)=>Promise<QualityInterpretationCandidate|null>;
 expertSources?:(recordId:string,runId:string,contentHash:string,signal?:AbortSignal)=>Promise<readonly QualityExpertAssociation[]>;
 expertCandidate?:(association:QualityExpertAssociation,signal?:AbortSignal)=>Promise<QualityInterpretationCandidate|null>;
}
export interface QualityReportEditorProps {
 readonly view:QualityRunView;readonly client:QualityReportDocumentClient;
 readonly onSaved?:(receipt:QualityReportReceipt|undefined)=>void;
 readonly onLeaveGuard?:(guard:(()=>boolean)|undefined)=>void;
 readonly onOpenAi?:(report?:QualityAiReportTarget)=>void;readonly aiBusy?:boolean;
 readonly aiDraft?:QualityReportDraftSummary;
 readonly additionalTools?:React.ReactNode;
}

export function QualityReportEditor(props:QualityReportEditorProps){
 return <ReportEditorBody key={`${props.view.recordId}/${props.view.runId}/${props.view.contentHash}`} {...props}/>;
}
function ReportEditorBody({view,client,onSaved,onLeaveGuard,onOpenAi,aiBusy,additionalTools,aiDraft}:QualityReportEditorProps){
 const [documents,setDocuments]=useState<readonly QualityReportDocumentSummary[]>([]),[document,setDocument]=useState<QualityReportDocumentView>();
 const [fields,setFields]=useState<QualityReportFields>(initialReportFields),[baseline,setBaseline]=useState<QualityReportFields>(initialReportFields);
 const [drafts,setDrafts]=useState<readonly QualityReportDraftSummary[]>([]),[draft,setDraft]=useState<QualityReportDraftView>(),[confirmedDraftFields,setConfirmedDraftFields]=useState<QualityReportFields>();
 const [consumedAiDraft,setConsumedAiDraft]=useState<{draftId:string;draftRevision:string}>();
 const [draftError,setDraftError]=useState<string>(),[draftRetry,setDraftRetry]=useState(false),[parentMismatch,setParentMismatch]=useState(false);
 const [editing,setEditing]=useState(false),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[operation,setOperation]=useState<'read'|'save'|'draft-read'|'draft-save'|'draft-archive'|'candidate-read'|'candidate-use'|'candidate-sources'>('read');
 const [moreOpen,setMoreOpen]=useState(false),[assistantOpen,setAssistantOpen]=useState(false);
 const [candidate,setCandidate]=useState<QualityInterpretationCandidate>(),[expertSources,setExpertSources]=useState<readonly QualityExpertAssociation[]>([]),[candidateSession,setCandidateSession]=useState('');
 const fieldsRef=useRef(fields);fieldsRef.current=fields;
 const [error,setError]=useState<string>(),[notice,setNotice]=useState<string>(),[retryAvailable,setRetryAvailable]=useState(false);
 const pending=useRef<AbortController|undefined>(undefined),saveAttempt=useRef<QualitySaveReportDocumentInput|undefined>(undefined),draftAttempt=useRef<QualitySaveReportDraftInput|undefined>(undefined);
 const callbacks=useRef({onSaved,onLeaveGuard});callbacks.current={onSaved,onLeaveGuard};
 const dirty=!reportFieldsEqual(fields,baseline),historical=!!document&&document.revisionId!==document.currentRevisionId;
 const draftSupported=!!client.reportDrafts&&!!client.reportDraft&&!!client.saveReportDraft;
 const draftConfirmed=!!draft&&draft.status==='active'&&!!confirmedDraftFields&&reportFieldsEqual(fields,confirmedDraftFields);
 const canEdit=ready&&editing&&!historical&&!parentMismatch&&!busy&&!retryAvailable&&!draftRetry;
 const candidateSupported=!!client.aiCandidate,expertSupported=!!client.expertSources&&!!client.expertCandidate;
 const leavePending=dirty&&!draftConfirmed||retryAvailable||draftRetry;

 function confirmLeave():boolean{
  if(busy){setNotice('当前操作尚未结束，请先等待或停止等待。');return false;}
  return !leavePending||(typeof window!=='undefined'&&window.confirm(retryAvailable||draftRetry?'保存完成状态尚未确认，当前文字仍保留。是否离开当前编辑？':'当前文字尚未保存为草稿或报告，离开会丢失这些修改。是否继续？'));
 }
 useEffect(()=>{callbacks.current.onLeaveGuard?.(confirmLeave);return()=>callbacks.current.onLeaveGuard?.(undefined);},[leavePending,retryAvailable,draftRetry,busy,onLeaveGuard]);
 useEffect(()=>{
  if(!leavePending&&!busy||typeof window==='undefined')return;
  const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);
 },[leavePending,busy]);
 useEffect(()=>{void initialize();return()=>{pending.current?.abort();pending.current=undefined;};},[client,view.recordId,view.runId,view.contentHash]);
 useEffect(()=>{
  if((!moreOpen&&!assistantOpen)||typeof window==='undefined')return;
  const close=(event:KeyboardEvent)=>{if(event.key==='Escape'){setMoreOpen(false);setAssistantOpen(false);}};
  window.addEventListener('keydown',close);return()=>window.removeEventListener('keydown',close);
 },[moreOpen,assistantOpen]);

 function assertView(next:QualityReportDocumentView,reportId?:string,revisionId?:string){
  if(!reportDocumentMatchesRun(next,view)||reportId!==undefined&&next.reportId!==reportId||revisionId!==undefined&&next.revisionId!==revisionId)throw Error('unmatched-report-document');
 }
 function adoptRead(next:QualityReportDocumentView,continueEditing=false){
  setDocument(next);setFields({...next.fields});setBaseline({...next.fields});setEditing(continueEditing&&next.revisionId===next.currentRevisionId);setReady(true);saveAttempt.current=undefined;setRetryAvailable(false);clearDraftBinding();callbacks.current.onSaved?.(next.receipt);
 }
 function clearDraftBinding(){setDraft(undefined);setConfirmedDraftFields(undefined);setParentMismatch(false);setDraftRetry(false);draftAttempt.current=undefined;}
 function begin(kind:typeof operation){
  if(pending.current)return;const request=new AbortController();pending.current=request;setBusy(true);setOperation(kind);setError(undefined);setNotice(undefined);return request;
 }
 function finish(request:AbortController){if(pending.current===request){pending.current=undefined;if(!request.signal.aborted)setBusy(false);}}
 async function loadDraftList(signal:AbortSignal){
  if(!draftSupported)return;
  try{const list=await client.reportDrafts!(view.recordId,view.runId,view.contentHash,signal);signal.throwIfAborted();setDrafts(list.filter(item=>item.status==='active'));setDraftError(undefined);}
  catch{if(!signal.aborted)setDraftError('草稿列表读取失败。当前文字保留，可刷新重试。');}
 }
 async function initialize(){
  const request=begin('read');if(!request)return;
  try{
   const list=await client.reportDocuments(view.recordId,view.runId,view.contentHash,request.signal);request.signal.throwIfAborted();setDocuments(list);
   if(list[0]){const next=await client.reportDocument(view.recordId,view.runId,view.contentHash,list[0].reportId,undefined,request.signal);request.signal.throwIfAborted();assertView(next,list[0].reportId);adoptRead(next);}
   else{setDocument(undefined);callbacks.current.onSaved?.(undefined);setReady(true);setEditing(false);setNotice(undefined);}
   await loadDraftList(request.signal);
  }catch{if(!request.signal.aborted)setError('报告读取未完成，请重试。当前文字保持不变。');}
  finally{finish(request);}
 }
 async function refreshList(){
  const request=begin('read');if(!request)return;
  try{const list=await client.reportDocuments(view.recordId,view.runId,view.contentHash,request.signal);request.signal.throwIfAborted();setDocuments(list);await loadDraftList(request.signal);request.signal.throwIfAborted();setNotice('报告与草稿列表已刷新，当前文字未替换。');}
  catch{if(!request.signal.aborted)setError('报告列表读取失败，当前文字保持不变。');}finally{finish(request);}
 }
 async function getCandidate(signal:AbortSignal):Promise<QualityInterpretationCandidate|null>{
  const source=candidateSession?expertSources.find(item=>item.sessionId===candidateSession):undefined;
  if(candidateSession){if(!source||!client.expertCandidate)throw Error('unavailable-candidate-source');return client.expertCandidate(source,signal);}
  if(!client.aiCandidate)throw Error('unavailable-candidate-source');return client.aiCandidate(view.recordId,view.runId,view.contentHash,signal);
 }
 async function readCandidate(){
  const request=begin('candidate-read');if(!request)return;setCandidate(undefined);
  try{const next=await getCandidate(request.signal);request.signal.throwIfAborted();
   if(next&&!reportCandidateMatchesRun(next,view))throw Error('unmatched-report-candidate');
   setCandidate(next??undefined);setNotice(next?'已找到 AI 建议。确认内容后，可加入分析说明。':'还没有可用建议。请先在 AI 对话中发送分析请求，完成后再查看。');
  }catch{if(!request.signal.aborted)setError('解读读取未完成，报告文字保持不变。请核对本次会话、来源和权限。');}finally{finish(request);}
 }
 async function refreshCandidateSources(){
  if(!expertSupported)return;const request=begin('candidate-sources');if(!request)return;
  try{const rows=await client.expertSources!(view.recordId,view.runId,view.contentHash,request.signal);request.signal.throwIfAborted();
   if(rows.some(item=>item.recordId!==view.recordId||item.runId!==view.runId||item.contentHash!==view.contentHash))throw Error('unmatched-report-candidate-source');
   setExpertSources(rows);setCandidate(undefined);if(!rows.some(item=>item.sessionId===candidateSession))setCandidateSession('');
   setNotice(rows.length?'已找到关联专家对话，请选择后查看建议。':'还没有关联专家对话，可使用本次分析对话。');
  }catch{if(!request.signal.aborted)setError('专家来源读取未完成，当前报告文字保持不变。');}finally{finish(request);}
 }
 async function useCandidate(){
  if(!canEdit||!candidate)return;const selected=candidate,capturedFields={...fields};const request=begin('candidate-use');if(!request)return;
  try{
   const current=await getCandidate(request.signal);request.signal.throwIfAborted();
   if(!current||!reportCandidateMatchesRun(current,view)||!reportCandidatesEqual(selected,current)){setCandidate(undefined);throw Error('report-candidate-changed');}
   if(!reportFieldsEqual(fieldsRef.current,capturedFields))throw Error('report-text-changed');
   const next=appendReportAnalysisCandidate(capturedFields,current,view);setFields(next);setCandidate(undefined);
   setNotice('AI 建议已加入分析说明，请核对后保存。');
  }catch{if(!request.signal.aborted)setError('未追加解读：回复可能已更新、正在进行新一轮，或完整文字超过报告容量。报告原文字保持不变，请重新读取核对或自行整理。');}finally{finish(request);}
 }
 async function read(reportId:string,revisionId?:string,continueEditing=false){
  if(!confirmLeave())return;const request=begin('read');if(!request)return;
  try{const next=await client.reportDocument(view.recordId,view.runId,view.contentHash,reportId,revisionId,request.signal);request.signal.throwIfAborted();assertView(next,reportId,revisionId);adoptRead(next,continueEditing);setMoreOpen(false);setNotice(next.revisionId===next.currentRevisionId?undefined:'正在查看历史版本，编辑时会打开最新版。');}
  catch{if(!request.signal.aborted)setError('版本读取未完成。当前文字与编辑依据均未替换，请重试。');}finally{finish(request);}
 }
 function newReport(){
  if(!confirmLeave())return;
  const summary=view.statistics?.summary;
  const next={...initialReportFields(),...(summary?{analysis:`本次共检验 ${qualityCount(summary.inspectedQuantity)}，其中 ${qualityCount(summary.nonconformingQuantity)} 不合格，合格率 ${qualityPercentage(summary.nonconformingRate===null?null:1-summary.nonconformingRate)}。不合格率按检验数量计算。`}:{})};
  setDocument(undefined);callbacks.current.onSaved?.(undefined);setFields(next);setBaseline(next);clearDraftBinding();setEditing(true);setMoreOpen(false);saveAttempt.current=undefined;setRetryAvailable(false);setError(undefined);setNotice(undefined);
 }
 function cancelEditing(){
  if(!confirmLeave())return;
  const next=document?{...document.fields}:initialReportFields();setFields(next);setBaseline(next);clearDraftBinding();setEditing(false);setCandidate(undefined);setError(undefined);setNotice('已退出编辑。已保存草稿仍可从“更多”恢复。');
 }
 async function restoreDraft(draftId:string){
  if(!draftSupported||!confirmLeave())return;const request=begin('draft-read');if(!request)return;
  try{
   const next=await client.reportDraft!(view.recordId,view.runId,view.contentHash,draftId,request.signal);request.signal.throwIfAborted();
   if(!reportDraftMatchesRun(next,view)||next.draftId!==draftId||next.status!=='active')throw Error('unmatched-draft');
   let parent:QualityReportDocumentView|undefined;
   if(next.reportId){parent=await client.reportDocument(view.recordId,view.runId,view.contentHash,next.reportId,undefined,request.signal);request.signal.throwIfAborted();assertView(parent,next.reportId);}
   const matches=reportDraftParentMatches(next,parent);
   setDocument(parent);setBaseline(parent?{...parent.fields}:initialReportFields());setFields({...next.fields});setDraft(next);setConfirmedDraftFields({...next.fields});setParentMismatch(!matches);setEditing(matches);setReady(true);saveAttempt.current=undefined;draftAttempt.current=undefined;setRetryAvailable(false);setDraftRetry(false);callbacks.current.onSaved?.(parent?.receipt);
   setMoreOpen(false);setNotice(matches?'已按你的选择恢复草稿。正式报告尚未更新。':'草稿基于较早的报告版本，当前仅查看。可以明确另存为新报告；不会自动覆盖最新版。');
  }catch{if(!request.signal.aborted)setError('草稿或其报告依据读取失败，当前文字未替换。请刷新列表后重试。');}finally{finish(request);}
 }
 function copyDraftToNewReport(){
  if(!parentMismatch||busy)return;setDocument(undefined);callbacks.current.onSaved?.(undefined);setBaseline(initialReportFields());clearDraftBinding();saveAttempt.current=undefined;setRetryAvailable(false);setEditing(true);setNotice('已将这些文字用于本轮新报告。原草稿保留；请保存新的草稿或正式报告。');
 }
 async function saveDraft(){
  if(!draftSupported||!ready||busy||historical||parentMismatch||retryAvailable)return;
  let input=draftAttempt.current;
  if(!input){
   try{input=reportDraftSaveInput(fields,crypto.randomUUID(),document,draft);}catch{setError('草稿保存依据或文字容量不符合要求。标题可暂空，正文和当前文字保持不变，请核对后再保存。');return;}
   draftAttempt.current=input;
  }
  const request=begin('draft-save');if(!request)return;setDraftRetry(true);
  try{
   const candidate=await client.saveReportDraft!(view.recordId,view.runId,view.contentHash,input,request.signal);request.signal.throwIfAborted();
   if(!reportDraftMatchesRun(candidate,view)||input.draftId&&candidate.draftId!==input.draftId)throw Error('unmatched-draft-save');
   const confirmed=await client.reportDraft!(view.recordId,view.runId,view.contentHash,candidate.draftId,request.signal);request.signal.throwIfAborted();
   if(!reportDraftReadbackMatches(candidate,confirmed,input,view))throw Error('unconfirmed-draft-save');
   setDraft(confirmed);setConfirmedDraftFields({...confirmed.fields});draftAttempt.current=undefined;setDraftRetry(false);setNotice('草稿已保存。正式报告尚未更新。');await loadDraftList(request.signal);
  }catch{if(!request.signal.aborted)setError('草稿保存结果尚未确认，文字保留。可重试同一次保存；若草稿或报告依据已变化，请明确恢复核对或另建报告，不会自动覆盖。');}finally{finish(request);}
 }
 async function save(){
  if(!ready||busy||historical||parentMismatch||draftRetry)return;
  let input=saveAttempt.current;
  if(!input){
   try{input=reportSaveInput(fields,crypto.randomUUID(),document);}
   catch{setError('请填写报告标题（最多 256 字），每段正文最多 8192 字，文字总量需在保存容量内。输入保持不变。');return;}
   saveAttempt.current=input;
  }
  const adoptedDraft=draft;const request=begin('save');if(!request)return;setRetryAvailable(true);
  try{
   const candidate=await client.saveReportDocument(view.recordId,view.runId,view.contentHash,input,request.signal);request.signal.throwIfAborted();assertView(candidate,input.reportId);
   const confirmed=await client.reportDocument(view.recordId,view.runId,view.contentHash,candidate.reportId,candidate.revisionId,request.signal);request.signal.throwIfAborted();
   if(!reportSaveReadbackMatches(candidate,confirmed,input,view))throw Error('unconfirmed-report-save');
   adoptRead(confirmed);let savedNotice=`报告第 ${confirmed.version} 版已保存。${confirmed.revisionId===confirmed.currentRevisionId?'':'已有更新版本，当前显示本次保存的版本。'}`;
   if(adoptedDraft){
    if(client.archiveReportDraft){
     setOperation('draft-archive');
     try{
      const archived=await client.archiveReportDraft(view.recordId,view.runId,view.contentHash,adoptedDraft.draftId,adoptedDraft.draftRevision,crypto.randomUUID(),request.signal);request.signal.throwIfAborted();
      const confirmedArchive=await client.reportDraft!(view.recordId,view.runId,view.contentHash,adoptedDraft.draftId,request.signal);request.signal.throwIfAborted();
      if(!reportDraftArchiveReadbackMatches(archived,confirmedArchive,adoptedDraft,view))throw Error('unconfirmed-draft-archive');
      setConsumedAiDraft({draftId:adoptedDraft.draftId,draftRevision:adoptedDraft.draftRevision});
     }
     catch{if(!request.signal.aborted)savedNotice+=' 草稿整理状态未确认，可从“更多”查看。';}
    }else savedNotice+=' 当前无法归档草稿，原草稿保留。';
   }
   if(!request.signal.aborted)setNotice(savedNotice);
   try{const list=await client.reportDocuments(view.recordId,view.runId,view.contentHash,request.signal);request.signal.throwIfAborted();setDocuments(list);}
   catch{if(!request.signal.aborted)setNotice(savedNotice+' 报告列表暂未刷新。');}
   await loadDraftList(request.signal);
  }catch{if(!request.signal.aborted)setError('保存结果尚未确认，文字保留。请重试同一次保存；如最新版已有变化，可明确读取最新版核对，当前文字不会自动覆盖。');}
  finally{finish(request);}
 }
 function stopWaiting(){
  const request=pending.current;if(!request)return;request.abort();pending.current=undefined;setBusy(false);setError(operation==='save'||operation==='draft-save'?'已停止等待，保存完成状态尚未确认。文字保留，请重试同一次保存。':operation==='draft-archive'?'正式报告已保存，草稿整理状态未确认，可从“更多”查看。':'读取已取消，当前文字保持不变。');
 }
 function download(){
  if(!document||dirty)return;const url=URL.createObjectURL(new Blob([document.markdown],{type:'text/markdown;charset=utf-8'}));const anchor=globalThis.document.createElement('a');anchor.href=url;anchor.download=`${document.fields.title}.md`;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 function primary(){
  if(historical&&document){void read(document.reportId,undefined,true);return;}
  if(editing||retryAvailable){void save();return;}
  if(!document){newReport();return;}
  setEditing(true);setNotice(undefined);
 }
 const primaryLabel=busy&&operation==='save'?'正在保存…':retryAvailable?'重试保存':historical?'编辑最新版':editing?'保存报告':'编辑报告';
 const textStatus=!ready?'正在读取':parentMismatch?'草稿需重新确认':historical?`第 ${document?.version} 版 · 历史版本`:retryAvailable||draftRetry?'保存待确认':editing?draftConfirmed?'草稿已保存':dirty?'有未保存修改':'正在编辑':document?`第 ${document.version} 版 · 已保存`:'尚未生成报告';
 return <section className="wd-quality-report-editor" aria-label="质量报告编辑器">
  <style>{reportEditorStyles}</style>
  <header className="wd-report-editor-heading">
   <div className="wd-report-editor-title"><span className="wd-report-editor-label">报告</span><h2>{document?.fields.title??(editing?fields.title||'未命名报告':'分析报告')}</h2><span className="wd-report-editor-state" role="status">{textStatus}</span></div>
   <div className="wd-report-editor-actions">
    {onOpenAi&&<button disabled={!ready||busy||aiBusy} onClick={()=>onOpenAi(document?{reportId:document.reportId,revisionId:document.revisionId}:undefined)}>{aiBusy?'正在打开…':'与 AI 加工'}</button>}
    {!onOpenAi&&candidateSupported&&<button aria-expanded={assistantOpen} aria-controls="quality-report-ai-panel" disabled={!ready||!document&&!editing&&!parentMismatch} onClick={()=>setAssistantOpen(value=>!value)}>查看 AI 建议</button>}
    {editing?<>
     <button disabled={busy||retryAvailable||draftRetry} onClick={cancelEditing}>取消编辑</button>
     {draftSupported&&<button disabled={busy||!ready||historical||parentMismatch||retryAvailable||draftConfirmed&&!draftRetry} onClick={()=>void saveDraft()}>{draftRetry?'重试确认草稿':busy&&operation==='draft-save'?'正在保存草稿…':'保存草稿'}</button>}
     <button className="wd-quality-primary" disabled={busy||!ready||parentMismatch||draftRetry||!dirty&&!!document&&!retryAvailable} onClick={primary}>{primaryLabel}</button>
    </>:document&&<>
     <button disabled={busy||dirty} onClick={download}>导出报告</button>
     <button className="wd-quality-primary" disabled={busy||!ready||parentMismatch} onClick={primary}>{primaryLabel}</button>
    </>}
    <button aria-expanded={moreOpen} aria-controls="quality-report-management" disabled={busy||!ready} onClick={()=>setMoreOpen(value=>!value)}>更多</button>
   </div>
  </header>
  {moreOpen&&<aside id="quality-report-management" className="wd-report-editor-more-panel" aria-label="报告管理">
   <header><h3>报告管理</h3><button aria-label="关闭报告管理" onClick={()=>setMoreOpen(false)}>关闭</button></header>
   <section><h4>查看报告</h4><select aria-label="选择分析报告" disabled={busy||!ready} value={document?.reportId??''} onChange={event=>{if(event.currentTarget.value)void read(event.currentTarget.value);}}><option value="">选择报告</option>{documents.map(item=><option key={item.reportId} value={item.reportId}>{item.title}</option>)}</select>
    {document&&<label className="wd-report-editor-panel-label">历史版本<select aria-label="选择报告版本" disabled={busy} value={document.revisionId} onChange={event=>void read(document.reportId,event.currentTarget.value)}>{document.versions.map(item=><option key={item.revisionId} value={item.revisionId}>第 {item.version} 版{item.revisionId===document.currentRevisionId?' · 最新':''}</option>)}</select></label>}
    <div className="wd-report-editor-actions"><button disabled={busy} onClick={()=>void (ready?refreshList():initialize())}>刷新列表</button><button disabled={busy||!ready} onClick={newReport}>新建报告</button></div>
    {candidateSupported&&onOpenAi&&<button disabled={busy} onClick={()=>{setMoreOpen(false);setAssistantOpen(true);}}>查看已保存建议</button>}
   </section>
   {draftSupported&&<section aria-label="报告草稿"><h4>恢复草稿</h4><p>恢复后可继续编辑；如有未保存修改，会先询问你。</p><select aria-label="选择并恢复草稿" disabled={busy||!ready} value="" onChange={event=>{if(event.currentTarget.value)void restoreDraft(event.currentTarget.value);}}><option value="">{drafts.length?`选择已保存草稿（${drafts.length}）`:'暂无已保存草稿'}</option>{drafts.map(item=><option key={item.draftId} value={item.draftId}>{item.title||'未命名草稿'} · {qualityResultSourceLabel(item.updatedAt,'Asia/Shanghai')}</option>)}</select></section>}
   {additionalTools&&<section className="wd-report-editor-extra-tools">{additionalTools}</section>}
   {document&&<details className="wd-report-editor-receipt"><summary>追溯详情</summary><dl><dt>报告版本</dt><dd>第 {document.version} 版 · {document.revisionId}</dd><dt>资料库资产</dt><dd>{document.receipt.assetId}</dd><dt>版本校验</dt><dd>{document.receipt.sha256}</dd><dt>分析依据</dt><dd>{view.runId} · {view.contentHash}</dd></dl></details>}
  </aside>}
  {parentMismatch&&<div className="wd-report-editor-caution"><p>这份草稿基于较早的报告。可以保留文字另建报告，或打开最新版。</p><button disabled={busy} onClick={copyDraftToNewReport}>将这些文字另存为新报告</button>{document&&<button disabled={busy} onClick={()=>void read(document.reportId,undefined,true)}>编辑最新版</button>}</div>}
  {busy&&<div className="wd-report-editor-feedback" role="status">{operation==='save'?'正在保存报告…':operation==='draft-save'?'正在保存草稿…':operation==='draft-archive'?'报告已保存，正在整理草稿…':operation==='candidate-use'?'正在确认这条建议…':operation==='candidate-read'||operation==='candidate-sources'?'正在读取 AI 建议…':'正在读取报告…'} <button onClick={stopWaiting}>停止等待</button></div>}
  {error&&<div className="wd-report-editor-feedback is-error" role="alert">{error}{!ready&&<button disabled={busy} onClick={()=>void initialize()}>重试读取</button>}</div>}
  {draftError&&moreOpen&&<p role="alert">{draftError}</p>}
  {notice&&<p className="wd-report-editor-feedback" role="status">{notice}</p>}
  {aiDraft&&aiDraft.recordId===view.recordId&&aiDraft.runId===view.runId&&aiDraft.contentHash===view.contentHash&&aiDraft.status==='active'&&
   !(draft?.draftId===aiDraft.draftId&&draft.draftRevision===aiDraft.draftRevision)&&
   !(consumedAiDraft?.draftId===aiDraft.draftId&&consumedAiDraft.draftRevision===aiDraft.draftRevision)&&<div className="wd-report-editor-caution" role="status"><p>AI 已加工报告草稿，可核对后继续编辑。</p><button className="wd-quality-primary" disabled={!ready||busy} onClick={()=>void restoreDraft(aiDraft.draftId)}>查看 AI 草稿</button></div>}
  {retryAvailable&&!busy&&<div className="wd-report-editor-caution"><p>保存状态尚未确认，请重试保存。当前文字保留。</p>{document&&<button onClick={()=>void read(document.reportId,undefined,true)}>查看最新版</button>}</div>}
  {draftRetry&&!busy&&<div className="wd-report-editor-caution"><p>草稿保存状态尚未确认，请重试。当前文字保留。</p></div>}
  {!ready&&!error?<div className="wd-report-editor-loading" role="status">正在打开报告…</div>:ready&&!document&&!editing&&!parentMismatch?<section className="wd-report-editor-empty"><span className="wd-report-editor-empty-icon" aria-hidden="true">▤</span><h3>把分析结果整理成报告</h3><p>检验数量、合格率和趋势已准备好。补充结论与建议后，即可保存报告。</p><button className="wd-quality-primary" disabled={busy} onClick={newReport}>生成报告</button>{drafts.length>0&&<button disabled={busy} onClick={()=>setMoreOpen(true)}>恢复已有草稿</button>}</section>:ready&&<div className={`wd-report-editor-main${assistantOpen?' has-assistant':''}`}>
   <div className={`wd-report-editor-workspace${editing||parentMismatch?' is-editing':''}`}>
    {(editing||parentMismatch)&&<section className="wd-report-editor-fields" aria-label="报告文字编辑"><header><h3>编辑内容</h3><span>{canEdit?'文字修改不会改变统计数字':'只读'}</span></header>
     <fieldset disabled={!canEdit}><label>报告标题<input aria-label="报告标题" maxLength={256} value={fields.title} onChange={event=>{const value=event.currentTarget.value;setFields(previous=>({...previous,title:value}));}}/></label>{([['analysis','分析说明','说明趋势、数据变化与核查情况'],['conclusion','结论','写下已确认的判断'],['recommendations','改进建议','列出措施与后续安排']] as const).map(([field,label,placeholder])=><label key={field}>{label}<textarea aria-label={label} value={fields[field]} rows={field==='analysis'?6:4} maxLength={8192} placeholder={placeholder} onChange={event=>{const value=event.currentTarget.value;setFields(previous=>({...previous,[field]:value}));}}/></label>)}</fieldset>
     <p className="wd-report-editor-caption">{draftSupported?draftConfirmed?'草稿已保存。正式报告尚未更新。':draft?'草稿有未保存修改。':'可以保存草稿，稍后继续。':'当前宿主未提供可恢复草稿，离开前请保存报告。'}</p>
    </section>}
    <div className="wd-report-editor-preview" aria-label={editing?'报告纸张预览':'报告阅读区'}><QualityReportPaper view={view} fields={fields}/></div>
   </div>
   {assistantOpen&&(candidateSupported||onOpenAi)&&<aside id="quality-report-ai-panel" className="wd-report-editor-assistant" aria-label="报告 AI 助手"><header><h3>AI 助手</h3><button aria-label="关闭 AI 助手" onClick={()=>setAssistantOpen(false)}>关闭</button></header><p>让 AI 解释趋势或完善报告。建议经你确认后加入正文。</p>
    {onOpenAi&&<><button className="wd-quality-primary" disabled={busy||aiBusy||!ready} onClick={()=>onOpenAi(document?{reportId:document.reportId,revisionId:document.revisionId}:undefined)}>{aiBusy?'正在打开对话…':'打开原生对话'}</button><p className="wd-report-editor-caption">对话保持在工作台内，生成的报告草稿可在当前页面核对。</p></>}
    {candidateSupported&&<><button disabled={busy||!ready} onClick={()=>void readCandidate()}>查看已完成建议</button>
     {candidate?<section aria-label="报告 AI 建议"><div className="wd-report-editor-candidate-text">{candidate.text}</div><button className="wd-quality-primary" disabled={!canEdit} onClick={()=>void useCandidate()}>加入分析说明</button>{!canEdit&&<p className="wd-report-editor-caption">先编辑报告，再将建议加入正文。</p>}</section>:<div className="wd-report-editor-assistant-placeholder">完成 AI 对话后，在这里查看建议。</div>}
     <details className="wd-report-editor-source-options"><summary>其他建议来源</summary><label>对话<select aria-label="报告解读来源" disabled={busy||!ready} value={candidateSession} onChange={event=>{setCandidateSession(event.currentTarget.value);setCandidate(undefined);}}><option value="">本次分析对话</option>{expertSources.map((item,index)=><option key={item.sessionId} value={item.sessionId}>专家对话 {index+1}</option>)}</select></label>{expertSupported&&<button disabled={busy||!ready} onClick={()=>void refreshCandidateSources()}>刷新专家对话</button>}{candidate&&<details className="wd-report-editor-caption"><summary>追溯详情</summary><p>第 {candidate.turn} 轮回复 · 会话 {candidate.sessionId}<br/>解读指纹 {candidate.candidateHash}</p></details>}</details>
    </>}
   </aside>}
  </div>}
 </section>;
}

export function QualityReportPaper({view,fields}:{view:QualityRunView;fields:QualityReportFields}){
 const summary=view.statistics.summary,conforming=summary.nonconformingRate===null?null:1-summary.nonconformingRate;
 return <article className="wd-report-editor-paper" aria-label="报告正文预览"><header><span className="wd-report-editor-kicker">质量分析报告</span><h2>{fields.title||'未命名报告'}</h2><p>{qualityResultSourceLabel(view.createdAt,view.statistics.timeZone)} · 检验质量分析</p></header>
  <section className="wd-report-editor-metrics" aria-label="报告固定统计">{[['检验数量',qualityCount(summary.inspectedQuantity)],['不合格数量',qualityCount(summary.nonconformingQuantity)],['合格率',qualityPercentage(conforming)],['缺陷次数',view.hasDefectSource?qualityCount(summary.defectOccurrences):'未提供明细']].map(([label,value])=><div key={label}><span>{label}</span><strong>{value}</strong></div>)}</section>
  <section className="wd-report-editor-paper-trend"><h3>不合格率趋势</h3>{view.statistics.trend.length?<QualityTrendChart rows={view.statistics.trend} granularity={view.statistics.trendGranularity}/>:<p>当前分析范围没有趋势数据。</p>}</section>
  {([['analysis','分析说明'],['conclusion','结论'],['recommendations','改进建议']] as const).map(([field,label])=><section className="wd-report-editor-paper-text" key={field}><h3>{label}</h3>{fields[field]?<p>{fields[field]}</p>:<p className="wd-report-editor-placeholder">尚未填写{label}</p>}</section>)}
  <footer>不合格率按检验数量计算。{view.hasDefectSource?'缺陷次数独立累计。':'未提供缺陷明细，不能将其视为零。'}</footer>
 </article>;
}
