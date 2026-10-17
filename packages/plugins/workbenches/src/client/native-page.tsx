import * as React from 'react';
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client';
import type { WorkbenchDescriptor } from 'workdsh-contracts';
import { WorkbenchPageLifecycle, type WorkbenchPageMount, type WorkbenchPagePorts } from './page-lifecycle.js';
import type {WorkbenchShortcuts} from './shortcuts.js';
import {createNativeFrame} from './native-frame.js';

export const WORKBENCH_MANAGER_PANEL = 'workdsh-workbench-manager';
export interface WorkbenchPageProps { readonly workbench: WorkbenchPageMount }
export type WorkbenchPageComponent = React.ComponentType<WorkbenchPageProps>;
type NativePageContext = Pick<Context, 'slots' | 'layout' | 'uiWorkspace'>;

/** Own business layout around the untouched native Conversation subtree. */
export function createNativeWorkbenchPagePorts(ctx:NativePageContext,shortcuts?:WorkbenchShortcuts):WorkbenchPagePorts<WorkbenchPageComponent>{
 const frame=createNativeFrame(ctx,shortcuts);
 return {
  mountPage(mount,Page){
   const remove=frame.add(mount,Page);
   let stopPage:()=>void;
   try{stopPage=ctx.slots.register({name:'main',key:mount.panelKey},()=>{React.useLayoutEffect(()=>{frame.activate(mount.panelKey);},[]);return null;});}catch(error){remove();throw error;}
   let untrack:(()=>void)|undefined;
   try{untrack=mount.panelKey.startsWith('workdsh-workbench:')?shortcuts?.track(mount):undefined;}catch(error){stopPage();remove();throw error;}
   return()=>{try{untrack?.();}finally{try{stopPage();}finally{remove();}}};
  },
  selectedPanel(){return ctx.layout.panelInfo.getSnapshot().activePanelId??frame.active();},
  openManager(){const exists=ctx.slots.entriesOfSlot('main').some(entry=>entry.options.key===WORKBENCH_MANAGER_PANEL);ctx.layout.selectPanel(exists?WORKBENCH_MANAGER_PANEL as MainPanelId:null);}
 };
}
export function mountVerifiedNativeWorkbenchPage(ctx:NativePageContext,descriptor:WorkbenchDescriptor,Page:WorkbenchPageComponent):()=>void{
 const lifecycle=new WorkbenchPageLifecycle(createNativeWorkbenchPagePorts(ctx));
 return ctx.slots.inject('main',()=>lifecycle.mount(descriptor,Page));
}
