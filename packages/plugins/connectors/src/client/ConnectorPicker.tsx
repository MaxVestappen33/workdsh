import * as React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import { Icon, Modal, modalCss } from 'workdsh-ui';
import type { ConnectorSummary } from '../shared.js';
import type { ConnectorManagementClient } from './management.js';

const labels = { ready: '已连接', discovering: '连接中', offline: '连接异常', disabled: '未连接' } as const;
const css = `${modalCss}
.wd-connector-picker{position:relative;display:flex;align-items:center}.wd-connector-trigger{display:flex;align-items:center;gap:7px;max-width:190px;height:36px;padding:0 9px;border:0;border-radius:10px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:13px;cursor:pointer}.wd-connector-trigger:hover,.wd-connector-trigger[aria-expanded="true"]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.wd-connector-trigger .trigger-icon{display:grid;place-items:center;width:22px;height:22px;flex:none;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary)}.wd-connector-trigger .trigger-icon.connected{background:linear-gradient(145deg,#146c7c,#11b7c8);color:white;font-weight:700}.wd-connector-trigger .trigger-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500}.wd-connector-trigger .trigger-count{color:var(--dsw-alias-label-secondary);font-size:11px}
.wd-connector-popover{position:absolute;z-index:90;left:0;bottom:calc(100% + 10px);width:336px;max-height:min(430px,60vh);overflow:auto;padding:8px;border:0;border-radius:15px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);box-shadow:var(--dsw-elevation-panel);font:14px/20px "PingFang SC","Microsoft YaHei",sans-serif}.wd-connector-popover *{box-sizing:border-box}.wd-connector-popover .picker-row{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:8px;width:100%;min-height:54px;padding:5px;border-radius:10px}.wd-connector-popover .picker-row:hover{background:var(--dsw-alias-interactive-bg-hover)}.wd-connector-popover .picker-main{display:grid;grid-template-columns:38px minmax(0,1fr);align-items:center;gap:10px;min-width:0;padding:3px;border:0;background:transparent;color:inherit;text-align:left;cursor:pointer}.wd-connector-popover .picker-mark,.connector-picker-detail .picker-mark{display:grid;place-items:center;width:38px;height:38px;border-radius:10px;background:linear-gradient(145deg,#146c7c,#11b7c8);color:#fff;font-weight:700;text-transform:uppercase}.wd-connector-popover .picker-copy{min-width:0}.wd-connector-popover .picker-copy strong,.wd-connector-popover .picker-copy small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.wd-connector-popover .picker-copy strong{font-size:14px;font-weight:600}.wd-connector-popover .picker-copy small{margin-top:2px;color:var(--dsw-alias-label-secondary);font-size:11px}.wd-connector-popover .picker-action{min-width:52px;padding:6px 8px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}.wd-connector-popover .picker-action:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.wd-connector-popover .picker-action.ready{color:var(--dsw-alias-label-primary)}.wd-connector-popover .picker-action.offline{color:var(--dsw-alias-state-danger-primary,var(--dsw-alias-label-primary))}.wd-connector-popover .picker-action.discovering{color:var(--dsw-alias-label-secondary)}.wd-connector-popover .picker-empty{padding:28px 12px;text-align:center;color:var(--dsw-alias-label-secondary)}.wd-connector-popover .picker-footer{margin-top:6px;border-top:1px solid var(--dsw-alias-border-l2)}.wd-connector-popover .picker-all{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:9px 9px 1px;color:var(--dsw-alias-label-secondary);font-size:12px}.wd-connector-popover .picker-all label{display:flex;align-items:center;gap:7px;cursor:pointer}.wd-connector-popover .picker-all label:hover{color:var(--dsw-alias-label-primary)}.wd-connector-popover .picker-all input{width:14px;height:14px;flex:none;margin:0;accent-color:var(--dsw-alias-label-primary);cursor:pointer}.wd-connector-popover .picker-all input:disabled{cursor:default}.wd-connector-popover .manage{display:flex;align-items:center;gap:8px;width:100%;padding:9px;border:0;background:transparent;color:var(--dsw-alias-label-secondary);text-align:left;cursor:pointer}.wd-connector-popover .manage:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.wd-dialog.connector-picker-detail{width:min(620px,calc(100vw - 48px));padding:26px}.connector-picker-detail .picker-detail-hero{display:grid;grid-template-columns:52px minmax(0,1fr);gap:15px;align-items:center;padding-right:44px}.connector-picker-detail .picker-mark{width:52px;height:52px;border-radius:14px;font-size:21px}.connector-picker-detail h2{margin:0 0 3px;font-size:21px}.connector-picker-detail .detail-state{color:var(--dsw-alias-label-secondary);font-size:12px}.connector-picker-detail .detail-description{margin:20px 0;color:var(--dsw-alias-label-secondary);line-height:1.7}.connector-picker-detail .detail-tools{max-height:210px;overflow:auto;padding:15px;border:1px solid var(--dsw-alias-border-l2);border-radius:11px;background:var(--dsw-alias-bg-layer-2)}.connector-picker-detail .detail-tools strong{display:block;margin-bottom:8px}.connector-picker-detail code{display:block;margin:5px 0;overflow:hidden;text-overflow:ellipsis;color:var(--dsw-alias-label-primary);font:12px/18px ui-monospace,SFMono-Regular,Menlo,monospace}.connector-picker-detail .detail-error{margin:12px 0 0;color:var(--dsw-alias-state-danger-primary,var(--dsw-alias-label-primary));font-size:12px}.connector-picker-detail .detail-actions{display:flex;justify-content:flex-end;gap:9px;margin-top:18px}.connector-picker-detail .detail-actions button{min-height:38px;padding:7px 14px;border:1px solid var(--dsw-alias-interactive-bg-hover);border-radius:9px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);cursor:pointer}.connector-picker-detail .detail-actions .primary{background:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-primary);color:var(--dsw-alias-label-primary-inverted);font-weight:600}
@media(max-width:560px){.wd-connector-popover{position:fixed;left:12px;right:12px;bottom:86px;width:auto}.wd-connector-trigger .trigger-name{display:none}}
`;

