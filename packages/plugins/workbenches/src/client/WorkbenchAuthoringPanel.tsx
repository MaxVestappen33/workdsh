import {WorkbenchDelivery} from './WorkbenchDelivery.js';
import {prepareWorkbenchResume,resumeFailureMessage} from './resume-development.js';
import {createWorkbenchRequirementsClient} from './requirements-client.js';
import type {WorkbenchDevelopmentIndexEntry} from 'workdsh-contracts';
import {NativeWorkbenchConversation} from './native-conversation.js';
import {createWorkbenchCreationClient,type CreationView} from './creation-client.js';
import type {AuthoringEntry} from './authoring-navigation.js';
import {workbenchSurfaceStyles} from './surface-styles.js';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { WorkbenchImportHistory } from './WorkbenchImportHistory.js';
import { WorkbenchSourceCandidates } from './WorkbenchSourceCandidates.js';
import { WorkbenchPackageUpload } from './WorkbenchPackageUpload.js';
import { WorkbenchDevelopmentsPanel } from './WorkbenchDevelopmentsPanel.js';
import { WorkbenchNativeAuthoringEditor, type WorkbenchNativeAuthoringEditorProps } from './WorkbenchNativeAuthoringEditor.js';
import { createWorkbenchDevelopmentClient } from './development-client.js';
import {WorkbenchCreationPage} from './WorkbenchCreationPage.js';

export interface WorkbenchAuthoringPanelProps {
  readonly identityScopeKey: string;
  readonly entryRequest?:AuthoringEntry;
  readonly canOpen?: (id:string)=>boolean;
  readonly onOpen?: (id:string)=>void;
  readonly native: WorkbenchNativeAuthoringEditorProps['native'];
  readonly onClose: () => void;
}
interface Selection { readonly developmentId: string; readonly workbenchId: string; readonly packageName: string; readonly existing?: boolean }

/** One identity-scoped authoring surface. New identities are generated once per
 * explicit creation; restoration always uses the Host's persisted identities. */
