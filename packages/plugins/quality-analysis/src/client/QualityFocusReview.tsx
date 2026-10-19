import React,{useEffect,useRef,useState} from 'react';
import type {QualityFocusSelection} from '../domain/analysis-focus.js';
import type {QualityRunView} from './run-view.js';
import type {createQualityRecordClient} from './record-client.js';
import type {QualityAiContext} from './ai-context.js';
import {qualityCount,qualityPercentage} from './result-presentation.js';

export interface QualityFocusReviewProps {
 readonly view:QualityRunView;
 readonly selection:QualityFocusSelection;
 readonly client:Pick<ReturnType<typeof createQualityRecordClient>,'focusInspections'>;
 readonly aiContext?:QualityAiContext;
 readonly disabled?:boolean;
 readonly onSelect:(selection:QualityFocusSelection)=>void;
 readonly onOpenAi?:(selection:QualityFocusSelection,signal:AbortSignal)=>Promise<void>;
 readonly onClose:()=>void;
}
type Page=Awaited<ReturnType<QualityFocusReviewProps['client']['focusInspections']>>;
/** Business evidence from the authorized saved run, separate from mutable raw-file edits. */
export function QualityFocusReview({view,selection,client,aiContext,disabled=false,onSelect,onOpenAi,onClose}:QualityFocusReviewProps){
 const [page,setPage]=useState<Page>(),[offset,setOffset]=useState(0),[attempt,setAttempt]=useState(0);
 const [loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState<string>();
 const request=useRef<AbortController|undefined>(undefined),section=useRef<HTMLElement>(null);
 useEffect(()=>{
  const controller=new AbortController();setPage(undefined);setLoading(true);setError(undefined);
  void client.focusInspections(view.recordId,view.runId,view.contentHash,selection,offset,controller.signal).then(value=>{
   if(controller.signal.aborted)return;setPage(value);section.current?.scrollIntoView?.({block:'nearest'});
  },()=>{if(!controller.signal.aborted)setError('当前分析中暂时无法定位这些记录，请重新读取。');}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  return()=>controller.abort();
 },[client,view.recordId,view.runId,view.contentHash,selection,offset,attempt]);
 useEffect(()=>()=>request.current?.abort(),[]);
 async function openAi(next:QualityFocusSelection){
  if(!onOpenAi||disabled||request.current||!page)return;
  const controller=new AbortController();request.current=controller;setBusy(true);setError(undefined);
  try{await onOpenAi(next,controller.signal);}catch{if(!controller.signal.aborted)setError('记录暂未交给 AI，已有输入和分析保持原状。请核对右侧对话后重试。');}
  finally{if(request.current===controller){request.current=undefined;if(!controller.signal.aborted)setBusy(false);}}
 }
 const target=selection.kind==='inspection'?`检验记录 ${selection.inspectionId}`:`${selection.date.replaceAll('-','/')} 的检验记录`;
 const handed=aiContext?.recordId===view.recordId&&aiContext.runId===view.runId&&aiContext.contentHash===view.contentHash&&JSON.stringify(aiContext.selectedFocus)===JSON.stringify(selection);
 return <section ref={section} className="wd-quality-result-panel wd-quality-focus-review" aria-label="所选检验记录" style={{padding:20,border:'1px solid var(--dsw-alias-border-l2,#dce2e9)',borderRadius:12,minWidth:0}}>
  <header style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,flexWrap:'wrap'}}><div><h3 style={{margin:0,fontSize:16}}>{target}</h3><p style={{margin:'6px 0',fontSize:12,color:'var(--dsw-alias-label-secondary,#657185)'}}>{page?`本次已保存分析中的 ${qualityCount(page.total)} 条记录`:'正在定位记录…'}{handed?' · 已关联当前 AI 会话':''}</p></div><div style={{display:'flex',gap:8}}>{onOpenAi&&<button className="wd-quality-primary" disabled={disabled||loading||busy||!page?.total} onClick={()=>void openAi(selection)}>{busy?'正在关联…':'与 AI 核查'}</button>}<button disabled={disabled||busy} onClick={onClose}>收起记录</button></div></header>
  {loading&&<p role="status">正在读取对应检验记录…</p>}
  {error&&<p role="alert">{error} <button disabled={loading||busy} onClick={()=>setAttempt(value=>value+1)}>重新读取</button></p>}
  {page&&<><div style={{overflowX:'auto'}}><table style={{width:'100%',borderCollapse:'collapse',fontSize:13,textAlign:'left'}}><thead><tr>{['检验编号','检验日期','产线','检验数量','不合格数量','不合格率','操作'].map(label=><th key={label} style={{padding:'10px 8px',borderBottom:'1px solid #dce2e9',whiteSpace:'nowrap'}}>{label}</th>)}</tr></thead><tbody>{page.rows.map(row=>{const item=row.inspection;return <tr key={item.inspectionId} aria-selected={selection.kind==='inspection'&&selection.inspectionId===item.inspectionId}>{[item.inspectionId,item.inspectionDate,item.lineId??'未提供',qualityCount(item.inspectedQuantity),qualityCount(item.nonconformingQuantity),qualityPercentage(item.inspectedQuantity?item.nonconformingQuantity/item.inspectedQuantity:null)].map((value,index)=><td key={index} style={{padding:'10px 8px',borderBottom:'1px solid #e6e9ed',whiteSpace:'nowrap'}}>{value}</td>)}<td><button disabled={disabled||busy} aria-label={`选择检验记录 ${item.inspectionId}`} onClick={()=>onSelect({kind:'inspection',inspectionId:item.inspectionId})}>选择记录</button></td></tr>;})}</tbody></table></div>
   {!page.total&&<p>这个周期没有可核查的检验记录。</p>}
   {page.total>20&&<nav aria-label="所选记录分页" style={{display:'flex',justifyContent:'flex-end',gap:8,marginTop:12}}><button disabled={disabled||offset===0||loading||busy} onClick={()=>setOffset(Math.max(0,offset-20))}>上一页</button><span>共 {qualityCount(page.total)} 条</span><button disabled={disabled||page.nextOffset===null||loading||busy} onClick={()=>{if(page.nextOffset!==null)setOffset(page.nextOffset);}}>下一页</button></nav>}
   <p style={{fontSize:12,color:'var(--dsw-alias-label-secondary,#657185)'}}>选择记录后，可在原生对话中继续核查；统计和报告仍采用原分析范围。</p>
  </>}
 </section>;
}
