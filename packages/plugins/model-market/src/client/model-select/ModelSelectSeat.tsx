import {
  useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import type { ModelDirectoryState, ModelSelectInjected } from '@deepseek-ai/dsh-client-ui-model-selection/client';
import { createModelMarketClient } from '../management.js';
import {
  MODEL_MARKET_SECTION, openSettingsSection,
} from '../settings-nav.js';
import type { ModelAuthorizationState } from '../../shared.js';
import {
  AUTO_ENTRY, TIERS, busyOf, fallbackDescription, familyOf, formatMultiplier, monogramOf, presentationOf,
  type TierDefinition,
} from './meta.js';
import { modelSelectCss } from './styles.js';

/** 会话座位注入面 + 座位自身 owner props。 */
export type ModelSelectSeatProps = ModelSelectInjected & {
  readonly locked: boolean;
  readonly sessionId: string;
};

type Group = ModelDirectoryState['groups'][number];

/** 二级详情面板宽度；与 styles.ts 里 `.wd-ms-aside` 的 width 必须保持一致。 */
const ASIDE_WIDTH = 260;
type CatalogModel = Group['models'][number];
type Selection = NonNullable<ModelDirectoryState['current']>;
type SelectOutcome = Awaited<ReturnType<ModelSelectInjected['select']>>;
type Detail =
  | { readonly kind: 'auto' }
  | { readonly kind: 'tier'; readonly id: TierDefinition['id'] }
  | { readonly kind: 'model'; readonly provider: string; readonly model: string };

/* ---------------------------------------------------------------- 图标 */

function Svg({ children }: { readonly children: ReactNode }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>;
}

function AutoIcon() {
  return <Svg><rect x="3" y="4" width="18" height="14" rx="3" /><path d="M8 21h8M12 18v3M7 11h4M15 11h2" /></Svg>;
}

function FastIcon() {
  return <Svg><path d="M13 2 4.5 13.5H11l-1 8.5L19 10h-6.5L13 2Z" /></Svg>;
}

function BalancedIcon() {
  return <Svg><circle cx="12" cy="12" r="9" /><path d="m8.5 12 2.4 2.4 4.6-4.8" /></Svg>;
}

function DeepIcon() {
  return <Svg><path d="m12 3 7 6-7 12L5 9l7-6Z" /><path d="M5 9h14" /></Svg>;
}

function TierGlyph({ id }: { readonly id: TierDefinition['id'] }) {
  if (id === 'fast') return <FastIcon />;
  if (id === 'balanced') return <BalancedIcon />;
  return <DeepIcon />;
}

function InfoIcon() {
  return <Svg><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></Svg>;
}

function CheckIcon() {
  return <Svg><path d="m5 12.5 4.5 4.5L19 7" /></Svg>;
}

function CaretIcon() {
  return <Svg><path d="m7 10 5 5 5-5" /></Svg>;
}

function ChevronIcon() {
  return <Svg><path d="m9 6 6 6-6 6" /></Svg>;
}

function PencilIcon() {
  return <Svg><path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3Z" /><path d="m14 7 3 3" /></Svg>;
}

/* ---------------------------------------------------------------- 工具 */

function failureText(outcome: SelectOutcome): string | null {
  if (!outcome || outcome.ok) return null;
  const error = outcome.error as { code?: string; message?: string } | undefined;
  if (error?.code === 'session/writer-held') return '会话正在写入，请稍后再切换模型。';
  return error?.message ?? '切换模型失败，请重试。';
}

function selectionOf(group: Group, model: CatalogModel): Selection {
  const effort = model.reasoning?.defaultEffort;
  return {
    provider: group.id,
    model: model.id,
    ...(effort === undefined ? {} : { reasoningEffort: effort }),
  };
}

function sameSelection(left: Selection | null, right: Selection): boolean {
  return left !== null && left.provider === right.provider && left.model === right.model;
}

function effortName(model: CatalogModel, effort: string | undefined): string {
  if (effort === undefined) return '默认';
  return model.reasoning?.efforts.find(level => level.id === effort)?.name ?? effort;
}

/* ---------------------------------------------------------------- 主体 */

/** 授权状态表键：provider 与模型标识用不可见分隔符拼接，避免拼接歧义。 */
function authKey(provider: string, model: string): string {
  return `${provider}\u0000${model}`;
}


export function ModelSelectSeat(props: ModelSelectSeatProps) {
  const { available, directory, load, select, locked } = props;

  /** 市场模型授权状态：只用来隐藏未授权市场模型；自建模型恒为 authorized，不受影响。 */
  const market = useMemo(() => createModelMarketClient(), []);
  const [authStates, setAuthStates] = useState<Readonly<Record<string, ModelAuthorizationState>>>({});

  const state = useSyncExternalStore(
    useCallback(notify => directory.subscribe(notify), [directory]),
    useCallback(() => directory.getSnapshot(), [directory]),
    useCallback(() => directory.getSnapshot(), [directory]),
  );

  const [open, setOpen] = useState(false);
  // Auto 与三档调度还没有真实逻辑：只保留展示，恒为未选中，避免写入任何会话或配置。
  const auto = false;
  const tier: TierDefinition['id'] | null = null;
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState('');
  const [position, setPosition] = useState<{
    readonly left: number;
    readonly bottom: number;
    readonly maxHeight: number;
    readonly aside: 'right' | 'none';
    readonly mainWidth: number;
    /** 二级面板的左边距，定位时一并算好，渲染时不必再读视口宽度。 */
    readonly asideLeft: number;
  } | null>(null);
  const [effortOpen, setEffortOpen] = useState(false);
  const [contextNote, setContextNote] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  // 二级面板的垂直位置：与「当前悬停的那一行」顶部对齐，鼠标可以水平右移直达。
  const [asideTop, setAsideTop] = useState<number | null>(null);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const asideRef = useRef<HTMLElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const hoverRowRef = useRef<HTMLElement | null>(null);
  /** 面板收起的延迟句柄：指针离开两栏整体后留一点兜底时间，避免边界抖动。 */
  const hideTimerRef = useRef<number | null>(null);

  const groups = state.groups;
  const currentEntry = useMemo(() => {
    if (state.current === null) return undefined;
    const exact = groups
      .map(group => ({ group, model: group.models.find(item => item.id === state.current?.model && group.id === state.current?.provider) }))
      .find(entry => entry.model !== undefined);
    if (exact?.model) return { group: exact.group, model: exact.model };
    // provider 可能已下线但选择仍保留：退回同 id 模型，至少显示名称。
    for (const group of groups) {
      const model = group.models.find(item => item.id === state.current?.model);
      if (model) return { group, model };
    }
    return undefined;
  }, [groups, state.current]);

  const activeTier = auto ? null : tier;
  const label = auto
    ? 'Auto'
    : activeTier
      ? TIERS.find(item => item.id === activeTier)?.name ?? '选择模型'
      : currentEntry?.model.name ?? (state.status === 'loading' ? '加载中…' : '选择模型');

  /** 当前目录里的模型集合：授权缓存、过滤与就绪判定都用这一份列表。 */
  const authItems = useMemo(
    () => groups.flatMap(group => group.models.map(model => ({ provider: group.id, model: model.id }))),
    [groups],
  );
  /** 模型集合指纹：换了集合（增删模型）才需要重新等一次授权结果。 */
  const authItemsKey = useMemo(
    () => authItems.map(item => authKey(item.provider, item.model)).join('\u0001'),
    [authItems],
  );
  /** 最新一次渲染的模型集合指纹：迟到的授权结果只在指纹仍一致时才落 UI。 */
  const authKeyRef = useRef(authItemsKey);
  authKeyRef.current = authItemsKey;
  const effectiveAuthStates = authStates;
  /**
   * 首帧保护：这一批模型的授权结论返回前不画任何模型行（也不是加载态），
   * 避免未授权模型先出现一次再消失。宿主读的是已恢复的本地快照，通常几毫秒就返回。
   */
  const [resolvedKey, setResolvedKey] = useState<string | null>(null);
  /** 每次打开面板递增，用来在打开时重新确认一次授权结论（不影响已渲染的行）。 */
  const [authRefreshKey, setAuthRefreshKey] = useState(0);

  /** 授权结论由宿主按资产授权快照给出，面板直接渲染，不留加载态。 */
  useEffect(() => {
    if (!available || !authItems.length) return;
    const key = authItemsKey;
    let live = true;
    void market.modelAuthorizations(authItems).then(entries => {
      if (!live || authKeyRef.current !== key) return;
      const next: Record<string, ModelAuthorizationState> = {};
      for (const entry of entries) next[authKey(entry.provider, entry.model)] = entry.state;
      setAuthStates(next);
      setResolvedKey(key);
    }).catch(() => {
      // 宿主不可用时保持上一次结论，并放行本批渲染（不阻塞列表）。
      if (live && authKeyRef.current === key) setResolvedKey(key);
    });
    return () => { live = false; };
  }, [available, authItems, authItemsKey, authRefreshKey, market]);

  /** 未授权的市场模型（unknown 与自建模型都保留）。 */
  const isRevoked = (provider: string, model: string): boolean =>
    effectiveAuthStates[authKey(provider, model)] === 'unauthorized';
  const visibleGroups = groups
    .map(group => ({ group, models: group.models.filter(model => !isRevoked(group.id, model.id)) }))
    .filter(entry => entry.models.length > 0);
  /** 正在使用的模型被撤销：面板内给出提示，要求用户自行切换。 */
  const currentRevoked = state.current !== null && isRevoked(state.current.provider, state.current.model);

  useEffect(() => {
    if (available) load();
  }, [available, load]);

  const cancelHideAside = useCallback(() => {
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  /** 立即收起二级面板：指针不在任何档位/模型行上时都用它。 */
  const hideAside = useCallback(() => {
    cancelHideAside();
    hoverRowRef.current = null;
    setDetail(null);
    setAsideTop(null);
  }, [cancelHideAside]);

  /** 延迟收起：指针离开「主面板 + 二级面板」整体时的兜底，进不去面板才收。 */
  const scheduleHideAside = useCallback(() => {
    cancelHideAside();
    hideTimerRef.current = window.setTimeout(() => {
      hideTimerRef.current = null;
      hoverRowRef.current = null;
      setDetail(null);
      setAsideTop(null);
    }, 160);
  }, [cancelHideAside]);

  useEffect(() => () => cancelHideAside(), [cancelHideAside]);

  const close = useCallback(() => {
    cancelHideAside();
    setOpen(false);
    setDetail(null);
    setEffortOpen(false);
    setContextNote(false);
    setScrolled(false);
    setAsideTop(null);
    hoverRowRef.current = null;
  }, []);

  /** 切换二级详情时记住是哪一行触发的，供面板做垂直对齐。 */
  const showDetail = useCallback((next: Detail, element: HTMLElement) => {
    cancelHideAside();
    hoverRowRef.current = element;
    setDetail(next);
  }, [cancelHideAside]);

  /**
   * 把二级面板的顶边对到悬停行的顶边（再夹在视口内）。
   * 对齐后鼠标只需水平右移就能进入面板；面板在上方时则要斜穿列表，容易途经别的行。
   */
  const alignAside = useCallback(() => {
    const row = hoverRowRef.current;
    const aside = asideRef.current;
    if (!row || !aside || !row.isConnected) return;
    const rowRect = row.getBoundingClientRect();
    const asideHeight = aside.getBoundingClientRect().height;
    const maxTop = Math.max(8, window.innerHeight - asideHeight - 8);
    const top = Math.min(Math.max(8, rowRect.top), maxTop);
    setAsideTop(previous => (previous !== null && Math.abs(previous - top) < 0.5 ? previous : top));
  }, []);

  const place = useCallback((withAside: boolean) => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const width = window.innerWidth;
    const height = window.innerHeight;
    const mainWidth = Math.min(348, width - 16);
    const mainLeft = Math.min(Math.max(8, rect.right - mainWidth), width - mainWidth - 8);
    // Auto 态浮层只有一段说明，右侧不再有详情栏，也就不能为它预留面板宽度。
    const aside: 'right' | 'none' = withAside && width >= 720 ? 'right' : 'none';
    // 详情紧贴列表右边缘（零间隙），鼠标从行水平右移直接进入面板，不经过外部区域。
    const left = aside === 'right'
      ? Math.max(8, Math.min(mainLeft, width - (mainWidth + ASIDE_WIDTH) - 8))
      : mainLeft;
    const asideLeft = Math.max(8, Math.min(left + mainWidth, width - ASIDE_WIDTH - 8));
    const bottom = Math.min(height - 8, height - rect.top + 8);
    const maxHeight = Math.max(240, Math.min(560, rect.top - 24));
    setPosition(previous => previous
      && previous.left === left
      && previous.bottom === bottom
      && previous.maxHeight === maxHeight
      && previous.aside === aside
      && previous.mainWidth === mainWidth
      && previous.asideLeft === asideLeft
      ? previous
      : { left, bottom, maxHeight, aside, mainWidth, asideLeft });
  }, []);

  useEffect(() => {
    if (!open) return;
    const sync = () => {
      place(!auto);
      alignAside();
    };
    sync();
    window.addEventListener('resize', sync);
    // 只跟随窗口滚动；列表自身滚动不应重新定位浮层，否则会把列表顶回选中项。
    window.addEventListener('scroll', sync);
    return () => {
      window.removeEventListener('resize', sync);
      window.removeEventListener('scroll', sync);
    };
  }, [open, place, auto, alignAside]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (popRef.current?.contains(target)) return;
      // 二级面板已移出 pop 的 flex 流，需要单独判定，否则点面板内部会被当成外部点击。
      if (asideRef.current?.contains(target)) return;
      close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, close]);

  useEffect(() => {
    setEffortOpen(false);
    setContextNote(false);
  }, [detail]);

  // 二级面板内容/高度变化后重新贴回悬停行；没有面板时清空，避免下次残留旧位置。
  useLayoutEffect(() => {
    if (!open) return;
    if (!detail || position?.aside !== 'right') {
      setAsideTop(null);
      return;
    }
    alignAside();
  }, [open, detail, effortOpen, contextNote, position?.aside, alignAside]);

  // 打开时把当前模型滚进可视区，避免用户每次都要自己找勾选项。
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      const row = scrollRef.current?.querySelector<HTMLElement>('[data-selected="true"]');
      const box = scrollRef.current;
      if (!row || !box) return;
      const rowRect = row.getBoundingClientRect();
      const boxRect = box.getBoundingClientRect();
      if (rowRect.top < boxRect.top) box.scrollTop -= boxRect.top - rowRect.top + 6;
      else if (rowRect.bottom > boxRect.bottom) box.scrollTop += rowRect.bottom - boxRect.bottom + 6;
    });
    return () => cancelAnimationFrame(frame);
  }, [open, position, state.current?.provider, state.current?.model]);

  if (!available) return null;

  const chooseModel = async (group: Group, model: CatalogModel, effort?: string, keepOpen = false) => {
    if (state.pending !== null) return;
    setError('');
    try {
      const outcome = await select({
        provider: group.id,
        model: model.id,
        ...(effort === undefined ? {} : { reasoningEffort: effort }),
      });
      const failure = failureText(outcome);
      if (failure) {
        setError(failure);
        return;
      }
      if (!keepOpen) close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '切换模型失败，请重试。');
    }
  };

  /**
   * 底部入口：只打开「设置 → 模型管理」，不再预置添加表单之类的动作。
   */
  const openModelManagement = () => {
    if (openSettingsSection(MODEL_MARKET_SECTION)) {
      close();
      return;
    }
    // 设置外壳还没就绪：留在原地提示，等用户自己从侧栏进入。
    setError('未能打开设置，请从侧栏进入「设置 → 模型管理」。');
  };

  const toggle = () => {
    if (open) {
      close();
      return;
    }
    setError('');
    setOpen(true);
    // 每次打开都重新问一次授权结论（宿主侧强制整份快照刷新，并有 15 秒节流）。
    setAuthRefreshKey(value => value + 1);
    load();
  };

  const asideDetail = (() => {
    if (auto) return null;
    if (!detail) return null;
    if (detail.kind === 'auto') {
      return (
        <>
          <h3 className="wd-ms-aside-title">{AUTO_ENTRY.name}</h3>
          <p className="wd-ms-aside-desc">{AUTO_ENTRY.description}</p>
          <div className="wd-ms-kv"><span className="wd-ms-kv-label">消耗速度</span><span className="wd-ms-kv-value">按实际模型计费</span></div>
          <p className="wd-ms-note">{AUTO_ENTRY.note}</p>
        </>
      );
    }
    if (detail.kind === 'tier') {
      const item = TIERS.find(entry => entry.id === detail.id);
      if (!item) return null;
      return (
        <>
          <h3 className="wd-ms-aside-title">{item.name}</h3>
          <p className="wd-ms-aside-desc">{item.description}</p>
          <div className="wd-ms-kv"><span className="wd-ms-kv-label">消耗速度</span><span className="wd-ms-kv-value">{formatMultiplier(item.multiplier)} 倍率</span></div>
          <p className="wd-ms-note">档位调度由服务端接入后生效，当前仅展示说明。</p>
        </>
      );
    }
    const group = groups.find(entry => entry.id === detail.provider);
    const model = group?.models.find(entry => entry.id === detail.model);
    if (!group || !model) return null;
    const meta = presentationOf(model.id);
    const busy = busyOf(model.id);
    const reasoning = model.reasoning;
    const isCurrent = sameSelection(state.current, { provider: group.id, model: model.id });
    const chosenEffort = isCurrent
      ? state.current?.reasoningEffort ?? reasoning?.defaultEffort
      : reasoning?.defaultEffort;
    return (
      <>
        <h3 className="wd-ms-aside-title">{model.name}</h3>
        <p className="wd-ms-aside-desc">{model.description || fallbackDescription(model.id)}</p>
        <div className="wd-ms-kv"><span className="wd-ms-kv-label">消耗速度</span><span className="wd-ms-kv-value">{formatMultiplier(meta.multiplier)} 倍率</span></div>
        <div className="wd-ms-kv">
          <span className="wd-ms-kv-label">繁忙程度</span>
          <span className="wd-ms-kv-value wd-ms-busy" data-level={busy.level}><i className="wd-ms-dot" aria-hidden="true" />{busy.label}</span>
        </div>
        <div className="wd-ms-kv">
          <span className="wd-ms-kv-label">思考强度</span>
          <button
            type="button"
            className="wd-ms-kv-value is-clickable"
            aria-expanded={effortOpen}
            disabled={reasoning === undefined}
            onClick={() => setEffortOpen(value => !value)}
          >
            {reasoning === undefined ? '不支持' : effortName(model, chosenEffort)}
            {reasoning === undefined ? null : <ChevronIcon />}
          </button>
        </div>
        {effortOpen && reasoning !== undefined ? (
          <div className="wd-ms-menu" role="radiogroup" aria-label="思考强度">
            <button type="button" role="radio" aria-checked={chosenEffort === undefined} onClick={() => { setEffortOpen(false); void chooseModel(group, model, undefined, true); }}>
              默认<em>跟随模型</em>
            </button>
            {reasoning.efforts.map(level => (
              <button
                key={level.id}
                type="button"
                role="radio"
                aria-checked={chosenEffort === level.id}
                onClick={() => { setEffortOpen(false); void chooseModel(group, model, level.id, true); }}
              >
                {level.name}
                {level.description ? <em>{level.description}</em> : null}
              </button>
            ))}
          </div>
        ) : null}
        <div className="wd-ms-kv">
          <span className="wd-ms-kv-label">上下文窗口</span>
          <button type="button" className="wd-ms-kv-value is-clickable" onClick={() => setContextNote(value => !value)}>
            {meta.context}<ChevronIcon />
          </button>
        </div>
        {contextNote ? <p className="wd-ms-note">上下文窗口由模型服务端配置，暂不支持按会话切换。</p> : null}
      </>
    );
  })();

  /** 非 Auto 态：模型目录列表 + 底部「模型管理」入口。 */
  const catalogPanel = (
    <>
      <div className="wd-ms-scroll-wrap">
        <div
          className="wd-ms-scroll"
          ref={scrollRef}
          onScroll={event => {
            setScrolled(event.currentTarget.scrollTop > 0);
            // 列表滚动会改变行的视口位置，面板要跟着走，否则又会和行错位。
            if (hoverRowRef.current) requestAnimationFrame(alignAside);
          }}
        >
          {error ? <p className="wd-ms-error" role="alert">{error}</p> : null}
          {/* 正在使用的模型被撤销：明确要求用户自行切换，不自动改选。 */}
          {currentRevoked ? (
            <p className="wd-ms-error" role="alert">
              当前模型「{currentEntry?.model.name ?? state.current?.model ?? ''}」的授权已失效，请切换到其他模型后继续使用；如仍需使用，请到「模型管理 · 模型市场」重新申请。
            </p>
          ) : null}
          {state.status === 'loading' && groups.length === 0 ? <div className="wd-ms-state">正在加载模型…</div> : null}
          {state.status === 'error' ? (
            <div className="wd-ms-state">
              <span>{state.error ?? '模型列表加载失败。'}</span>
              <button type="button" onClick={() => load()}>重试</button>
            </div>
          ) : null}
          {resolvedKey === authItemsKey && visibleGroups.length === 0 && state.status === 'ready' ? <div className="wd-ms-state">暂无可用模型</div> : null}
          {resolvedKey === authItemsKey ? visibleGroups.map(({ group, models }) => (
            <section key={group.id}>
              <div className="wd-ms-group">
                {group.id === 'deepseek-account' ? '内置模型' : group.name}
                <InfoIcon />
              </div>
              {models.map(model => {
                const meta = presentationOf(model.id);
                const selected = sameSelection(state.current, selectionOf(group, model));
                const pending = state.pending !== null && state.pending.provider === group.id && state.pending.model === model.id;
                return (
                  <button
                    key={model.id}
                    type="button"
                    className={`wd-ms-row${selected ? ' is-selected' : ''}${pending ? ' is-busy' : ''}`}
                    data-selected={selected ? 'true' : undefined}
                    data-hover-row="true"
                    disabled={state.pending !== null}
                    onClick={() => void chooseModel(group, model)}
                    onMouseEnter={event => showDetail({ kind: 'model', provider: group.id, model: model.id }, event.currentTarget)}
                  >
                    <span className="wd-ms-model-glyph" data-family={familyOf(model.id)}>{monogramOf(model.name, model.id)}</span>
                    <span className="wd-ms-name">{model.name}</span>
                    {meta.tag ? <span className="wd-ms-tag" data-tone={meta.tag.tone}>{meta.tag.text}</span> : null}
                    <span className="wd-ms-mult">{formatMultiplier(meta.multiplier)}</span>
                    {/* 勾选列固定在最右侧并始终占位：标签、徽标、勾选都不再影响倍率列对齐。 */}
                    <span className="wd-ms-check" aria-hidden={pending || selected ? undefined : 'true'}>
                      {pending ? <i className="wd-ms-spinner" /> : selected ? <CheckIcon /> : null}
                    </span>
                  </button>
                );
              })}
            </section>
          )) : null}
        </div>
        <i className={`wd-ms-fade${scrolled ? ' is-on' : ''}`} aria-hidden="true" />
      </div>
      <div className="wd-ms-footer">
        <button type="button" className="wd-ms-row" onClick={openModelManagement}>
          <span className="wd-ms-glyph"><PencilIcon /></span>
          <span className="wd-ms-name">模型管理</span>
          <span className="wd-ms-kv-value"><ChevronIcon /></span>
        </button>
      </div>
    </>
  );

  const popover = open && position ? createPortal(
    <>
    <div className="wd-ms-pop" ref={popRef} style={{ left: position.left, bottom: position.bottom }}>
      <div
        className="wd-ms-main"
        style={{ maxHeight: position.maxHeight }}
        role="dialog"
        aria-label="选择模型"
        // 指针停在档位/模型行以外（分组标题、分隔线、列表空白、底部入口）时收起二级面板。
        onMouseMove={event => {
          if (auto) return;
          const target = event.target as Element;
          if (target.closest('[data-hover-row]')) {
            cancelHideAside();
            return;
          }
          // 行两侧的窄内边距与行同属一条水平带：鼠标从行水平右移去面板时会经过它，
          // 这里若直接收起，面板就永远够不到。按指针高度是否落在某一行判断更准确。
          const y = event.clientY;
          for (const row of event.currentTarget.querySelectorAll<HTMLElement>('[data-hover-row]')) {
            const rect = row.getBoundingClientRect();
            if (y >= rect.top && y <= rect.bottom) {
              cancelHideAside();
              return;
            }
          }
          hideAside();
        }}
        // 两栏紧贴：指针若是直接进了二级面板，就不启动收起计时，彻底消除跨间隙时的概率隐藏。
        onMouseLeave={event => {
          if (asideRef.current?.contains(event.relatedTarget as Node | null)) return;
          scheduleHideAside();
        }}
      >
        <div className="wd-ms-top">
          {/* Auto 暂无真实逻辑：开关不可拨动，悬浮或键盘聚焦只展示介绍。 */}
          <button
            type="button"
            className="wd-ms-row is-static"
            role="switch"
            aria-checked={false}
            aria-disabled="true"
            data-hover-row="true"
            onMouseEnter={event => showDetail({ kind: 'auto' }, event.currentTarget)}
            onFocus={event => showDetail({ kind: 'auto' }, event.currentTarget)}
            onBlur={hideAside}
          >
            <span className="wd-ms-glyph"><AutoIcon /></span>
            <span className="wd-ms-name">Auto</span>
            <span className="wd-ms-tag" data-tone="gray">暂不可用</span>
            <span className="wd-ms-switch" aria-hidden="true" />
          </button>
          <div className="wd-ms-sep" />
          {/* 三档调度暂无真实逻辑：灰字展示，悬浮/聚焦只打开介绍，不参与选中。 */}
          {TIERS.map(item => (
            <button
              key={item.id}
              type="button"
              className="wd-ms-row is-static"
              aria-disabled="true"
              data-hover-row="true"
              onMouseEnter={event => showDetail({ kind: 'tier', id: item.id }, event.currentTarget)}
              onFocus={event => showDetail({ kind: 'tier', id: item.id }, event.currentTarget)}
              onBlur={hideAside}
            >
              <span className="wd-ms-glyph"><TierGlyph id={item.id} /></span>
              <span className="wd-ms-name">{item.name}</span>
              <span className="wd-ms-tag" data-tone="gray">暂不可用</span>
              <span className="wd-ms-mult">{formatMultiplier(item.multiplier)}</span>
              <span className="wd-ms-check" aria-hidden="true" />
            </button>
          ))}
        </div>
        {auto ? <p className="wd-ms-auto-desc">{AUTO_ENTRY.inline}</p> : catalogPanel}
      </div>
    </div>
    {position.aside === 'right' && asideDetail ? (
      <aside
        ref={asideRef}
        className="wd-ms-aside"
        // 指针进入面板就取消收起；回到主面板时交给它的 mousemove 判定，只有离开两栏整体才按宽限收起。
        onMouseEnter={cancelHideAside}
        onMouseLeave={event => {
          if (popRef.current?.contains(event.relatedTarget as Node | null)) return;
          scheduleHideAside();
        }}
        style={{
          left: position.asideLeft,
          top: asideTop ?? 0,
          maxHeight: 'calc(100vh - 16px)',
          // 首次挂载还没量到高度，先不可见，layout effect 定位后再显示，避免闪一下。
          visibility: asideTop === null ? 'hidden' : undefined,
        }}
      >
        {asideDetail}
      </aside>
    ) : null}
    </>,
  document.body,
) : null;

  return (
    <>
      <style>{modelSelectCss}</style>
      <button
        ref={triggerRef}
        type="button"
        className="wd-ms-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={locked}
        title={`当前模型：${label}`}
        onClick={toggle}
      >
        <span className="wd-ms-trigger-icon">
          {auto
            ? <AutoIcon />
            : activeTier
              ? <TierGlyph id={activeTier} />
              : currentEntry
                ? <span className="wd-ms-model-glyph" data-family={familyOf(currentEntry.model.id)}>{monogramOf(currentEntry.model.name, currentEntry.model.id)}</span>
                : <BalancedIcon />}
        </span>
        <span className="wd-ms-trigger-text">{label}</span>
        <span className="wd-ms-trigger-caret"><CaretIcon /></span>
      </button>
      {popover}
    </>
  );
}
