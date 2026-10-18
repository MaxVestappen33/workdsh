import * as React from 'react';
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/client';
import {createLibraryClient} from './management.js';
import type {Context} from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-client-ui-layout/client';
import type {MainPanelId} from '@deepseek-ai/dsh-client-ui-layout/client';
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client';
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client';
import type {ISessions} from '@deepseek-ai/dsh-api-session-controller/client';
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client';
import type {LibraryOriginalPanelClient,LibraryOriginalPanelInput} from 'workdsh-contracts/library';

const knownKinds=new Set(['markdown','text','pdf','docx','pptx','html','csv','xlsx']);
const pause=(signal:AbortSignal)=>new Promise<void>((resolve,reject)=>{
 signal.throwIfAborted();
 const abort=()=>{clearTimeout(timer);reject(signal.reason);};
 const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},25);
 signal.addEventListener('abort',abort,{once:true});
});
/** The official right panel exists only while a real Session's Conversation is selected. */
export function createLibraryOriginalPanelClient(ctx:Context):LibraryOriginalPanelClient {
 const lifetime=new AbortController();
 let pending:AbortController|undefined;
 ctx.effect(()=>()=>{lifetime.abort();pending?.abort();},'workdsh.library.originalPanel');
 const registered=(id:string)=>ctx.slots.entriesOfSlot('main').some(entry=>entry.options.key===id);
 return {async open(input:LibraryOriginalPanelInput,external?:AbortSignal){
  if(!input.assetId||!input.revisionId||!input.name||!knownKinds.has(input.kind))throw new Error('资料引用不完整，请重新选择文件。');
  if(input.returnPanel&&(!input.returnPanel.id||!input.returnPanel.label||!registered(input.returnPanel.id)))throw new Error('原工作台暂时不可用，请重新打开工作台。');
  pending?.abort();const request=new AbortController();pending=request;
  const signal=AbortSignal.any([lifetime.signal,request.signal,...(external?[external]:[])]);
  signal.throwIfAborted();
  const sessions=ctx.sessions as unknown as ISessions;
  let sessionId=Object.values(sessions.list.getSnapshot().byId).find(row=>(row.retainedBy.mainView??0)>0)?.id;
  if(!sessionId){
   const workspace=ctx.workspaces.list.getSnapshot().items[0];
   if(!workspace)throw new Error('请先选择工作区，再打开源文件。');
   // Public Workspace owner reuses a real blank Session or creates one through the Host.
   sessionId=await ctx.uiWorkspace.connectWorkspace(workspace.workspaceId);
   signal.throwIfAborted();
  }
  ctx.uiWorkspace.openSession(sessionId);
  signal.throwIfAborted();
  ctx.layout.selectPanel(null);
  const params={assetId:input.assetId,revisionId:input.revisionId,name:input.name,kind:input.kind,
   ...(input.returnPanel?{returnPanelId:input.returnPanel.id,returnLabel:input.returnPanel.label}:{}),
   ...(input.kind==='xlsx'?{saveOriginal:true}:{})};
  for(let attempt=0;attempt<80;attempt++){
   signal.throwIfAborted();
   if(ctx.layout.panelInfo.getSnapshot().activePanelId!==null)throw new Error('已切换页面，源文件未打开。');
   const mounted=ctx.sidebarRight.mounted.getSnapshot();
   if(mounted&&mounted!==sessionId)throw new Error('已切换会话，请重新打开源文件。');
   if(mounted===sessionId){
    try{ctx.sidebarRight.openTab('workdsh-library-preview',{params});return;}
    catch{ /* The official seat may not have minted its store until the next render. */ }
   }
   await pause(signal);
  }
  throw new Error('系统文件面板尚未就绪，请重新打开源文件。');
 }};
}

export function returnToLibraryPanel(ctx:Context,id:string):void {
 if(!ctx.slots.entriesOfSlot('main').some(entry=>entry.options.key===id))throw new Error('原工作台暂时不可用。');
 ctx.layout.selectPanel(id as MainPanelId);
}

/** Open the real immutable original through the official file-tab owner. */
export function createLibraryNativeFileClient(ctx:Context){
 const management=createLibraryClient(ctx),lifetime=new AbortController();
 const returns=new Map<string,{id:string;label:string}>();
 ctx.effect(()=>()=>lifetime.abort());
 ctx.slots.inject('sidebar.right.tab.document.actions',()=>ctx.slots.register({name:'sidebar.right.tab.document.actions',id:'workdsh-library-return'},({absolutePath}:{absolutePath:string})=>{
  const target=returns.get(absolutePath);return target ? React.createElement('button',{onClick:()=>returnToLibraryPanel(ctx,target.id)},target.label):null;
 }));
 return {async open(input:{assetId:string;revisionId:string;sessionId?:string;returnPanel:{id:string;label:string}},external?:AbortSignal){
  const signal=AbortSignal.any([lifetime.signal,...(external?[external]:[])]);
  const path=await management.originalFilePath(input.assetId,input.revisionId,signal);signal.throwIfAborted();
  const sessions=ctx.sessions as unknown as ISessions;
  let sessionId=(input.sessionId as ReturnType<ISessions['create']> extends Promise<infer S> ? S : never)??Object.values(sessions.list.getSnapshot().byId).find(row=>(row.retainedBy.mainView??0)>0)?.id;
  if(!sessionId){const workspace=ctx.workspaces.list.getSnapshot().items[0];if(!workspace)throw Error('请先选择工作区。');sessionId=await ctx.uiWorkspace.connectWorkspace(workspace.workspaceId);}
  signal.throwIfAborted();returns.set(path,input.returnPanel);ctx.uiWorkspace.openSession(sessionId);ctx.layout.selectPanel(null);
  const address=`dsh-resource://file/session/${encodeURIComponent(sessionId)}/${path.split('/').map(encodeURIComponent).join('/')}`;
  for(let attempt=0;attempt<80;attempt++){
   signal.throwIfAborted();if(ctx.layout.panelInfo.getSnapshot().activePanelId!==null)throw Error('已切换页面。');
   if(ctx.sidebarRight.mounted.getSnapshot()===sessionId){try{ctx.sidebarRight.openResource(address);return;}catch{}}
   await pause(signal);
  }
  throw Error('原生文件面板尚未就绪，请重试。');
 }};
}
