import { useEffect, useRef, useState } from 'react';
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { CompactionOutcome } from '../harness/compaction.js';

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** ContextMeter 弹窗底部的操作区；由本包注册，官方弹窗只提供一个渲染位。 */
    'conversation.context.panel.footer': { kind: 'list'; scope: 'session' };
  }
}

type Props = PropsRuntime<'conversation.context.panel.footer'> & { compact: () => Promise<CompactionOutcome> };

/**
 * 上下文弹窗底部的手动压缩条：与官方弹窗同一 12px 字号、同一圆角与悬浮色，
 * 顶部用一条分隔线与占用明细分开，宽度跟随弹窗（min(264px, 100vw - 24px)）。
 */
const css = `
.wd-compact-footer{display:block;margin-top:10px;padding-top:10px;border-top:1px solid var(--dsw-alias-border-l2)}
.wd-compact-footer-pill{box-sizing:border-box;width:100%;justify-content:center;align-items:center;gap:6px;display:inline-flex;padding:4px 8px;border:0;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:20px;font-variant-numeric:tabular-nums;white-space:nowrap;cursor:pointer}
.wd-compact-footer-pill svg{flex:none;width:14px;height:14px}
.wd-compact-footer-pill:hover:not(:disabled),.wd-compact-footer-pill:focus-visible{background:var(--dsw-alias-interactive-bg-hover-solid)}
.wd-compact-footer-pill:disabled{cursor:default;opacity:.65}
.wd-compact-footer-pill[data-tone="done"]{color:var(--dsw-alias-state-business-primary)}
.wd-compact-footer-label{min-width:0;overflow:hidden;text-overflow:ellipsis}
`;

/** 结果提示保留时间：足够读完释放的 token 数，又不长期占据弹窗底部。 */
const NOTICE_MS = 12_000;

/** 释放 token 的紧凑写法，与官方占用行的 K/M 口径一致。 */
function formatTokens(value: number): string {
  const scaled = (candidate: number) => candidate >= 100 ? String(Math.round(candidate)) : String(Math.round(candidate * 10) / 10);
  if (value < 1_000) return String(value);
  if (value < 1_000_000) return `${scaled(value / 1_000)}K`;
  return `${scaled(value / 1_000_000)}M`;
}

function describe(outcome: CompactionOutcome | null, running: boolean): { label: string; tone: 'idle' | 'done'; title: string } {
  if (running) return { label: '压缩中…', tone: 'idle', title: '正在摘要较早的历史，完成后释放上下文空间' };
  if (outcome === null) return { label: '压缩上下文', tone: 'idle', title: '把较早的对话压缩为一条摘要，释放上下文空间（等同 /compact）' };
  switch (outcome.kind) {
    case 'compacted':
      return outcome.tokens > 0
        ? { label: `已压缩 ${outcome.items} 项 · 释放 ~${formatTokens(outcome.tokens)} tok`, tone: 'done', title: `已压缩 ${outcome.items} 项历史，约释放 ${outcome.tokens} tokens` }
        : { label: '已压缩', tone: 'done', title: outcome.items > 0 ? `已压缩 ${outcome.items} 项历史` : '压缩完成' };
    case 'empty':
      return { label: '暂无可压缩历史', tone: 'idle', title: '当前对话还没有可安全压缩的较早历史' };
    case 'busy':
      return { label: '会话运行中，稍后再试', tone: 'idle', title: '智能体正在执行或已在压缩' };
    default:
      return { label: '压缩失败', tone: 'idle', title: outcome.reason || '压缩未完成，请稍后重试' };
  }
}

export function ContextCompaction({ compact }: Props) {
  const [running, setRunning] = useState(false);
  const [outcome, setOutcome] = useState<CompactionOutcome | null>(null);
  const alive = useRef(true);
  const notice = useRef<number | undefined>(undefined);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (notice.current !== undefined) window.clearTimeout(notice.current);
    };
  }, []);
  const run = async () => {
    if (running) return;
    if (notice.current !== undefined) window.clearTimeout(notice.current);
    setRunning(true);
    setOutcome(null);
    let next: CompactionOutcome;
    try {
      next = await compact();
    } catch (cause) {
      next = { kind: 'failed', reason: cause instanceof Error ? cause.message : String(cause) };
    }
    if (!alive.current) return;
    setRunning(false);
    setOutcome(next);
    notice.current = window.setTimeout(() => { if (alive.current) setOutcome(null); }, NOTICE_MS);
  };
  const { label, tone, title } = describe(outcome, running);
  return (
    <div className="wd-compact-footer">
      <style>{css}</style>
      <button
        type="button"
        className="wd-compact-footer-pill"
        data-tone={tone}
        aria-label={label}
        title={title}
        disabled={running}
        onClick={() => void run()}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 1.6v3.6M6.3 3.5 8 5.2l1.7-1.7M8 14.4v-3.6M6.3 12.5 8 10.8l1.7 1.7M3 8h10" />
        </svg>
        <span className="wd-compact-footer-label">{label}</span>
      </button>
    </div>
  );
}