export function WorkbenchAuthoringPanel(props: WorkbenchAuthoringPanelProps) {
  return <Panel key={`${props.identityScopeKey}:${props.entryRequest?.revision??0}`} {...props} />;
}
function Panel(props: WorkbenchAuthoringPanelProps) {
  const client = useMemo(() => createWorkbenchDevelopmentClient(), []);
  const [current,setCurrent]=useState<WorkbenchDevelopmentIndexEntry>();
  const [resumedCreation,setResumedCreation]=useState<CreationView>();
  const [editing,setEditing]=useState(false);
  const [shown,setShown]=useState(true);
  const [failedDraft,setFailedDraft]=useState<{id:string;instruction:string;submit?:boolean}>();
  const [draft,setDraft]=useState<{id:string;instruction:string;submit?:boolean}>();
  const [selection, setSelection] = useState<Selection>();
  const [creating,setCreating]=useState(props.entryRequest?.view==='create');
  const [section, setSection] = useState<'development' | 'package' | 'history'>('development');
  const [opening, setOpening] = useState(false);
  const [checking,setChecking]=useState(false);
  const [resumeNotice,setResumeNotice]=useState<string>();
  const [goal,setGoal]=useState<{firstIteration:string;acceptance:string}>();
  const [error, setError] = useState<string>();
  const [deliveryRefresh,setDeliveryRefresh]=useState(0);
  const request = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => request.current?.abort(), []);
  function create() {
    setFailedDraft(undefined);setDraft(undefined);setGoal(undefined);setResumeNotice(undefined);setChecking(false);
    request.current?.abort();request.current=undefined;setResumedCreation(undefined);setCurrent(undefined);setEditing(false);setCreating(true);setSelection(undefined);setOpening(false);setError(undefined);
  }
  function createFromCompleteRequirements() {
    setFailedDraft(undefined);setDraft(undefined);setGoal(undefined);setResumeNotice(undefined);setChecking(false);
    request.current?.abort(); request.current = undefined;
    const id = crypto.randomUUID();
    setSelection({ developmentId: id, workbenchId: `workdsh.user-${id}`, packageName: `workdsh-workbench-${id}` });
    setCreating(false);setEditing(true);
    setOpening(false); setError(undefined); setSection('development');
  }
  function back() {
    setFailedDraft(undefined);setDraft(undefined);setGoal(undefined);setResumeNotice(undefined);setChecking(false);
    request.current?.abort(); request.current = undefined;
    setOpening(false); setError(undefined); setSection('development'); setSelection(undefined);setCurrent(undefined);setResumedCreation(undefined);setEditing(false);setCreating(false);
  }
  async function restore(developmentId: string) {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setOpening(true); setError(undefined);
    try {
      const entries = await client.list(controller.signal);
      controller.signal.throwIfAborted();
      let entry = entries.find(row => row.development.id === developmentId);
      if (!entry) throw new Error('workbench/development-not-found');
      setGoal(undefined);setResumeNotice(undefined);
      if(entry.development.session||entry.development.state!=='requirements'){
        try{
          const prepared=await prepareWorkbenchResume(client,createWorkbenchRequirementsClient(),developmentId,controller.signal);
          entry=prepared.entry;setGoal(prepared.requirements);setResumeNotice('已核对需求、运行环境、源码与原生会话。准备草稿后，在原生会话中检查并发送。');
        }catch(cause){controller.signal.throwIfAborted();setError(resumeFailureMessage(cause));}
      }
      controller.signal.throwIfAborted();
      setFailedDraft(undefined);setCurrent(entry);setEditing(!entry.development.session);setDraft(undefined);
      setSection('development');
      setCreating(false);
      setSelection({ developmentId: entry.development.id, workbenchId: entry.development.workbenchId, packageName: entry.development.packageName, existing: true });
    } catch (cause) {
      if (!controller.signal.aborted) setError(resumeFailureMessage(cause));
      throw cause;
    } finally {
      if (request.current === controller) { request.current = undefined; if (!controller.signal.aborted) setOpening(false); }
    }
  }
  async function resumeSaved(prepareDraft=true){
    if(!current||request.current)return;
    const controller=new AbortController();request.current=controller;setChecking(true);setGoal(undefined);setResumeNotice(undefined);setError(undefined);
    try{
      const prepared=await prepareWorkbenchResume(client,createWorkbenchRequirementsClient(),current.development.id,controller.signal);
      controller.signal.throwIfAborted();setCurrent(prepared.entry);setGoal(prepared.requirements);setSection('development');
      if(prepareDraft)setDraft({id:`development-start:${prepared.entry.development.id}:${prepared.entry.development.requirementsRevision}`,instruction:prepared.instruction,submit:true});
      else setResumeNotice('已重新核对需求、运行环境、源码与原生会话。未发送消息。');
    }catch(cause){if(!controller.signal.aborted)setError(resumeFailureMessage(cause));}
    finally{if(request.current===controller){request.current=undefined;if(!controller.signal.aborted)setChecking(false);}}
  }

  async function restoreDiscussion(id:string){
    setFailedDraft(undefined);setDraft(undefined);setGoal(undefined);setResumeNotice(undefined);setChecking(false);
    request.current?.abort();const controller=new AbortController();request.current=controller;setOpening(true);setError(undefined);
    try{
      const rows=await createWorkbenchCreationClient().list(controller.signal);controller.signal.throwIfAborted();
      const row=rows.find(row=>row.id===id&&row.phase==='discussing');if(!row)throw Error('workbench/creation-not-found');
      setSelection(undefined);setResumedCreation(row);setCreating(true);
    }catch(cause){if(!controller.signal.aborted)setError('无法恢复讨论，原有会话已保留，请刷新重试。');throw cause;}
    finally{if(request.current===controller){request.current=undefined;if(!controller.signal.aborted)setOpening(false);}}
  }
  useEffect(()=>{
    if(props.entryRequest?.developmentId)void restore(props.entryRequest.developmentId).catch(()=>{});
    else if(props.entryRequest?.creationId)void restoreDiscussion(props.entryRequest.creationId).catch(()=>{});
  },[]);
  return <section className="wd-workbenches" aria-label="工作台开发" style={{height:'100%',overflow:'auto'}}>
    <style>{workbenchSurfaceStyles}</style>
    <header className="wd-authoring-back" style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, padding: '16px 28px 0' }}>
      <span className="wd-authoring-context">工作台 <span aria-hidden="true"> / </span>{creating?'创建工作台':selection?'继续制作':'我的开发'}</span>
      {(selection||creating) && <button onClick={back}>我的开发</button>}
      <button onClick={() => { request.current?.abort(); props.onClose(); }}>返回工作台管理</button>
    </header>
    {error && <p role="alert" style={{ padding: '0 28px' }}>{error}</p>}{failedDraft&&<div style={{padding:'0 28px'}}><button onClick={()=>{setDraft(failedDraft);}}>重新提交本轮开发</button></div>}
    {opening && <p role="status" style={{ padding: '0 28px' }}>正在恢复开发记录…</p>}
    {opening ? null : creating ? <><WorkbenchCreationPage initialCreation={resumedCreation} key={`${props.identityScopeKey}:${resumedCreation?.id??'new'}`} identityScopeKey={props.identityScopeKey} native={props.native} onCancel={back} onDevelopmentReady={id=>void restore(id).catch(()=>{})}/><details className="wd-creation-manual"><summary>已有完整需求？</summary><p>可以直接填写需求摘要。</p><button onClick={createFromCompleteRequirements}>填写完整需求</button></details></> : selection ? <>
      {selection.existing && <header className="wd-making-header"><div><span className="wd-making-eyebrow">应用开发</span><h1>{current?.title??'正在读取应用'}</h1><p>接着已有会话继续制作，需求和修改记录保留在同一应用中。</p></div><button onClick={()=>setShown(value=>!value)}>{shown?'收起 AI 对话':'展开 AI 对话'}</button></header>}
      {selection.existing && <nav className="wd-making-tabs" aria-label="开发记录内容">
        <button aria-pressed={section === 'development'} onClick={() => setSection('development')}>开发与修改</button>
        <button aria-pressed={section === 'package'} onClick={() => { setSection('package'); }}>安装试用</button>
        <button aria-pressed={section === 'history'} onClick={() => setSection('history')}>安装记录</button>
      </nav>}
      {current?.development.session&&<NativeWorkbenchConversation native={props.native} sessionId={current.development.session.sessionId} identityScopeKey={`${props.identityScopeKey}:${current.development.id}`} active={shown} onClose={()=>setShown(false)} onToolSettled={()=>setDeliveryRefresh(value=>value+1)} draftRequest={draft} onDraftReady={()=>{setShown(true);setDraft(undefined);setFailedDraft(undefined);setError(undefined);setResumeNotice(draft?.submit?'开发指令已交给原生会话处理；发送结果与执行状态以原生会话为准。':'草稿已放入原生输入框，请检查后发送。');}} onDraftError={(_id,cause)=>{const uncertain=cause instanceof Error&&cause.message==='workbench/conversation-submit-unconfirmed';setFailedDraft(uncertain?undefined:draft);setDraft(undefined);setError(uncertain?'原生发送结果尚未确认，请在原生会话中核对；平台不会自动重发。':'本轮指令尚未提交，原有草稿未覆盖。请处理原有草稿后重试。');}} onError={()=>setError('原生会话暂时无法恢复，制作记录已保留。')}/>}
      {section==='development'&&!editing&&current&&<section className="wd-making-body"><WorkbenchDelivery key={current.development.id} submitting={checking||!!draft} submissionMessage={resumeNotice} submissionError={error} entry={current} criteria={goal?.acceptance} refreshToken={deliveryRefresh} canOpen={props.canOpen} onOpen={props.onOpen} onPackage={()=>setSection('package')} onFeedback={()=>setEditing(true)} onContinue={()=>void resumeSaved()}/><details className="wd-making-baseline"><summary>继续开发或记录修改意见</summary><div className="wd-making-next"><h2>按已保存需求继续开发</h2><p>可以直接描述要改的地方，也可以补充资料、查看执行过程。原有对话、模型和权限设置继续使用。</p>{goal&&<dl><dt>本轮制作范围</dt><dd>{goal.firstIteration}</dd><dt>完成标准</dt><dd>{goal.acceptance}</dd></dl>}{checking&&<p role="status">正在核对最新需求、运行环境、源码与原生会话…</p>}{resumeNotice&&<p role="status">{resumeNotice}</p>}<button data-variant="primary" disabled={checking||!!draft} onClick={()=>void resumeSaved()}>{checking?'正在核对…':draft?'正在准备草稿…':'开始本轮开发'}</button><button disabled={checking||!!draft} onClick={()=>void resumeSaved(false)}>重新核对</button><button onClick={()=>setShown(true)}>查看已有对话</button><button onClick={()=>setEditing(true)}>记录本轮修改意见</button></div></details><details className="wd-making-baseline"><summary>查看已保存需求</summary><SavedRequirements developmentId={current.development.id}/></details></section>}
      <div hidden={section !== 'development'||!editing}><WorkbenchNativeAuthoringEditor key={selection.developmentId} {...selection}
        identityScopeKey={props.identityScopeKey} native={props.native} onCancel={()=>selection.existing?setEditing(false):back()}
        onDraftPrepared={(entry,instruction)=>{setGoal(undefined);setResumeNotice(undefined);setCurrent(entry);setEditing(false);setDraft({id:`development-start:${entry.development.id}:${entry.development.requirementsRevision}`,instruction,submit:true});}}
        onDevelopmentReady={developmentId => setSelection(current => current?.developmentId === developmentId ? { ...current, existing: true } : current)} /></div>
      {selection.existing && section === 'package' && <>
          <WorkbenchSourceCandidates key={selection.developmentId} developmentId={selection.developmentId}
            canOpen={props.canOpen} onOpen={props.onOpen} onClose={() => {setSection('development');}}
            onRefresh={async () => {
              const entries = await client.list();
              if (!entries.some(entry => entry.development.id === selection.developmentId)) throw new Error('workbench/development-not-found');
            }} />
        <details className="wd-install-manual"><summary>已有插件包？手动导入</summary><p>适用于在其他环境完成开发的版本。</p><WorkbenchPackageUpload key={selection.developmentId} developmentId={selection.developmentId} workbenchId={selection.workbenchId} packageName={selection.packageName} /></details>
      </>}
      {selection.existing && section === 'history' && <WorkbenchImportHistory key={`history-${selection.developmentId}`} developmentId={selection.developmentId} workbenchId={selection.workbenchId} packageName={selection.packageName} />}
      </> :
      <WorkbenchDevelopmentsPanel canOpen={props.canOpen} onOpen={props.onOpen} identityScopeKey={props.identityScopeKey} onCreate={create} onDiscuss={restoreDiscussion} onContinue={restore} />}
  </section>;
}

function SavedRequirements({developmentId}:{developmentId:string}){
 const [summary,setSummary]=useState<{scenario:string;workflow:string;firstIteration:string}>();const [failed,setFailed]=useState(false);
 useEffect(()=>{const request=new AbortController();void import('./requirements-client.js').then(({createWorkbenchRequirementsClient})=>createWorkbenchRequirementsClient().history(developmentId,request.signal)).then(rows=>{if(!request.signal.aborted)setSummary(rows.at(-1)?.requirements);}).catch(()=>{if(!request.signal.aborted)setFailed(true);});return()=>request.abort();},[developmentId]);
 return failed?<p role="alert">需求暂时无法读取，请重新打开。</p>:summary?<dl><dt>要完成的工作</dt><dd>{summary.scenario}</dd><dt>业务流程</dt><dd>{summary.workflow}</dd><dt>当前制作范围</dt><dd>{summary.firstIteration}</dd></dl>:<p role="status">正在读取需求…</p>;
}
