import type {LibraryOriginalPreviewRegistry} from 'workdsh-contracts/library';
import {QualitySourcePreview} from './QualitySourcePreview.js';
import React,{useEffect,useRef,useState} from 'react';
import {LibraryAssetPicker,type createLibraryClient,type LibraryAssetPickerProps} from 'workdsh-plugin-library/client';
import {QualityLibraryImport,type QualityLibraryImportProps,type QualityLibraryChoice} from './QualityLibraryImport.js';
import {qualityLibraryChoice} from './library-choice.js';
export interface QualityLibraryInputProps extends Omit<QualityLibraryImportProps,'selectSource'|'selectedSource'> {
 readonly management:LibraryAssetPickerProps['management']&Pick<ReturnType<typeof createLibraryClient>,'readOriginal'|'saveOriginalRevision'>&Partial<Pick<ReturnType<typeof createLibraryClient>,'importFile'>>;
 readonly previewRegistry?:LibraryOriginalPreviewRegistry;
 readonly openOriginal?:(source:QualityLibraryChoice,signal?:AbortSignal)=>Promise<void>;
 readonly openLibrary:()=>void;
 readonly initialSource?:QualityLibraryChoice;
}
/** Selection and upload use the public Library owner; this component does not own files. */
export function QualityLibraryInput(props:QualityLibraryInputProps){return <InputBody key={`${props.identityScopeKey}/${props.recordId}/${props.generation}/${props.tableKind}/${props.baseSourceSnapshotId??'new'}`} {...props}/>;}
function InputBody(props:QualityLibraryInputProps){
 const [source,setSource]=useState<QualityLibraryChoice|undefined>(props.initialSource);
 const [uploading,setUploading]=useState(false),[error,setError]=useState<string>();
 const upload=useRef<HTMLInputElement>(null),pending=useRef<AbortController|undefined>(undefined);
 useEffect(()=>()=>{pending.current?.abort();pending.current=undefined;},[]);
 useEffect(()=>{if(props.initialSource)setSource(props.initialSource);},[props.initialSource]);
 function select(choice:QualityLibraryChoice){if(pending.current)return false;setSource(choice);setError(undefined);return true;}
 async function uploadFile(file:File){
  if(pending.current||!props.management.importFile)return;
  if(!/\.(csv|xlsx)$/i.test(file.name)){setError('请选择 Excel（.xlsx）或 CSV 文件。');return;}
  if(!file.size||file.size>8*1024*1024){setError('请选择不超过 8 MB 的非空 Excel 或 CSV 文件。');return;}
  const request=new AbortController();pending.current=request;setUploading(true);setError(undefined);
  try{const entry=await props.management.importFile(file);request.signal.throwIfAborted();const choice=qualityLibraryChoice(entry);if(!choice)throw Error('invalid-upload');setSource(choice);}
  catch{if(!request.signal.aborted)setError('上传结果暂未确认。请在资料库查看后选择文件，避免重复上传。');}
  finally{if(pending.current===request){pending.current=undefined;if(!request.signal.aborted)setUploading(false);}if(upload.current)upload.current.value='';}
 }
 return <section className="wd-quality-library-input" aria-label={props.tableKind==='inspections'?'选择检验表':'选择缺陷明细'}>
  <header><strong>{props.tableKind==='inspections'?'选择检验文件':'选择缺陷明细'}</strong><span>支持 Excel（.xlsx）和 CSV，文件会保存在资料库。</span></header>
  <div className="wd-quality-library-choice"><input ref={upload} hidden type="file" accept=".csv,.xlsx" aria-label="上传质量分析文件" onChange={event=>{const file=event.currentTarget.files?.[0];if(file)void uploadFile(file);}}/>
   {props.management.importFile&&<button type="button" disabled={uploading} onClick={()=>upload.current?.click()}>{uploading?'正在上传…':'上传文件'}</button>}
   <LibraryAssetPicker management={props.management} openLibrary={props.openLibrary} triggerLabel="从资料库选择" onSelect={entry=>{const choice=qualityLibraryChoice(entry);return !!choice&&select(choice);}}/>
   {!props.management.importFile&&<button type="button" onClick={props.openLibrary}>上传到资料库</button>}
  </div>
  {uploading&&<p role="status" className="wd-quality-data-caption">正在将文件保存到资料库…</p>}{error&&<p role="alert">{error}</p>}
  <QualityLibraryImport {...props} selectedSource={source}/>
  {source&&props.previewRegistry&&<QualitySourcePreview source={source} registry={props.previewRegistry} openOriginal={props.openOriginal} beforeOpen={()=>!uploading&&props.beforeImport?.()!==false}/>}
 </section>;
}
