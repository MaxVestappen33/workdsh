import { applyStatusTone, Button, CardSkeleton, cardSkeletonCss, Input, QueryOverlay, queryOverlayCss, TongyunTagScrollRow, TongyunTagSingle, tongyunTagScrollCss, tongyunTagSingleCss } from 'workdsh-ui';
import * as React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
// The `main` slot PropsRuntime is augmented by the official layout client module;
// without this side-effect type import the slot name resolves to `never`.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client';
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import { Icon, Modal, type IconName } from 'workdsh-ui';
import type { ExpertAvailability, ExpertSummary } from '../shared.js';
import type { ExpertManagementClient } from './management.js';
import { EXPERT_AUTH_SSO } from './management.js';
import { ExpertDetailModal } from './ExpertDetailModal.js';
import { expertDraftId } from '../domain/navigation.js';
import { ExpertDraftEditor } from './ExpertDraftEditor.js';
import { ImportExpertModal } from './ImportExportModals.js';
import { RemoteExperts } from './RemoteExperts.js';
import { MyApplications } from './MyApplications.js';
import { CategoryBar } from './components/CategoryBar.js';
import { EXPERT_APPLY_LABEL, EXPERT_APPLY_VALUE, EXPERT_BUILTIN_OPTIONS } from './market-list.js';
import { expertsCss, expertsMarketCss } from './styles.js';

type ExpertsPanelInjected = {
  toggleNavigation: () => void;
  management: ExpertManagementClient;
  /** Switch the shared capability center to another registered panel (e.g. Skill). */
  openCapability: (key: string) => void;
  hasCapability: (key: string) => boolean;
  /** Summon a published expert into a fresh bound native Session; never auto-sends. */
  summon: (expertId: string, revisionId: string | undefined, draftText: string | undefined) => Promise<void>;
  /** Open a new native task seeded with the `/workdsh-expert-manager` guide draft. */
  createExpertTask: (kind?: 'agent' | 'team') => Promise<void>;
  editExpertTask: (expertId: string) => Promise<void>;
};
export type ExpertsPanelProps = PropsRuntime<'main'> & InjectFace<ExpertsPanelInjected>;

type View = 'center' | 'mine' | 'applications';
/** 「专家 / 专家团」标题下的二级页签：我的（本地）与市场（后台目录）。 */
type LibraryTab = 'mine' | 'market';
type StateFilter = 'all' | 'draft' | 'published' | 'disabled' | 'archived';
type Notice = { kind: 'info' | 'warn' | 'error'; text: string };

function messageOf(cause: unknown): string { return cause instanceof Error ? cause.message : '专家操作失败，请重试。'; }
function codeOf(cause: unknown): string { const code = (cause as unknown as { code?: unknown })?.code; return typeof code === 'string' ? code : ''; }
function icon(name: string) { return <Icon name={name as IconName} />; }

/**
 * 打开后台管理系统：Desktop 的 window.open 由主进程转交系统浏览器，
 * Web 预览被拦截时退回当前页跳转。
 */
function openAdminSso(url: string): void {
  const popup = window.open(url, '_blank', 'noopener');
  if (!popup && !/Electron/iu.test(navigator.userAgent)) window.location.assign(url);
}

const ORIGIN_LABEL: Record<string, string> = { default: '默认模板', personal: '我的专家', organization: '组织' };
const AVAILABILITY_LABEL: Record<ExpertAvailability, string> = { enabled: '已启用', disabled: '已停用', archived: '已归档' };
const READINESS: Record<string, { label: string; cls: string }> = {
  ready: { label: '可用', cls: 'ready' },
  'missing-dependency': { label: '依赖缺失', cls: 'bad' },
  'unsupported-capability': { label: '能力未满足', cls: 'warn' },
  broken: { label: 'preset 异常', cls: 'bad' },
  unknown: { label: '未发布', cls: '' },
};

/** 卡片异常态：与 Host 的 authState / integrityState 一一对应，文案沿用同一套语义。 */
function assetStateOf(summary: ExpertSummary): { label: string; tone?: 'red' | 'blue'; reason?: string } | undefined {
  if (summary.integrityState) return summary.integrityState === 'unsigned'
    ? { label: '需重新安装', tone: 'blue', reason: summary.integrityReason ?? '安装清单缺少校验信息，请从市场重新安装。' }
    : { label: '校验失败', tone: 'red', reason: summary.integrityReason ?? '专家文件校验失败，请从市场重新安装。' };
  if (summary.authState === 'reinstall') return { label: '需重新安装', tone: 'blue', reason: summary.authReason };
  if (summary.authState === 'revoked') return { label: '已失效', reason: summary.authReason };
  if (summary.authState === 'unauthorized') return { label: '未授权', reason: summary.authReason };
  return undefined;
}

