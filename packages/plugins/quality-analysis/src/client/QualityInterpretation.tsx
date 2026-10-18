import {QualityExpertTask,type QualityExpertDraft} from './QualityExpertTask.js';
import type {QualityExpertAssociation} from '../runtime/expert-association.js';
import type {QualityInterpretationReceipt} from '../runtime/run-store.js';
import React,{useEffect,useRef,useState} from 'react';
import type {createQualityRecordClient} from './record-client.js';
type Client=Pick<ReturnType<typeof createQualityRecordClient>,'aiCandidate'|'adoptInterpretation'|'expertSources'|'expertCandidate'|'adoptExpertInterpretation'|'availableExperts'|'prepareExpertTask'|'createExpertTask'>;
export function QualityInterpretation({client,recordId,runId,contentHash,openLibrary,onExpertDraft,receipts=[]}:{client:Client;recordId:string;runId:string;contentHash:string;openLibrary?:()=>void;onExpertDraft?:QualityExpertDraft;receipts?:readonly QualityInterpretationReceipt[]}){
 const [candidate,setCandidate]=useState<Awaited<ReturnType<Client['aiCandidate']>>>();
 const [saved,setSaved]=useState<Awaited<ReturnType<Client['adoptInterpretation']>>>();
 const [expertSources,setExpertSources]=useState<readonly QualityExpertAssociation[]>([]);
 const [sourceSession,setSourceSession]=useState('');
 const source=expertSources.find(row=>row.sessionId===sourceSession);
 const [busy,setBusy]=useState(false),[message,setMessage]=useState<string>();
 const pending=useRef<AbortController|undefined>(undefined);
 useEffect(()=>()=>pending.current?.abort(),[]);
 async function refreshSources(){if(pending.current)return;const request=new AbortController();pending.current=request;setBusy(true);setMessage(undefined);
  try{const rows=await client.expertSources(recordId,runId,contentHash,request.signal);if(request.signal.aborted)return;setExpertSources(rows);setCandidate(undefined);setSaved(undefined);if(!rows.some(row=>row.sessionId===sourceSession))setSourceSession('');if(!rows.length)setMessage('本次分析尚未关联专家任务。普通会话仍可读取；其他运行的专家任务不会列在这里。');}
  catch{if(!request.signal.aborted)setMessage('专家来源读取未完成，请核对登录和权限。');}
  finally{if(pending.current===request){pending.current=undefined;if(!request.signal.aborted)setBusy(false);}}
 }
 async function read(){if(pending.current)return;const request=new AbortController();pending.current=request;setBusy(true);setMessage(undefined);setCandidate(undefined);
  try{const next=await (source?client.expertCandidate(source,request.signal):client.aiCandidate(recordId,runId,contentHash,request.signal));if(request.signal.aborted)return;setCandidate(next);setSaved(prior=>prior?.candidateHash===next?.candidateHash?prior:receipts.find(row=>row.candidateHash===next?.candidateHash));if(!next)setMessage('尚无已完成解读。请先在原生会话发送本次分析提示词，待回复完成后再读取。');}
  catch{if(!request.signal.aborted)setMessage('解读读取未完成，请先确认本次分析的原生会话已创建并完成回复。');}
  finally{if(pending.current===request){pending.current=undefined;if(!request.signal.aborted)setBusy(false);}}
 }
 async function adopt(){if(pending.current||!candidate)return;const selected=candidate;const request=new AbortController();pending.current=request;setBusy(true);setMessage(undefined);
  try{const receipt=await (source?client.adoptExpertInterpretation(source,selected.candidateHash,request.signal):client.adoptInterpretation(recordId,runId,contentHash,selected.candidateHash,request.signal));if(!request.signal.aborted){setSaved(receipt);setMessage('已采纳并保存到资料库。原统计和历史报告保持不变。');}}
  catch{if(!request.signal.aborted)setMessage('保存尚未确认；可重试同一候选。若会话回复已变化，请重新读取并核对。');}
  finally{if(pending.current===request){pending.current=undefined;if(!request.signal.aborted)setBusy(false);}}
 }
 const catalog=[...receipts,...(saved&&!receipts.some(row=>row.candidateHash===saved.candidateHash)?[saved]:[])];
 return <section className="wd-quality-interpretation" aria-label="AI 解读成果" style={{marginTop:16,paddingTop:14,borderTop:'1px solid var(--dsw-alias-border-l2, #dce2e9)'}}>
  <p style={{margin:'0 0 10px',fontSize:12,lineHeight:1.65,color:'var(--dsw-alias-label-secondary, #657185)'}}>采纳后的 AI 解读是资料库中的独立成果，引用本次分析；现有统计报告正文保持不变。</p>
  <details><summary>读取与确认解读{catalog.length>0?` · ${catalog.length} 份已保存`:''}</summary><p style={{fontSize:13}}>原生会话回复完成后，读取并检查内容，再确认保存。</p>
   <div className="wd-quality-interpretation-toolbar" style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',margin:'12px 0'}}><label style={{display:'flex',gap:8,alignItems:'center'}}>解读来源 <select aria-label="解读来源" disabled={busy} value={sourceSession} onChange={event=>{setSourceSession(event.target.value);setCandidate(undefined);setSaved(undefined);setMessage(undefined);}}><option value="">本次分析的原生会话</option>{expertSources.map((row,index)=><option key={row.sessionId} value={row.sessionId}>关联专家任务 {index+1}</option>)}</select></label><button disabled={busy} onClick={()=>void read()}>{busy?'正在处理…':'读取解读'}</button><button disabled={busy} onClick={()=>void refreshSources()}>刷新专家来源</button></div>
   {source&&<details style={{fontSize:12,color:'var(--dsw-alias-label-secondary, #657185)',margin:'12px 0'}}><summary>查看专家来源标识</summary><p style={{overflowWrap:'anywhere'}}>专家 {source.expertId} · 修订 {source.expertRevisionId} · 会话 {source.sessionId}。读取和采纳时会重新校验任务权限。</p></details>}
   <details className="wd-quality-expert-preparation" style={{margin:'12px 0'}}><summary>委托专家进一步解读</summary>{onExpertDraft?<QualityExpertTask client={client} recordId={recordId} runId={runId} contentHash={contentHash} onDraft={onExpertDraft} onCreated={association=>{setExpertSources(rows=>[...rows.filter(row=>row.sessionId!==association.sessionId),association]);setSourceSession(association.sessionId);setCandidate(undefined);setSaved(undefined);}}/>:<p style={{fontSize:13,color:'var(--dsw-alias-label-secondary, #657185)'}}>专家会话草稿交接尚未接入；已有的关联专家任务仍可读取。</p>}</details>
   {candidate&&<QualityInterpretationCandidate candidate={candidate} contentHash={contentHash} busy={busy} adopted={saved?.candidateHash===candidate.candidateHash} onAdopt={()=>void adopt()}/>}
   {catalog.length>0&&<section className="wd-quality-interpretation-saved" aria-label="已采纳的解读" style={{marginTop:16}}><h4 style={{fontSize:14,margin:'0 0 10px'}}>已保存的解读成果</h4><ul style={{listStyle:'none',margin:0,padding:0,display:'grid',gap:8}}>{catalog.map((row,index)=><li key={row.candidateHash} style={{padding:'10px 12px',border:'1px solid var(--dsw-alias-border-l2, #dce2e9)',borderRadius:8}}><div style={{display:'flex',justifyContent:'space-between',gap:12,fontSize:13}}><strong>解读成果 {index+1}</strong><span>已保存到资料库</span></div><details style={{fontSize:12,color:'var(--dsw-alias-label-secondary, #657185)',marginTop:6}}><summary>查看成果标识</summary><dl style={{overflowWrap:'anywhere'}}><dt>解读候选</dt><dd>{row.candidateHash}</dd><dt>资料版本</dt><dd>{row.revisionId}</dd></dl></details></li>)}</ul>{openLibrary&&<button style={{marginTop:10}} onClick={openLibrary}>在资料库查看解读成果</button>}</section>}
   {message&&<p role="status">{message}</p>}
  </details>
 </section>;
}

