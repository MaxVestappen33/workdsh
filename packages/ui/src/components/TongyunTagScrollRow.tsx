import * as React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { normalizeHex, paletteFromHex } from './tag-color.js';

/** 配色模式：默认灰（跟随主题）、预置主色、自定义主色。 */
export type TongyunTagScrollColorMode = 'default' | 'preset' | 'custom';
/** 预置主色。 */
export type TongyunTagScrollPreset = 'blue' | 'cyan' | 'green' | 'purple' | 'orange';

export interface TongyunTagScrollRowProps {
  /** 标签文案；按传入顺序渲染，全部展示（单行 + 溢出翻页）。 */
  tags: readonly string[];
  /** 固定 px（number）或任意 CSS 宽度；省略时自适应占满父容器。 */
  width?: number | string;
  /** 默认 `default`（灰色，跟随主题）。 */
  colorMode?: TongyunTagScrollColorMode;
  /** `colorMode="preset"` 时选用的主色。 */
  preset?: TongyunTagScrollPreset;
  /** `colorMode="custom"` 时的主色（hex），由它推导浅底 / 描边 / 文字色。 */
  customColor?: string;
  className?: string;
}

type FadeMode = 'none' | 'left' | 'right' | 'both';

const PRESET_HEX: Readonly<Record<TongyunTagScrollPreset, string>> = {
  blue: '#2563eb',
  cyan: '#0891b2',
  green: '#16a34a',
  purple: '#7c3aed',
  orange: '#ea580c',
};

const DRAG_THRESHOLD = 4;