/** 授权到期提示：只在条目带结束时间且已经过期时展示；未过期不新增噪音。 */
function expiryNoticeOf(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const at = Date.parse(value);
  if (Number.isNaN(at)) return '授权已过期';
  if (at > Date.now()) return undefined;
  const date = new Date(at);
  return `已过期至 ${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}

/** 本地自建（含已发布的自建）：无市场安装记录且非内置，按“不受支持”只读展示。 */
function isLegacyLocal(summary: ExpertSummary): boolean {
  return summary.origin === 'personal' && !summary.installedFromCatalog && !summary.builtin;
}

function StateTag({ state }: { state: { label: string; tone?: 'red' | 'blue' } }) {
  return state.tone
    ? <TongyunTagSingle tone={state.tone}>{state.label}</TongyunTagSingle>
    : <TongyunTagSingle auth={false}>{state.label}</TongyunTagSingle>;
}

/** 卡片展示名称：后台运营口径优先，缺省回退包内定义。 */
function displayNameOf(summary: Pick<ExpertSummary, 'name' | 'displayName'>): string {
  return summary.displayName?.trim() || summary.name;
}

function Avatar({ summary }: { summary: ExpertSummary }) {
  const [brokenIcon, setBrokenIcon] = useState(false);
  const backendIcon = summary.displayIcon;
  // 后台图标是远程 URL，内网连不上后台时加载失败；失败后退回包内头像，再退回名称首字。
  const packageIcon = summary.avatarRef?.startsWith('data:image/') ? summary.avatarRef : undefined;
  const icon = backendIcon && !brokenIcon ? backendIcon : packageIcon;
  return <span className="avatar" style={icon === undefined && summary.displayColor ? { background: summary.displayColor, color: '#fff' } : undefined} aria-hidden>
    {icon === undefined
      ? displayNameOf(summary).trim().charAt(0) || '专'
      : <img src={icon} alt="" onError={icon === backendIcon ? () => setBrokenIcon(true) : undefined} />}
  </span>;
}

export function ExpertsPanel({ toggleNavigation, management, openCapability, hasCapability, summon, createExpertTask, editExpertTask }: ExpertsPanelProps) {
  const [view, setView] = useState<View>(() => expertDraftId(window.location.search) || new URLSearchParams(window.location.search).get('expert-library') === 'mine' ? 'mine' : 'center');
  /** 二级页签：默认「我的」；顶部「我的专家」按钮仍走原来的独立视图，用于对比验收。 */
  const [libraryTab, setLibraryTab] = useState<LibraryTab>('mine');
  /** 市场页签的数量：按类型分别保存，进入面板即取；市场页加载/筛选后由 onTotal 回填当前类型。 */
  const [marketTotals, setMarketTotals] = useState<Partial<Record<'agent' | 'team', number>>>({});
  /** 我的专家筛选：是否内置（单选）与业务场景（多选），都在本地按安装清单快照过滤。 */
  const [builtinFilter, setBuiltinFilter] = useState<boolean>();
  const [sceneFilter, setSceneFilter] = useState<readonly string[]>([]);
  /** 申请/取消申请跳转占用：与上架申请分开，避免互相禁用。 */
  const [ssoBusy, setSsoBusy] = useState(false);
  const [kind, setKind] = useState<'agent' | 'team'>(() => new URLSearchParams(window.location.search).get('expert-kind') === 'team' ? 'team' : 'agent');
  const [typeCounts, setTypeCounts] = useState({ agent: 0, team: 0 });
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [stateFilter, setStateFilter] = useState<StateFilter>('all');
  const [items, setItems] = useState<readonly ExpertSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | undefined>();
  const [busy, setBusy] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<Notice | undefined>();
  /** 验收对比用总数：仅服务顶栏「我的专家」按钮，按钮下线后一并注释；恢复按钮时取消本行注释。 */
  // const [mineCount, setMineCount] = useState(0);
  /** 绑定不可用时待确认打开的单点地址，非空即弹出提醒。 */
  const [ssoPromptUrl, setSsoPromptUrl] = useState<string>();
  const [detailId, setDetailId] = useState<string>();
  /** Set when the detail was opened from the backend catalog: only 召唤 and 卸载 apply. */
  const [detailRemote, setDetailRemote] = useState<{ remoteKey: string; boundSessions: number }>();
  /** `expertId → 安装记录`：remoteKey 用于卸载，boundSessions 用于确认弹窗的会话占用提示。 */
  const [installations, setInstallations] = useState<ReadonlyMap<string, { remoteKey: string; boundSessions: number }>>(new Map());
  const [editorId, setEditorId] = useState<string | undefined>(() => expertDraftId(window.location.search));
  const [importOpen, setImportOpen] = useState(false);
  const [actionMenu, setActionMenu] = useState<string>();
  const [acting, setActing] = useState(false);
  /** Bumped by 刷新 so the backend catalog reloads; it is the only center-view source. */
  const [remoteReload, setRemoteReload] = useState(0);
  const search = useRef<HTMLInputElement>(null);
  const loadSequence = useRef(0);
  const kindLabel = kind === 'team' ? '专家团' : '专家';

  useEffect(() => {
    const url = new URL(window.location.href);
    if (view === 'mine') { url.searchParams.set('expert-library', 'mine'); url.searchParams.set('expert-kind', kind); }
    else { url.searchParams.delete('expert-library'); url.searchParams.set('expert-kind', kind); }
    window.history.replaceState(window.history.state, '', url);
  }, [view, kind]);

  useEffect(() => { const timer = window.setTimeout(() => setDebounced(query.trim()), 300); return () => window.clearTimeout(timer); }, [query]);

  /** Local catalog query. Only the 「我的」 view uses it; the center view is backend-only. */
  const buildQuery = useCallback(() => {
    const search_ = debounced || undefined;
    const availability = stateFilter === 'disabled' || stateFilter === 'archived' || stateFilter === 'published'
      ? (stateFilter === 'published' ? 'enabled' : stateFilter) as ExpertAvailability : undefined;
    return { expertType: kind, ...(search_ ? { search: search_ } : {}), origin: 'personal' as const, ...(availability ? { availability } : {}), limit: 100 };
  }, [kind, debounced, stateFilter]);

  /**
   * `force`：回跳/切回本地页签/手动刷新时跳过 Host 的市场元数据缓存，
   * 让本地卡片的申请状态立即反映后台最新结果。
   */
  const load = useCallback(async (cursor?: string, force = false) => {
    const sequence = ++loadSequence.current;
    const appending = cursor !== undefined;
    if (appending) setLoadingMore(true); else { setBusy(true); setNotice(undefined); }
    setError('');
    try {
      const base = force ? { ...buildQuery(), refresh: true } : buildQuery();
      const result = await management.list(cursor ? { ...base, cursor } : base);
      if (sequence !== loadSequence.current) return;
      setItems(prev => (appending ? [...prev, ...result.items] : result.items));
      setNextCursor(result.nextCursor);
    } catch (cause) {
      if (sequence !== loadSequence.current) return;
      if (codeOf(cause) === 'experts/cursor-stale') {
        setNotice({ kind: 'warn', text: '目录已变化，分页游标失效，已为你重新加载第一页。' });
        setItems([]); setNextCursor(undefined);
        try { const fresh = await management.list(buildQuery()); setItems(fresh.items); setNextCursor(fresh.nextCursor); } catch { /* surfaced below */ }
      } else setError(messageOf(cause));
    } finally { if (sequence === loadSequence.current) { setBusy(false); setLoadingMore(false); } }
  }, [buildQuery, management]);

  // 注意：本函数同时维护二级 tab 的 typeCounts，不能随「我的专家」按钮一起删除。
  const loadMineCount = useCallback(async () => {
    try { const [agent, team] = await Promise.all([management.list({ origin: 'personal', expertType: 'agent', limit: 1 }), management.list({ origin: 'personal', expertType: 'team', limit: 1 })]); setTypeCounts({ agent: agent.total, team: team.total }); /* setMineCount(agent.total + team.total); 顶栏按钮下线，恢复时取消注释 */ } catch { /* non-fatal badge */ }
  }, [management]);

  // The center view is backend-only; the local catalog is fetched for 「我的」 and the new 我的 page tab.
  const lastLocalTab = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!(view === 'mine' || (view === 'center' && libraryTab === 'mine'))) { setBusy(false); return; }
    const key = `${view}:${libraryTab}`;
    // 切回本地页签时强制重取，不走 Host 的市场元数据缓存；首次进入与筛选变化不额外回查后台。
    const switched = lastLocalTab.current !== undefined && lastLocalTab.current !== key;
    lastLocalTab.current = key;
    void load(undefined, switched);
  }, [load, view, libraryTab]);
  useEffect(() => { void loadMineCount(); }, [loadMineCount, items]);
  /** 上架入口：按按钮对应的类型跳转后台管理系统的申请页；绑定不可用时先提示再打开登录页。 */
  const openListingAdmin = useCallback(async (type: 'agent' | 'team') => {
    if (acting) return;
    setActing(true);
    setError('');
    try {
      const target = await management.adminSso(type);
      if (target.degraded) {
        // 绑定不可用时不阻断跳转：弹窗提醒后由用户确认继续打开后台登录页。
        setSsoPromptUrl(target.url);
      } else {
        openAdminSso(target.url);
      }
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setActing(false);
    }
  }, [acting, management]);
  /** 从后台返回后刷新一次：申请/取消申请的结果可能已变化。 */
  const pendingAuthRefresh = useRef(false);
  /**
   * 本地卡片上的授权申请/取消申请：与市场一致，走后台单点登录。
   * assetType 按专家类型注入（agent → expert、team → expert_group），assetId 取安装清单里的后台主键。
   */
  const openAuthSso = useCallback(async (action: 'apply' | 'cancel', summary: ExpertSummary) => {
    if (ssoBusy || !summary.assetId) return;
    setSsoBusy(true);
    setError('');
    try {
      const target = EXPERT_AUTH_SSO[action];
      const result = await management.adminSsoFor(EXPERT_AUTH_SSO.menuId, {
        ...target,
        assetType: summary.expertType === 'team' ? 'expert_group' : 'expert',
        assetId: summary.assetId,
      });
      pendingAuthRefresh.current = true;
      if (result.degraded) setSsoPromptUrl(result.url);
      else openAdminSso(result.url);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setSsoBusy(false);
    }
  }, [management, ssoBusy]);
  const loadInstallations = useCallback(async () => {
    try {
      const rows = await management.installations();
      setInstallations(new Map(rows.map(row => [row.expertId, { remoteKey: row.remoteKey, boundSessions: row.boundSessions ?? 0 }])));
    } catch { /* non-fatal: summaries still carry installedFromCatalog */ }
  }, [management]);
  useEffect(() => { void loadInstallations(); }, [loadInstallations]);
  useEffect(() => {
    if (!actionMenu) return;
    const outside = (event: PointerEvent) => { if (!(event.target instanceof Element) || !event.target.closest('.card-actions')) setActionMenu(undefined); };
    document.addEventListener('pointerdown', outside); return () => document.removeEventListener('pointerdown', outside);
  }, [actionMenu]);

  const visible = useMemo(() => {
    if (stateFilter === 'draft') return items.filter(item => item.publishedRevisionRef === undefined);
    if (stateFilter === 'published') return items.filter(item => item.publishedRevisionRef !== undefined);
    return items;
  }, [items, stateFilter]);
  /** 我的专家的业务场景选项：只取安装清单快照里的真实值，本地自建专家没有就不出现在筛选里。 */
  const libraryScenes = useMemo(() => {
    const labels = new Set<string>();
    for (const item of items) for (const label of item.bizScene ?? []) labels.add(label);
    return [...labels];
  }, [items]);
  /** 「我的」二级页签的客户端过滤：是否内置与业务场景都按安装清单快照判断。 */
  const libraryItems = useMemo(() => visible.filter(item => {
    if (builtinFilter !== undefined && (item.builtin === true) !== builtinFilter) return false;
    if (!sceneFilter.length) return true;
    const labels = item.bizScene ?? [];
    return labels.some(label => sceneFilter.includes(label));
  }), [visible, builtinFilter, sceneFilter]);
  // 切换类型时清空只对某一类有意义的筛选，避免场景选项与选中项错配。
  useEffect(() => { setBuiltinFilter(undefined); setSceneFilter([]); }, [kind]);
  /** 首屏骨架：只有「我的」列表还没有任何数据且正在加载时出现；已有数据刷新改用覆盖层。 */
  const skeletonVisible = busy && !items.length;
  const overlayVisible = busy && items.length > 0;

  /** 刷新按钮：只重取当前视图的数据源，避免一次点击同时打列表、计数与安装索引。 */
  const refresh = useCallback(() => {
    // 手动刷新强制回查后台，跳过 Host 的市场元数据缓存。
    if (view === 'mine' || (view === 'center' && libraryTab === 'mine')) { void load(undefined, true); return; }
    // 中心页市场与「我的申请」都由 reloadKey 驱动。
    setRemoteReload(value => value + 1);
  }, [load, view, libraryTab]);
  /**
   * 市场总数：与技能管理的页签计数同口径，进入面板即分别取两类市场的 total，
   * 不依赖市场页签是否打开过；只取 1 条，成本与一次轻量查询相当。
   */
  const loadMarketTotals = useCallback(async () => {
    try {
      const [agent, team] = await Promise.all([
        management.remoteList({ expertType: 'agent', pageNo: 1, pageSize: 1 }),
        management.remoteList({ expertType: 'team', pageNo: 1, pageSize: 1 }),
      ]);
      setMarketTotals({ agent: agent.total, team: team.total });
    } catch { /* 后台不可用时保留已有数字，市场页自身会提示不可用 */ }
  }, [management]);
  /** 操作后的整体同步：安装/删除/启停可能改变我的作品数量与安装索引，需一并重取。 */
  const refreshAll = useCallback(() => {
    refresh();
    void loadMineCount();
    void loadInstallations();
    void loadMarketTotals();
  }, [refresh, loadMineCount, loadInstallations, loadMarketTotals]);
  // 进入面板即取两类市场的总数（与技能管理一致，数字不依赖市场页是否打开过）。
  useEffect(() => { void loadMarketTotals(); }, [loadMarketTotals]);
  // 依赖声明在这些回调之后：effect 的依赖数组在渲染期求值，放在前面会命中 TDZ。
  useEffect(() => {
    /**
     * 回跳时不论当前页签都强制重取：本地列表跳过 Host 的市场元数据缓存，
     * 市场/我的申请由 reloadKey 重拉；否则用户要切一次页签才能看到最新申请状态。
     */
    const onReturn = () => {
      if (!pendingAuthRefresh.current) return;
      pendingAuthRefresh.current = false;
      if (view === 'mine' || (view === 'center' && libraryTab === 'mine')) void load(undefined, true);
      setRemoteReload(value => value + 1);
      void loadInstallations();
      void loadMarketTotals();
    };
    // Electron 切回窗口通常只有 window focus，没有 visibilitychange，两个信号都听。
    const onVisible = () => { if (document.visibilityState === 'visible') onReturn(); };
    window.addEventListener('focus', onReturn);
    document.addEventListener('visibilitychange', onVisible);
    return () => { window.removeEventListener('focus', onReturn); document.removeEventListener('visibilitychange', onVisible); };
  }, [load, view, libraryTab, loadInstallations, loadMarketTotals]);
  const closeEditor = () => {
    setEditorId(undefined);
    const url = new URL(window.location.href);
    url.searchParams.delete('expert-draft');
    window.history.replaceState(window.history.state, '', url);
  };

  const runSummon = async (expertId: string, revisionId: string | undefined, draftText: string | undefined) => {
    setActing(true); setError('');
    try { await summon(expertId, revisionId, draftText); setDetailId(undefined); setDetailRemote(undefined); }
    catch (cause) { setError(messageOf(cause)); }
    finally { setActing(false); }
  };
  const createExpert = async (type: 'agent' | 'team' = kind) => {
    setActing(true); setError('');
    try { await createExpertTask(type); } catch (cause) { setError(messageOf(cause)); } finally { setActing(false); }
  };
  /**
   * 我的专家：市场安装的「卸载」与本地自建的「删除」都先走确认弹窗，
   * 结构与专家市场一致（标题 / 说明 / 会话占用 / danger 确认 / 执行中禁用）。
   */
  const [pendingUninstall, setPendingUninstall] = useState<{ remoteKey: string; name: string; boundSessions: number }>();
  const [pendingDelete, setPendingDelete] = useState<{ expertId: string; name: string }>();

  const uninstallInstalled = (remote: { remoteKey: string; boundSessions: number; name?: string }) => {
    setPendingUninstall({ remoteKey: remote.remoteKey, boundSessions: remote.boundSessions, name: remote.name ?? '该专家' });
  };

  /** 弹窗确认后真正卸载市场安装的专家；文案与专家市场同一套反馈。 */
  const runUninstall = async () => {
    if (!pendingUninstall) return;
    const target = pendingUninstall;
    setActing(true); setError('');
    try {
      const receipt = await management.uninstallRemote(target.remoteKey, management.newOperationId('uninstall'));
      setNotice({ kind: 'info', text: `已卸载「${target.name}」，删除 ${receipt.deletedExpertIds.length} 条本地专家记录${receipt.boundSessions > 0 ? `（影响 ${receipt.boundSessions} 个会话）` : ''}。` });
      setPendingUninstall(undefined);
      setDetailId(undefined); setDetailRemote(undefined);
      refreshAll();
    } catch (cause) { setError(messageOf(cause)); }
    finally { setActing(false); }
  };

  /** Installed expert (opened from 「我的」): resolve its installation key, then ask for confirmation. */
  const uninstallById = (expertId: string, name?: string) => {
    const installed = installations.get(expertId);
    if (!installed) { setError('未找到该专家的安装记录，请刷新后重试。'); return; }
    uninstallInstalled({ remoteKey: installed.remoteKey, boundSessions: installed.boundSessions, name });
  };

  /** Self-made expert: 打开删除确认弹窗（删除接口与市场卸载不同，见 runDelete）。 */
  const deleteLocalById = (expertId: string, name?: string) => {
    setPendingDelete({ expertId, name: name ?? '该专家' });
  };

  const runDelete = async () => {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setActing(true); setError('');
    try {
      await management.deleteExpert(target.expertId, management.newOperationId('delete'));
      setDetailId(undefined); setDetailRemote(undefined);
      setNotice({ kind: 'info', text: `已删除「${target.name}」及其全部本地文件。` });
      setPendingDelete(undefined);
      refreshAll();
    } catch (cause) { setError(messageOf(cause)); }
    finally { setActing(false); }
  };
  const copyToMine = async (summary: ExpertSummary) => {
    setActionMenu(undefined); setActing(true); setError('');
    try {
      const draft = await management.copy(summary.id, summary.publishedRevisionRef?.revisionId, management.newOperationId('copy'));
      refreshAll(); setEditorId(draft.expertId);
    } catch (cause) { setError(messageOf(cause)); } finally { setActing(false); }
  };
  const setAvailability = async (summary: ExpertSummary, availability: ExpertAvailability) => {
    setActionMenu(undefined); setActing(true); setError('');
    try { await management.setAvailability(summary.id, availability, management.newOperationId('availability')); refreshAll(); if (detailId === summary.id) setDetailId(undefined); }
    catch (cause) { setError(messageOf(cause)); } finally { setActing(false); }
  };
  const exportExpert = async (summary: ExpertSummary) => {
    setActionMenu(undefined); setActing(true); setError('');
    try { const result = await management.downloadExport(summary.id, summary.publishedRevisionRef?.revisionId); setNotice({ kind: 'info', text: `已导出「${result.fileName}」（${result.bytes} 字节，摘要 ${result.digest.slice(0, 12)}…）。` }); }
    catch (cause) { setError(messageOf(cause)); } finally { setActing(false); }
  };

  const capabilityTabs = [['experts', '专家'], ['skills', '技能'], ['connectors', '连接器']] as const;
  const capabilityKey: Record<string, string> = { experts: 'workdsh-experts', skills: 'workdsh-skills', connectors: 'workdsh-connectors' };
  const isDraft = (summary: ExpertSummary) => summary.publishedRevisionRef === undefined;
  const stateLabel = (summary: ExpertSummary) => isDraft(summary) ? '草稿' : AVAILABILITY_LABEL[summary.availability];

  const editInConversation = async (id: string) => {
    setActing(true); setActionMenu(undefined);
    try { await editExpertTask(id); setDetailId(undefined); }
    catch (cause) { setError(messageOf(cause)); }
    finally { setActing(false); }
  };

  return <section className="wd-experts" data-testid="workdsh-experts">
    <style>{expertsCss + expertsMarketCss + cardSkeletonCss + tongyunTagScrollCss + tongyunTagSingleCss + queryOverlayCss}</style>
    <header className="cap-header">
      <button className="nav-toggle" onClick={toggleNavigation} aria-label="切换导航">导航</button>
      {capabilityTabs.map(([key, label]) => {
        const active = key === 'experts';
        const target = capabilityKey[key];
        const enabled = active || (target !== undefined && hasCapability(target));
        return <button key={key} className={`cap-tab ${active ? 'active' : ''}`} disabled={!enabled}
          aria-current={active ? 'page' : undefined}
          onClick={() => { if (!active && target) openCapability(target); }}>{icon(key)}{label}</button>;
      })}
      <Input ref={search} className="search" aria-label="搜索专家"
        placeholder={view === 'mine' ? `搜索我创建的${kind === 'team' ? '专家团' : '专家'}` : view === 'applications' ? '搜索我的上架申请' : libraryTab === 'market' ? `搜索${kindLabel}市场` : `搜索我的${kindLabel}`}
        value={query}
        onChange={event => setQuery(event.currentTarget.value)} />
      <Button className="refresh" onClick={refresh} disabled={busy}>刷新列表</Button>
      {/* 「导入」入口暂时下线（自建/导入后续按产品方案统一处理）。
          恢复方式：取消下面一行的注释即可；ImportExpertModal 与 importOpen 状态均保留未删。 */}
      {/* {view !== 'applications' && <Button onClick={() => setImportOpen(true)}>导入</Button>} */}
      {/* 上架与创建各按专家/专家团拆成独立按钮，不再依赖当前筛选的类型。 */}
      <Button variant="primary" className="mine-toggle" disabled={acting} onClick={() => void openListingAdmin('agent')}>上架专家</Button>
      <Button variant="primary" className="mine-toggle" disabled={acting} onClick={() => void openListingAdmin('team')}>上架专家团</Button>
      <Button variant="primary" className="mine-toggle" disabled={acting} onClick={() => void createExpert('agent')}>创建专家</Button>
      <Button variant="primary" className="mine-toggle" disabled={acting} onClick={() => void createExpert('team')}>创建专家团</Button>
      {/* 验收对比入口「我的专家」已下线（本地入口统一走下方「我的 / 市场」二级 tab）。
          恢复方式：取消本段注释，同时恢复 ExpertsPanel 里的 mineCount 状态和 loadMineCount 中的 setMineCount 调用。
      <Button className={`mine-toggle ${view === 'mine' ? 'active' : ''}`} aria-pressed={view === 'mine'}
        onClick={() => { setView('mine'); setQuery(''); }}>我的专家 {mineCount}</Button>
      */}
    </header>

    {view !== 'center' && <Button variant="ghost" size="sm" className="back-center" onClick={() => { setView('center'); setQuery(''); setStateFilter('all'); }}>‹ 全部专家</Button>}
    <div className={`section-head${view === 'center' ? ' has-tabs' : ''}`}>
      <nav className="work-types" aria-label={view === 'mine' ? '我的作品类型' : '专家中心类型'}>{([['agent', '专家'], ['team', '专家团']] as const).map(([type, label]) => <button key={type} className={kind === type ? 'active' : ''} aria-pressed={kind === type} onClick={() => { setKind(type); setQuery(''); }}>{label}{view === 'mine' && <span>{typeCounts[type]}</span>}</button>)}</nav>
    </div>
    {/* 二级页签：我的 / 市场；顶部「我的专家」按钮保留原来的独立视图，两者互不影响。 */}
    {view === 'center' && <nav className="source-tabs" aria-label={`${kindLabel}来源`}>
      <button className={libraryTab === 'mine' ? 'active' : ''} aria-pressed={libraryTab === 'mine'}
        onClick={() => { setLibraryTab('mine'); setQuery(''); setStateFilter('all'); }}>我的{kindLabel}<i>{typeCounts[kind] ?? 0}</i></button>
      <button className={libraryTab === 'market' ? 'active' : ''} aria-pressed={libraryTab === 'market'}
        onClick={() => { setLibraryTab('market'); setQuery(''); }}>{kindLabel}市场{marketTotals[kind] !== undefined ? <i>{marketTotals[kind]}</i> : null}</button>
    </nav>}

    {/* 「我的专家 / 我的专家团」都不再显示状态筛选行（全部/草稿/已发布/已停用/已归档）。 */}

    {/* 我的专家筛选：是否内置与业务场景都在本地按安装清单快照过滤，空值不硬凑。 */}
    {view === 'center' && libraryTab === 'mine' && <div className="skill-filters">
      <div className="filter-group"><span className="filter-label">是否内置：</span>
        <CategoryBar label="是否内置" categories={EXPERT_BUILTIN_OPTIONS}
          values={builtinFilter === undefined ? [] : [builtinFilter ? EXPERT_BUILTIN_OPTIONS[0] : EXPERT_BUILTIN_OPTIONS[1]]}
          onChange={next => setBuiltinFilter(next.length ? next[next.length - 1] === EXPERT_BUILTIN_OPTIONS[0] : undefined)} />
      </div>
      {libraryScenes.length > 0 && <div className="filter-group scenes-filter"><span className="filter-label">业务场景：</span>
        <CategoryBar label="业务场景" categories={libraryScenes} values={sceneFilter} onChange={next => setSceneFilter(next)} />
      </div>}
    </div>}

    {notice && <div className={`notice ${notice.kind}`} role="status"><div className="notice-body"><span>{notice.text}</span></div><Button onClick={() => setNotice(undefined)} aria-label="关闭提示">×</Button></div>}
    {/* 中心页：市场取后台目录，我的取本地目录；顶部「我的专家」按钮仍是原来的独立视图。 */}
    {view === 'center'
      ? libraryTab === 'market'
        ? <RemoteExperts management={management} kind={kind} keyword={debounced} onChanged={refreshAll} reloadKey={remoteReload}
          onTotal={total => setMarketTotals(current => ({ ...current, [kind]: total }))} onSsoPrompt={setSsoPromptUrl}
          onOpenInstalled={(expertId, remote) => { setDetailId(expertId); setDetailRemote(remote); }} />
        : <>
    <div className="expert-content">
    <div role="status" aria-live="polite" className={error ? 'error counts' : 'counts'}>
      {busy && !items.length
        ? `正在读取我的${kindLabel}…`
        : error || `当前显示 ${libraryItems.length} 个${kindLabel}${debounced ? `（搜索“${debounced}”）` : ''}`}
    </div>

    {!busy && !error && !libraryItems.length
      ? <div className="empty"><span className="empty-text">{debounced || builtinFilter !== undefined || sceneFilter.length ? `没有找到与查询条件匹配的${kindLabel}` : `暂无${kindLabel}数据`}</span></div>
      : null}

    {libraryItems.length
      ? <div className="grid">{libraryItems.map(summary => {
          const readiness = READINESS[summary.readiness] ?? READINESS.unknown;
          const draft = isDraft(summary);
          const state = assetStateOf(summary);
          const legacy = isLegacyLocal(summary);
          const blocked = state !== undefined;
          const authBlocked = summary.authState === 'revoked' || summary.authState === 'unauthorized';
          const usable = summary.canUse && !blocked && !legacy && !draft && summary.availability === 'enabled' && summary.readiness === 'ready';
          const sceneText = (summary.bizScene ?? []).join(' · ');
          const applyStatus = summary.applyStatus ?? 'none';
          // 被撤权/未授权才展示申请入口；申请中显示取消申请。
          const applicable = authBlocked && applyStatus !== 'pending' && Boolean(summary.assetId);
          const cancelable = authBlocked && applyStatus === 'pending' && Boolean(summary.assetId);
          return <article className={`card expert-library-card ${draft ? 'draft' : ''} ${summary.availability !== 'enabled' || blocked || legacy ? 'unavailable' : ''} ${actionMenu === summary.id ? 'menu-open' : ''}`} key={summary.id}>
            <div className="card-top">
              <button className="card-open" aria-label={`查看${kindLabel} ${displayNameOf(summary)}`} onClick={() => setDetailId(summary.id)}>
                <Avatar summary={summary} />
                <span className="card-title">
                  <strong title={displayNameOf(summary)}>{displayNameOf(summary)}</strong>
                  {/* 来源节点来自安装清单：本地自建专家没有就不展示，不拿默认值硬凑。 */}
                  {summary.sourceNode ? <span className="card-meta" title={summary.sourceNode}>{summary.sourceNode}</span> : null}
                </span>
              </button>
              {/* 市场安装的条目底部已有召唤/卸载，不再重复「…」菜单；本地自建/草稿的编辑、复制、导出、删除仍只能从这里进入。 */}
              {summary.canManage && !summary.installedFromCatalog && <div className="card-actions">
                <Button variant="ghost" size="sm" className="more-button" aria-label={`管理专家 ${summary.name}`} aria-haspopup="menu" aria-expanded={actionMenu === summary.id}
                  onClick={() => setActionMenu(current => (current === summary.id ? undefined : summary.id))}>•••</Button>
                {actionMenu === summary.id && <div className="card-menu" role="menu">
                    {draft
                      ? <button role="menuitem" onClick={() => { setActionMenu(undefined); void editInConversation(summary.id); }}>继续编辑</button>
                      : !legacy && <button role="menuitem" disabled={!usable || acting || summary.executionBlocked !== undefined}
                          title={summary.executionBlocked === 'approval-required' ? '需上架审核并安装后才能召唤' : undefined}
                          onClick={() => { setActionMenu(undefined); void runSummon(summary.id, summary.publishedRevisionRef?.revisionId, undefined); }}>召唤专家</button>}
                    {!legacy && summary.canEdit && !draft && <button role="menuitem" onClick={() => { setActionMenu(undefined); void editInConversation(summary.id); }}>编辑</button>}
                    {!legacy && <button role="menuitem" disabled={acting} onClick={() => { setActionMenu(undefined); void copyToMine(summary); }}>复制到我的专家</button>}
                    <button role="menuitem" disabled={acting} onClick={() => { setActionMenu(undefined); void exportExpert(summary); }}>导出</button>
                    <button className="danger" role="menuitem" disabled={acting} onClick={() => { setActionMenu(undefined); deleteLocalById(summary.id, summary.name); }}>删除</button>
                </div>}
              </div>}
            </div>
            {sceneText ? <small className="skill-scene" title={sceneText}>{sceneText}</small> : null}
            {/* 简介统一读后台「专家说明」（capability）；本地自建记录没有该字段，退回自建简介。 */}
            <p className="desc">{summary.capability || (!summary.installedFromCatalog ? summary.description : '') || <span className="muted">（暂无简介）</span>}</p>
            {state?.reason ? <p className="auth-reason">{state.reason}</p> : null}
            {(summary.tags ?? []).length ? <TongyunTagScrollRow tags={summary.tags ?? []} /> : null}
            <div className="market-card-foot">
              <div className="market-card-tags">
                {/* 参考本地技能：展示内置状态；授权/完整性异常时补充异常与申请状态。 */}
                <TongyunTagSingle tone={summary.builtin ? 'gray' : 'cyan'}>{summary.builtin ? '内置' : '非内置'}</TongyunTagSingle>
                {/* 只保留异常态；正常（可用）不再出标签。 */}
                {!draft && summary.readiness !== 'ready' && <span className={`badge ${readiness.cls}`}>{readiness.label}</span>}
                {state ? <StateTag state={state} /> : null}
                {expiryNoticeOf(summary.expiresAt) ? <span className="tag tag-muted">{expiryNoticeOf(summary.expiresAt)}</span> : null}
                {legacy ? <TongyunTagSingle auth={false}>本地自建（不受支持）</TongyunTagSingle> : null}
                {authBlocked ? <TongyunTagSingle tone={applyStatusTone(applyStatus)}>{EXPERT_APPLY_LABEL[applyStatus]}</TongyunTagSingle> : null}
              </div>
              <div className="market-card-actions">
                {/* 操作与本地技能一致：可召唤时给主按钮；无权限时给申请入口；市场安装的可卸载。 */}
                {usable && !blocked ? <button type="button" className="market-action primary" disabled={acting || summary.executionBlocked !== undefined}
                  title={summary.executionBlocked === 'approval-required' ? '需上架审核并安装后才能召唤' : undefined}
                  onClick={() => void runSummon(summary.id, summary.publishedRevisionRef?.revisionId, undefined)}>召唤</button> : null}
                {applicable ? <button type="button" className="market-action primary" disabled={ssoBusy}
                  onClick={() => void openAuthSso('apply', summary)}>申请</button> : null}
                {cancelable ? <button type="button" className="market-action primary" disabled={ssoBusy}
                  onClick={() => void openAuthSso('cancel', summary)}>取消申请</button> : null}
                {summary.installedFromCatalog && summary.canManage ? <button type="button" className="market-action danger" disabled={acting}
                  onClick={() => uninstallById(summary.id, summary.name)}>卸载</button> : null}
              </div>
            </div>
          </article>;
        })}</div>
      : null}
    {skeletonVisible ? <div className="grid" role="status" aria-label={`正在读取我的${kindLabel}…`}><CardSkeleton variant="avatar" count={12} /></div> : null}
    {overlayVisible ? <QueryOverlay /> : null}
    </div>

    {nextCursor && !busy && <div className="empty-actions" style={{ justifyContent: 'center', marginTop: 18 }}>
      <Button disabled={loadingMore} onClick={() => void load(nextCursor)}>{loadingMore ? '正在加载…' : '加载更多'}</Button>
    </div>}
      </>
      : view === 'applications'
        ? <MyApplications management={management} kind={kind} keyword={debounced} reloadKey={remoteReload} />
        : <>
    <div className="expert-content">
    <div role="status" aria-live="polite" className={error ? 'error counts' : 'counts'}>
      {busy && !items.length
        ? '正在读取专家目录…'
        : error || `当前显示 ${visible.length} 个${kindLabel}${debounced ? `（搜索“${debounced}”）` : ''}`}
    </div>

    {!busy && !error && !visible.length
      ? <div className="empty"><span className="empty-text">{debounced ? `没有找到与查询条件匹配的${kindLabel}` : `暂无${kindLabel}数据`}</span></div>
      : null}

    {visible.length
      ? <div className="grid">{visible.map(summary => {
          const readiness = READINESS[summary.readiness] ?? READINESS.unknown;
          const draft = isDraft(summary);
          const state = assetStateOf(summary);
          const legacy = isLegacyLocal(summary);
          const blocked = state !== undefined;
          const usable = summary.canUse && !blocked && !legacy && !draft && summary.availability === 'enabled' && summary.readiness === 'ready';
          return <article className={`card ${draft ? 'draft' : ''} ${summary.availability !== 'enabled' || blocked || legacy ? 'unavailable' : ''} ${actionMenu === summary.id ? 'menu-open' : ''}`} key={summary.id}>
            <div className="card-top">
              <button className="card-open" aria-label={`查看专家 ${displayNameOf(summary)}`} onClick={() => setDetailId(summary.id)}>
                <Avatar summary={summary} />
                <span className="card-title"><strong title={displayNameOf(summary)}>{displayNameOf(summary)}</strong>
                  <span className="card-meta">{summary.profession || (summary.expertType === 'team' ? '专家团' : '专家')}{view === 'mine' && <span> · {stateLabel(summary)}</span>}</span></span>
              </button>
              {/* 市场安装的条目底部已有召唤/卸载，不再重复「…」菜单；本地自建/草稿的编辑、复制、导出、删除仍只能从这里进入。 */}
              {summary.canManage && !summary.installedFromCatalog && <div className="card-actions">
                <Button variant="ghost" size="sm" className="more-button" aria-label={`管理专家 ${summary.name}`} aria-haspopup="menu" aria-expanded={actionMenu === summary.id}
                  onClick={() => setActionMenu(current => (current === summary.id ? undefined : summary.id))}>•••</Button>
                {actionMenu === summary.id && <div className="card-menu" role="menu">
                    {draft
                      ? <button role="menuitem" onClick={() => { setActionMenu(undefined); void editInConversation(summary.id); }}>继续编辑</button>
                      : !legacy && <button role="menuitem" disabled={!usable || acting || summary.executionBlocked !== undefined}
                          title={summary.executionBlocked === 'approval-required' ? '需上架审核并安装后才能召唤' : undefined}
                          onClick={() => { setActionMenu(undefined); void runSummon(summary.id, summary.publishedRevisionRef?.revisionId, undefined); }}>召唤专家</button>}
                    {!legacy && summary.canEdit && !draft && <button role="menuitem" onClick={() => { setActionMenu(undefined); void editInConversation(summary.id); }}>编辑</button>}
                    {!legacy && <button role="menuitem" disabled={acting} onClick={() => { setActionMenu(undefined); void copyToMine(summary); }}>复制到我的专家</button>}
                    <button role="menuitem" disabled={acting} onClick={() => { setActionMenu(undefined); void exportExpert(summary); }}>导出</button>
                    <button className="danger" role="menuitem" disabled={acting} onClick={() => { setActionMenu(undefined); deleteLocalById(summary.id, summary.name); }}>删除</button>
                </div>}
              </div>}
            </div>
            {/* 简介统一读后台「专家说明」（capability）；本地自建记录没有该字段，退回自建简介。 */}
            <p className="desc">{summary.capability || (!summary.installedFromCatalog ? summary.description : '') || <span className="muted">（暂无简介）</span>}</p>
            {state?.reason ? <p className="auth-reason">{state.reason}</p> : null}
            <div className="domain-tags">{(summary.tags ?? []).slice(0, 3).map(tag => <span key={tag}>{tag}</span>)}</div>
            <div className="card-foot">
              <span className="badge">{summary.expertType === 'team' ? '专家团' : '专家'}</span>
              {!draft && summary.readiness !== 'ready' && <span className={`badge ${readiness.cls}`}>{readiness.label}</span>}
              {draft && <span className="badge">未发布</span>}
              {summary.executionBlocked === 'approval-required' && <span className="badge warn">需上架审核</span>}
              {state ? <StateTag state={state} /> : null}
              {expiryNoticeOf(summary.expiresAt) ? <span className="tag tag-muted">{expiryNoticeOf(summary.expiresAt)}</span> : null}
              {legacy ? <TongyunTagSingle auth={false}>本地自建（不受支持）</TongyunTagSingle> : null}
              {summary.origin === 'default' && <span className="badge">默认</span>}
            </div>
          </article>;
        })}</div>
      : null}
    {skeletonVisible ? <div className="grid" role="status" aria-label="正在读取专家目录…"><CardSkeleton variant="avatar" count={12} /></div> : null}
    {overlayVisible ? <QueryOverlay /> : null}
    </div>

    {nextCursor && !busy && <div className="empty-actions" style={{ justifyContent: 'center', marginTop: 18 }}>
      <Button disabled={loadingMore} onClick={() => void load(nextCursor)}>{loadingMore ? '正在加载…' : '加载更多'}</Button>
    </div>}
      </>}

    <Modal open={Boolean(detailId)} label={detailId ? '专家详情' : '专家详情'} className="expert-dialog" onClose={() => { setDetailId(undefined); setDetailRemote(undefined); }}>
      {detailId && <ExpertDetailModal expertId={detailId} management={management} acting={acting}
        onUninstall={detailRemote
          ? () => uninstallInstalled({ ...detailRemote, name: items.find(item => item.id === detailId)?.name })
          : installations.has(detailId) ? () => uninstallById(detailId, items.find(item => item.id === detailId)?.name) : undefined}
        onSubmitListing={undefined}
        onDelete={installations.has(detailId) ? undefined : () => deleteLocalById(detailId, items.find(item => item.id === detailId)?.name)}
        onClose={() => { setDetailId(undefined); setDetailRemote(undefined); }}
        onSummon={(expertId, revisionId, draftText) => void runSummon(expertId, revisionId, draftText)}
        onEditTask={id => void editInConversation(id)}
        onEditDraft={id => { setDetailId(undefined); setEditorId(id); }}
        onCopy={async (expertId, revisionId) => {
          setActing(true);
          try { const draft = await management.copy(expertId, revisionId, management.newOperationId('copy')); setDetailId(undefined); refreshAll(); setEditorId(draft.expertId); }
          catch (cause) { setError(messageOf(cause)); } finally { setActing(false); }
        }}
        onAvailability={async (expertId, availability) => {
          setActing(true);
          try { await management.setAvailability(expertId, availability, management.newOperationId('availability')); setDetailId(undefined); refreshAll(); }
          catch (cause) { setError(messageOf(cause)); } finally { setActing(false); }
        }}
        onExport={async expertId => {
          setActing(true);
          try { const result = await management.downloadExport(expertId, undefined); setNotice({ kind: 'info', text: `已导出「${result.fileName}」。` }); }
          catch (cause) { setError(messageOf(cause)); } finally { setActing(false); }
        }}
        onChanged={refreshAll} />}
    </Modal>

    {editorId && <ExpertDraftEditor expertId={editorId} management={management}
      onClose={closeEditor}
      onSaved={refreshAll}
      onPublished={() => { closeEditor(); refreshAll(); }}
      onSummon={(id, revisionId, text) => { closeEditor(); void runSummon(id, revisionId, text); }} />}

    <Modal open={importOpen} label="导入专家" className="import-dialog" onClose={() => setImportOpen(false)}>
      {importOpen && <ImportExpertModal management={management} onClose={() => setImportOpen(false)}
        onImported={id => { setImportOpen(false); refreshAll(); setEditorId(id); }} />}
    </Modal>

    <Modal open={Boolean(ssoPromptUrl)} label="后台未接入提醒" className="sso-dialog" onClose={() => setSsoPromptUrl(undefined)}>
      <div className="sso-dialog-body">
        <h2>无法自动登录后台</h2>
        <p>当前未接入业务后台或登录已失效。继续将打开后台管理系统登录页，请登录后重新发起上架申请。</p>
        <div className="sso-dialog-actions">
          <Button onClick={() => setSsoPromptUrl(undefined)}>取消</Button>
          <Button variant="primary" onClick={() => { const url = ssoPromptUrl; setSsoPromptUrl(undefined); if (url) openAdminSso(url); }}>继续打开</Button>
        </div>
      </div>
    </Modal>
    {/* 我的专家：卸载确认（与专家市场同一套结构、文案与按钮规格）。 */}
    <Modal open={Boolean(pendingUninstall)} label="确认卸载专家" className="confirm-dialog" onClose={() => { if (!acting) setPendingUninstall(undefined); }}>
      {pendingUninstall && <div>
        <h2>卸载 {pendingUninstall.name}？</h2>
        <p>专家及其全部文件将从本机移除，相关会话将无法继续使用该专家。</p>
        {pendingUninstall.boundSessions > 0
          ? <p>该专家已被 {pendingUninstall.boundSessions} 个会话使用，卸载后这些会话将无法继续使用。</p>
          : null}
        <div className="confirm-actions">
          <Button onClick={() => setPendingUninstall(undefined)} disabled={acting}>取消</Button>
          <Button tone="danger" className="danger solid" disabled={acting}
            onClick={() => void runUninstall()}>{acting ? '卸载中…' : '确认卸载'}</Button>
        </div>
      </div>}
    </Modal>

    {/* 我的专家：本地自建的删除确认（deleteExpert 接口，与市场安装的卸载不是同一个接口）。 */}
    <Modal open={Boolean(pendingDelete)} label="确认删除专家" className="confirm-dialog" onClose={() => { if (!acting) setPendingDelete(undefined); }}>
      {pendingDelete && <div>
        <h2>删除 {pendingDelete.name}？</h2>
        <p>将删除该专家及其全部本地文件，删除后无法恢复。</p>
        <div className="confirm-actions">
          <Button onClick={() => setPendingDelete(undefined)} disabled={acting}>取消</Button>
          <Button tone="danger" className="danger solid" disabled={acting}
            onClick={() => void runDelete()}>{acting ? '删除中…' : '确认删除'}</Button>
        </div>
      </div>}
    </Modal>
  </section>;
}