/** A completed native reply remains a candidate until the Host confirms adoption. */
export function QualityInterpretationCandidate({candidate,contentHash,busy,adopted,onAdopt}:{candidate:NonNullable<Awaited<ReturnType<Client['aiCandidate']>>>;contentHash:string;busy:boolean;adopted:boolean;onAdopt:()=>void}){
 return <section aria-label="待采纳的 AI 解读" className="wd-quality-interpretation-candidate" style={{padding:16,border:'1px solid var(--dsw-alias-border-l2, #dce2e9)',borderRadius:10,marginTop:14}}><header style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,flexWrap:'wrap'}}><h4 style={{margin:0,fontSize:14}}>{adopted?'已采纳的解读':'请确认解读内容'}</h4><span style={{fontSize:12,color:'var(--dsw-alias-label-secondary, #657185)'}}>第 {candidate.turn} 轮回复</span></header>
  <div aria-label="AI 解读候选正文" style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',fontSize:14,lineHeight:1.8,margin:'14px 0',maxHeight:360,overflowY:'auto'}}>{candidate.text}</div>
  <div style={{display:'flex',gap:12,alignItems:'center',flexWrap:'wrap'}}><button className="wd-quality-primary" disabled={busy||adopted} onClick={onAdopt}>{adopted?'已采纳并保存':'确认采纳并保存到资料库'}</button><details style={{fontSize:12,color:'var(--dsw-alias-label-secondary, #657185)'}}><summary>查看解读来源</summary><dl style={{overflowWrap:'anywhere'}}><dt>分析指纹</dt><dd>{contentHash}</dd><dt>解读候选</dt><dd>{candidate.candidateHash}</dd><dt>原生会话</dt><dd>{candidate.sessionId}</dd></dl></details></div>
 </section>;
}
