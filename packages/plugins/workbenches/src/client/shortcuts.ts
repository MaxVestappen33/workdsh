import type {WorkbenchPageMount} from './page-lifecycle.js';
export interface SwitcherApplication{readonly id:string;readonly title:string;readonly description:string;readonly panelKey:string}
export interface ShortcutSnapshot{readonly ids:readonly string[];readonly apps:readonly SwitcherApplication[];readonly open:boolean;readonly activeId?:string;readonly ready:boolean;readonly busy:boolean;readonly error?:string}
export const emptyShortcutSnapshot:ShortcutSnapshot=Object.freeze({ids:[],apps:[],open:false,ready:false,busy:false});
/** The switcher contributes no per-application sidebar rows. Its application
 * list is derived only from verified live page registrations. */
export function createWorkbenchShortcuts(transport:typeof fetch=fetch){
  let snapshot:ShortcutSnapshot=emptyShortcutSnapshot;
  let sequence=0,closed=false,open=false,activeId:string|undefined;const lifetime=new AbortController(),listeners=new Set<()=>void>();
  const tracked=new Map<WorkbenchPageMount,()=>void>();
  const publish=(value:Pick<ShortcutSnapshot,'ids'|'ready'|'busy'|'error'>=snapshot)=>{
    const apps=Object.freeze([...tracked.keys()].filter(mount=>!mount.signal.aborted).map(mount=>Object.freeze({id:mount.descriptor.id,title:mount.descriptor.title,description:mount.descriptor.description,panelKey:mount.panelKey})));
    snapshot=Object.freeze({...value,apps,open,activeId:apps.some(app=>app.id===activeId)?activeId:undefined});for(const listener of listeners)listener();
  };
  async function invoke(body:unknown){
    const response=await transport('/api/workdsh-workbench-shortcuts',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.any([lifetime.signal,AbortSignal.timeout(15000)])});
    const result=await response.json();lifetime.signal.throwIfAborted();
    if(!response.ok||result?.ok!==true)throw Error(result?.error?.code==='workbench/shortcuts-limit'?'最多设置 8 个常用应用，请先取消一个。':'常用应用设置未确认，请重新读取。');
    const value=result.value;
    if(!value||typeof value.organizationId!=='string'||!value.organizationId||typeof value.principalId!=='string'||!value.principalId||!Array.isArray(value.ids)||value.ids.length>8||new Set(value.ids).size!==value.ids.length||value.ids.some((id:unknown)=>typeof id!=='string'||!id||id.length>128))throw Error('常用应用返回异常，请重新读取。');
    return Object.freeze([...value.ids]) as readonly string[];
  }
  const controller={
    subscribe(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener);};},getSnapshot:()=>snapshot,
    show(){if(!closed){open=true;publish();}},hide(){open=false;publish();},setActive(id:string|undefined){activeId=id;publish();},
    async refresh(){if(closed||snapshot.busy)return;const seq=++sequence;publish({ids:[],ready:false,busy:true});try{const ids=await invoke({});if(!closed&&seq===sequence)publish({ids,ready:true,busy:false});}catch{if(!closed&&seq===sequence)publish({ids:[],ready:false,busy:false,error:'无法读取常用应用，请重试。'});}},
    async setPinned(id:string,pinned:boolean){
      if(closed||snapshot.busy||!snapshot.ready)return;const seq=++sequence;publish({...snapshot,busy:true,error:undefined});
      try{const ids=await invoke({id,pinned});if(!closed&&seq===sequence)publish({ids,ready:true,busy:false});}
      catch(error){if(!closed&&seq===sequence)publish({ids:[],ready:false,busy:false,error:error instanceof Error?error.message:'常用应用设置未确认，请重新读取。'});}
    },
    track(mount:WorkbenchPageMount){
      if(closed||mount.signal.aborted)return()=>{};
      const release=()=>{if(!tracked.delete(mount))return;mount.signal.removeEventListener('abort',release);publish();};
      tracked.set(mount,release);mount.signal.addEventListener('abort',release,{once:true});publish();return release;
    },
    close(){if(closed)return;closed=true;++sequence;lifetime.abort();open=false;for(const release of [...tracked.values()])release();publish({ids:[],ready:false,busy:false});listeners.clear();},
  };
  return controller;
}
export type WorkbenchShortcuts=ReturnType<typeof createWorkbenchShortcuts>;
export function switcherSections(state:ShortcutSnapshot,query:string){
  const text=query.trim().toLocaleLowerCase();
  const apps=state.apps.filter(app=>!text||`${app.title} ${app.description}`.toLocaleLowerCase().includes(text));
  const common=state.ready?state.ids.flatMap(id=>apps.filter(app=>app.id===id)):[];
  return {common,other:apps.filter(app=>!common.some(row=>row.id===app.id)).sort((a,b)=>a.title.localeCompare(b.title,'zh-CN'))};
}
