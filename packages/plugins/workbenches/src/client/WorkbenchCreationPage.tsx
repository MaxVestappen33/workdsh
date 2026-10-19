import React,{useEffect,useMemo,useRef,useState} from 'react';
import {NativeWorkbenchConversation} from './native-conversation.js';
import {createWorkbenchCreationClient,creationOpeningDraft,type CreationView} from './creation-client.js';
import {WorkbenchRequirementsForm} from './WorkbenchRequirementsForm.js';
import type {WorkbenchNativeAuthoringEditorProps} from './WorkbenchNativeAuthoringEditor.js';
import {createWorkbenchRequirementsClient} from './requirements-client.js';
import {createWorkbenchDevelopmentInstruction} from './development-instruction.js';
import {creationProposalReview,restoreCreationReview,type WorkbenchCreationReview} from './creation-review.js';
import type {WorkbenchDevelopmentIndexEntry,WorkbenchRequirementsDraft} from 'workdsh-contracts';

export function WorkbenchCreationPage(props:{identityScopeKey:string;native:WorkbenchNativeAuthoringEditorProps['native'];initialCreation?:CreationView;onCancel:()=>void;onDevelopmentReady:(id:string)=>void}){
  const client=useMemo(()=>createWorkbenchCreationClient(),[]);
  const requirementsClient=useMemo(()=>createWorkbenchRequirementsClient(),[]);
  const [idea,setIdea]=useState(props.initialCreation?.idea??'');const [id,setId]=useState<string>(()=>crypto.randomUUID());
  const [creation,setCreation]=useState<CreationView|undefined>(props.initialCreation);const [history,setHistory]=useState<CreationView[]>([]);
  const [development,setDevelopment]=useState<WorkbenchDevelopmentIndexEntry>();
  const [review,setReview]=useState<WorkbenchCreationReview|undefined>(()=>props.initialCreation?creationProposalReview(props.initialCreation):undefined);
  const edited=useRef<WorkbenchRequirementsDraft|undefined>(undefined);
  const reviewChoice=useRef(0);
  const [recovery,setRecovery]=useState<{id:string;state:'pending'|'ready'|'failed'}|undefined>(()=>props.initialCreation?.phase==='discussing'?{id:props.initialCreation.id,state:'pending'}:undefined);
  const [recoveryAttempt,setRecoveryAttempt]=useState(0);
  const [busy,setBusy]=useState(false),[error,setError]=useState<string>(),[shown,setShown]=useState(true);
  const [opening,setOpening]=useState<{id:string;instruction:string;submit?:boolean}>();
  const [openingIssued,setOpeningIssued]=useState(false);
  const [developmentIssued,setDevelopmentIssued]=useState(false);
  const request=useRef<AbortController|undefined>(undefined);const current=useRef(creation);current.current=creation;
  useEffect(()=>{const controller=new AbortController();void client.list(controller.signal).then(rows=>{if(!controller.signal.aborted)setHistory(rows.filter(row=>row.phase==='discussing'));}).catch(()=>{});return()=>{controller.abort();request.current?.abort();};},[client]);
  useEffect(()=>{
    const row=current.current;if(!row||row.phase!=='discussing')return;
    const controller=new AbortController(),choice=reviewChoice.current;
    setRecovery({id:row.id,state:'pending'});
    void requirementsClient.history(row.id,controller.signal).then(rows=>{
      if(controller.signal.aborted||current.current?.id!==row.id||current.current.phase!=='discussing')return;
      setReview(existing=>restoreCreationReview(row,rows,existing,!!edited.current||reviewChoice.current!==choice));
      setRecovery({id:row.id,state:'ready'});
    }).catch(()=>{if(!controller.signal.aborted&&current.current?.id===row.id)setRecovery({id:row.id,state:'failed'});});
    return()=>controller.abort();
  },[creation?.id,props.identityScopeKey,requirementsClient,recoveryAttempt]);
  async function start(requestId=id,input=idea){
    request.current?.abort();const controller=new AbortController();request.current=controller;
    setBusy(true);setError(undefined);
    try{
      const result=await client.open(requestId,input,controller.signal);controller.signal.throwIfAborted();
      if(result.phase==='confirmed'){props.onDevelopmentReady(result.id);return;}
      if(current.current?.id!==result.id){edited.current=undefined;reviewChoice.current++;setReview(creationProposalReview(result));setRecovery({id:result.id,state:'pending'});}
      setCreation(result);setId(result.id);setIdea(result.idea);
      if(result.needsOpening)setOpening({id:`creation-opening:${result.id}`,instruction:creationOpeningDraft(result),submit:true});
    }catch(cause){if(!controller.signal.aborted)setError('暂时无法开始，想法已保留。请重试；不会重复创建应用。');}
    finally{if(request.current===controller){request.current=undefined;if(!controller.signal.aborted)setBusy(false);}}
  }
  async function refresh(signal:AbortSignal){
    const before=current.current;if(!before||signal.aborted)return;
    const rows=await client.list(signal);signal.throwIfAborted();
    if(current.current?.id!==before.id)return;
    const updated=rows.find(row=>row.id===before.id);if(updated?.phase==='confirmed'&&!development){props.onDevelopmentReady(updated.id);return;}if(updated){setCreation(updated);if(updated.proposal)setReview(existing=>existing??creationProposalReview(updated));}
  }
  async function prepareDevelopment(entry:WorkbenchDevelopmentIndexEntry,signal?:AbortSignal){
    const saved=(await createWorkbenchRequirementsClient().history(entry.development.id,signal)).at(-1);signal?.throwIfAborted();
    if(!saved||saved.id!==entry.development.requirementsRevision)throw Error('workbench/requirements-revision-conflict');
    setOpening({id:`development-start:${entry.development.id}:${entry.development.requirementsRevision}`,instruction:createWorkbenchDevelopmentInstruction(saved,entry.development),submit:true});
  }
  async function retryDevelopment(entry:WorkbenchDevelopmentIndexEntry){
    request.current?.abort();const controller=new AbortController();request.current=controller;
    try{await prepareDevelopment(entry,controller.signal);}catch{if(!controller.signal.aborted)setError('开发草稿暂时无法准备，请从开发记录继续。');}
    finally{if(request.current===controller)request.current=undefined;}
  }
  return <section className="wd-creation-page" style={{padding:'32px 28px',maxWidth:900,margin:'0 auto'}} aria-label="制作应用">
    <header style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12}}><h1>{creation?'一起完善你的应用':'你想做一个什么工作台？'}</h1>{creation&&<button onClick={()=>setShown(value=>!value)}>{shown?'收起 AI 对话':'展开 AI 对话'}</button>}</header>
    {!creation?<>
      <p className="wd-creation-intro">用一句话说说你想完成的工作，AI 会帮你一起梳理。</p>
      <div className="wd-creation-input"><label htmlFor="workbench-idea">我想让这个工作台帮我…</label><textarea id="workbench-idea" aria-label="应用想法" value={idea} maxLength={4000} rows={4} onChange={event=>{setIdea(event.target.value);setId(crypto.randomUUID());}} placeholder="例如：每周有几张检验表，我想整理出趋势和一份周报。" style={{width:'100%',boxSizing:'border-box',padding:16,border:'1px solid var(--dsw-alias-border-l2,#dce2e9)',borderRadius:12,font:'inherit'}} disabled={busy}/></div>
      <div className="wd-creation-examples" style={{display:'flex',gap:8,flexWrap:'wrap',margin:'16px 0'}}>{['把合同和到期日期整理成台账','跟踪团队每周的工作进度','把检验表整理成趋势和周报'].map(example=><button key={example} disabled={busy} onClick={()=>{setIdea(example);setId(crypto.randomUUID());}}>{example}</button>)}</div>
      <button data-variant="primary" disabled={busy||!idea.trim()} onClick={()=>void start()}>{busy?'正在准备原生对话…':'开始梳理需求'}</button>
      <p>先讨论需求，确认后再开始制作。</p>
      {history.length>0&&<section style={{marginTop:28}}><h2>继续之前的想法</h2>{history.map(row=><button key={row.id} disabled={busy} onClick={()=>void start(row.id,row.idea)} style={{display:'block',margin:'8px 0'}}>{row.idea.slice(0,80)}</button>)}</section>}
    </>:<>
      <p style={{padding:16,background:'var(--dsw-alias-bg-layer-2,transparent)',color:'var(--dsw-alias-label-primary,inherit)',borderRadius:10}}>{creation.idea}</p>
      <NativeWorkbenchConversation native={props.native} sessionId={creation.sessionId} identityScopeKey={`${props.identityScopeKey}:${creation.id}`} active={shown} onClose={()=>setShown(false)} draftRequest={opening}
        onDraftReady={()=>{setShown(true);if(opening?.id.startsWith('development-start:'))setDevelopmentIssued(true);if(opening?.submit)setOpeningIssued(true);setOpening(undefined);setError(undefined);}}
        onDraftError={()=>{setOpening(undefined);setError('原生对话已有输入或暂时不可写，已保留原内容。请在原生会话中检查已有草稿及发送结果；不会自动重复发送。');}}
        onToolSettled={event=>{void refresh(event.signal).catch(()=>{if(!event.signal.aborted)setError('需求摘要读取未完成，可以刷新重试。');});}} onError={()=>setError('原生对话暂时无法打开，请重试。')}/>
      {development?(!developmentIssued&&<button disabled={!!opening} onClick={()=>void retryDevelopment(development)}>{opening?'正在提交开发指令…':'开始开发'}</button>):!openingIssued&&!review?<button disabled={!!opening} onClick={()=>{setOpening({id:`creation-opening:${creation.id}`,instruction:creationOpeningDraft(creation),submit:true});}}>{opening?'正在交给原生会话…':'发送开场，开始梳理'}</button>:null}
      {development?<section role="status" style={{padding:24,marginTop:24,border:'1px solid var(--dsw-alias-border-l2,#dce2e9)',borderRadius:12}}><h2>需求已确认，开发工程已准备</h2><p>{developmentIssued?'开发指令已交给原生会话处理，发送结果与执行状态以原生会话为准。':'需求已保存，开发指令尚未确认提交。平台会保留已有输入，并提示需要处理的冲突。'}</p><button onClick={()=>props.onDevelopmentReady(development.development.id)}>查看开发记录与安装试用</button></section>:recovery?.id===creation.id&&recovery.state!=='ready'?<section role="status"><p>{recovery.state==='pending'?'正在读取已保存需求…':'暂时无法读取已保存需求。为保留上次修改，请读取成功后再确认。'}</p>{recovery.state==='failed'&&<button onClick={()=>setRecoveryAttempt(value=>value+1)}>重新读取需求</button>}</section>:review?<>
        {review.revision!==creation.revision&&<section role="status"><p>AI 有新的摘要，当前修改已保留。</p><button onClick={()=>{edited.current=undefined;reviewChoice.current++;setReview(creationProposalReview(creation));}}>使用 AI 新摘要</button><button onClick={()=>{reviewChoice.current++;setReview({...review,revision:creation.revision,draft:edited.current??review.draft});}}>保留我的版本继续</button></section>}
        <WorkbenchRequirementsForm key={`${review.revision}:${review.seed}`} initial={review.draft} title="核对应用需求摘要" description="可以修改后进入开发；尚未确定的内容可以继续在原生会话中讨论。" submitLabel="确认需求并开始开发" singlePage onDraftChange={draft=>{edited.current=draft;}} onCancel={props.onCancel} onSave={async requirements=>{
          request.current?.abort();const controller=new AbortController();request.current=controller;
          try{const result=await client.confirm(creation.id,review.revision,requirements,controller.signal);controller.signal.throwIfAborted();setCreation(result.creation);setDevelopment(result.development);
            try{await prepareDevelopment(result.development,controller.signal);}catch{if(!controller.signal.aborted)setError('需求已保存，但开发尚未提交。可点击“开始开发”重试；已有输入会保留。');}
          }catch(cause){if(!controller.signal.aborted)throw cause;}finally{if(request.current===controller)request.current=undefined;}
        }}/>
      </>:<section style={{margin:'28px 0',padding:24,border:'1px solid var(--dsw-alias-border-l2,#dce2e9)',borderRadius:12}}><h2>先聊清楚要完成的工作</h2><p>开始后，AI 会在原生会话中逐步询问，并把需求摘要放到这里。发送状态、模型和权限沿用原生会话。需求确认后才进入开发。</p></section>}
    </>}
    {error&&<p role="alert">{error}</p>}
  </section>;
}
