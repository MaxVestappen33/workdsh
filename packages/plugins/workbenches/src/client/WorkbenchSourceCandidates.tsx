import {packageCheckMessage} from './package-check-message.js';
import React,{useEffect,useMemo,useRef,useState} from 'react';
import {parseWorkbenchDescriptor} from 'workdsh-contracts';
import {WorkbenchPackagePreview,type WorkbenchCandidatePreview} from './WorkbenchPackagePreview.js';
import {createWorkbenchDevelopmentClient} from './development-client.js';
import {assertWorkbenchCandidateIdentity,readWorkbenchCandidateDevelopment,type WorkbenchCandidateDevelopment} from './candidate-development.js';
export function WorkbenchSourceCandidates(props:{developmentId:string;onClose:()=>void;onRefresh:()=>Promise<void>;canOpen?:(id:string)=>boolean;onOpen?:(id:string)=>void}){
 const developmentClient=useMemo(()=>createWorkbenchDevelopmentClient(),[]);
 const [development,setDevelopment]=useState<WorkbenchCandidateDevelopment>();
 const [rows,setRows]=useState<readonly {fileName:string;candidate?:WorkbenchCandidatePreview;errorCode?:string}[]>();
 const [selected,setSelected]=useState<WorkbenchCandidatePreview>();
 const [error,setError]=useState<string>();const [busy,setBusy]=useState(false);
 const request=useRef<AbortController | undefined>(undefined);
 useEffect(()=>{void inspect();return()=>request.current?.abort();},[]);
 useEffect(()=>{if(rows?.length!==0||selected)return;const timer=setInterval(()=>void inspect(),30000);return()=>clearInterval(timer);},[rows?.length,selected]);
 async function inspect(){
  if(request.current)return;const controller=new AbortController();request.current=controller;setBusy(true);setError(undefined);setRows(undefined);setDevelopment(undefined);
  try{
   const baseline=await readWorkbenchCandidateDevelopment(developmentClient,props.developmentId,undefined,controller.signal);
   const response=await fetch('/api/workdsh-workbench-source-candidates',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({developmentId:props.developmentId}),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(60000)])});
   const envelope=await response.json();controller.signal.throwIfAborted();
   if(!response.ok||envelope.ok!==true)throw Error(envelope.error?.code??'workbench/candidate-check-failed');
   if(!Array.isArray(envelope.value)||envelope.value.length>12)throw Error('invalid');
   const rows=envelope.value.map((row:any)=>{
    if(typeof row.fileName!=='string'||! /^[a-zA-Z0-9._-]{1,214}\.tgz$/.test(row.fileName))throw Error('invalid');
    if(!row.candidate)return {fileName:row.fileName,errorCode:packageCheckMessage(row.errorCode)};
    const value=row.candidate,receipt=value.package;
    if(!receipt||typeof receipt.packageName!=='string'||typeof receipt.version!=='string'||! /^[a-f0-9]{64}$/.test(receipt.sha256)||typeof value.compatible!=='boolean')throw Error('invalid');
    const candidate={package:{packageName:receipt.packageName,version:receipt.version,sha256:receipt.sha256},descriptor:parseWorkbenchDescriptor(value.descriptor),compatible:value.compatible};
    assertWorkbenchCandidateIdentity(baseline,candidate);
    return {fileName:row.fileName,candidate};
   });
   await readWorkbenchCandidateDevelopment(developmentClient,props.developmentId,baseline,controller.signal);
   if(request.current===controller){setRows(rows);setDevelopment(baseline);}
  }catch(cause){if(!controller.signal.aborted)setError(candidateCheckMessage(cause));}
  finally{if(request.current===controller){request.current=undefined;setBusy(false);}}
 }
 return <section className="wd-install-page" aria-label="开发产物">
  <header className="wd-install-heading"><div><h2>安装到本机试用</h2><p>查看 AI 已生成的版本，确认后安装。</p></div><button disabled={busy||!!selected} onClick={()=>void inspect()}>{busy?'正在检查…':'刷新版本'}</button></header>
  {!selected&&(busy||(!rows&&!error))&&<div className="wd-install-state" role="status"><span className="wd-install-symbol" aria-hidden="true">↻</span><h3>正在查找可试用版本</h3><p>读取当前应用的开发目录并核验插件包。</p></div>}
  {!selected&&error&&<div className="wd-install-state" role="alert"><span className="wd-install-symbol" aria-hidden="true">!</span><h3>暂时无法检查版本</h3><p>{error}</p><button data-variant="primary" onClick={()=>void inspect()}>重新检查</button><button onClick={props.onClose}>回到开发对话</button></div>}
  {!selected&&rows?.length===0&&<div className="wd-install-state"><span className="wd-install-symbol" aria-hidden="true">□</span><h3>还没有可安装的版本</h3><p>请在右侧开发对话中让 AI 完成应用并生成插件包。完成后这里会自动重新检查，也可以点击“刷新版本”。</p><button data-variant="primary" onClick={props.onClose}>继续开发</button></div>}
  {!selected&&!!rows?.length&&<><div className="wd-install-list-heading"><h3>{rows.some(row=>row.candidate)?`可检查版本 · ${rows.filter(row=>row.candidate).length}`:'开发产物需要修正'}</h3><span>选择一个版本查看安装信息</span></div><div className="wd-install-versions">{rows.map(row=><article key={row.fileName}><div className="wd-install-version-info"><h3>{row.candidate?.descriptor.title??'待修正的插件包'}</h3><p><strong>{row.candidate?`版本 ${row.candidate.package.version}`:row.errorCode}</strong><span className="wd-catalog-status" data-active={row.candidate?.compatible}>{row.candidate?row.candidate.compatible?'可准备安装':'版本不兼容':'核验失败'}</span></p><details><summary>文件信息</summary><p>{row.fileName}</p></details></div>{row.candidate?<button data-variant="primary" disabled={!row.candidate.compatible} onClick={()=>setSelected(row.candidate)}>查看并安装</button>:<button onClick={props.onClose}>返回修正</button>}</article>)}</div></>}
  {selected&&development&&<WorkbenchPackagePreview key={selected.package.sha256+'/'+development.revision} candidate={selected} development={development} canOpen={props.canOpen} onOpen={props.onOpen} onClose={()=>{setSelected(undefined);void inspect();}} onRefresh={props.onRefresh}/>}
 </section>;
}

export function candidateCheckMessage(cause:unknown):string {
 const code=cause instanceof Error?cause.message:'';
 if(code==='workbench/installation-target-changed')return '这份记录来自另一个预览位置，开发目录关联需要修复。重新打包不能解决这个问题。';
 if(code==='workbench/development-source-unavailable')return '这份记录尚未关联开发工程，请先按已保存需求继续开发。';
 if(code==='workbench/development-revision-conflict')return '需求或开发记录刚刚发生变化，请刷新版本后重试。';
 return '暂时无法读取或核验开发版本，请重试。需求和现有文件已保留。';
}
