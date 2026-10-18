import {workbenchDeliveryState} from './delivery-state.js';
import {WorkbenchSourceCheckpoints} from './WorkbenchSourceCheckpoints.js';
import type {SourceCheckpointSummary,VerifiedSourceCheckpoint} from './source-checkpoints.js';
import React, { useEffect, useRef, useState } from 'react';
import type { WorkbenchCatalogEntry } from './catalog-client.js';
import type { WorkbenchDevelopmentIndexEntry, WorkbenchDevelopmentState } from 'workdsh-contracts';

export interface WorkbenchDevelopmentsProps {
  readonly verifyCheckpoint?:(id:string,hash:string,signal?:AbortSignal)=>Promise<VerifiedSourceCheckpoint>;
  readonly loadCheckpoints?:(id:string,signal?:AbortSignal)=>Promise<readonly SourceCheckpointSummary[]>;
  readonly entries: readonly WorkbenchDevelopmentIndexEntry[];
  readonly catalog?: readonly WorkbenchCatalogEntry[];
  readonly catalogError?: string;
  readonly loading: boolean;
  readonly error?: string;
  readonly onCreate: () => void;
  readonly canOpen?:(id:string)=>boolean;
  readonly onOpen?:(id:string)=>void;
  readonly onRefresh: () => Promise<void>;
  /** Opens the existing development, never creates another plugin identity. */
  readonly onContinue: (developmentId: string) => Promise<void>;
  readonly onCandidates?: (developmentId: string) => void;
}
const states: Record<WorkbenchDevelopmentState, string> = {
  requirements: '需求待完善', ready: '可开始开发', developing: '开发中', built: '候选已构建',
  'pending-install': '待安装', 'pending-restart': '待重启', trial: '待试用',
  'changes-requested': '需要调整', accepted: '本轮已验收', interrupted: '已中断', failed: '本轮失败',
};
const button: React.CSSProperties = { padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border-color, #ddd)', background: 'inherit', color: 'inherit', cursor: 'pointer' };

/** Uses persisted development facts; absence from plugin inventory never hides a row. */
export function WorkbenchDevelopments(props: WorkbenchDevelopmentsProps) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState<string>();
  const [actionError, setActionError] = useState<string>();
  const pending = useRef(false);
  async function run(id: string, action: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true; setBusy(id); setActionError(undefined);
    try { await action(); }
    catch { setActionError('操作未完成，请保留需求并刷新核对开发记录。'); }
    finally { pending.current = false; setBusy(undefined); }
  }
  const entries = props.entries.filter(row => `${row.title} ${row.development.workbenchId} ${row.development.packageName}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const pageCount = Math.max(1, Math.ceil(entries.length / 12));
  const currentPage = Math.min(page, pageCount - 1);
  const visible = entries.slice(currentPage * 12, (currentPage + 1) * 12);
  useEffect(() => setPage(0), [query]);
  return <section className="wd-development-page" aria-label="我的开发">
    <header style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
      <div><h1>我的开发</h1><p>继续制作你的应用，或为已安装的工作台添加功能。</p></div>
      <button data-variant="primary" disabled={Boolean(busy)} onClick={props.onCreate}>用 AI 创建工作台</button>
    </header>
    <div className="wd-development-toolbar">
      <input aria-label="搜索开发记录" placeholder="搜索应用名称" value={query} onChange={event => setQuery(event.target.value)} style={{ minWidth: 0, flex: '1 1 220px', padding: 10, borderRadius: 8, border: '1px solid var(--border-color, #ddd)', background: 'inherit', color: 'inherit' }} />
      <button style={button} disabled={Boolean(busy) || props.loading} onClick={() => void run('refresh', props.onRefresh)}>刷新</button>
    </div>
    {(props.error || actionError) && <p role="alert">{props.error || actionError}</p>}
    {props.loading && <p role="status">正在读取开发记录…</p>}
    {!props.loading && !props.error && entries.length === 0 && <p>{query ? '没有匹配的开发记录。' : '还没有正在制作的应用。点击“用 AI 创建工作台”，说说你想完成的工作。'}</p>}
    <div className="wd-development-grid">
      {visible.map(({title,development:item})=>{
        const observed=props.catalog?.find(row=>row.packageName===item.packageName&&row.descriptor?.id===item.workbenchId);
        const usable=Boolean(observed?.registered&&observed.selected&&!observed.errorCode&&observed.compatible&&props.onOpen&&props.canOpen?.(item.workbenchId));
        return <article key={item.id} className="wd-development-card">
          <div className="wd-development-card-top"><span className="wd-development-symbol" aria-hidden="true">↗</span><span className="wd-catalog-status" data-active={usable}>{observed?.installed?workbenchDeliveryState(observed,usable,0,false).title:states[item.state]}</span></div>
          <h2>{title}</h2>
          <p className="wd-development-summary">{usable?'应用已安装。可以直接使用，也可以继续与 AI 调整功能。':item.state==='requirements'?'先补充要完成的工作，再与 AI 开始制作。':item.state==='pending-restart'?'新版本已安装，重启后才能确认生效。':item.source?'需求和制作进度已保存，可以继续开发。':'需求已保存，继续制作时会准备开发工程。'}</p>
          <div className="wd-development-actions">
            {usable&&<button data-variant="primary" disabled={Boolean(busy)||props.loading} onClick={()=>props.onOpen?.(item.workbenchId)}>打开使用</button>}
            <button data-variant={usable?undefined:'primary'} disabled={Boolean(busy)||props.loading||Boolean(props.error)} onClick={()=>void run(item.id,()=>props.onContinue(item.id))}>{busy===item.id?'正在打开…':usable?'继续修改':'继续开发'}</button>
            {item.source&&props.onCandidates&&<button disabled={Boolean(busy)||props.loading} onClick={()=>props.onCandidates?.(item.id)}>检查新版本</button>}
          </div>
          <details className="wd-development-details"><summary>开发详情</summary>
            <dl><dt>制作进度</dt><dd>{states[item.state]}</dd><dt>已安装版本</dt><dd>{observed?.installed?.version??(props.catalogError?'读取失败':props.catalog?'尚未安装或未核验':'正在确认')}</dd></dl>
            <p>安装版本：{observed?.installed?.version??(props.catalogError?'读取失败':props.catalog?'尚未安装或未核验':'正在确认')}</p>
            <p>运行状态：{props.catalogError?'无法确认，请刷新':observed?.errorCode?'安装未核验':observed?.selected&&observed.runtimeStatus==='failed'?'组件加载失败，请继续开发修复后安装新版':observed?.registered?`宿主已运行 ${observed.installed?.version}`:observed?.selected?'尚未确认新版注册，请刷新核对':observed?.installed?'已停用':'尚未确认'}</p>
            <p>“检查新版本”会检查开发目录中的安装包；构建完成不代表已安装。</p>
            <p className="wd-development-identifiers">{item.workbenchId}<br/>{item.packageName}</p>
            <p>安装位置：{item.target.hostId} / {item.target.profileId}</p>
            {item.source&&props.loadCheckpoints&&<WorkbenchSourceCheckpoints key={item.id+'/'+item.revision} developmentId={item.id} load={props.loadCheckpoints} verify={props.verifyCheckpoint}/>}
          </details>
        </article>;
      })}
    </div>
    {entries.length > 12 && <nav aria-label="开发记录分页" style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 20 }}>
      <button style={button} disabled={currentPage === 0 || props.loading || Boolean(busy)} onClick={() => setPage(currentPage - 1)}>上一页</button>
      <span role="status">第 {currentPage + 1} / {pageCount} 页 · 共 {entries.length} 个工作台</span>
      <button style={button} disabled={currentPage + 1 >= pageCount || props.loading || Boolean(busy)} onClick={() => setPage(currentPage + 1)}>下一页</button>
    </nav>}
  </section>;
}
