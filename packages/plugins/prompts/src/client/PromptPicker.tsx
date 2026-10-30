import * as React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client';
import { Icon } from 'workdsh-ui';
import type { PromptItem } from '../shared.js';
import type { PromptClient } from './management.js';

type Props = PropsRuntime<'conversation.input.left'> & {
  prompts: PromptClient;
};

/** 每页条数：与宿主默认分页保持一致。 */
const PAGE_SIZE = 10;
/** 关键词输入停顿多久后查询后台：与服务端筛选的市场页同一口径。 */
const QUERY_DEBOUNCE_MS = 300;
/** 距离列表底部多少像素开始取下一页。 */
const SCROLL_THRESHOLD = 48;

const css = `
.wd-prompt-picker{position:relative;display:flex;align-items:center}
.wd-prompt-trigger{display:grid;place-items:center;width:36px;height:36px;padding:0;border:0;border-radius:10px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer}
.wd-prompt-trigger:hover,.wd-prompt-trigger[aria-expanded="true"]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.wd-prompt-popover{position:absolute;z-index:90;left:0;bottom:calc(100% + 10px);display:flex;flex-direction:column;width:368px;max-height:min(460px,62vh);padding:8px;border-radius:16px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);box-shadow:var(--dsw-elevation-panel);font:14px/20px "PingFang SC","Microsoft YaHei",sans-serif}
.wd-prompt-search{display:flex;align-items:center;gap:8px;flex:none;margin:0 2px 6px;padding:0 10px;height:34px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-tertiary)}
.wd-prompt-search input{flex:1;min-width:0;border:0;outline:0;background:transparent;color:var(--dsw-alias-label-primary);font:inherit}
.wd-prompt-search input::placeholder{color:var(--dsw-alias-label-tertiary)}
.wd-prompt-list{flex:1;min-height:0;overflow:auto;padding:0 2px}
.wd-prompt-row{display:grid;grid-template-columns:40px minmax(0,1fr);align-items:center;gap:12px;width:100%;padding:8px 6px;border:0;border-radius:12px;background:transparent;color:inherit;text-align:left;font:inherit;cursor:pointer}
.wd-prompt-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.wd-prompt-mark{display:grid;place-items:center;width:40px;height:40px;border-radius:12px;background:linear-gradient(145deg,#146c7c,#11b7c8);color:#eafcff;font-size:17px;font-weight:700}
.wd-prompt-copy{min-width:0}
.wd-prompt-copy strong,.wd-prompt-copy small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wd-prompt-copy strong{font-size:14px;font-weight:600}
.wd-prompt-copy small{margin-top:3px;color:var(--dsw-alias-label-secondary);font-size:12px}
.wd-prompt-status{padding:12px;color:var(--dsw-alias-label-secondary);font-size:13px}
.wd-prompt-end{padding:10px 12px 4px;color:var(--dsw-alias-label-tertiary);font-size:12px;text-align:center}
@media(max-width:560px){.wd-prompt-popover{position:fixed;left:12px;right:12px;bottom:86px;width:auto}}
`;

/** 提示词标题的首字：后台不下发图标，按连接器卡片的兜底样式取名称首字。 */
const markOf = (row: PromptItem): string => (row.name || row.content).trim().charAt(0).toUpperCase();

export function PromptPicker({ prompts, inputActions }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  /** 请求序号：关键词或页码变化后，旧请求的回包直接丢弃。 */
  const ticket = useRef(0);
  const [open, setOpen] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [items, setItems] = useState<readonly PromptItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (nextPage: number, nextKeyword: string, append: boolean): Promise<void> => {
    const current = ++ticket.current;
    setLoading(true); setError('');
    try {
      const result = await prompts.list({ page: nextPage, pageSize: PAGE_SIZE, keyword: nextKeyword });
      if (current !== ticket.current) return;
      setItems(previous => {
        if (!append) return result.items;
        const seen = new Set(previous.map(row => row.id));
        return [...previous, ...result.items.filter(row => !seen.has(row.id))];
      });
      setPage(result.page); setTotal(result.total); setHasMore(result.hasMore);
    } catch (cause) {
      if (current === ticket.current) setError(cause instanceof Error ? cause.message : '提示词加载失败，请重试。');
    } finally {
      if (current === ticket.current) setLoading(false);
    }
  }, [prompts]);

  // 打开弹层或关键词变化：回到第一页重新取数；关键词走服务端筛选，输入停顿后再发请求。
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => { void load(1, keyword, false); }, keyword ? QUERY_DEBOUNCE_MS : 0);
    return () => window.clearTimeout(timer);
  }, [open, keyword, load]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);

  const toggle = (): void => {
    if (open) { setOpen(false); return; }
    // 重新打开时清空上一次的筛选与结果，避免显示别的关键词的列表。
    setKeyword(''); setItems([]); setTotal(0); setPage(1); setHasMore(false); setError('');
    setOpen(true);
  };

  const loadMore = (): void => {
    if (!hasMore || loading) return;
    void load(page + 1, keyword, true);
  };

  const onScroll = (event: React.UIEvent<HTMLDivElement>): void => {
    const node = event.currentTarget;
    if (node.scrollHeight - node.scrollTop - node.clientHeight < SCROLL_THRESHOLD) loadMore();
  };

  const pick = (row: PromptItem): void => {
    if (!row.content.trim()) { setError('该提示词没有内容，无法填写。'); return; }
    const span = inputActions.captureInsertion();
    if (!inputActions.insertText(row.content, span)) { setError('输入内容已变化，请重新选择。'); return; }
    setOpen(false);
  };

  return <><style>{css}</style><div className="wd-prompt-picker" ref={root}>
    <button ref={trigger} type="button" className="wd-prompt-trigger" aria-label="提示词" aria-haspopup="dialog" aria-expanded={open} title="提示词" onClick={toggle}><Icon name="prompt" size={22} /></button>
    {open && <div className="wd-prompt-popover" role="dialog" aria-label="提示词">
      <div className="wd-prompt-search">
        <Icon name="search" size={15} />
        <input autoFocus aria-label="搜索提示词" placeholder="搜索提示词…" value={keyword} onChange={event => setKeyword(event.currentTarget.value)} />
      </div>
      <div className="wd-prompt-list" onScroll={onScroll}>
        {items.map(row => <button className="wd-prompt-row" key={row.id} type="button" onClick={() => pick(row)}>
          <span className="wd-prompt-mark" aria-hidden="true">{markOf(row)}</span>
          <span className="wd-prompt-copy">
            <strong>{row.name || '未命名提示词'}</strong>
            <small>{row.description || '暂无描述'}</small>
          </span>
        </button>)}
        {loading && <div className="wd-prompt-status" role="status">正在加载提示词…</div>}
        {error && <div className="wd-prompt-status" role="alert">{error}</div>}
        {!loading && !error && !items.length && <div className="wd-prompt-status">暂无可用提示词。</div>}
        {!loading && !error && items.length > 0 && !hasMore && <div className="wd-prompt-end">已加载全部 {total} 条</div>}
      </div>
    </div>}
  </div></>;
}
