import * as React from 'react';
import {useEffect,useRef,useState,useSyncExternalStore} from 'react';
import type {LibraryOriginalPreviewRegistry,LibraryTreeEntry} from 'workdsh-contracts/library';
import type {LibraryClient} from './management.js';
import {createLibraryOriginalRevisionSave} from './original-revision-save.js';

export interface LibraryOriginalSurfaceProps {
 source:{assetId:string;revisionId:string;name:string;kind:'csv'|'xlsx'};
 management:Pick<LibraryClient,'readOriginal'|'saveOriginalRevision'>;
 previewRegistry:LibraryOriginalPreviewRegistry;
 onSaved?:(entry:LibraryTreeEntry)=>void;
 /** Saving is busy; the caller owns close and source-switch controls. */
 onBusyChange?:(busy:boolean)=>void;
}

/** A Library-owned surface reuses the system Office provider without owning an editor. */
export function LibraryOriginalSurface({source,management,previewRegistry,onSaved,onBusyChange}:LibraryOriginalSurfaceProps){
 const providerRevision=useSyncExternalStore(previewRegistry.subscribe,previewRegistry.getRevision,previewRegistry.getRevision);
 const host=useRef<HTMLDivElement>(null);
 const callbacks=useRef({onSaved,onBusyChange});callbacks.current={onSaved,onBusyChange};
 const [loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState('');
 useEffect(()=>{
  const controller=new AbortController(),container=host.current;
  let active=true,saving=false,dispose:undefined|(()=>void),surface:HTMLDivElement|undefined;
  const signal=controller.signal;
  setLoading(true);setError('');setNotice('');
  const busy=(value:boolean)=>{if(!active)return;saving=value;callbacks.current.onBusyChange?.(value);};
  const release=()=>{const current=dispose;dispose=undefined;try{current?.();}finally{surface?.remove();}};
  const run=async()=>{
   try{
    if(!container||!source.assetId||!source.revisionId||!source.name)throw new Error('invalid-source');
    if(source.kind!=='csv'&&source.kind!=='xlsx')throw new Error('unsupported-source');
    if(!previewRegistry.canOpen(source.kind))throw new Error('unavailable-provider');
    const bytes=await management.readOriginal(source.assetId,source.revisionId,signal);signal.throwIfAborted();
    if(!active)return;
    // A separate target per generation prevents a late provider from changing the next file.
    surface=document.createElement('div');surface.style.cssText='height:100%;min-height:0;width:100%;overflow:hidden';
    container.append(surface);
    const save=source.kind==='xlsx'?createLibraryOriginalRevisionSave(source,
     (input,saveSignal)=>management.saveOriginalRevision(input,saveSignal),
     entry=>{if(active&&!signal.aborted){setNotice('新版本已保存。可采用新版本继续分析。');callbacks.current.onSaved?.(entry);}}):undefined;
    const mounted=await previewRegistry.mount(surface,{name:source.name,kind:source.kind,bytes,
     ...(save?{onSaveOriginal:async(nextBytes:Uint8Array,officeSignal:AbortSignal)=>{
      signal.throwIfAborted();if(!active)throw new Error('文件已关闭。');
      if(saving)throw new Error('源文件正在保存，请等待结果。');
      busy(true);setNotice('正在保存源文件…');
      try{await save(nextBytes,AbortSignal.any([signal,officeSignal]));}
      catch(cause){if(active&&!signal.aborted)setNotice('保存结果未确认，请在资料库核对新版本后重试。');throw cause;}
      finally{busy(false);}
     }}:{})});
    if(!active||signal.aborted){try{mounted();}finally{surface.remove();}return;}
    dispose=mounted;setLoading(false);
   }catch(cause){
    if(!active||signal.aborted)return;
    release();setLoading(false);
    setError(cause instanceof Error&&cause.message==='unavailable-provider'?'系统 Office 暂未就绪，请稍后重试。':
     cause instanceof Error&&cause.message==='unsupported-source'?'此处仅支持 CSV 和 Excel 文件。':'源文件无法打开，请核对文件访问权限后重试。');
   }
  };
  void run();
  return()=>{active=false;controller.abort();if(saving){saving=false;callbacks.current.onBusyChange?.(false);}release();};
 },[source.assetId,source.revisionId,source.name,source.kind,management,previewRegistry,providerRevision]);
 return <section aria-label="系统 Office 源文件" style={{height:'100%',minHeight:0,display:'flex',flexDirection:'column',overflow:'hidden'}}>
  {notice&&<p role="status" style={{margin:0,padding:'10px 16px',fontSize:13,color:'var(--dsw-alias-label-secondary)'}}>{notice}</p>}
  {error?<p role="alert" style={{padding:16,margin:0}}>{error}</p>:loading&&<p role="status" style={{padding:16,margin:0}}>正在打开源文件…</p>}
  <div ref={host} style={{flex:1,minHeight:0,width:'100%',overflow:'hidden'}} />
 </section>;
}
