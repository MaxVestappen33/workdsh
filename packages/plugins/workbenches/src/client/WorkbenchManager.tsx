import {workbenchSurfaceStyles} from './surface-styles.js';
import React, { useRef, useState } from 'react';
import type { WorkbenchInventoryEntry } from 'workdsh-contracts';

export interface WorkbenchManagerProps {
  readonly entries: readonly WorkbenchInventoryEntry[];
  readonly loading: boolean;
  readonly canManage: boolean;
  readonly onOpen: (id: string) => void;
  /** Owning page selects a local package and submits it to the trusted import service. */
  readonly onImport: () => Promise<void>;
  readonly onUpdate: (entry: WorkbenchInventoryEntry) => Promise<void>;
  readonly onDeveloperGuide: () => void;
  readonly onCreateWithAI: () => void;
  readonly onRefresh: () => Promise<void>;
  /** Host owns desired package enablement, applies official lifecycle and refreshes inventory. */
  readonly onSetEnabled: (entry: WorkbenchInventoryEntry, enabled: boolean) => Promise<void>;
}
const labels: Record<WorkbenchInventoryEntry['state'], string> = {
  enabled: '已启用', disabled: '已停用', 'pending-restart': '待重启生效', incompatible: '版本不兼容', failed: '加载失败',
};
const buttonStyle: React.CSSProperties = { border: '1px solid var(--border-color, #ddd)', borderRadius: 8, padding: '8px 14px', background: 'var(--background-color, white)', color: 'inherit', cursor: 'pointer' };

/** Presentation only: installation and active versions come from independently verified Host facts. */
export function WorkbenchManager(props: WorkbenchManagerProps) {
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const pending = useRef(false);
  const entries = props.entries.filter(entry => `${entry.descriptor.title} ${entry.descriptor.description}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  async function run(id: string, action: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(id); setError(undefined);
    try { await action(); }
    catch { setError('操作未完成，请刷新列表核对当前状态后重试。'); }
    finally { pending.current = false; setBusy(undefined); }
  }
  return <section className="wd-workbenches" aria-label="工作台管理" style={{ padding: 32, maxWidth: 1120, margin: '0 auto', color: 'inherit' }}>
    <style>{workbenchSurfaceStyles}</style>
    <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 20 }}>
      <div><h1 style={{ marginBottom: 8 }}>我的工作台</h1><p>描述需求，用 AI 创建工作台；也可导入已有插件。</p></div>
      <div style={{ display: 'flex', gap: 10 }}><button style={buttonStyle} onClick={props.onDeveloperGuide}>开发者指南</button>
      <button data-variant="primary" style={buttonStyle} disabled={Boolean(busy) || props.loading} onClick={props.onCreateWithAI}>用 AI 创建工作台</button>
      {props.canManage && <button style={buttonStyle} disabled={Boolean(busy) || props.loading} onClick={() => void run('import', props.onImport)}>导入插件</button>}</div>
    </header>
    <div style={{ display: 'flex', gap: 12, margin: '24px 0' }}>
      <input aria-label="搜索工作台" placeholder="搜索名称或描述" value={query} onChange={event => setQuery(event.target.value)} style={{ flex: 1, padding: 12, borderRadius: 8, border: '1px solid var(--border-color, #ddd)', background: 'inherit', color: 'inherit' }} />
      <button style={buttonStyle} disabled={Boolean(busy) || props.loading} onClick={() => void run('refresh', props.onRefresh)}>刷新</button>
    </div>
    {error && <p role="alert">{error}</p>}
    {props.loading && <p role="status">正在读取工作台…</p>}
    {!props.loading && entries.length === 0 && <p>{query ? '没有匹配的工作台。' : props.canManage ? '尚未安装工作台。导入开发者提供的插件包即可开始使用。' : '尚未安装工作台，请联系管理员安装。'}</p>}
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20 }}>
      {entries.map(entry => <article key={`${entry.target.hostId}/${entry.target.installationId}/${entry.target.profileId}/${entry.installed.packageName}`} style={{ border: '1px solid var(--border-color, #ddd)', borderRadius: 14, padding: 24 }}>
        <h2 style={{ fontSize: 20 }}>{entry.descriptor.title}</h2>
        <p>{entry.descriptor.description}</p>
        <p><strong>{labels[entry.state]}</strong></p>
        <p>已安装：{entry.installed.version} · 运行中：{entry.active?.version ?? '未运行'}</p>
        {entry.unavailableCapabilities.length > 0 && <p>部分功能暂不可用，请打开工作台查看配置要求。</p>}
        {entry.state === 'pending-restart' && <p>安装配置与运行状态尚未一致，请重启后刷新确认。</p>}
        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <button style={buttonStyle} disabled={entry.state !== 'enabled'} onClick={() => props.onOpen(entry.descriptor.id)}>打开</button>
          {props.canManage && <button style={buttonStyle} disabled={Boolean(busy) || props.loading} onClick={() => void run(entry.descriptor.id, () => props.onUpdate(entry))}>导入更新</button>}
          {props.canManage && entry.state === 'disabled' && <button style={buttonStyle} disabled={Boolean(busy)} onClick={() => void run(entry.descriptor.id, () => props.onSetEnabled(entry, true))}>启用</button>}
          {props.canManage && ['enabled', 'failed', 'incompatible'].includes(entry.state) && <button style={buttonStyle} disabled={Boolean(busy)} onClick={() => void run(entry.descriptor.id, () => props.onSetEnabled(entry, false))}>停用</button>}
        </div>
      </article>)}
    </div>
  </section>;
}
