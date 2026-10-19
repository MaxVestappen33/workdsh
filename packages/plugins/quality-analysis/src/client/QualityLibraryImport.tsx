import React,{useEffect,useRef,useState} from 'react';
import type {createQualityRecordClient} from './record-client.js';
import type {QualityLibraryImportResult} from './library-import-result.js';
import {describeLibraryImportError,type QualityLibraryImportError} from './library-import-error.js';
export interface QualityLibraryChoice {readonly assetId:string;readonly revisionId:string;readonly title:string;readonly format:'csv'|'xlsx';}
export interface QualityLibraryImportProps {
 readonly identityScopeKey:string;readonly recordId:string;readonly generation:number;readonly tableKind:'inspections'|'defects';readonly baseSourceSnapshotId?:string;
 readonly client:Pick<ReturnType<typeof createQualityRecordClient>,'importLibrary'>;
 readonly selectSource?:(signal:AbortSignal)=>Promise<QualityLibraryChoice|undefined>;readonly selectedSource?:QualityLibraryChoice;
 readonly beforeImport?:()=>boolean;
 readonly onReconcile?:(signal:AbortSignal)=>Promise<void>;
 readonly onReady:(result:Extract<QualityLibraryImportResult,{status:'ready'}>)=>void;
}
/** Selection is supplied by the Library owner. Host independently checks the selected revision. */
export function QualityLibraryImport(props:QualityLibraryImportProps){return <ImportBody key={`${props.identityScopeKey}/${props.recordId}/${props.generation}/${props.tableKind}/${props.baseSourceSnapshotId??'new'}`} {...props}/>;}
function ImportBody(props:QualityLibraryImportProps){
 const [source,setSource]=useState<QualityLibraryChoice>(),[sheets,setSheets]=useState<readonly string[]>(),[worksheet,setWorksheet]=useState(''),[headerRow,setHeaderRow]=useState(1),[busy,setBusy]=useState(false),[error,setError]=useState<QualityLibraryImportError>();const pending=useRef<AbortController|undefined>(undefined);
 useEffect(()=>()=>{pending.current?.abort();pending.current=undefined;},[]);
 useEffect(()=>{pending.current?.abort();pending.current=undefined;setBusy(false);setError(undefined);setSource(props.selectedSource);setSheets(undefined);setWorksheet('');setHeaderRow(1);},[props.selectedSource]);
 async function action(work:(signal:AbortSignal)=>Promise<void>,operation:'import'|'select'|'reconcile'='import'){if(pending.current)return;const request=new AbortController();pending.current=request;setBusy(true);setError(undefined);
  try{await work(request.signal);}catch(cause){if(!request.signal.aborted&&pending.current===request)setError(describeLibraryImportError(cause,operation));}finally{if(pending.current===request){pending.current=undefined;setBusy(false);}}
 }
 async function select(signal:AbortSignal){const picked=await props.selectSource?.(signal);signal.throwIfAborted();if(!picked)return;setSource(Object.freeze({...picked}));setSheets(undefined);setWorksheet('');setHeaderRow(1);}
 async function load(signal:AbortSignal){if(!source||props.beforeImport?.()===false)return;
  const result=await props.client.importLibrary({recordId:props.recordId,reference:{assetId:source.assetId,revisionId:source.revisionId},format:source.format,tableKind:props.tableKind,headerRow:source.format==='csv'?1:headerRow,...(worksheet?{worksheet}:{}),...(props.baseSourceSnapshotId?{baseSourceSnapshotId:props.baseSourceSnapshotId}:{}),expectedGeneration:props.generation},signal);signal.throwIfAborted();
  if(result.status==='worksheet_required'){setSheets(result.worksheets);setWorksheet('');}else props.onReady(result);
 }
 return <section aria-label="导入资料数据">
  {props.selectSource&&<button type="button" disabled={busy} onClick={()=>void action(select,'select')}>从资料库选择</button>}
  {source&&<div className="wd-quality-library-selected"><strong>{source.title}</strong><p className="wd-quality-data-caption">{source.format==='xlsx'?(props.tableKind==='inspections'?'选择包含检验明细的工作表；列名行通常包含编号、日期和检验数量。':'选择包含缺陷明细的工作表，并确认实际列名所在行。'):'CSV 文件 · 导入后确认数据列'}</p><div className="wd-quality-library-options">
   {source.format==='xlsx'&&<>{sheets&&<label>选择工作表<select aria-label="导入工作表" value={worksheet} disabled={busy} onChange={event=>{setWorksheet(event.target.value);setError(undefined);}}><option value="">请选择工作表</option>{sheets.map(name=><option key={name} value={name}>{name}</option>)}</select></label>}<label>列名所在行<input aria-label="列名所在行" type="number" min={1} max={10000} value={headerRow} disabled={busy} onChange={event=>{setHeaderRow(Number(event.target.value));setError(undefined);}}/></label></>}
   <button type="button" className="wd-quality-primary" disabled={busy||!!sheets&&!worksheet||!Number.isSafeInteger(headerRow)||headerRow<1||headerRow>10000} onClick={()=>void action(load)}>{busy?'正在导入…':sheets?'导入选中工作表':'导入检验数据'}</button>
  </div></div>}
  {busy&&<p role="status" className="wd-quality-data-caption">正在读取文件… <button type="button" onClick={()=>{pending.current?.abort();pending.current=undefined;setBusy(false);setError({message:'已停止等待。导入结果尚未确认，请重新读取检验数据后核对。',reconcile:true});}}>停止等待</button></p>}
  {error&&<div className="wd-quality-data-notice"><p role="alert">{error.message}</p>{error.reconcile&&props.onReconcile&&<button type="button" disabled={busy} onClick={()=>void action(props.onReconcile!,'reconcile')}>重新读取检验表</button>}</div>}
 </section>;
}