const CHEVRON_LEFT = (
  <svg viewBox="0 0 12 12" width="12" height="12" fill="none" aria-hidden="true">
    <path d="M7.4 2.6 4.1 6l3.3 3.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const CHEVRON_RIGHT = (
  <svg viewBox="0 0 12 12" width="12" height="12" fill="none" aria-hidden="true">
    <path d="M4.6 2.6 7.9 6l-3.3 3.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/**
 * 同云标签滚动行：单行不换行，溢出时显示左右箭头、支持箭头翻页 /
 * 滚轮横向翻页 / 按住左键拖动（4px 阈值区分点击与拖动），触屏走原生滑动，两端自动隐藏箭头并渐隐遮罩。
 */
export function TongyunTagScrollRow({
  tags,
  width,
  colorMode = 'default',
  preset = 'blue',
  customColor,
  className,
}: TongyunTagScrollRowProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  const [overflowing, setOverflowing] = useState(false);
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(false);
  const [fade, setFade] = useState<FadeMode>('none');
  const [dragging, setDragging] = useState(false);

  const overflowingRef = useRef(false);
  const dragRef = useRef({ active: false, pointerId: -1, startX: 0, startScroll: 0, moved: false });

  /** 根据滚动位置同步左右箭头与渐隐方向。 */
  const syncScrollState = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const max = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
    const current = viewport.scrollLeft;
    const atStart = current <= 1;
    const atEnd = current >= max - 1;
    setCanPrev(!atStart);
    setCanNext(!atEnd);
    if (!overflowingRef.current || max <= 1) setFade('none');
    else if (atStart) setFade('right');
    else if (atEnd) setFade('left');
    else setFade('both');
  }, []);

  /** 重新判断是否溢出；不溢出时回到起始位置并收起箭头。 */
  const update = useCallback(() => {
    const track = trackRef.current;
    const viewport = viewportRef.current;
    if (!track || !viewport) return;
    // 箭头绝对定位、不占行内宽度，直接用视口可用宽度与内容宽度比较。
    const available = viewport.clientWidth;
    const contentWidth = track.getBoundingClientRect().width;
    const next = contentWidth - available > 0.5;
    overflowingRef.current = next;
    setOverflowing(next);
    if (!next) {
      setCanPrev(false);
      setCanNext(false);
      setFade('none');
      if (viewport.scrollLeft !== 0) viewport.scrollLeft = 0;
    } else {
      syncScrollState();
    }
  }, [syncScrollState]);

  useEffect(() => {
    const root = rootRef.current;
    const viewport = viewportRef.current;
    const track = trackRef.current;
    if (!root || !viewport || !track) return;

    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        syncScrollState();
      });
    };

    /** 纵向滚轮转横向滚动；到达两端时放行页面滚动。 */
    const onWheel = (event: WheelEvent) => {
      if (!overflowingRef.current) return;
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      const max = viewport.scrollWidth - viewport.clientWidth;
      const current = viewport.scrollLeft;
      if ((event.deltaY < 0 && current <= 0) || (event.deltaY > 0 && current >= max - 1)) return;
      event.preventDefault();
      viewport.scrollLeft = Math.min(max, Math.max(0, current + event.deltaY));
    };

    /** 鼠标左键按下：开始一次可能的拖动；触控保留原生滑动。 */
    const onPointerDown = (event: PointerEvent) => {
      dragRef.current.moved = false;
      if (event.pointerType === 'touch' || event.button !== 0 || !overflowingRef.current) return;
      dragRef.current = {
        active: true,
        pointerId: event.pointerId,
        startX: event.clientX,
        startScroll: viewport.scrollLeft,
        moved: false,
      };
      viewport.scrollTo({ left: viewport.scrollLeft, behavior: 'auto' });
      try {
        viewport.setPointerCapture(event.pointerId);
      } catch {
        // 少数环境不支持指针捕获，拖动仍可在视口内完成。
      }
      event.preventDefault();
    };

    /** 拖动中：超过 4px 阈值后进入拖动状态，跟手设置 scrollLeft。 */
    const onPointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag.active || event.pointerId !== drag.pointerId) return;
      const deltaX = event.clientX - drag.startX;
      if (!drag.moved && Math.abs(deltaX) < DRAG_THRESHOLD) return;
      if (!drag.moved) {
        drag.moved = true;
        setDragging(true);
      }
      event.preventDefault();
      const max = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
      viewport.scrollLeft = Math.min(max, Math.max(0, drag.startScroll - deltaX));
    };

    /** 松开 / 取消：结束拖动并释放指针捕获。 */
    const onPointerUp = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag.active || event.pointerId !== drag.pointerId) return;
      drag.active = false;
      drag.pointerId = -1;
      setDragging(false);
      try {
        if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
      } catch {
        // 已释放或不支持指针捕获，忽略。
      }
      syncScrollState();
    };

    /** 捕获阶段吞掉拖动刚结束的那一次 click，阈值内的普通点击不受影响。 */
    const onClickCapture = (event: MouseEvent) => {
      if (!dragRef.current.moved) return;
      dragRef.current.moved = false;
      const target = event.target as Element | null;
      if (target?.closest?.('.wd-tagrow-nav')) return;
      event.preventDefault();
      event.stopPropagation();
    };

    viewport.addEventListener('scroll', onScroll, { passive: true });
    viewport.addEventListener('wheel', onWheel, { passive: false });
    viewport.addEventListener('pointerdown', onPointerDown);
    viewport.addEventListener('pointermove', onPointerMove);
    viewport.addEventListener('pointerup', onPointerUp);
    viewport.addEventListener('pointercancel', onPointerUp);
    root.addEventListener('click', onClickCapture, true);

    const observer = new ResizeObserver(() => update());
    observer.observe(root);
    observer.observe(track);
    update();

    return () => {
      if (raf) cancelAnimationFrame(raf);
      observer.disconnect();
      viewport.removeEventListener('scroll', onScroll);
      viewport.removeEventListener('wheel', onWheel);
      viewport.removeEventListener('pointerdown', onPointerDown);
      viewport.removeEventListener('pointermove', onPointerMove);
      viewport.removeEventListener('pointerup', onPointerUp);
      viewport.removeEventListener('pointercancel', onPointerUp);
      root.removeEventListener('click', onClickCapture, true);
    };
  }, [syncScrollState, update]);

  // 首次挂载或标签内容真正变化时回到行首；同样的数据刷新不打断用户当前滚动位置。
  const signatureRef = useRef('');
  useEffect(() => {
    const signature = tags.join('\u0001');
    const viewport = viewportRef.current;
    if (signatureRef.current !== signature) {
      signatureRef.current = signature;
      if (viewport) viewport.scrollLeft = 0;
    }
    update();
  }, [tags, update]);

  /** 按一屏（80% 视口）平滑翻页。 */
  const scrollPage = (direction: number) => {
    const viewport = viewportRef.current;
    if (!viewport || !overflowingRef.current) return;
    const max = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
    const step = Math.max(120, viewport.clientWidth * 0.8);
    viewport.scrollTo({ left: Math.min(max, Math.max(0, viewport.scrollLeft + direction * step)), behavior: 'smooth' });
  };

  const palette = colorMode === 'custom'
    ? paletteFromHex(normalizeHex(customColor) ?? PRESET_HEX.blue)
    : colorMode === 'preset'
      ? paletteFromHex(PRESET_HEX[preset] ?? PRESET_HEX.blue)
      : null;

  const style: React.CSSProperties = { ...(palette === null ? {} : ({
    '--wd-tag-bg': palette.bg,
    '--wd-tag-border': palette.border,
    '--wd-tag-text': palette.text,
  } as React.CSSProperties)) };
  if (typeof width === 'number') style.width = `${width}px`;
  else if (width !== undefined && width !== '') style.width = width;
  style.maxWidth = '100%';

  return (
    <div
      ref={rootRef}
      className={`wd-tagrow${overflowing ? ' is-overflowing' : ''}${canPrev ? ' can-prev' : ''}${canNext ? ' can-next' : ''}${dragging ? ' is-dragging' : ''}${className ? ` ${className}` : ''}`}
      data-fade={fade}
      style={style}
    >
      <button type="button" className="wd-tagrow-nav wd-tagrow-nav--prev" aria-label="向左翻页" onClick={() => scrollPage(-1)}>
        {CHEVRON_LEFT}
      </button>
      <div ref={viewportRef} className="wd-tagrow-viewport">
        <div ref={trackRef} className="wd-tagrow-track">
          {tags.map((tag, index) => (
            <span key={`${tag}-${index}`} className="wd-tagrow-tag" title={tag}>{tag}</span>
          ))}
        </div>
      </div>
      <button type="button" className="wd-tagrow-nav wd-tagrow-nav--next" aria-label="向右翻页" onClick={() => scrollPage(1)}>
        {CHEVRON_RIGHT}
      </button>
    </div>
  );
}
