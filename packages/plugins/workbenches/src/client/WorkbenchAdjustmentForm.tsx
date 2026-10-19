import React, { useRef, useState } from 'react';
import type { WorkbenchRequirementsFormProps } from './WorkbenchRequirementsForm.js';
import { prepareWorkbenchAdjustmentRequirements } from './adjustment-requirements.js';

export function WorkbenchAdjustmentForm(props: WorkbenchRequirementsFormProps) {
  const [moduleId, setModuleId] = useState('');
  const [pageId, setPageId] = useState('');
  const [request, setRequest] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const pending = useRef(false);
  const module = props.initial?.system?.modules.find(row => row.id === moduleId);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (pending.current || !props.initial) return;
    let draft;
    try { draft = prepareWorkbenchAdjustmentRequirements(props.initial, request, moduleId ? { moduleId, ...(pageId ? { pageId } : {}) } : undefined); }
    catch { setError('请填写修改意见，并核对所选页面。'); return; }
    pending.current = true; setSaving(true); setError(undefined);
    try { await props.onSave(draft); }
    catch { setError('调整未保存成功，意见已保留，请核对后重试。'); }
    finally { pending.current = false; setSaving(false); }
  }
  return <form aria-label="调整工作台" onSubmit={event => void submit(event)} className="wd-adjustment-form">
    <h2>这次想改什么？</h2><p>写下本轮修改意见，保存后放入右侧原生对话草稿。</p>
    <details className="wd-adjustment-scope"><summary>指定模块或页面（可选）</summary><label>修改范围 <select disabled={saving} value={moduleId} onChange={event => { setModuleId(event.target.value); setPageId(''); }}>
      <option value="">根据文字定位</option>{props.initial?.system?.modules.map(row => <option key={row.id} value={row.id}>{row.title}</option>)}
    </select></label>
    {module && <label style={{ marginLeft: 16 }}>页面 <select disabled={saving} value={pageId} onChange={event => setPageId(event.target.value)}>
      <option value="">整个模块</option>{module.pages.map(row => <option key={row.id} value={row.id}>{row.title}</option>)}
    </select></label>}
    </details>
    <textarea aria-label="修改意见" required maxLength={7000} rows={5} disabled={saving} value={request} onChange={event => setRequest(event.target.value)} placeholder="例如：分析总览增加按产线筛选；保持现有计算口径，其他页面不变。" style={{ display: 'block', width: '100%', boxSizing: 'border-box', padding: 14, margin: '20px 0', borderRadius: 8, background: 'inherit', color: 'inherit' }} />
    <p>修改意见会保存到当前应用。检查并发送对话草稿后，AI 才会开始执行。</p>
    {error && <p role="alert">{error}</p>}
    <button disabled={saving || !props.initial} type="submit">{saving ? '正在保存…' : '保存并开始修改'}</button> <button type="button" disabled={saving} onClick={props.onCancel}>取消</button>
  </form>;
}
