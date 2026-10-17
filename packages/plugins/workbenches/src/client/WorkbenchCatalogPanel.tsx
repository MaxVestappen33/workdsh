import {WorkbenchMenu} from './WorkbenchMenu.js';
import {activationMessage} from './activation-message.js';
import {workbenchSurfaceStyles} from './surface-styles.js';
import { createWorkbenchOfflineImportsClient } from './offline-imports-client.js';
import { WorkbenchOfflineImportHistory } from './WorkbenchOfflineImportHistory.js';
import { WorkbenchPackagePreview } from './WorkbenchPackagePreview.js';
import {WorkbenchDevelopmentOverview} from './WorkbenchDevelopmentOverview.js';
import {createWorkbenchCreationClient,type CreationView} from './creation-client.js';
import type {WorkbenchDevelopmentIndexEntry} from 'workdsh-contracts';
import React, { useEffect, useMemo, useRef, useState,useSyncExternalStore } from 'react';
import { createWorkbenchCatalogClient, type WorkbenchCatalogEntry } from './catalog-client.js';
import { createWorkbenchActivationClient } from './activation-client.js';
import { createWorkbenchDevelopmentClient } from './development-client.js';
import { resolveActivationAssociation } from './activation-association.js';
import { WorkbenchCatalogList } from './WorkbenchCatalogList.js';
import {emptyShortcutSnapshot,type WorkbenchShortcuts} from './shortcuts.js';
export function WorkbenchCatalogPanel(props: { shortcuts?:WorkbenchShortcuts;onCreate: () => void; onDevelopments:()=>void; onContinue:(id:string)=>void; onDiscuss:(id:string)=>void; canOpen: (id: string) => boolean; onOpen: (id: string) => void }) {
  const shortcutState=useSyncExternalStore(props.shortcuts?.subscribe??(()=>()=>{}),props.shortcuts?.getSnapshot??(()=>emptyShortcutSnapshot),()=>emptyShortcutSnapshot);
  const offlineImports = useMemo(() => createWorkbenchOfflineImportsClient(), []);
  const catalog = useMemo(() => createWorkbenchCatalogClient(), []);
  const activate = useMemo(() => createWorkbenchActivationClient(), []);
  const creation = useMemo(()=>createWorkbenchCreationClient(),[]);
  const [developments,setDevelopments]=useState<readonly WorkbenchDevelopmentIndexEntry[]>([]);
  const [creations,setCreations]=useState<readonly CreationView[]>([]);
  const [developmentError,setDevelopmentError]=useState<string>();
  const developmentRequest=useRef<AbortController|undefined>(undefined);
  const development = useMemo(() => createWorkbenchDevelopmentClient(), []);
  const [entries, setEntries] = useState<readonly WorkbenchCatalogEntry[]>([]);
  const [importing, setImporting] = useState(false);
  const [historyVisible, setHistoryVisible] = useState(false);
  const [query, setQuery] = useState('');
  const [view,setView]=useState<'installed'|'making'>('installed');
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const request = useRef<AbortController | undefined>(undefined);
  const applying = useRef(false);
  async function refresh() {
    if (applying.current) return;
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    setBusy(true); setMessage(undefined); setEntries([]);
    try { const rows = await catalog(controller.signal); if (request.current === controller) setEntries(rows); }
    catch { if (!controller.signal.aborted && request.current === controller) setMessage('无法读取工作台，请检查登录状态后重试。'); }
    finally { if (request.current === controller) { request.current = undefined; setBusy(false); } }
  }
  async function refreshDevelopments(){
    if(developmentRequest.current)return;const controller=new AbortController();developmentRequest.current=controller;
    const results=await Promise.allSettled([development.list(controller.signal),creation.list(controller.signal)]);
    if(controller.signal.aborted)return;
    if(results[0].status==='fulfilled')setDevelopments(results[0].value);
    if(results[1].status==='fulfilled')setCreations(results[1].value.filter(row=>row.phase==='discussing'));
    setDevelopmentError(results.some(row=>row.status==='rejected')?'部分制作记录未能读取，请刷新重试。':undefined);
    if(developmentRequest.current===controller)developmentRequest.current=undefined;
  }
  useEffect(() => { void refresh();void refreshDevelopments();const timer=setInterval(()=>void refreshDevelopments(),15000); return () => {clearInterval(timer);developmentRequest.current?.abort(); request.current?.abort(); request.current = undefined; }; }, []);
  async function setEnabled(entry: WorkbenchCatalogEntry, enabled: boolean) {
    if (applying.current || busy || !entry.installed || !entry.descriptor) return;
    applying.current = true;
    request.current?.abort();
    const controller = new AbortController(); request.current = controller; setBusy(true);
    try {
      const developmentId = await resolveActivationAssociation(entry.packageName, entry.descriptor.id,
        signal => development.list(signal), offlineImports, controller.signal);
      controller.signal.throwIfAborted();
      const result = await activate({ developmentId, ...entry.installed, workbenchId: entry.descriptor.id }, enabled, controller.signal);
      controller.signal.throwIfAborted();
      const rows = await catalog(controller.signal);
      if (request.current === controller) {
        setEntries(rows); setMessage(activationMessage(entry.descriptor.title, enabled, rows.find(row=>row.packageName===entry.packageName), result));
      }
    } catch {
      if (!controller.signal.aborted && request.current === controller) {
        // A failed acknowledgement may still have changed the native selection.
        const rows = await catalog(controller.signal).catch(()=>undefined);
        if (!controller.signal.aborted && request.current === controller) {
          if (rows) setEntries(rows);
          setMessage(activationMessage(entry.descriptor.title, enabled, rows?.find(row=>row.packageName===entry.packageName)));
        }
      }
    }
    finally { applying.current = false; if (request.current === controller) { request.current = undefined; setBusy(false); } }
  }
  const visible = entries.filter(row => `${row.descriptor?.title ?? ''} ${row.packageName}`.toLowerCase().includes(query.trim().toLowerCase()));
  const pageCount = Math.max(1, Math.ceil(visible.length / 6));
  const currentPage = Math.min(page, pageCount - 1);
  const pageEntries = visible.slice(currentPage * 6, (currentPage + 1) * 6);
  const developmentCount=developments.length+creations.length;
  return <section className="wd-workbenches wd-workbench-catalog" aria-label="工作台管理">
    <style>{workbenchSurfaceStyles}</style>
    <header className="wd-catalog-header">
      <div><h1>工作台</h1><p>你的业务工具，随时打开使用。</p></div>
      <button data-variant="primary" onClick={props.onCreate}><span aria-hidden="true">＋ </span>用 AI 创建</button>
    </header>
    <div className="wd-catalog-navigation">
      <nav aria-label="工作台视图">
        <button aria-pressed={view==='installed'} onClick={()=>setView('installed')}>已安装 <span>{entries.length}</span></button>
        <button aria-pressed={view==='making'} onClick={()=>setView('making')}>我的开发 <span>{developmentCount}{developmentError?' !':''}</span></button>
      </nav>
      <WorkbenchMenu label="工作台更多操作" items={[{id:'import',label:'导入插件包'},{id:'history',label:historyVisible?'收起导入历史':'导入历史'},{id:'refresh',label:'刷新列表',disabled:busy}]} onSelect={id=>{if(id==='import')setImporting(true);if(id==='history')setHistoryVisible(value=>!value);if(id==='refresh'){void refresh();void refreshDevelopments();}}}>更多 <span aria-hidden="true">⌄</span></WorkbenchMenu>
    </div>
    {historyVisible && <section className="wd-catalog-secondary" aria-label="导入历史"><div className="wd-catalog-secondary-heading"><h2>导入历史</h2><button onClick={()=>setHistoryVisible(false)}>收起</button></div><WorkbenchOfflineImportHistory /></section>}
    {importing && <WorkbenchPackagePreview onRefresh={refresh} canOpen={props.canOpen} onOpen={props.onOpen} onClose={() => { setImporting(false); void refresh(); }} />}
    {shortcutState.error&&<p role="status">{shortcutState.error} <button onClick={()=>void props.shortcuts?.refresh()}>重新读取常用应用</button></p>}
    <div className="wd-catalog-scroll" key={view} tabIndex={0} aria-label={view==='installed'?'已安装应用列表，可上下滚动':'开发记录列表，可上下滚动'}>
    {view==='making'?<WorkbenchDevelopmentOverview compact catalog={entries} canOpen={props.canOpen} developments={developments} creations={creations} error={developmentError} onContinue={props.onContinue} onDiscuss={props.onDiscuss} onAll={props.onDevelopments} limit={6}/>:<>
      <div className="wd-catalog-toolbar">
        <input type="search" aria-label="搜索工作台" placeholder="搜索工作台…" value={query} onChange={event => { setQuery(event.currentTarget.value); setPage(0); }} />
        {query&&<span className="wd-catalog-count">{visible.length} 个结果</span>}
      </div>
      {busy && <p role="status">正在读取或应用设置…</p>}{message && <p role="status">{message} <button disabled={busy} onClick={()=>void refresh()}>重新核对</button></p>}
      {!busy && !message && visible.length === 0 && <div className="wd-catalog-empty"><h2>{query?'没有找到工作台':'还没有安装工作台'}</h2><p>{query?'试试其他名称。':'可以用 AI 创建，也可以从“更多”导入已有插件包。'}</p>{query&&<button onClick={()=>setQuery('')}>清除搜索</button>}</div>}
      <WorkbenchCatalogList entries={pageEntries} developments={developments} busy={busy} canOpen={props.canOpen} onOpen={props.onOpen} onContinue={props.onContinue} pinnedIds={shortcutState.ids} pinReady={shortcutState.ready&&!shortcutState.busy} onPin={props.shortcuts?(id,pinned)=>void props.shortcuts!.setPinned(id,pinned):undefined} onSetEnabled={(entry,enabled)=>void setEnabled(entry,enabled)}/>

    </>}
    </div>
    {view==='installed' && <nav aria-label="工作台列表分页" className="wd-catalog-pagination">
      <span role="status">共 {visible.length} 个 · 第 {currentPage + 1} / {pageCount} 页</span>
      <button disabled={busy || currentPage === 0} onClick={() => setPage(currentPage - 1)}>上一页</button>
      <button disabled={busy || currentPage + 1 >= pageCount} onClick={() => setPage(currentPage + 1)}>下一页</button>
    </nav>}
  </section>;
}
