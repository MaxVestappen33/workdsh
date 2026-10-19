import React,{useEffect,useRef,useState,useSyncExternalStore} from 'react';
import type {LibraryOriginalPreviewRegistry} from 'workdsh-contracts/library';
import type {QualityLibraryChoice} from './QualityLibraryImport.js';

/** Library navigates to the native file panel; this workbench owns no file viewer. */
export function QualitySourcePreview({source,registry,openOriginal,beforeOpen,label,active=true}:{
 source:QualityLibraryChoice;registry:LibraryOriginalPreviewRegistry;
 openOriginal?:(source:QualityLibraryChoice,signal?:AbortSignal)=>Promise<void>;
 beforeOpen?:()=>boolean;label?:string;active?:boolean;
}){
 useSyncExternalStore(registry.subscribe,registry.getRevision,registry.getRevision);
 const [opening,setOpening]=useState(false),[error,setError]=useState(false);
 const alive=useRef(true),pending=useRef(false);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 const available=!!openOriginal&&(source.format==='csv'||source.format==='xlsx');
 async function open(){
  if(!active||!available||pending.current||beforeOpen?.()===false)return;
  pending.current=true;setOpening(true);setError(false);
  try{await openOriginal!(source);}
  catch{if(alive.current)setError(true);}
  finally{pending.current=false;if(alive.current)setOpening(false);}
 }
 return <section className="wd-quality-source-preview" aria-label="源文件">
  <button type="button" title={source.title} disabled={!available||!active||opening} onClick={()=>void open()}>{opening?'正在打开…':label??'在右侧打开源文件'}</button>
  {!available&&<p className="wd-quality-data-caption">系统文件查看服务暂未就绪，可在资料库查看。</p>}
  {error&&<p className="wd-quality-data-caption" role="alert">源文件未能打开，请重试或在资料库查看。</p>}
 </section>;
}
