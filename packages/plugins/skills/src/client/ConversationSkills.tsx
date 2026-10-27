import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import { Icon } from 'workdsh-ui';
import type { ManagedSkillSummary } from '../shared.js';
import type { SkillManagementClient } from './management.js';

type Props = PropsRuntime<'conversation.input.left'> & {
  management: Pick<SkillManagementClient, 'list'>;
  openSkills: () => void;
};

const usable = (row: ManagedSkillSummary) => row.state === 'enabled' || row.state === 'readonly';
const css = `
.wd-skill-picker{position:relative;display:flex;align-items:center}
.wd-skill-picker-trigger{display:grid;place-items:center;width:36px;height:36px;padding:0;border:0;border-radius:10px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer}
.wd-skill-picker-trigger:hover,.wd-skill-picker-trigger[aria-expanded="true"]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.wd-skill-popover{position:absolute;z-index:90;left:0;bottom:calc(100% + 10px);width:336px;max-height:min(430px,60vh);overflow:auto;padding:8px;border-radius:15px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);box-shadow:var(--dsw-elevation-panel);font:14px/20px "PingFang SC","Microsoft YaHei",sans-serif}
.wd-skill-row{display:grid;grid-template-columns:38px minmax(0,1fr);align-items:center;gap:10px;width:100%;padding:6px 5px;border:0;border-radius:10px;background:transparent;color:inherit;text-align:left;font:inherit;cursor:pointer}
.wd-skill-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.wd-skill-row:disabled{opacity:.5;cursor:default}
.wd-skill-mark{display:grid;place-items:center;width:38px;height:38px;border-radius:10px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
.wd-skill-copy{min-width:0}.wd-skill-copy strong,.wd-skill-copy small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.wd-skill-copy strong{font-size:14px;font-weight:600}.wd-skill-copy small{margin-top:2px;color:var(--dsw-alias-label-secondary);font-size:11px}
.wd-skill-manage{display:flex;gap:8px;width:100%;margin-top:6px;padding:10px 9px;border:0;border-top:1px solid var(--dsw-alias-border-l2);border-radius:0;background:transparent;color:var(--dsw-alias-label-secondary);text-align:left;font:inherit;cursor:pointer}
.wd-skill-manage:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.wd-skill-status{padding:12px;color:var(--dsw-alias-label-secondary)}
@media(max-width:560px){.wd-skill-popover{position:fixed;left:12px;right:12px;bottom:86px;width:auto}}
`;

export function ConversationSkills({ management, openSkills, inputActions }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<readonly ManagedSkillSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true); setError('');
    void management.list()
      .then(items => { if (!cancelled) setRows(items.filter(row => row.state !== 'invalid')); })
      .catch(cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : '无法加载技能，请重试。'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, management]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);
  const pick = (row: ManagedSkillSummary) => {
    const span = inputActions.captureInsertion();
    if (!inputActions.insertText(`/${row.name} `, span)) { setError('输入内容已变化，请重新选择。'); return; }
    setOpen(false);
  };
  return <><style>{css}</style><div className="wd-skill-picker" ref={root}>
    <button ref={trigger} type="button" className="wd-skill-picker-trigger" aria-label="技能" aria-haspopup="dialog" aria-expanded={open} title="技能" onClick={() => setOpen(value => !value)}><Icon name="skills" size={22} /></button>
    {open && <div className="wd-skill-popover" role="dialog" aria-label="技能">
      {loading && <div className="wd-skill-status" role="status">正在加载技能…</div>}
      {error && <div className="wd-skill-status" role="alert">{error}</div>}
      {!loading && !error && !rows.length && <div className="wd-skill-status">暂无可用技能，可在技能中心创建或安装。</div>}
      {rows.map(row => <button className="wd-skill-row" key={row.name} type="button" disabled={!usable(row)} onClick={() => pick(row)}>
        <span className="wd-skill-mark"><Icon name="skills" size={18} /></span>
        <span className="wd-skill-copy"><strong>{row.title || row.name}</strong><small>{row.state === 'disabled' ? '已停用' : row.localizedDescription || row.description || row.name}</small></span>
      </button>)}
      <button className="wd-skill-manage" type="button" onClick={() => { setOpen(false); openSkills(); }}><span aria-hidden="true">↗</span>管理技能</button>
    </div>}
  </div></>;
}
