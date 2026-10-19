import React,{useEffect,useRef,useState} from 'react';
import {QualityRecordRequestError,type createQualityRecordClient,type QualityRunPage,type QualityRunSummary} from './record-client.js';
export interface QualityHistoryLoadState {readonly recordId:string;readonly busy:boolean;readonly error?:string;readonly total?:number;}
export interface QualityHistoryProps {readonly identityScopeKey:string;readonly recordId:string;readonly client:Pick<ReturnType<typeof createQualityRecordClient>,'runs'>;readonly onSelect:(run:QualityRunSummary)=>void;readonly selectLatestOnLoad?:boolean;readonly onLoadState?:(state:QualityHistoryLoadState)=>void;}
export function QualityHistory(props:QualityHistoryProps){return <HistoryBody key={`${props.identityScopeKey}/${props.recordId}`} {...props}/>;}
function HistoryBody({recordId,client,onSelect,selectLatestOnLoad,onLoadState}:QualityHistoryProps){
 const selectedInitial=useRef(false);const selection=useRef(onSelect);selection.current=onSelect;
 const [page,setPage]=useState<QualityRunPage>(),[busy,setBusy]=useState(true),[error,setError]=useState<string>();const pending=useRef<AbortController|undefined>(undefined);
 const stateCallback=useRef(onLoadState);stateCallback.current=onLoadState;
 useEffect(()=>{stateCallback.current?.({recordId,busy,error,total:page?.total});},[recordId,busy,error,page]);
 async function load(offset:number,revision?:number){
  pending.current?.abort();const request=new AbortController();pending.current=request;setBusy(true);setError(undefined);
  try{const next=await client.runs(recordId,offset,20,revision,request.signal);if(pending.current===request&&!request.signal.aborted){setPage(next);
   // The Host returns newest-first immutable runs. Only the first successful
   // page may choose a default; refresh/paging must preserve user selection.
   if(offset===0&&!selectedInitial.current){selectedInitial.current=true;if(selectLatestOnLoad&&next.entries[0])selection.current(next.entries[0]);}
  }}
  catch(cause){if(pending.current===request&&!request.signal.aborted)setError(cause instanceof QualityRecordRequestError&&cause.code==='quality/store/revision-conflict'?'历史分析已有变化，请刷新列表。':'历史分析读取失败，请重试。');}
  finally{if(pending.current===request&&!request.signal.aborted){pending.current=undefined;setBusy(false);}}
 }
 useEffect(()=>{void load(0);return()=>{pending.current?.abort();pending.current=undefined;};},[client,recordId]);
 return <section aria-label="历史分析"><button disabled={busy} onClick={()=>void load(0)}>刷新历史</button>
  {busy&&<p role="status">正在读取历史分析…</p>}{error&&<p role="alert">{error}</p>}
  {!busy&&!error&&page?.total===0&&<p>尚无已完成分析。</p>}
  <ul>{page?.entries.map(run=><li key={run.runId}><button disabled={busy||!!error} onClick={()=>onSelect(run)}>{new Date(run.createdAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})} · 检验 {run.inspectedQuantity} · 不合格 {run.nonconformingQuantity}</button></li>)}</ul>
  {page&&page.total>20&&<nav aria-label="历史分析分页"><button disabled={busy||!!error||!page||page.offset===0} onClick={()=>page&&void load(Math.max(0,page.offset-20),page.revision)}>上一页</button><button disabled={busy||!!error||!page||page.offset+page.entries.length>=page.total} onClick={()=>page&&void load(page.offset+20,page.revision)}>下一页</button></nav>}
 </section>;
}
