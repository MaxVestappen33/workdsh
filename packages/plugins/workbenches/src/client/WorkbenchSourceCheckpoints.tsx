import React,{useEffect,useRef,useState} from 'react';
import type {SourceCheckpointSummary,VerifiedSourceCheckpoint} from './source-checkpoints.js';
export function WorkbenchSourceCheckpoints({developmentId,load,verify}:{developmentId:string;load:(id:string,signal?:AbortSignal)=>Promise<readonly SourceCheckpointSummary[]>;verify?:(id:string,hash:string,signal?:AbortSignal)=>Promise<VerifiedSourceCheckpoint>}){
 const [open,setOpen]=useState(false),[attempt,setAttempt]=useState(0),[rows,setRows]=useState<readonly SourceCheckpointSummary[]>([]),[loading,setLoading]=useState(false),[error,setError]=useState(false),[page,setPage]=useState(0);
 const active=useRef<AbortController|null>(null),[checking,setChecking]=useState<string|null>(null),[results,setResults]=useState<Record<string,string>>({});
 async function check(row:SourceCheckpointSummary){
  if(!verify||active.current)return;
  const request=new AbortController();active.current=request;setChecking(row.sha256);
  try{const result=await verify(developmentId,row.sha256,request.signal);if(!request.signal.aborted)setResults(previous=>({...previous,[row.sha256]:result.fileCount===row.fileCount&&result.byteLength===row.byteLength?'文件校验通过':'摘要已变化，请重新读取'}));}
  catch{if(!request.signal.aborted)setResults(previous=>({...previous,[row.sha256]:'校验未通过，请核对备份或重试'}));}
  finally{if(active.current===request){active.current=null;if(!request.signal.aborted)setChecking(null);}}
 }
 useEffect(()=>{
  active.current?.abort();active.current=null;setChecking(null);setResults({});
  if(!open)return;const request=new AbortController();setLoading(true);setError(false);setRows([]);setPage(0);
  void load(developmentId,request.signal).then(value=>{if(!request.signal.aborted){setRows(value);setLoading(false);}}).catch(()=>{if(!request.signal.aborted){setError(true);setLoading(false);}});
  return()=>{request.abort();active.current?.abort();active.current=null;};
 },[open,attempt,developmentId,load,verify]);
 const pages=Math.max(1,Math.ceil(rows.length/5)),current=Math.min(page,pages-1);
 return <section aria-label="源码恢复点"><button type="button" aria-expanded={open} onClick={()=>setOpen(value=>!value)}>{open?'收起源码恢复点':'查看源码恢复点'}</button>
 {open&&<div style={{marginTop:12,maxHeight:320,overflow:'auto'}}>
 <p>仅保留开发源码，不包含业务数据。恢复前仍需校验备份文件；恢复操作尚未开放。</p>
 {loading&&<p role="status">正在读取恢复点…</p>}{error&&<p role="alert">无法读取恢复点，请核对当前账号和开发记录。<button onClick={()=>setAttempt(value=>value+1)}>重试</button></p>}
 {!loading&&!error&&!rows.length&&<p>尚无源码恢复点。准备开发源码后可在这里查看。</p>}
 {!loading&&!error&&rows.slice(current*5,(current+1)*5).map(row=><p key={row.sha256}>源码版本 {row.sha256.slice(0,12)} · {row.fileCount} 个文件 · {(row.byteLength/1024).toFixed(1)} KB {verify&&<button disabled={checking!==null} onClick={()=>void check(row)}>{checking===row.sha256?'正在校验…':'校验文件'}</button>} {results[row.sha256]&&<span role="status">{results[row.sha256]}</span>}</p>)}
 {rows.length>5&&<nav aria-label="源码恢复点分页"><button disabled={current===0} onClick={()=>setPage(current-1)}>上一页</button><span> {current+1} / {pages} </span><button disabled={current+1>=pages} onClick={()=>setPage(current+1)}>下一页</button></nav>}
 </div>}
 </section>;
}
