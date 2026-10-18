import React,{useLayoutEffect,useMemo,useState,useSyncExternalStore} from 'react';
import {createPortal} from 'react-dom';
import type {Context} from '@deepseek-ai/cordis';
import type {WorkbenchPageComponent} from './native-page.js';
import type {WorkbenchPageMount} from './page-lifecycle.js';
import type {WorkbenchShortcuts} from './shortcuts.js';
import {WorkbenchNavigation} from './WorkbenchNavigation.js';
import {NativeWorkbenchConversationSeatProvider,type NativeWorkbenchConversationSeat} from './native-conversation.js';

declare module '@deepseek-ai/dsh-client-ui-slots'{interface SlotMap{
 'workdsh.workbench.frame':{kind:'single';scope:'root';owner:{conversation:React.ReactNode}};
}}
type Entry={mount:WorkbenchPageMount;Page:WorkbenchPageComponent};
/** Layout only: the patched native owner supplies its already-created subtree.
 * No native header, view roster, Composer, SessionProvider or DOM is recreated. */
export function createNativeFrame(ctx:Pick<Context,'slots'|'layout'|'uiWorkspace'>,shortcuts?:WorkbenchShortcuts){
 let entries:Entry[]=[],active:string|undefined,close:(()=>void)|undefined;
 let snapshot={entries,active};const listeners=new Set<()=>void>();
 const publish=()=>{snapshot={entries,active};for(const fn of listeners)fn();};
 const subscribe=(fn:()=>void)=>{listeners.add(fn);return()=>{listeners.delete(fn);};};
 const activate=(key:string)=>{if(!entries.some(e=>e.mount.panelKey===key))throw Error('workbench/frame-page-unavailable');active=key;shortcuts?.setActive(entries.find(e=>e.mount.panelKey===key)?.mount.descriptor.id);publish();ctx.layout.selectPanel(null);};
 function Frame({conversation}:{conversation:React.ReactNode}){
  const state=useSyncExternalStore(subscribe,()=>snapshot,()=>snapshot);
  const [shown,setShown]=useState(false);
  const [container]=useState(()=>{const node=document.createElement('div');Object.assign(node.style,{height:'100%',minHeight:'0',minWidth:'0',flex:'1',display:'flex',flexDirection:'column'});return node;});
  const selected=state.entries.some(e=>e.mount.panelKey===state.active);
  useLayoutEffect(()=>()=>container.remove(),[container]);
  return <div className={`wd-native-frame${selected&&shown?' has-conversation':''}`} data-workdsh-full-native-frame="" style={{height:'100%',minHeight:0,minWidth:0,display:'flex',overflow:'hidden'}}>
   <style>{`.wd-native-business{flex:1;min-width:0;min-height:0;overflow:auto}.wd-native-business.managed{flex-direction:column;overflow:hidden}.wd-native-managed-page{flex:1;min-height:0;min-width:0;overflow:auto}.wd-native-conversation{min-height:0;min-width:0;display:flex;flex-direction:column;flex:1}.wd-native-conversation.companion{flex:0 0 44%;min-width:320px;border-left:1px solid var(--dsw-alias-border-l2)}.wd-native-mobile-back{display:none}@media(max-width:900px){.wd-native-frame.has-conversation .wd-native-business{display:none!important}.wd-native-conversation.companion{flex:1;min-width:0}.wd-native-mobile-back{display:block;align-self:flex-end;margin:8px;padding:6px 10px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);border-radius:8px}}`}</style>
   {createPortal(conversation,container)}
   {state.entries.map(entry=><Business key={entry.mount.panelKey} entry={entry} active={state.active===entry.mount.panelKey} setShown={setShown}/>)}
   <div className={`wd-native-conversation${selected?' companion':''}`} style={{display:!selected||shown?'flex':'none'}}>
    {selected&&<button className="wd-native-mobile-back" onClick={()=>{close?.();setShown(false);}}>返回业务</button>}
    <div ref={node=>{if(node&&container.parentNode!==node)node.appendChild(container);}} style={{height:'100%',flex:1,minHeight:0,minWidth:0,display:'flex'}}/>
   </div>
  </div>;
 }
 function Business({entry,active:visible,setShown}:{entry:Entry;active:boolean;setShown:(shown:boolean)=>void}){
  const seat=useMemo<NativeWorkbenchConversationSeat>(()=>({signal:entry.mount.signal,active:visible,setShown,setClose:fn=>{if(visible)close=fn;},
   openSession:id=>{if(visible)ctx.uiWorkspace.openSession(id as Parameters<typeof ctx.uiWorkspace.openSession>[0]);}}),[entry,visible,setShown]);
  const managed=entry.mount.panelKey.startsWith('workdsh-workbench:');
  return <div className={`wd-native-business${managed?' managed':''}`} hidden={!visible} style={{display:visible?(managed?'flex':'block'):'none'}}>
   <NativeWorkbenchConversationSeatProvider seat={seat}>
    {managed&&<WorkbenchNavigation mount={entry.mount} shortcuts={shortcuts} onBack={()=>ctx.layout.selectPanel('workdsh-workbench-manager' as never)}/>}
    {managed?<div className="wd-native-managed-page"><entry.Page workbench={entry.mount}/></div>:<entry.Page workbench={entry.mount}/>}
   </NativeWorkbenchConversationSeatProvider>
  </div>;
 }
 ctx.slots.inject('workdsh.workbench.frame',()=>{
  const stop=ctx.slots.register({name:'workdsh.workbench.frame'},Frame);
  const unsubscribe=ctx.layout.panelInfo.subscribe(()=>{const key=ctx.layout.panelInfo.getSnapshot().activePanelId;if(key&&entries.some(e=>e.mount.panelKey===key))activate(key);else if(key){active=undefined;shortcuts?.setActive(undefined);publish();}});
  return()=>{unsubscribe();stop();};
 });
 return {add(mount:WorkbenchPageMount,Page:WorkbenchPageComponent){if(entries.some(e=>e.mount.panelKey===mount.panelKey))throw Error('workbench/frame-registration-conflict');const entry={mount,Page};entries=[...entries,entry];publish();return()=>{entries=entries.filter(e=>e!==entry);if(active===mount.panelKey)active=undefined;publish();};},activate,active:()=>active};
}
