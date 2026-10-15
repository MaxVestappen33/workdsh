import { Icon } from 'workdsh-ui';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

const ALL = '全部';
const GAP = 7;

/**
 * 分类胶囊栏：标签总宽超出容器时，末尾出现「更多」按钮，放不下的标签收进下拉浮层。
 * 当前选中的分类始终排在最前，因此不会被挤出可见区；容器宽度变化时重新计算。
 */
export function CategoryBar({ categories, value, onChange }: { categories: readonly string[]; value: string; onChange: (next: string) => void }) {
  const bar = useRef<HTMLDivElement>(null);
  const tabs = useRef<HTMLDivElement>(null);
  const more = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [barWidth, setBarWidth] = useState(0);
  const [overflowFrom, setOverflowFrom] = useState(Number.MAX_SAFE_INTEGER);
  const ordered = useMemo(
    () => (value === ALL ? [ALL, ...categories] : [ALL, value, ...categories.filter(name => name !== value)]),
    [categories, value],
  );
  useEffect(() => {
    const node = bar.current;
    if (!node) return;
    setBarWidth(node.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(entries => {
      const width = entries[0]?.contentRect.width;
      if (typeof width === 'number') setBarWidth(width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => { setOpen(false); }, [value, categories]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!more.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  // 标签可见性直接落在 DOM 上（量完即刻生效），避免多一次渲染造成跳动。
  useLayoutEffect(() => {
    const barNode = bar.current; const tabsNode = tabs.current; const moreNode = more.current;
    if (!barNode || !tabsNode || !moreNode) return;
    const chips = [...tabsNode.querySelectorAll<HTMLButtonElement>('[data-category]')];
    if (!chips.length) return;
    moreNode.hidden = false;
    chips.forEach(chip => { chip.hidden = false; });
    const available = barNode.clientWidth;
    const total = chips.reduce((sum, chip, index) => sum + (index ? GAP : 0) + chip.offsetWidth, 0);
    let fit = chips.length;
    if (total > available) {
      const reserved = moreNode.offsetWidth + GAP;
      let used = 0;
      for (let index = 0; index < chips.length; index += 1) {
        const next = used + (index ? GAP : 0) + chips[index].offsetWidth;
        if (next > available - reserved) { fit = index; break; }
        used = next;
      }
      const active = chips.findIndex(chip => chip.dataset.category === value);
      if (active >= fit) fit = active + 1;
    }
    chips.forEach((chip, index) => { chip.hidden = index >= fit; });
    moreNode.hidden = fit >= chips.length;
    setOverflowFrom(current => (current === fit ? current : fit));
  }, [ordered, value, barWidth]);
  return (
    <div className="category-bar" ref={bar}>
      <div className="category-tabs" ref={tabs} aria-label="MCP 分类">
        {ordered.map(name => (
          <button
            key={name}
            type="button"
            data-category={name}
            className={name === value ? 'active' : ''}
            aria-pressed={name === value}
            onClick={() => onChange(name)}
          >
            {name}
          </button>
        ))}
      </div>
      <div className="more-wrap" ref={more}>
        <button
          type="button"
          className={`more-btn${open ? ' open' : ''}`}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen(current => !current)}
        >
          更多<span className="chev"><Icon name="chevron" size={14} /></span>
        </button>
        <div className="more-panel" role="menu" hidden={!open}>
          {ordered.slice(overflowFrom).map(name => (
            <button
              key={name}
              type="button"
              role="menuitemradio"
              aria-checked={name === value}
              className={name === value ? 'active' : ''}
              onClick={() => { onChange(name); setOpen(false); }}
            >
              {name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
