import React,{useEffect,useRef,useState} from 'react';
import {QualityRecordRequestError} from './record-client.js';
import type {createQualityRecordClient} from './record-client.js';
import type {QualityExpertAssociation} from '../runtime/expert-association.js';
type Client=Pick<ReturnType<typeof createQualityRecordClient>,'availableExperts'|'prepareExpertTask'|'createExpertTask'>;
export type QualityExpertDraft=(sessionId:string,instruction:string,signal:AbortSignal)=>Promise<void>;
export function QualityExpertTask({client,recordId,runId,contentHash,onDraft,onCreated}:{client:Client;recordId:string;runId:string;contentHash:string;onDraft?:QualityExpertDraft;onCreated:(association:QualityExpertAssociation)=>void}){
 const [choices,setChoices]=useState<Awaited<ReturnType<Client['availableExperts']>>>([]),[expertId,setExpertId]=useState('');
 const [plan,setPlan]=useState<Awaited<ReturnType<Client['prepareExpertTask']>>>();
 const [busy,setBusy]=useState(false),[message,setMessage]=useState<string>();
 const pending=useRef<AbortController|undefined>(undefined);
 useEffect(()=>()=>pending.current?.abort(),[]);
 async function perform(operation:(signal:AbortSignal)=>Promise<void>){
  if(pending.current)return;const request=new AbortController();pending.current=request;setBusy(true);setMessage(undefined);
  try{await operation(request.signal);}catch(cause){if(!request.signal.aborted){
   const code=cause instanceof QualityRecordRequestError?cause.code:undefined;
   if(code==='quality/expert/plan-expired'){setPlan(undefined);setMessage('计划已过期，请重新点击“准备任务”。');}
   else if(code==='quality/expert/unavailable'||code==='quality/expert/not-ready'){setPlan(undefined);setMessage('专家权限、状态或依赖已变化，请重新选择专家并准备任务。');}
   else setMessage('操作尚未确认。请重试同一计划以核对已有任务；不要重新准备计划。');
  }}
  finally{if(pending.current===request){pending.current=undefined;if(!request.signal.aborted)setBusy(false);}}
 }
 async function load(){await perform(async signal=>{const rows=await client.availableExperts(recordId,runId,contentHash,signal);signal.throwIfAborted();setChoices(rows);setExpertId(rows[0]?.id??'');setPlan(undefined);if(!rows.length)setMessage('暂无可用的已发布专家，请在系统专家管理中配置。');});}
 async function prepare(){await perform(async signal=>{const next=await client.prepareExpertTask(recordId,runId,contentHash,expertId,signal);signal.throwIfAborted();setPlan(next);});}
 async function create(){if(!plan||!onDraft)return;const selected=plan;await perform(async signal=>{
  const result=await client.createExpertTask(recordId,runId,contentHash,selected.executionPlanId,signal);signal.throwIfAborted();
  if(result.association.expertId!==selected.expertId||result.association.expertRevisionId!==selected.expertRevisionId)throw Error('invalid-expert-task');
  onCreated(result.association);
  await onDraft(result.association.sessionId,result.instruction,signal);signal.throwIfAborted();setMessage('任务已关联，提示词已进入专家会话草稿。请检查并发送，回复完成后回到这里读取。');
 });}
 return <section aria-label="准备专家解读" style={{padding:'12px 0'}}>
  <button disabled={busy} onClick={()=>void load()}>选择专家解读本次分析</button>
  {choices.length>0&&<div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',marginTop:12}}><select aria-label="选择质量解读专家" disabled={busy} value={expertId} onChange={event=>{setExpertId(event.target.value);setPlan(undefined);setMessage(undefined);}}>{choices.map(row=><option key={row.id} value={row.id}>{row.name}</option>)}</select><button disabled={busy||!expertId} onClick={()=>void prepare()}>准备任务</button></div>}
  {plan&&<div style={{marginTop:12}}><p>专家：{choices.find(row=>row.id===plan.expertId)?.name??plan.expertId} · 固定版本 {plan.expertRevisionId}。将创建独立专家会话，关联本次分析；不会自动发送提示词。</p><button disabled={busy||!onDraft} onClick={()=>void create()}>确认创建并打开专家草稿</button></div>}
  {message&&<p role="status">{message}</p>}
 </section>;
}
