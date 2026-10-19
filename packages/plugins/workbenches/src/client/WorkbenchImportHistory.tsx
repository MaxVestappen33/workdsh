import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createWorkbenchActivationClient } from './activation-client.js';
import { createWorkbenchImportRecordsClient, type WorkbenchImportRecord } from './import-records-client.js';
import { createWorkbenchImportClient } from './import-client.js';
const labels: Record<WorkbenchImportRecord['state'], string> = {
  intent: '待提交', running: '执行中', reconciling: '核对中', unknown: '结果未确认', succeeded: '安装文件已核验', failed: '安装失败',
};
/** Restored from Host journals, not browser storage. Recovery inspects the same
 * operation; explicit continuation uses its original identity. */
export function WorkbenchImportHistory(props: { developmentId: string; packageName: string; workbenchId: string }) {
  const recordsClient = useMemo(() => createWorkbenchImportRecordsClient(), []);
  const activate = useMemo(() => createWorkbenchActivationClient(), []);
  const importClient = useMemo(() => createWorkbenchImportClient(), []);
  const [records, setRecords] = useState<readonly WorkbenchImportRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const request = useRef<AbortController | undefined>(undefined);
  async function refresh() {
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    setBusy(true); setMessage(undefined);
    try {
      const restored = await recordsClient(props, controller.signal);
      if (request.current === controller) setRecords(restored);
    } catch { if (!controller.signal.aborted && request.current === controller) setMessage('无法读取安装记录，请重试。'); }
    finally { if (request.current === controller) { request.current = undefined; setBusy(false); } }
  }
  useEffect(() => { void refresh(); return () => { request.current?.abort(); }; }, [props.developmentId, props.packageName, props.workbenchId]);
  async function recover(record: WorkbenchImportRecord, inspectOnly = true) {
    if (busy || !record.selection) return;
    const controller = new AbortController(); request.current = controller; setBusy(true); setMessage(undefined);
    try {
      const status = await importClient(record.selection, inspectOnly, controller.signal);
      if (request.current !== controller) return;
      setRecords(current => current.map(row => row.id === record.id ? { ...row, state: status.state } : row));
      setMessage(status.state === 'succeeded' ? '原安装文件已核验。工作台启用状态仍需确认。' : status.state === 'intent' ? '这份记录尚未提交安装；本次核对没有执行安装。' : '本次状态已核对，结果仍需继续确认。');
    } catch { if (!controller.signal.aborted && request.current === controller) setMessage('核对未完成，原记录已保留，可再次核对。'); }
    finally { if (request.current === controller) { request.current = undefined; setBusy(false); } }
  }
  async function setEnabled(record: WorkbenchImportRecord, enabled: boolean) {
    if (busy || !record.selection || record.state !== 'succeeded') return;
    const controller = new AbortController(); request.current = controller; setBusy(true);
    try {
      const result = await activate(record.selection, enabled, controller.signal);
      if (request.current === controller) setMessage(result.confirmed ? enabled ? '宿主启用已生效，业务页面仍需检查。' : '宿主停用已生效。' : result.pendingRestart ? '设置需要重启后确认。' : '设置尚未确认，请核对管理状态。');
    } catch { if (!controller.signal.aborted && request.current === controller) setMessage('启停未确认，原安装记录保留，请核对管理状态。'); }
    finally { if (request.current === controller) { request.current = undefined; setBusy(false); } }
  }
  return <details style={{ margin: '16px 28px', padding: 16, border: '1px solid #e2e8f0', borderRadius: 12 }}>
    <summary>安装记录{records.length ? `（${records.length}）` : ''}</summary>
    <p>离开页面后仍可读取原记录；核对状态不会重新安装；待提交记录可主动继续原安装。</p>
    <button disabled={busy} onClick={() => void refresh()}>刷新记录</button>
    {busy && <p role="status">正在读取或核对…</p>}
    {!busy && !records.length && !message && <p>暂无安装记录。</p>}
    {records.length > 0 && <ul style={{ maxHeight: 280, overflowY: 'auto' }}>{records.map(record => <li key={record.id} style={{ marginTop: 12 }}>
      {record.selection?.version ?? '旧安装记录'} · {labels[record.state]}
      {record.selection && record.state === 'succeeded' && <><button style={{ marginLeft: 12 }} disabled={busy} onClick={() => void setEnabled(record, true)}>启用</button><button disabled={busy} onClick={() => void setEnabled(record, false)}>停用</button></>}
      {record.recoveryUnavailable && <span> · 缺少原包信息，无法自动恢复</span>}
      {record.selection && record.state === 'intent' && <button style={{ marginLeft: 12 }} disabled={busy} onClick={() => void recover(record, false)}>继续原安装</button>}
      {record.selection && ['intent', 'running', 'reconciling', 'unknown'].includes(record.state) && <button style={{ marginLeft: 12 }} disabled={busy} onClick={() => void recover(record)}>核对状态</button>}
    </li>)}</ul>}
    {message && <p role="status">{message}</p>}
  </details>;
}
