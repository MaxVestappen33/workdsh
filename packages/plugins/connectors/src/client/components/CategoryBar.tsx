import { Icon } from 'workdsh-ui';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

const ALL = '全部';
const GAP = 7;

/**
 * 分类胶囊栏（多选）：标签渲染顺序恒等于选项顺序，选中只改变高亮、不改变位置。
 * 一行放不下时末尾出现「更多」按钮，被折叠的标签收进下拉浮层；按钮上标出被折叠的已选数量，
 * 让选中项即使被折叠也不会被忽略。「全部」等价于未选任何分类，点击它即清空选择。
 */
export function CategoryBar({ categories, values, onChange }: {
  readonly categories: readonly string[];
  readonly values: readonly string[];
  readonly onChange: (next: readonly string[]) => void;
}) {
  const bar = useRef<HTMLDivElement>(null);
  const tabs = useRef<HTMLDivElement>(null);
  const more = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [barWidth, setBarWidth] = useState(0);
  /** 可见标签数量：由上方的宽度测算得出，用于决定下拉浮层里要收哪些标签。 */
  const [visible, setVisible] = useState(Number.MAX_SAFE_INTEGER);
  const names = useMemo(() => [ALL, ...categories], [categories]);
  /** 选项内容指纹：用内容而非数组引用判断选项是否真的变化，避免每次列表刷新都收起浮层。 */
  const optionKey = categories.join('\u0000');
  const hiddenNames = names.slice(visible);
  /** 被折叠且已选中的标签数量：显示在「更多」按钮上。 */
  const hiddenSelected = hiddenNames.filter(name => values.includes(name)).length;
  const isActive = (name: string) => (name === ALL ? values.length === 0 : values.includes(name));
  const toggle = (name: string) => {
    if (name === ALL) { onChange([]); return; }
    onChange(values.includes(name) ? values.filter(value => value !== name) : [...values, name]);
  };
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
  // 仅选项集合变化时收起浮层；多选过程中保持展开，方便连续勾选多个分类。
  useEffect(() => { setOpen(false); }, [optionKey]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!more.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  // 标签可见性直接落在 DOM 上（量完即刻生效），避免多一次渲染造成跳动。
  // 选中状态会改变字重进而改变标签宽度，因此 values 也要参与重算。
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
      // 「全部」始终保留可见：其余标签从第二个开始按剩余宽度依次放入。
      fit = 1;
      let used = chips[0].offsetWidth;
      for (let index = 1; index < chips.length; index += 1) {
        const next = used + GAP + chips[index].offsetWidth;
        if (next > available - reserved) break;
        used = next;
        fit = index + 1;
      }
    }
    chips.forEach((chip, index) => { chip.hidden = index >= fit; });
    moreNode.hidden = fit >= chips.length;
    setVisible(current => (current === fit ? current : fit));
  }, [names, values, barWidth]);
  return (
    <div className="category-bar" ref={bar}>
      <div className="category-tabs" ref={tabs} role="group" aria-label="MCP 分类">
        {names.map(name => (
          <button
            key={name}
            type="button"
            data-category={name}
            className={isActive(name) ? 'active' : ''}
            aria-pressed={isActive(name)}
            onClick={() => toggle(name)}
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
          更多
          {hiddenSelected ? <i className="more-count" aria-label={`${hiddenSelected} 个已选分类已折叠`}>{hiddenSelected}</i> : null}
          <span className="chev"><Icon name="chevron" size={14} /></span>
        </button>
        <div className="more-panel" role="menu" hidden={!open}>
          {hiddenNames.map(name => (
            <button
              key={name}
              type="button"
              role="menuitemcheckbox"
              aria-checked={isActive(name)}
              className={isActive(name) ? 'active' : ''}
              onClick={() => toggle(name)}
            >
              {name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
