import React,{useEffect,useRef,useState,useSyncExternalStore} from 'react';
import type {QualityRecordController} from './record-controller.js';
import type {QualityRecordDetail} from './record-client.js';
export interface QualityRecordsProps {readonly identityScopeKey:string;readonly controller:QualityRecordController;readonly onOpen:(record:QualityRecordDetail)=>void;readonly initialRecordId?:string;}
/** Enclosing Client must supply a distinct controller for each identity scope and dispose it when that scope ends. */
export function QualityRecords(props:QualityRecordsProps){return <RecordsBody key={props.identityScopeKey} {...props}/>;}
function RecordsBody({controller,onOpen,initialRecordId}:QualityRecordsProps){
 const state=useSyncExternalStore(controller.subscribe,controller.snapshot,controller.snapshot),[title,setTitle]=useState('');
 const openCallback=useRef(onOpen);openCallback.current=onOpen;
 useEffect(()=>{let active=true;
  void controller.refresh().then(async()=>{
   const latest=controller.snapshot();
   if(!active||latest.busy||latest.error)return;
   const selected=initialRecordId?latest.records.find(row=>row.id===initialRecordId):latest.records.length===1?latest.records[0]:undefined;
   if(!selected)return;
   const detail=await controller.open(selected.id);
   if(active&&detail)openCallback.current(detail);
  });
  return()=>{active=false;controller.cancel();};
 },[controller]);
 return <section className="wd-quality-records" aria-label="质量分析记录"><header><h2>我的分析</h2><span>共 {state.records.length} 条</span></header>
  <button disabled={state.busy} onClick={()=>void controller.refresh()}>刷新列表</button>
  {state.busy&&<button onClick={()=>controller.cancel()}>取消</button>}
  {state.error&&<p role="alert">{state.error}</p>}
  <form onSubmit={event=>{event.preventDefault();void controller.create(state.pendingTitle??title).then(record=>{if(record){setTitle('');void controller.open(record.id).then(detail=>{if(detail)onOpen(detail);});}}).catch(()=>undefined);}}>
   <label>分析名称<input placeholder="例如：本月出厂质量分析" value={state.pendingTitle??title} maxLength={256} disabled={state.busy||!!state.pendingTitle} onChange={event=>setTitle(event.target.value)}/></label>
   <button disabled={state.busy||!(state.pendingTitle??title).trim()}> {state.pendingTitle?'重试创建':'新建分析'}</button>
  </form>
  {!state.records.length&&!state.busy&&<p>尚无分析记录，请创建第一条分析。</p>}
  <ul className="wd-quality-record-list">{state.records.map(record=><li key={record.id}><button disabled={state.busy} onClick={()=>void controller.open(record.id).then(detail=>{if(detail)onOpen(detail);})}>{record.title}<span aria-hidden="true">打开 →</span></button></li>)}</ul>
 </section>;
}
