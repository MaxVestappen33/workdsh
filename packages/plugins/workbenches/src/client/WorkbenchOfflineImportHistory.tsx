import React,{useEffect,useMemo,useRef,useState} from 'react';
import {createWorkbenchOfflineImportsClient,type WorkbenchOfflineImport} from './offline-imports-client.js';
import {WorkbenchImportHistory} from './WorkbenchImportHistory.js';
export function WorkbenchOfflineImportHistory(){
 const client=useMemo(()=>createWorkbenchOfflineImportsClient(),[]);
 const [rows,setRows]=useState<readonly WorkbenchOfflineImport[]>([]),[selected,setSelected]=useState('');
 const [busy,setBusy]=useState(false),[message,setMessage]=useState<string>();
 const request=useRef<AbortController|undefined>(undefined);
 async function refresh(){request.current?.abort();const controller=new AbortController();request.current=controller;setBusy(true);setMessage(undefined);
  try{const result=await client(controller.signal);if(request.current===controller){setRows(result);setSelected(current=>result.some(row=>row.importId===current)?current:result[0]?.importId??'');}}
  catch{if(!controller.signal.aborted&&request.current===controller)setMessage('无法读取导入历史，请重试。');}
  finally{if(request.current===controller){request.current=undefined;setBusy(false);}}
 }
 useEffect(()=>{void refresh();return()=>request.current?.abort();},[]);
 const row=rows.find(row=>row.importId===selected);
 return <section aria-label="离线导入历史" style={{border:'1px solid #e2e8f0',borderRadius:12,padding:16,margin:'16px 0'}}>
  <h2>离线导入历史</h2><p>选择一个插件，查看并核对原来的安装操作。</p>
  <select aria-label="选择导入插件" value={selected} onChange={event=>setSelected(event.currentTarget.value)} disabled={busy||!rows.length}>
   {!rows.length&&<option value="">暂无离线导入记录</option>}{rows.map(item=><option key={item.importId} value={item.importId}>{item.packageName}</option>)}
  </select> <button disabled={busy} onClick={()=>void refresh()}>刷新记录</button>
  {busy&&<p role="status">正在读取…</p>}{message&&<p role="alert">{message}</p>}
  {row&&<WorkbenchImportHistory key={row.importId} developmentId={row.importId} packageName={row.packageName} workbenchId={row.workbenchId}/>}
 </section>;
}