type Props = PropsRuntime<'conversation.input.left'> & { management: ConnectorManagementClient; openManagement: () => void };

export function ConnectorPicker({ management, openManagement, sessionId }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<readonly ConnectorSummary[]>([]);
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);
  const [detail, setDetail] = useState<ConnectorSummary>();
  const [changing, setChanging] = useState<string>();
  const [changingAll, setChangingAll] = useState(false);
  const [error, setError] = useState('');
  const selectAllBox = useRef<HTMLInputElement>(null);
  const refresh = useCallback(async () => {
    try {
    const [nextRows, nextSelection] = await Promise.all([
      management.list(),
      management.selection(String(sessionId)),
    ]);
    setRows(nextRows); setSelectedIds(nextSelection); setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '无法加载连接器，请重试。'); }
  }, [management, sessionId]);
  useEffect(() => {
    // 没有选择记录的会话由后端返回「全部可用连接器」；用户显式保存过的选择（含清空）
    // 不会被轮询覆盖，空白会话打开时也不会把默认值写死成显式选择。
    void refresh();
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, 5_000);
    const visible = () => { if (!document.hidden) void refresh(); };
    document.addEventListener('visibilitychange', visible);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', visible); };
  }, [management, refresh, sessionId]);
  useEffect(() => { if (open) void refresh(); }, [open, refresh]);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); root.current?.querySelector<HTMLButtonElement>('.wd-connector-trigger')?.focus(); } };
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape); };
  }, [open]);

  const selected = rows.filter(row => selectedIds.includes(row.id));
  const primary = selected[0];
  // 「全选」只覆盖真正可用的连接器：连接中/连接异常/未连接的不参与，也无法被勾选。
  const selectable = rows.filter(row => row.state === 'ready');
  const selectedReady = selectable.filter(row => selectedIds.includes(row.id)).length;
  const allSelected = selectable.length > 0 && selectedReady === selectable.length;
  useEffect(() => {
    if (selectAllBox.current) selectAllBox.current.indeterminate = selectedReady > 0 && !allSelected;
  }, [selectedReady, allSelected]);
  const toggleAll = async () => {
    setChangingAll(true);
    try {
      const next = allSelected ? [] : selectable.map(row => row.id);
      setSelectedIds(await management.setSelection(String(sessionId), next));
      setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '无法修改连接器选择，请重试。'); } finally { setChangingAll(false); }
  };
  const changeSelection = async (row: ConnectorSummary) => {
    // 已选中的连接器即使掉线也允许移出本次对话，否则不可用项会一直占着选择无法调整。
    if (row.state !== 'ready' && !selectedIds.includes(row.id)) { setDetail(row); setOpen(false); return; }
    setChanging(row.id);
    try {
      const next = selectedIds.includes(row.id) ? selectedIds.filter(id => id !== row.id) : [...selectedIds, row.id];
      setSelectedIds(await management.setSelection(String(sessionId), next));
    } catch (cause) { setError(cause instanceof Error ? cause.message : '无法修改连接器选择，请重试。'); } finally { setChanging(undefined); }
  };

  return <>
    <style>{css}</style>
    <div className="wd-connector-picker" ref={root}>
      <button className="wd-connector-trigger" type="button" aria-label={primary ? `连接器：${primary.title}` : '连接器'} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(value => !value)}>
        <span className={`trigger-icon${primary ? ' connected' : ''}`}>{primary ? primary.title.charAt(0).toUpperCase() : <Icon name="connectors" size={22} />}</span>
        {primary ? <span className="trigger-name">{primary.title}</span> : null}
        {selected.length > 1 ? <span className="trigger-count">+{selected.length - 1}</span> : null}
      </button>
      {open ? <div className="wd-connector-popover" role="menu" aria-label="连接器">
        {rows.map(row => <div key={row.id} className="picker-row" role="none">
          <button className="picker-main" type="button" role="menuitem" onClick={() => { setDetail(row); setOpen(false); }}>
            <span className="picker-mark">{row.title.charAt(0).toUpperCase()}</span>
            <span className="picker-copy"><strong>{row.title}</strong><small>{row.description || row.serverName}</small></span>
          </button>
          <button className={`picker-action ${selectedIds.includes(row.id) ? 'ready' : row.state}`} type="button" disabled={changingAll || changing === row.id || row.state === 'discovering'} aria-pressed={selectedIds.includes(row.id)} aria-label={`${selectedIds.includes(row.id) ? '从本次对话移除' : '用于本次对话'} ${row.title}`} onClick={() => void changeSelection(row)}>{changing === row.id ? '处理中' : selectedIds.includes(row.id) ? '已选' : row.state === 'ready' ? '使用' : labels[row.state]}</button>
        </div>)}
        {error ? <div className="picker-empty" role="alert">{error}</div> : null}
        {!rows.length && !error ? <div className="picker-empty">尚未添加连接器</div> : null}
        <div className="picker-footer">
          {selectable.length ? <div className="picker-all">
            <label><input ref={selectAllBox} type="checkbox" checked={allSelected} disabled={changingAll || Boolean(changing)} onChange={() => void toggleAll()} /><span>{allSelected ? '取消全选' : '全选'}</span></label>
            <span>已选 {selectedReady}/{selectable.length}</span>
          </div> : null}
          <button className="manage" type="button" onClick={() => { setOpen(false); openManagement(); }}><span aria-hidden="true">↗</span> 管理连接器</button>
        </div>
      </div> : null}
    </div>
    <Modal open={Boolean(detail)} label="连接器详情" className="connector-picker-detail" onClose={() => setDetail(undefined)}>{detail ? <>
      <div className="picker-detail-hero"><span className="picker-mark">{detail.title.charAt(0).toUpperCase()}</span><div><h2>{detail.title}</h2><span className="detail-state">{labels[detail.state]} · {detail.transport} · {detail.serverName}</span></div></div>
      <p className="detail-description">{detail.description || 'MCP 服务'}</p>
      <div className="detail-tools"><strong>可用能力</strong>{detail.toolNames.length ? detail.toolNames.map(name => <code key={name}>{name}</code>) : <span>连接成功后显示 MCP 工具。</span>}</div>
      {detail.diagnostic ? <p className="detail-error">{detail.diagnostic}</p> : null}
      <div className="detail-actions">{detail.state === 'ready' ? <button type="button" onClick={() => { void changeSelection(detail).then(() => setDetail(undefined)); }}>{selectedIds.includes(detail.id) ? '从本次对话移除' : '用于本次对话'}</button> : null}<button type="button" className="primary" onClick={() => { setDetail(undefined); openManagement(); }}>管理连接器</button></div>
    </> : null}</Modal>
  </>;
}
