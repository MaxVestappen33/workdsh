import React, { useRef, useState } from 'react';
import { WorkbenchSystemEditor } from './WorkbenchSystemEditor.js';
import { parseWorkbenchRequirementsDraft, type WorkbenchRequirementsDraft } from 'workdsh-contracts';
import {requirementsSaveFailureMessage} from './requirements-save-error.js';
export interface WorkbenchRequirementsFormProps {
  readonly initial?: WorkbenchRequirementsDraft;
  /** Host persists the requirement revision before starting development or creating a session. */
  readonly onSave: (draft: WorkbenchRequirementsDraft) => Promise<void>;
  readonly onCancel: () => void;
  readonly title?:string;
  readonly description?:string;
  readonly submitLabel?:string;
  readonly singlePage?:boolean;
  readonly onDraftChange?:(draft:WorkbenchRequirementsDraft)=>void;
}
const empty: WorkbenchRequirementsDraft = { title: '', scenario: '', users: '', dataSources: '', workflow: '', firstIteration: '', acceptance: '' };
const fields: readonly { readonly key: keyof Omit<WorkbenchRequirementsDraft, 'system'>; readonly label: string; readonly hint: string }[] = [
  { key: 'title', label: '工作台名称', hint: '例如：质量分析' },
  { key: 'scenario', label: '解决什么问题', hint: '描述当前工作中的问题和希望达到的结果。' },
  { key: 'users', label: '谁来使用', hint: '例如：质量工程师、生产主管。' },
  { key: 'dataSources', label: '数据从哪里来', hint: '文件、资料库或企业接口；未知接口和字段请写“待验证”。' },
  { key: 'workflow', label: '主要工作流程', hint: '描述页面、操作、计算规则和最终成果。' },
  { key: 'firstIteration', label: '第一轮先完成什么', hint: '列出第一轮可实际试用的范围，其余需求后续调整。' },
  { key: 'acceptance', label: '怎样判断做对了', hint: '列出可检查的结果，最好提供输入与预期输出示例。' },
];

export function WorkbenchRequirementsForm(props: WorkbenchRequirementsFormProps) {
  const [draft, setDraft] = useState(props.initial ?? empty);
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState(0);
  const steps = ['业务需求', '数据与流程', '首轮验收'];
  const groups = [['title', 'scenario', 'users'], ['dataSources', 'workflow'], ['firstIteration', 'acceptance']];
  const [error, setError] = useState<string>();
  const pending = useRef(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending.current) return;
    const missing = (props.singlePage?groups.flat():groups[step]).some(key => !draft[key as keyof Omit<WorkbenchRequirementsDraft, 'system'>].trim());
    if (missing) { setError('请补齐当前步骤；尚不明确的内容可注明“待确认”。'); return; }
    if (!props.singlePage&&step < steps.length - 1) { setError(undefined); setStep(step + 1); return; }
    let normalized: WorkbenchRequirementsDraft;
    try { normalized = parseWorkbenchRequirementsDraft(draft); }
    catch { setError('请补齐需求、模块及页面名称，检查依赖和长度；尚不明确的数据和规则可注明“待验证”。'); return; }
    pending.current = true; setSaving(true); setError(undefined);
    try { await props.onSave(normalized); }
    catch(cause) { setError(requirementsSaveFailureMessage(cause)); }
    finally { pending.current = false; setSaving(false); }
  }
  return <form onSubmit={event => void submit(event)} aria-label="定义工作台需求" style={{ maxWidth: 800, margin: '0 auto', padding: 32 }}>
    <h1>{props.title??'用 AI 创建工作台'}</h1>
    <p>{props.description??'先明确需求，开发后试用，再通过反馈逐轮调整。同一工作台会保留需求修订和源码关联。'}</p>
    {!props.singlePage&&<nav aria-label="需求步骤" style={{ display: 'flex', gap: 16, margin: '24px 0', borderBottom: '1px solid var(--border-color, #ddd)' }}>
      {steps.map((label, index) => <span key={label} aria-current={step === index ? 'step' : undefined} style={{ padding: '12px 0', opacity: step === index ? 1 : 0.55, fontWeight: step === index ? 600 : 400 }}>{index + 1}. {label}</span>)}
    </nav>}
    {fields.filter(field => props.singlePage||groups[step].includes(field.key)).map(field => <label key={field.key} style={{ display: 'block', margin: '20px 0' }}>
      <strong>{field.label}</strong>
      <p style={{ margin: '6px 0', opacity: 0.7 }}>{field.hint}</p>
      <textarea required rows={field.key === 'title' ? 1 : 3} maxLength={field.key === 'title' ? 80 : 8000} value={draft[field.key]} disabled={saving} onChange={event => {const next={...draft,[field.key]:event.target.value};setDraft(next);props.onDraftChange?.(next);}} style={{ width: '100%', boxSizing: 'border-box', padding: 12, borderRadius: 8, border: '1px solid var(--border-color, #ddd)', background: 'inherit', color: 'inherit', resize: 'vertical' }} />
    </label>)}
    {step === 2 && <details style={{ margin: '16px 0' }}><summary>详细模块结构（可选）</summary>
      <p>已有结构会保留。需要精确指定系统模块时再展开配置。</p>
      <WorkbenchSystemEditor value={draft.system} disabled={saving} onChange={system => setDraft(previous => ({ ...previous, system }))} />
    </details>}
    {error && <p role="alert">{error}</p>}
    <div style={{ display: 'flex', gap: 12 }}>
      <button data-variant="primary" type="submit" disabled={saving}>{saving ? '正在保存…' : !props.singlePage&&step < 2 ? '下一步' : props.submitLabel??'保存需求并开始开发'}</button>
      {step > 0 && <button type="button" disabled={saving} onClick={() => { setError(undefined); setStep(step - 1); }}>上一步</button>}
      <button type="button" disabled={saving} onClick={props.onCancel}>返回开发记录</button>
    </div>
  </form>;
}
