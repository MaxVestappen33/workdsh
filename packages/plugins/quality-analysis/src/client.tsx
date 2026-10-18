import type {} from '@deepseek-ai/dsh-client-ui-conversation/client';
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client';
import type {ClientWorkbenchRegistration} from 'workdsh-plugin-workbenches/client';
import {NativeWorkbenchConversation,type NativeWorkbenchConversationDraft,type NativeWorkbenchToolSettled} from 'workdsh-plugin-workbenches/client';
import {createQualityToolInstruction} from './client/analysis-instruction.js';
import React,{useCallback,useEffect,useMemo,useRef,useState} from 'react';
import type {Context} from '@deepseek-ai/cordis';
import type {ISessions} from '@deepseek-ai/dsh-api-session-controller/client';
import type {IConversation} from '@deepseek-ai/dsh-client-ui-conversation/client';
import type {MainPanelId} from '@deepseek-ai/dsh-client-ui-layout/client';
import {createLibraryClient,createLibraryNativeFileClient,LibraryOriginalSurface,type LibraryOriginalSurfaceProps} from 'workdsh-plugin-library/client';
import type {LibraryOriginalPreviewRegistry} from 'workdsh-contracts/library';
import type {WorkbenchDescriptor} from 'workdsh-contracts';
import {QualityAnalysisBrowser,type QualityNavigation} from './client/QualityAnalysisBrowser.js';
import {createQualityRecordClient,QualityRecordRequestError} from './client/record-client.js';
import {createQualityIdentityScopeOwner} from './client/identity-scope.js';
import type {QualityAiContext} from './client/ai-context.js';
import {qualityNativeDraftState} from './client/native-draft-state.js';
export const name='workdsh-quality-analysis-client';
export const inject=['workdshWorkbenchClientRegistration','layout','workdshLibraryPreview','sessions','conversation','uiWorkspace','sidebarRight','workspaces','slots'];
const descriptor:WorkbenchDescriptor={id:'workdsh.quality-analysis',title:'质量分析',description:'检验数据、缺陷分析和可追溯报告',protocolVersion:'1.0',layout:'full-page',hostCompatibility:{sdk:'^1.0.0',harness:'0.2.1-rc.2'},capabilities:[]};
type ConversationBinding={sessionId:string;recordId:string;originRunId?:string;originContentHash?:string};
const closeStyles=`.wd-quality-native-companion{position:relative}.wd-quality-companion-close{position:absolute;right:10px;top:7px;z-index:2;display:grid;place-items:center;width:30px;height:30px;border:0;border-radius:6px;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-secondary,#657185);cursor:pointer;font:inherit}.wd-quality-companion-close:hover{background:var(--dsw-alias-bg-layer-1,#f2f3f5)}.wd-quality-companion-close:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#3d73ff);outline-offset:2px}`;
const frameStyles=`.wd-quality-native-frame{height:100%;min-height:0;display:grid;grid-template-columns:minmax(0,1fr);overflow:hidden;width:100%}.wd-quality-native-frame.has-companion{grid-template-columns:minmax(0,1fr) minmax(360px,42%)}.wd-quality-business-column{min-width:0;min-height:0;overflow:auto}.wd-quality-native-companion{height:100%;min-height:0;min-width:0;overflow:hidden;border-left:1px solid var(--dsw-alias-border-l2,#dce2e9);display:flex;flex-direction:column;background:var(--dsw-alias-bg-base,#fff)}.wd-quality-companion-return{display:none}.wd-quality-native-companion[hidden],.wd-quality-native-session[hidden],.wd-quality-native-file[hidden]{display:none}.wd-quality-native-session,.wd-quality-native-file{flex:1;display:flex;flex-direction:column;height:100%;min-height:0;min-width:0;overflow:hidden}.wd-quality-native-file>header{flex:0 0 auto;display:flex;gap:10px;align-items:center;padding:12px 16px;border-bottom:1px solid var(--dsw-alias-border-l2,#dce2e9)}.wd-quality-native-file>header strong{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.wd-quality-native-file>header button{font:inherit;padding:6px 10px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2,#dce2e9);background:var(--dsw-alias-bg-layer-1,#fff);color:inherit}.wd-quality-native-feedback{margin:0;padding:10px 16px;font-size:13px;color:var(--dsw-alias-label-secondary,#657185)}.wd-quality-ai-result-notice{padding:12px 16px;margin-bottom:16px;border:1px solid var(--dsw-alias-border-l2,#dce2e9);border-radius:8px}.wd-quality-ai-result-notice button{margin-left:12px}@media(max-width:850px){.wd-quality-native-frame.has-companion{grid-template-columns:minmax(0,1fr)}.wd-quality-native-frame.has-companion>.wd-quality-business-column{display:none}.wd-quality-native-companion{border-left:0}.wd-quality-companion-return{display:flex;padding:8px 12px;flex:0 0 auto}.wd-quality-companion-return button{font:inherit;border:0;background:transparent;color:inherit;cursor:pointer}}`;
function QualityPage({native,nativeFiles,navigation}:{native:Context;nativeFiles:ReturnType<typeof createLibraryNativeFileClient>;navigation:{scope?:string;value?:QualityNavigation}}){
 const client=useMemo(()=>createQualityRecordClient(),[]);
 const [scope,setScope]=useState<string>(),[error,setError]=useState(false),[attempt,setAttempt]=useState(0),[checking,setChecking]=useState(true);
 useEffect(()=>{
  const owner=createQualityIdentityScopeOwner(fetch,state=>{setScope(state.scope);setError(state.error);setChecking(state.checking);});
  const check=()=>{void owner.check();};const visible=()=>{if(document.visibilityState==='visible')check();};
  check();window.addEventListener('focus',check);document.addEventListener('visibilitychange',visible);
  return()=>{owner.dispose();window.removeEventListener('focus',check);document.removeEventListener('visibilitychange',visible);};
 },[attempt]);
 const management=useMemo(()=>createLibraryClient(native),[native]);
 const previewRegistry=native.get('workdshLibraryPreview') as LibraryOriginalPreviewRegistry;
 const [binding,setBinding]=useState<ConversationBinding>(),[draftRequest,setDraftRequest]=useState<NativeWorkbenchConversationDraft>(),[aiContext,setAiContext]=useState<QualityAiContext>();
 const [originalRevisionSaved,setOriginalRevisionSaved]=useState<import('workdsh-contracts/library').LibraryTreeEntry>();
 const [rightMode,setRightMode]=useState<'conversation'|'file'>(),[source,setSource]=useState<LibraryOriginalSurfaceProps['source']>(),[sourceBusy,setSourceBusy]=useState(false),[sourceNotice,setSourceNotice]=useState<string>(),[nativeError,setNativeError]=useState<string>(),[nativeNotice,setNativeNotice]=useState<string>();
 const sourceBusyRef=useRef(false);sourceBusyRef.current=sourceBusy;
 const current=useRef({scope,binding,recordId:navigation.value?.recordId});current.current={scope,binding,recordId:navigation.scope===scope?navigation.value?.recordId:undefined};
 const pendingDraft=useRef<{id:string;resolve:()=>void;reject:(error:Error)=>void;cleanup:()=>void}|undefined>(undefined);
 const cancelDraft=useCallback(()=>{const pending=pendingDraft.current;if(pending){pendingDraft.current=undefined;pending.cleanup();pending.reject(new Error('quality/draft-cancelled'));}},[]);
 useEffect(()=>{cancelDraft();setBinding(undefined);setDraftRequest(undefined);setAiContext(undefined);setRightMode(undefined);setSource(undefined);setSourceNotice(undefined);setNativeNotice(undefined);setOriginalRevisionSaved(undefined);return cancelDraft;},[scope,cancelDraft]);
 const rememberNavigation=useCallback((value:QualityNavigation)=>{
  if(navigation.scope===scope&&navigation.value&&navigation.value.recordId!==value.recordId){cancelDraft();setBinding(undefined);setDraftRequest(undefined);setAiContext(undefined);setRightMode(undefined);setSource(undefined);setSourceNotice(undefined);setNativeNotice(undefined);setOriginalRevisionSaved(undefined);}
  navigation.scope=scope;navigation.value=value;current.current.recordId=value.recordId;
 },[navigation,scope,cancelDraft]);
 const openNativeDraft=useCallback((next:ConversationBinding,instruction:string,signal:AbortSignal)=>{
  signal.throwIfAborted();if(sourceBusyRef.current)throw new Error('quality/source-saving');
  cancelDraft();setNativeError(undefined);setNativeNotice(undefined);setBinding(next);setRightMode('conversation');
  const id=crypto.randomUUID();
  return new Promise<void>((resolve,reject)=>{
   const abort=()=>{if(pendingDraft.current?.id===id){pendingDraft.current=undefined;setDraftRequest(undefined);reject(new Error('quality/draft-cancelled'));}signal.removeEventListener('abort',abort);};
   pendingDraft.current={id,resolve,reject,cleanup:()=>signal.removeEventListener('abort',abort)};
   signal.addEventListener('abort',abort,{once:true});setDraftRequest({id,instruction});
  });
 },[cancelDraft]);
 const finishDraft=useCallback((id:string,error?:unknown)=>{const pending=pendingDraft.current;if(!pending||pending.id!==id)return;pendingDraft.current=undefined;pending.cleanup();setDraftRequest(undefined);
  const reason=error instanceof Error?error.message:undefined;
  // The SDK owns existing text, attachments and in-flight submission. Opening
  // the same conversation succeeds even when a new starter cannot be inserted.
  if(reason==='workbench/development-draft-not-empty'||reason==='workbench/conversation-draft-preserved'){setNativeNotice('已有输入已保留，请继续编辑或发送。');pending.resolve();}
  else if(reason==='workbench/conversation-input-busy'){setNativeNotice('当前对话暂不能接收新请求，已有输入已保留。');pending.resolve();}
  else if(error)pending.reject(error instanceof Error?error:new Error('quality/native-draft-failed'));else pending.resolve();},[]);
 const refreshFromTool=useCallback(async(event:NativeWorkbenchToolSettled)=>{
  const captured=current.current,bound=captured.binding;
  if(!bound||!bound.originRunId||bound.sessionId!==event.sessionId||bound.recordId!==captured.recordId)return;
  try{const update=await client.aiContext(bound.recordId,bound.sessionId,event.signal);event.signal.throwIfAborted();
   const now=current.current;if(now.scope!==captured.scope||now.binding!==bound||now.recordId!==bound.recordId)return;
   if(update.originRunId!==bound.originRunId||update.originContentHash!==bound.originContentHash)throw Error('quality/unmatched-ai-session');
   setAiContext(previous=>previous?.sessionId===update.sessionId&&previous.revision>=update.revision?previous:update);setNativeError(undefined);setNativeNotice(undefined);
  }catch{if(!event.signal.aborted&&current.current.binding===bound)setNativeError('AI 操作已结束，业务结果暂未刷新。可继续对话或重新打开当前分析。');}
 },[client]);
 const closeCompanion=()=>{if(sourceBusyRef.current){setSourceNotice('文件正在保存，请等待完成。');return;}setRightMode(undefined);};
 if(error)return <p role="alert">无法确认当前账号，请核对登录状态。<button onClick={()=>setAttempt(value=>value+1)}>重试</button></p>;
 return <>{checking&&<p role="status">正在确认当前账号…</p>}{scope&&<div hidden={checking} className={`wd-quality-native-frame${rightMode==='file'?' has-companion':''}`}><style>{frameStyles}{closeStyles}</style>
  <div className="wd-quality-business-column">{nativeError&&<p role="alert" className="wd-quality-native-feedback">{nativeError}</p>}{nativeNotice&&<p role="status" className="wd-quality-native-feedback">{nativeNotice}</p>}<QualityAnalysisBrowser identityScopeKey={scope} client={client} initialNavigation={navigation.scope===scope?navigation.value:undefined} onNavigation={rememberNavigation} aiContext={aiContext} conversationOpen={rightMode==='conversation'} onOpenConversation={binding&&aiContext&&binding.sessionId===aiContext.sessionId?()=>{if(!sourceBusyRef.current)setRightMode('conversation');}:undefined} onCloseConversation={closeCompanion} onBeforeRecordChange={()=>!sourceBusyRef.current}
   onExpertDraft={(sessionId,instruction,signal)=>{signal.throwIfAborted();if(sourceBusyRef.current)throw Error('quality/source-saving');setAiContext(undefined);return openNativeDraft({sessionId,recordId:current.current.recordId!},instruction,signal);}}
   onAiDraft={async(view,signal,purpose,report,selection)=>{
    signal.throwIfAborted();if(sourceBusyRef.current)throw Error('quality/source-saving');
    if(purpose==='focus'&&!selection)throw Error('quality/focus/missing-selection');
    const instruction=createQualityToolInstruction(view.recordId,view,purpose,report),live=current.current.binding;
    const reuse=live?.recordId===view.recordId&&((aiContext?.sessionId===live.sessionId&&aiContext.runId===view.runId&&aiContext.contentHash===view.contentHash)||(live.originRunId===view.runId&&live.originContentHash===view.contentHash));
    const receipt=await client.aiSession(view.recordId,view.runId,view.contentHash,signal);
    const restored=await client.aiContext(view.recordId,receipt.sessionId,signal);
    signal.throwIfAborted();if(current.current.recordId!==view.recordId)throw Error('quality/record-changed');
    if(restored.runId!==view.runId||restored.contentHash!==view.contentHash)throw Error('quality/unmatched-ai-session');
    const next=reuse&&live!.sessionId===receipt.sessionId?live!:{sessionId:receipt.sessionId,recordId:view.recordId,originRunId:restored.originRunId,originContentHash:restored.originContentHash};
    let inputState:'empty'|'draft'|'busy';
    try{inputState=await qualityNativeDraftState({sessions:native.get('sessions') as unknown as ISessions,conversation:native.get('conversation') as IConversation},receipt.sessionId,signal,async guard=>{
     guard.signal.throwIfAborted();if(current.current.recordId!==view.recordId)throw Error('quality/record-changed');
     if(sourceBusyRef.current)throw Error('quality/source-saving');
     if(purpose==='focus')await client.aiFocus(view.recordId,view.runId,view.contentHash,receipt.sessionId,selection!,guard.signal);
     else await client.aiSession(view.recordId,view.runId,view.contentHash,guard.signal,purpose==='report'?(report??null):null);
     const selected=await client.aiContext(view.recordId,receipt.sessionId,guard.signal);guard.signal.throwIfAborted();
     if(current.current.recordId!==view.recordId||selected.runId!==view.runId||selected.contentHash!==view.contentHash)throw Error('quality/unmatched-ai-session');
     guard.allowInitialization(instruction);setAiContext(selected);await openNativeDraft(next,instruction,guard.signal);
    });}
    catch(error){
     const changed=error instanceof Error&&error.message==='quality/native-input-changed';
     if(!changed&&(!(error instanceof QualityRecordRequestError)||error.code!=='quality/ai/session-busy'))throw error;
     signal.throwIfAborted();if(current.current.recordId!==view.recordId)throw Error('quality/record-changed');
     // Input cancellation is not a distributed rollback. Read the actual Host
     // context rather than presenting the previous report target as restored.
     const actual=changed?await client.aiContext(view.recordId,receipt.sessionId,signal):restored;
     signal.throwIfAborted();if(current.current.recordId!==view.recordId)throw Error('quality/record-changed');
     cancelDraft();setAiContext(actual);setBinding(next);setRightMode('conversation');setNativeError(undefined);
     setNativeNotice(changed?'输入已变化，新的请求已取消。请核对当前分析对象后继续对话。':purpose==='focus'?'AI 正在处理当前任务，所选记录尚未交给 AI。请等待完成后再核查。':'当前对话暂不能接收新请求，已有输入已保留。');return;
    }
    signal.throwIfAborted();if(current.current.recordId!==view.recordId)throw Error('quality/record-changed');
    if(sourceBusyRef.current)throw Error('quality/source-saving');
    if(inputState!=='empty'){
     cancelDraft();setAiContext(restored);setBinding(next);setRightMode('conversation');setNativeError(undefined);
     setNativeNotice(purpose==='focus'?(inputState==='busy'?'AI 正在处理当前任务，所选记录尚未交给 AI。请等待完成后再核查。':'已有输入已保留，所选记录尚未交给 AI。请处理当前输入后再核查。'):(inputState==='busy'?'当前对话暂不能接收新请求，已有输入已保留。':'已有输入已保留，请先完成当前对话。'));return;
    }
   }}
   library={{management,previewRegistry,originalRevisionSaved,openLibrary:()=>{if(!sourceBusyRef.current)native.layout.selectPanel('workdsh-library' as MainPanelId);},openOriginal:async(next,signal)=>{signal?.throwIfAborted();if(sourceBusyRef.current)throw Error('quality/source-saving');await nativeFiles.open({assetId:next.assetId,revisionId:next.revisionId,sessionId:binding?.sessionId,returnPanel:{id:'workdsh-workbench:workdsh.quality-analysis',label:'返回质量分析'}},signal);}}}/></div>
   {binding&&<NativeWorkbenchConversation onClose={closeCompanion} active={rightMode==='conversation'} native={native} sessionId={binding.sessionId} identityScopeKey={scope} draftRequest={draftRequest} onDraftReady={id=>finishDraft(id)} onDraftError={(id,error)=>finishDraft(id,error)} onToolSettled={event=>void refreshFromTool(event)} onError={()=>setNativeError('原生会话暂时无法打开，请稍后重试。')}/>}
  <aside className="wd-quality-native-companion" aria-label="工作台协作区" hidden={rightMode!=='file'}><div className="wd-quality-companion-return"><button disabled={sourceBusy} onClick={closeCompanion}>返回分析</button></div>
   {rightMode==='conversation'&&<button type="button" className="wd-quality-companion-close" aria-label="收起右侧对话" title="收起对话，保留会话" disabled={sourceBusy} onClick={closeCompanion}><span aria-hidden="true">×</span></button>}
   {source&&<div className="wd-quality-native-file" hidden={rightMode!=='file'}><header><strong title={source.name}>{source.name}</strong>{binding&&<button disabled={sourceBusy} onClick={()=>setRightMode('conversation')}>返回对话</button>}<button disabled={sourceBusy} onClick={closeCompanion}>关闭文件</button></header>{sourceNotice&&<p role="status" className="wd-quality-native-feedback">{sourceNotice}</p>}<LibraryOriginalSurface key={`${scope}/${source.assetId}/${source.revisionId}`} source={source} management={management} previewRegistry={previewRegistry} onBusyChange={setSourceBusy} onSaved={entry=>{setOriginalRevisionSaved(entry);setSourceNotice('新版本已保存，可在检验数据中采用。');}}/></div>}
  </aside>
 </div>}</>;
}
export async function apply(ctx:Context){
 const registration=ctx.get('workdshWorkbenchClientRegistration') as ClientWorkbenchRegistration<React.ComponentType>;
 const navigation:{scope?:string;value?:QualityNavigation}={};
 const nativeFiles=createLibraryNativeFileClient(ctx);
 await registration.registerManaged(ctx,descriptor,()=> <QualityPage native={ctx} nativeFiles={nativeFiles} navigation={navigation}/>);
}
