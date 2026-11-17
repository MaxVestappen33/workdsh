import { Button, CardSkeleton, cardSkeletonCss, Input, QueryOverlay, queryOverlayCss, Textarea } from 'workdsh-ui';
import { Icon, Modal, Select, type IconName } from 'workdsh-ui';
import * as React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { SkillApplyStatus, SkillMarketAuthorized, SkillMarketDocument, SkillMarketItem, SkillScene } from '../market.js';
import type { ManagedSkillDetail, ManagedSkillResource, ManagedSkillSummary, SkillDependencyImpact, SkillListingItem, SkillListingOptions, TrashedSkillSummary } from '../shared.js';
import type { SkillTaskKind } from './drafts.js';
import { SKILL_AUTH_SSO, type SkillManagementClient } from './management.js';
import { CategoryBar } from './components/CategoryBar.js';
import { SkillListingModal } from './SkillListingModal.js';
import { appendSkillListingList, emptySkillListingList, startSkillListingList, SKILL_LISTING_PAGE_SIZE, type SkillListingListState } from './listing-list.js';
import { appendSkillMarketList, emptySkillMarketList, marketItemsByInstall, skillMarketQuery, skillMarketSceneText, SKILL_MARKET_PAGE_SIZE, startSkillMarketList, type SkillMarketFilter, type SkillMarketListState } from './market-list.js';
import { skillsActionsCss, skillsCss, skillsListingCss, skillsMarketCss } from './styles.js';

type SkillsPanelInjected = {
  toggleNavigation: () => void;
  management: SkillManagementClient;
  startSkillTask: (kind: SkillTaskKind, name?: string) => Promise<void>;
  startSkillTrial: (name: string) => Promise<void>;
  /** Switch the shared capability center to another registered panel (e.g. experts). */
  openCapability: (key: string) => void;
  hasCapability: (key: string) => boolean;
};
type SkillsPanelProps = PropsRuntime<'main'> & InjectFace<SkillsPanelInjected>;

/** 市场滚动到距底部这么多像素时自动加载下一页。 */
const MARKET_SCROLL_THRESHOLD = 160;
/** 市场关键词防抖：关键词由服务端筛选，等输入停顿这么久再发请求，避免每敲一键打一次后台。 */
const MARKET_QUERY_DEBOUNCE_MS = 250;
/** 是否内置筛选的两个胶囊：与业务场景胶囊同款样式，单选，都不选即「全部」。 */
const BUILTIN_OPTIONS = ['内置', '非内置'] as const;
const BUILTIN_YES = BUILTIN_OPTIONS[0];
/** 安装状态是本机判定，只在客户端过滤；授权状态与申请状态交给服务端。 */
const INSTALL_OPTIONS = ['已安装', '未安装'] as const;
const AUTH_OPTIONS = ['已授权', '未授权'] as const;
const APPLY_OPTIONS = ['未申请', '申请中', '已通过', '未通过'] as const;
/** 申请状态文案与后台 applyStatus 的对应关系；授权状态是另一个独立标签，不参与这里。 */
const APPLY_LABEL: Record<SkillApplyStatus, string> = { none: '未申请', pending: '申请中', approved: '已通过', rejected: '未通过' };
const APPLY_VALUE: Record<string, SkillApplyStatus> = { 未申请: 'none', 申请中: 'pending', 已通过: 'approved', 未通过: 'rejected' };
/** 批量管理入口开关：暂时隐藏（本地技能与技能市场都不展示），逻辑与接口保留。 */
const BATCH_UI_ENABLED = false;
/** 安装状态是客户端过滤：一页被过滤空时继续向后取，最多补拉这么多页，避免异常后台拖住首屏。 */
const MARKET_FILL_MAX_PAGES = 10;

function icon(kind: string) { return <Icon name={kind as IconName} />; }
function messageOf(cause: unknown): string { return cause instanceof Error ? cause.message : '技能操作失败，请重试。'; }
/** 安装状态过滤下可见条目是否还不满一页：为真时需要继续向后补拉，直到凑满或后台到底。 */
function needsFill(items: readonly SkillMarketItem[], install?: 'installed' | 'uninstalled'): boolean {
  return install !== undefined && marketItemsByInstall(items, install).length < SKILL_MARKET_PAGE_SIZE;
}
/**
 * 打开后台管理系统：Desktop 的 window.open 由主进程转交系统浏览器，
 * Web 预览被拦截时退回当前页跳转。
 */
function openAdminSso(url: string): void {
  const popup = window.open(url, '_blank', 'noopener');
  if (!popup && !/Electron/iu.test(navigator.userAgent)) window.location.assign(url);
}
/** 附件大小展示：与导入预检里的口径一致。 */
function sizeOf(bytes: number): string { return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KiB` : `${(bytes / 1024 / 1024).toFixed(1)} MiB`; }
/** 审批状态徽标配色：按文案关键词归类，后台新增或改名状态时不会丢配色。 */
function statusToneOf(text: string): string {
  if (/驳回|拒绝|不通过/u.test(text)) return 'error';
  if (/通过/u.test(text)) return 'success';
  if (/撤销|撤回|取消/u.test(text)) return 'neutral';
  if (/审批|审核/u.test(text)) return 'pending';
  return 'neutral';
}

/** Stable brand tone for skills without a bundled marketplace icon. */
function toneOf(name: string): { background: string; color: string } {
  let hue = 0;
  for (const char of name) hue = (hue * 31 + (char.codePointAt(0) ?? 0)) % 360;
  return { background: `hsl(${hue} 36% 25%)`, color: `hsl(${hue} 84% 78%)` };
}

function SkillMark({ name, title, iconUrl, large }: { name: string; title?: string; iconUrl?: string; large?: boolean }) {
  const label = (title ?? name).trim().charAt(0).toUpperCase() || name.charAt(0).toUpperCase();
  if (iconUrl) return <img className={`skill-icon${large ? ' large' : ''}`} src={iconUrl} alt="" loading="lazy" decoding="async" />;
  return <span className={`skill-mark${large ? ' large' : ''}`} aria-hidden style={toneOf(name)}>{label}</span>;
}

export function SkillsPanel({ toggleNavigation, management, startSkillTask, startSkillTrial, openCapability, hasCapability }: SkillsPanelProps) {
  const [skills, setSkills] = useState<readonly ManagedSkillSummary[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  /** 页签：本地技能＝本机发现结果，技能市场＝后台已授权技能，我的申请＝上架审批记录。 */
  const [tab, setTab] = useState<'local' | 'market' | 'applications'>('local');
  const [query, setQuery] = useState('');
  /** 已选业务场景（多选，数组顺序即用户选择顺序）；空数组等价于「全部」。 */
  const [scenes, setScenes] = useState<readonly string[]>([]);
  /** 是否内置筛选（单选）；undefined 等价于「全部」。两个页签各自独立，切页签时重置。 */
  const [builtinFilter, setBuiltinFilter] = useState<boolean>();
  /** 安装状态在本机判定、客户端过滤；授权状态与申请状态下发给服务端。undefined 均等价于「全部」。 */
  const [installFilter, setInstallFilter] = useState<'installed' | 'uninstalled'>();
  const [authFilter, setAuthFilter] = useState<'Y' | 'N'>();
  const [applyFilter, setApplyFilter] = useState<SkillApplyStatus>();
  /** 授权技能索引：本地技能的业务场景标签与内置属性都来自后台，后台不可用时为空。 */
  const [authorized, setAuthorized] = useState<readonly SkillMarketAuthorized[]>([]);
  /** 索引是否取到了市场数据：为真时内置属性以市场为准，为假时按本机安装记录快照兜底。 */
  const [authorizedReady, setAuthorizedReady] = useState(false);
  // 市场：可用性来自宿主绑定，不可用时整条链路（页签、数据、筛选）都不出现。
  const [marketOn, setMarketOn] = useState(false);
  const [marketDict, setMarketDict] = useState<readonly SkillScene[]>([]);
  const [market, setMarket] = useState<SkillMarketListState>(emptySkillMarketList);
  // 三种加载状态分开：首屏/筛选重置（marketBusy）、滚动加载更多（marketMore）、失败（marketError / marketMoreError）。
  const [marketBusy, setMarketBusy] = useState(false);
  const [marketMore, setMarketMore] = useState(false);
  const [marketError, setMarketError] = useState('');
  const [marketMoreError, setMarketMoreError] = useState('');
  /** 打开详情的市场条目 id；条目列表翻页后仍按 id 定位。 */
  const [marketDetailId, setMarketDetailId] = useState<string>();
  /** 市场详情页的说明附件与正文：正文可能取不到（非 md/zip 或解包失败），界面降级为只显示文件信息。 */
  const [marketDoc, setMarketDoc] = useState<SkillMarketDocument>();
  const [marketDocBusy, setMarketDocBusy] = useState(false);
  const [marketDocError, setMarketDocError] = useState('');
  /** 正在安装的市场条目 id：安装按钮进入加载态，卡片显示进度条。 */
  const [marketInstalling, setMarketInstalling] = useState<string>();
  /** 各条目上一次安装失败的原因：就地显示在卡片/详情上，重试时清除。 */
  const [marketFailures, setMarketFailures] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<ManagedSkillDetail>();
  const [editing, setEditing] = useState(false);
  const [skillDocument, setSkillDocument] = useState('');
  const [resource, setResource] = useState<(ManagedSkillResource & { isNew?: boolean })>();
  const [resourceDocument, setResourceDocument] = useState('');
  const [newResourcePath, setNewResourcePath] = useState('');
  const [trash, setTrash] = useState<readonly TrashedSkillSummary[]>([]);
  const [trashOpen, setTrashOpen] = useState(false);
  const [confirmUninstall, setConfirmUninstall] = useState<{ skill: ManagedSkillSummary; impact: SkillDependencyImpact; market?: { id: string; slug: string; name: string } }>();
  const [creating, setCreating] = useState(false);
  /** 试用失败按技能分别记录：错误显示在对应卡片/详情上，不占用列表顶部的全局提示。 */
  const [trialErrors, setTrialErrors] = useState<Record<string, string>>({});
  /** 上架申请跳转的请求占用：与创建流程分开，避免互相禁用。 */
  const [ssoBusy, setSsoBusy] = useState(false);
  /** 绑定不可用时待确认打开的单点地址，非空即弹出提醒。 */
  const [ssoPromptUrl, setSsoPromptUrl] = useState<string>();
  const [listingOpen, setListingOpen] = useState(false);
  // 上架申请：表单字典（技能类型 / 审批状态 / 来源节点 / 业务场景树）与我的申请列表。
  const [listingOptions, setListingOptions] = useState<SkillListingOptions>();
  const [listingOptionsBusy, setListingOptionsBusy] = useState(false);
  const [listingOptionsError, setListingOptionsError] = useState('');
  const [applications, setApplications] = useState<SkillListingListState>(emptySkillListingList);
  const [applicationBusy, setApplicationBusy] = useState(false);
  const [applicationMore, setApplicationMore] = useState(false);
  const [applicationError, setApplicationError] = useState('');
  const [applicationMoreError, setApplicationMoreError] = useState('');
  /** 审批状态筛选：空串表示全部；选项来自 ai_status 字典（已剔除草稿）。 */
  const [applicationStatus, setApplicationStatus] = useState('');
  /** 打开详情的申请单 id：列表刷新后仍按 id 定位。 */
  const [applicationId, setApplicationId] = useState<string>();
  const [batchMode, setBatchMode] = useState(false);
  const [selectedNames, setSelectedNames] = useState<readonly string[]>([]);
  const [confirmBatchUninstall, setConfirmBatchUninstall] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  /** 分类字典的同步快照：发请求时立即读取，避免等待 state 更新。 */
  const dictionaryRef = useRef<readonly SkillScene[]>([]);
  /** 请求代号：筛选变化时递增，用于丢弃过期响应，避免旧结果覆盖新筛选。 */
  const generationRef = useRef(0);
  /** 我的申请请求代号：与市场分开，两个页签互不影响。 */
  const applicationGenerationRef = useRef(0);
  /** 关键词防抖计时器：市场关键词由服务端筛选，输入停顿后才发请求。 */
  const queryTimerRef = useRef<number>(undefined);

  /** `silent`：后台重拉（如回到窗口），不切到骨架屏，避免列表闪一下。 */
  const refresh = useCallback(async (silent = false) => {
    if (!silent) setBusy(true);
    setError('');
    try { setSkills(await management.list()); }
    catch (cause) { console.error('[workdsh:skills:list]', cause); setError(messageOf(cause)); }
    finally { if (!silent) setBusy(false); }
  }, [management]);
  useEffect(() => { void refresh(); }, [refresh]);
  // 切回「本地技能」时静默重拉：用户可能刚在文件夹里手加/删除技能，列表要直接体现。
  useEffect(() => { if (tab === 'local') void refresh(true); }, [tab, refresh]);
  /**
   * 用户经常通过「打开文件夹」在外部改技能文件：回到应用窗口时重拉一次本地列表，
   * 让「文件已被修改 / 已缺失」这类状态立即显示在卡片上，而不是等到调用时才被拒绝。
   * 5 秒内的连续聚焦只刷新一次，避免来回切窗口反复请求。
   */
  useEffect(() => {
    let last = 0;
    const reload = () => {
      if (document.visibilityState === 'hidden' || Date.now() - last < 5_000) return;
      last = Date.now();
      void refresh(true);
    };
    window.addEventListener('focus', reload);
    document.addEventListener('visibilitychange', reload);
    return () => { window.removeEventListener('focus', reload); document.removeEventListener('visibilitychange', reload); };
  }, [refresh]);
  // 面板卸载时取消还没发出的关键词请求。
  useEffect(() => () => window.clearTimeout(queryTimerRef.current), []);

  /** 首屏与筛选变化：业务场景与关键词都交给服务端，一律从第 1 页重新取，并用新结果替换旧列表。 */
  const loadMarket = useCallback(async (next: SkillMarketFilter) => {
    const generation = ++generationRef.current;
    setMarketBusy(true);
    setMarketError('');
    setMarketMoreError('');
    // 重置会作废进行中的「加载更多」（它的 finally 因代号不匹配不会再清标志）。
    setMarketMore(false);
    try {
      // 业务场景字典是静态参考数据：首次取到后常驻，后续刷新与筛选不再重复请求。
      const dictionary = dictionaryRef.current.length ? dictionaryRef.current : await management.marketCategories();
      let listed = startSkillMarketList(await management.marketList(skillMarketQuery(next, 1, dictionary)));
      // 安装状态是客户端过滤：可见条目不足一页时继续向后取，避免筛选结果只剩零星几条或空白。
      for (let fetched = 1; needsFill(listed.items, next.install) && listed.hasMore && fetched < MARKET_FILL_MAX_PAGES; fetched++) {
        if (generationRef.current !== generation) return;
        listed = appendSkillMarketList(listed, await management.marketList(skillMarketQuery(next, listed.page + 1, dictionary)));
      }
      if (generationRef.current !== generation) return;
      if (!dictionaryRef.current.length) { dictionaryRef.current = dictionary; setMarketDict(dictionary); }
      setMarket(listed);
    } catch (cause) {
      if (generationRef.current !== generation) return;
      console.error('[workdsh:skills:market]', cause);
      setMarketError(messageOf(cause));
    } finally {
      if (generationRef.current === generation) setMarketBusy(false);
    }
  }, [management]);

  useEffect(() => {
    let active = true;
    void (async () => {
      let available = false;
      try { available = (await management.marketAvailable()).available; } catch { available = false; }
      if (!active) return;
      setMarketOn(available);
      if (available) await loadMarket({ scenes: [], keyword: '' });
    })();
    return () => { active = false; };
  }, [management, loadMarket]);
  useEffect(() => {
    if (!marketOn && (tab === 'market' || tab === 'applications')) setTab('local');
  }, [marketOn, tab]);

  /** 表单字典：技能类型 / 审批状态 / 来源节点 / 业务场景树。后台不可用时保持空，入口照常展示但表单会提示。 */
  const loadListingOptions = useCallback(async () => {
    if (!marketOn) return;
    setListingOptionsBusy(true); setListingOptionsError('');
    try { setListingOptions(await management.listingOptions()); }
    catch (cause) { console.error('[workdsh:skills:listing-options]', cause); setListingOptionsError(messageOf(cause)); }
    finally { setListingOptionsBusy(false); }
  }, [management, marketOn]);
  useEffect(() => { void loadListingOptions(); }, [loadListingOptions]);

  /**
   * 我的申请首屏与筛选变化：关键词与审批状态都交给服务端，一律从第 1 页重新取。
   * 页签上的数字跟着当前查询条件走（服务端返回的 total）。
   */
  const loadApplications = useCallback(async (next: { keyword: string; status: string }) => {
    const generation = ++applicationGenerationRef.current;
    setApplicationBusy(true);
    setApplicationError('');
    setApplicationMoreError('');
    setApplicationMore(false);
    try {
      const keyword = next.keyword.trim();
      const listed = await management.listingList({
        page: 1,
        pageSize: SKILL_LISTING_PAGE_SIZE,
        ...(next.status ? { status: next.status } : {}),
        ...(keyword ? { keyword } : {}),
      });
      if (applicationGenerationRef.current !== generation) return;
      setApplications(startSkillListingList(listed));
    } catch (cause) {
      if (applicationGenerationRef.current !== generation) return;
      console.error('[workdsh:skills:applications]', cause);
      setApplicationError(messageOf(cause));
    } finally {
      if (applicationGenerationRef.current === generation) setApplicationBusy(false);
    }
  }, [management]);

  // 首屏同时取一页申请：页签上的数量不必等用户点开才是准确值。
  useEffect(() => { if (marketOn) void loadApplications({ keyword: '', status: '' }); }, [marketOn, loadApplications]);

  /** 授权技能索引：本地技能的业务场景标签与内置属性来自它；失败时保持为空，内置属性退回本地快照。 */
  const loadAuthorized = useCallback(async (refresh?: boolean) => {
    if (!marketOn) { setAuthorized([]); setAuthorizedReady(false); return; }
    try { setAuthorized(await management.marketIndex(refresh)); setAuthorizedReady(true); }
    catch (cause) { console.error('[workdsh:skills:market-index]', cause); setAuthorized([]); setAuthorizedReady(false); }
  }, [management, marketOn]);
  useEffect(() => { void loadAuthorized(); }, [loadAuthorized]);

  /**
   * 刷新：只重取当前页签真正展示的数据，避免一次点击同时打本地索引、市场页与快照校验。
   * - 本地页签：本地列表 + 授权索引（索引请求在宿主侧顺带做一次触发式快照校验）；
   * - 市场页签：市场首页（宿主侧同样触发快照校验），业务场景字典常驻后不再重复请求；
   * - 我的申请：申请列表。
   * 单飞：同一轮未结束时再点只是复用它，防止连点叠出多轮请求。
   */
  const reloadingRef = useRef<Promise<void> | undefined>(undefined);
  const reloadAll = () => {
    if (reloadingRef.current) return reloadingRef.current;
    const task = (async () => {
      await refresh();
      if (!marketOn) return;
      if (tab === 'market') await loadMarket(filter);
      else if (tab === 'applications') await loadApplications({ keyword: query, status: applicationStatus });
      // 用户主动刷新时绕过索引缓存：后台刚改过的内置属性要立刻生效。
      else await loadAuthorized(true);
    })().finally(() => { reloadingRef.current = undefined; });
    reloadingRef.current = task;
    return task;
  };
  // 加载更多：滚动接近底部时按当前筛选追加下一页；失败只影响加载更多，不清空已有列表。
  const loadMoreMarket = async () => {
    if (marketBusy || marketMore || !market.hasMore) return;
    const generation = generationRef.current;
    setMarketMore(true);
    setMarketMoreError('');
    try {
      let next = appendSkillMarketList(market, await management.marketList(skillMarketQuery(filter, market.page + 1, dictionaryRef.current)));
      // 安装状态是客户端过滤：追加一页后仍不满一页时继续补拉，保持滚动加载的连贯。
      for (let fetched = 1; needsFill(next.items, filter.install) && next.hasMore && fetched < MARKET_FILL_MAX_PAGES; fetched++) {
        if (generationRef.current !== generation) return;
        next = appendSkillMarketList(next, await management.marketList(skillMarketQuery(filter, next.page + 1, dictionaryRef.current)));
      }
      if (generationRef.current !== generation) return;
      setMarket(next);
    } catch (cause) {
      if (generationRef.current !== generation) return;
      setMarketMoreError(messageOf(cause));
    } finally {
      if (generationRef.current === generation) setMarketMore(false);
    }
  };
  /** 我的申请加载更多：与市场同款滚动加载。 */
  const loadMoreApplications = async () => {
    if (applicationBusy || applicationMore || !applications.hasMore) return;
    const generation = applicationGenerationRef.current;
    setApplicationMore(true);
    setApplicationMoreError('');
    try {
      const keyword = query.trim();
      const listed = await management.listingList({
        page: applications.page + 1,
        pageSize: SKILL_LISTING_PAGE_SIZE,
        ...(applicationStatus ? { status: applicationStatus } : {}),
        ...(keyword ? { keyword } : {}),
      });
      if (applicationGenerationRef.current !== generation) return;
      setApplications(current => appendSkillListingList(current, listed));
    } catch (cause) {
      if (applicationGenerationRef.current !== generation) return;
      setApplicationMoreError(messageOf(cause));
    } finally {
      if (applicationGenerationRef.current === generation) setApplicationMore(false);
    }
  };

  const openDetail = async (name: string) => {
    setError('');
    try { const detail = await management.detail(name); setSelected(detail); setSkillDocument(detail.document ?? ''); setEditing(false); setResource(undefined); }
    catch (cause) { setError(messageOf(cause)); }
  };
  const beginSkillTask = async (kind: SkillTaskKind) => {
    setCreating(true); setError('');
    try { await startSkillTask(kind); }
    catch (cause) { setError(messageOf(cause)); setCreating(false); }
  };
  const trial = async (name: string) => {
    setCreating(true);
    setTrialErrors(current => { if (!(name in current)) return current; const next = { ...current }; delete next[name]; return next; });
    try { await startSkillTrial(name); }
    catch (cause) { setTrialErrors(current => ({ ...current, [name]: messageOf(cause) })); setCreating(false); }
  };
  /** 上架申请：跳转后台管理系统；绑定不可用时先提示，再打开纯登录地址。 */
  const openListingAdmin = async () => {
    if (ssoBusy) return;
    setSsoBusy(true); setError('');
    try {
      const target = await management.adminSso();
      if (target.degraded) {
        // 绑定不可用时不阻断跳转：弹窗提醒后由用户确认继续打开后台登录页。
        setSsoPromptUrl(target.url);
      } else {
        openAdminSso(target.url);
      }
    } catch (cause) { setError(messageOf(cause)); }
    finally { setSsoBusy(false); }
  };
  const setEnabled = async (skill: ManagedSkillSummary, enabled: boolean) => {
    setError('');
    try { await management.setEnabled(skill.name, enabled); await refresh(); if (selected?.name === skill.name) await openDetail(skill.name); }
    catch (cause) { setError(messageOf(cause)); }
  };
  /** 打开技能根目录：工具栏入口，直接定位共享技能安装位置。 */
  const openRootDirectory = async () => {
    setError('');
    try { await management.openDirectory(await management.rootPath()); }
    catch (cause) { setError(messageOf(cause)); }
  };
  const openDirectory = async (skill: ManagedSkillSummary) => {
    setError('');
    try { const detail = selected?.name === skill.name ? selected : await management.detail(skill.name); if (!detail.directoryPath) throw new Error('该技能来源不提供可打开的本地目录。'); await management.openDirectory(detail.directoryPath); }
    catch (cause) { setError(messageOf(cause)); }
  };
  const save = async () => {
    if (!selected?.revision) return;
    setBusy(true); setError('');
    try { const next = await management.update({ name: selected.name, document: skillDocument, expectedRevision: selected.revision }); setSelected(next); setSkillDocument(next.document ?? ''); setEditing(false); await refresh(); }
    catch (cause) { setError(messageOf(cause)); setBusy(false); }
  };
  const uninstall = async () => {
    if (!confirmUninstall) return;
    const { skill, impact, market } = confirmUninstall;
    setBusy(true); setError('');
    try {
      // 宿主在本机卸载成功后统一上报市场卸载记录（非市场技能自动跳过），reported 表示后台是否已记账。
      const receipt = await management.uninstall(skill.name, impact.revision);
      if (selected?.name === skill.name) setSelected(undefined);
      setConfirmUninstall(undefined);
      await refresh();
      // 市场卸载：重取市场列表让条目回到可安装状态，并如实反馈后台上报结果。
      if (market) {
        if (marketOn) await loadMarket(filter);
        setNotice(receipt.reported === false
          ? `已从本机卸载「${skill.title ?? skill.name}」，但后台卸载上报失败，后台记录可能未同步。`
          : `已卸载「${skill.title ?? skill.name}」`);
      }
    }
    catch (cause) { setError(messageOf(cause)); setBusy(false); setConfirmUninstall(undefined); }
  };
  const prepareUninstall = async (skill: ManagedSkillSummary) => {
    setError('');
    try { setConfirmUninstall({ skill, impact: await management.dependencyImpact(skill.name) }); }
    catch (cause) { setError(messageOf(cause)); }
  };
  const openTrash = async () => {
    setError('');
    try { setTrash(await management.listTrash()); setTrashOpen(true); }
    catch (cause) { setError(messageOf(cause)); }
  };
  const restore = async (entry: TrashedSkillSummary) => {
    setBusy(true); setError('');
    try { await management.restore(entry.id); setTrash(await management.listTrash()); await refresh(); }
    catch (cause) { setError(messageOf(cause)); setBusy(false); }
  };
  const openResource = async (path: string) => {
    if (!selected) return;
    setError('');
    try { const next = await management.resource(selected.name, path); setResource(next); setResourceDocument(next.document); }
    catch (cause) { setError(messageOf(cause)); }
  };
  const beginResource = () => {
    const path = newResourcePath.trim();
    if (!path) return;
    setResource({ path, document: '', revision: '', isNew: true }); setResourceDocument(''); setNewResourcePath('');
  };
  const saveResource = async () => {
    if (!selected || !resource) return;
    setBusy(true); setError('');
    try {
      const next = await management.writeResource({ name: selected.name, path: resource.path, document: resourceDocument, expectedRevision: resource.isNew ? undefined : resource.revision });
      const detail = await management.detail(selected.name); setSelected(detail); setResource(next); setResourceDocument(next.document); await refresh();
    } catch (cause) { setError(messageOf(cause)); setBusy(false); }
  };
  const toggleBatchSelection = (name: string) => setSelectedNames(current => current.includes(name) ? current.filter(item => item !== name) : [...current, name]);
  const toggleBatch = () => { setBatchMode(value => !value); setSelectedNames([]); };
  const runBatch = async (action: 'enable' | 'disable' | 'uninstall') => {
    if (!selectedNames.length) return;
    setBusy(true); setError('');
    try {
      const result = await management.batch(selectedNames, action);
      const failed = result.results.filter(item => !item.ok);
      await refresh();
      setSelectedNames(failed.map(item => item.name));
      if (failed.length) setError(`${result.results.length - failed.length} 项成功，${failed.length} 项失败：${failed.map(item => `${item.name}（${item.error}）`).join('；')}`);
      else { setBatchMode(false); setSelectedNames([]); }
      setConfirmBatchUninstall(false);
    } catch (cause) { setError(messageOf(cause)); setBusy(false); setConfirmBatchUninstall(false); }
  };
  /** 打开市场详情：先展示条目信息，同时让宿主下载附件并取出 SKILL.md 正文。 */
  const openMarketDetail = async (entry: SkillMarketItem) => {
    setError(''); setNotice('');
    setMarketDetailId(entry.id);
    setMarketDoc(undefined); setMarketDocError(''); setMarketDocBusy(true);
    try { setMarketDoc(await management.marketDocument(entry.id)); }
    catch (cause) { setMarketDocError(messageOf(cause)); }
    finally { setMarketDocBusy(false); }
  };
  /**
   * 从市场安装到本机：宿主完成「后台安装上报 → 下载附件 → 官方导入链路」。
   * 期间卡片显示加载态与进度条；成功后刷新本地列表与市场列表（条目转为「已安装」），
   * 失败把原因留在该条目上（卡片可就地重试），不打断整个列表。
   */
  const installFromMarket = async (entry: SkillMarketItem) => {
    setError(''); setNotice(''); setMarketInstalling(entry.id);
    setMarketFailures(current => {
      if (!(entry.id in current)) return current;
      const next = { ...current }; delete next[entry.id]; return next;
    });
    try {
      const result = await management.marketInstall(entry.id);
      setMarketDetailId(undefined);
      // 就地更新这一条：安装后重拉整页会把列表闪成空白，安装过程的反馈也就白做了。
      setMarket(current => ({
        ...current,
        items: current.items.map(item => item.id === entry.id ? { ...item, installed: true, installedName: result.name } : item),
      }));
      // 本地列表仍要刷新（新技能要出现在「本地技能」里），但它不影响正在展示的市场页签。
      await refresh();
      setNotice(result.state === 'existing'
        ? `本机已有该技能（${result.name}），已标记为「已安装」。`
        : `已从市场安装「${result.name}」，可在「本地技能」中查看。`);
    } catch (cause) {
      setMarketFailures(current => ({ ...current, [entry.id]: messageOf(cause) }));
    } finally { setMarketInstalling(undefined); }
  };
  /**
   * 卸载市场安装的技能：直接复用本地技能卸载流程（依赖影响确认 → 移入回收目录），
   * 本机卸载完成后再上报 uninstall；不再在卸载前上报。
   */
  const uninstallFromMarket = async (entry: SkillMarketItem) => {
    setError(''); setNotice('');
    const local = skills.find(skill => skill.name === entry.installedName);
    if (!local) { setError('本机未找到该技能，请刷新后重试。'); return; }
    setMarketDetailId(undefined);
    try {
      setConfirmUninstall({
        skill: local,
        impact: await management.dependencyImpact(local.name),
        market: { id: entry.id, slug: entry.slug, name: entry.title },
      });
    }
    catch (cause) { setError(messageOf(cause)); }
  };
  /**
   * 授权申请 / 取消申请：与上架申请共用单点登录通道，菜单与业务参数集中在 SKILL_AUTH_SSO。
   * 后台地址尚未接入时只提示未配置，不发请求。
   */
  const openAuthSso = async (action: 'apply' | 'cancel', entry: { readonly id: string }) => {
    if (ssoBusy) return;
    setSsoBusy(true); setError(''); setNotice('');
    try {
      const target = SKILL_AUTH_SSO[action];
      if (!target.menuId) { setNotice('授权申请跳转地址待配置，请联系管理员。'); return; }
      const result = await management.adminSsoFor(target.menuId, { ...target.bizParams, assetId: entry.id });
      if (result.degraded) setSsoPromptUrl(result.url);
      else openAdminSso(result.url);
    } catch (cause) { setError(messageOf(cause)); }
    finally { setSsoBusy(false); }
  };
  const switchTab = (next: 'local' | 'market' | 'applications') => {
    window.clearTimeout(queryTimerRef.current);
    setBatchMode(false);
    setSelectedNames([]);
    // 提示属于上一个页签的操作结果，切页签时一并清掉，否则出错信息会跟到另一个页签上。
    setError('');
    setNotice('');
    // 用户主动点页签：每次进入都按当前筛选重新取数，但保留已选业务场景/内置筛选/关键词。
    setTab(next);
    if (next === 'market' && marketOn) void loadMarket({ scenes, keyword: query, builtin: builtinFilter, install: installFilter, auth: authFilter, apply: applyFilter });
    if (next === 'applications' && marketOn) void loadApplications({ keyword: query, status: applicationStatus });
    // 本地页签的业务场景/内置属性来自授权索引：切回来时对齐一次。
    if (next === 'local' && marketOn) void loadAuthorized();
  };
  /** 是否内置是单选：胶囊栏只在「选中一个」与「全部」之间切换。 */
  const changeBuiltin = (next: readonly string[]) => {
    const value = next.length ? next[next.length - 1] === BUILTIN_YES : undefined;
    setBuiltinFilter(value);
    window.clearTimeout(queryTimerRef.current);
    if (tab !== 'market' || !marketOn) return;
    void loadMarket({ scenes: activeScenes, keyword: query, builtin: value, install: installFilter, auth: authFilter, apply: applyFilter });
  };
  /**
   * 安装状态：本机判定，只改客户端过滤条件。其它服务端条件不变，因此不重新请求后台，
   * 但需要保证已加载的数据够展示一页，不足时补拉。
   */
  const changeInstall = (next: readonly string[]) => {
    const label = next[next.length - 1];
    const value = next.length ? (label === INSTALL_OPTIONS[0] ? 'installed' as const : 'uninstalled' as const) : undefined;
    setInstallFilter(value);
    window.clearTimeout(queryTimerRef.current);
    if (tab !== 'market' || !marketOn) return;
    if (!needsFill(market.items, value) || !market.hasMore) return;
    void loadMarket({ scenes: activeScenes, keyword: query, builtin: builtinFilter, install: value, auth: authFilter, apply: applyFilter });
  };
  /** 授权状态是服务端条件：明确的一次点击，立即从第 1 页重新取数。 */
  const changeAuth = (next: readonly string[]) => {
    const label = next[next.length - 1];
    const value = next.length ? (label === AUTH_OPTIONS[0] ? 'Y' as const : 'N' as const) : undefined;
    setAuthFilter(value);
    window.clearTimeout(queryTimerRef.current);
    if (tab !== 'market' || !marketOn) return;
    void loadMarket({ scenes: activeScenes, keyword: query, builtin: builtinFilter, install: installFilter, auth: value, apply: applyFilter });
  };
  /** 申请状态是服务端条件：与授权状态同口径，点击即重新取数。 */
  const changeApply = (next: readonly string[]) => {
    const label = next[next.length - 1];
    const value = next.length ? APPLY_VALUE[label] : undefined;
    setApplyFilter(value);
    window.clearTimeout(queryTimerRef.current);
    if (tab !== 'market' || !marketOn) return;
    void loadMarket({ scenes: activeScenes, keyword: query, builtin: builtinFilter, install: installFilter, auth: authFilter, apply: value });
  };
  const changeScene = (next: readonly string[]) => {
    setScenes(next);
    // 业务场景是明确的一次点击，立即取数；同时作废还在等待中的关键词请求，避免重复请求。
    window.clearTimeout(queryTimerRef.current);
    if (tab !== 'market' || !marketOn) return;
    void loadMarket({ scenes: next, keyword: query, builtin: builtinFilter, install: installFilter, auth: authFilter, apply: applyFilter });
  };
  const changeQuery = (next: string) => {
    setQuery(next);
    // 本地页签的关键词是即时本地过滤；市场与我的申请的关键词交给服务端，等输入停顿后再发一次请求。
    if (tab === 'local' || (!marketOn && tab !== 'applications')) return;
    window.clearTimeout(queryTimerRef.current);
    queryTimerRef.current = window.setTimeout(() => {
      if (tab === 'market') void loadMarket({ scenes: activeScenes, keyword: next, builtin: builtinFilter, install: installFilter, auth: authFilter, apply: applyFilter });
      else if (tab === 'applications') void loadApplications({ keyword: next, status: applicationStatus });
    }, MARKET_QUERY_DEBOUNCE_MS);
  };
  /** 审批状态是明确的一次点击，立即取数，并让页签数字跟着新的查询条件更新。 */
  const changeApplicationStatus = (next: string) => {
    setApplicationStatus(next);
    setNotice('');
    setError('');
    window.clearTimeout(queryTimerRef.current);
    void loadApplications({ keyword: query, status: next });
  };
  /** 提交申请成功后：回到「我的申请」全量第一页，确保刚提交的记录可见。 */
  const focusApplications = () => {
    setTab('applications');
    setQuery('');
    setScenes([]);
    setBuiltinFilter(undefined);
    setInstallFilter(undefined);
    setAuthFilter(undefined);
    setApplyFilter(undefined);
    setBatchMode(false);
    setSelectedNames([]);
    setApplicationStatus('');
    setError('');
    setNotice('');
    window.clearTimeout(queryTimerRef.current);
    if (marketOn) void loadApplications({ keyword: '', status: '' });
  };

  /** 授权技能索引：标识（skillNameEn）优先、名称（skillName）兜底，用于本地技能的业务场景匹配。 */
  const slugScenes = useMemo(() => new Map(authorized.map(row => [row.slug.trim().toLowerCase(), row.sceneLabels])), [authorized]);
  const titleScenes = useMemo(() => new Map(authorized.map(row => [row.title.trim().toLowerCase(), row.sceneLabels])), [authorized]);
  /** 授权技能索引里的内置属性：口径与业务场景一致，标识优先、名称兜底。 */
  const slugBuiltin = useMemo(() => new Map(authorized.map(row => [row.slug.trim().toLowerCase(), row.builtin === true])), [authorized]);
  const titleBuiltin = useMemo(() => new Map(authorized.map(row => [row.title.trim().toLowerCase(), row.builtin === true])), [authorized]);
  /** 市场授权条目标识 → 中文名称：本地 SKILL.md 没有 title 时用它兜底显示。 */
  const marketTitles = useMemo(() => new Map(authorized.flatMap(row => {
    const slug = row.slug.trim().toLowerCase();
    const title = row.title.trim();
    return slug && title ? [[slug, title] as const] : [];
  })), [authorized]);
  /** 市场授权条目的图标：标识优先、名称兜底，本地技能没有自带图标时与技能市场保持一致。 */
  const slugIcons = useMemo(() => new Map(authorized.flatMap(row => {
    const slug = row.slug.trim().toLowerCase();
    return row.icon && slug ? [[slug, row.icon] as const] : [];
  })), [authorized]);
  const titleIcons = useMemo(() => new Map(authorized.flatMap(row => {
    const title = row.title.trim().toLowerCase();
    return row.icon && title ? [[title, row.icon] as const] : [];
  })), [authorized]);
  /** 本地技能的展示图标：自带图标优先，其次市场同名条目，都没有时由 SkillMark 回退名称首字符。 */
  const marketIconOf = (skill: ManagedSkillSummary): string | undefined =>
    skill.iconUrl
    ?? slugIcons.get(skill.name.trim().toLowerCase())
    ?? titleIcons.get((skill.title ?? '').trim().toLowerCase())
    ?? titleIcons.get(skill.name.trim().toLowerCase());
  /**
   * 本地技能的展示名称：SKILL.md 自带 title 优先，其次用市场下发的中文名称，
   * 两者都没有时回退到技能标识（name）。安装不改写 SKILL.md，标识始终保持官方口径。
   */
  const titleOf = (skill: ManagedSkillSummary): string => {
    const local = skill.title?.trim();
    if (local && local !== skill.name) return local;
    return marketTitles.get(skill.name.trim().toLowerCase()) ?? local ?? skill.name;
  };
  /** 本地技能的业务场景文案：匹配不到后台授权条目时为空，界面不显示占位。 */
  const scenesOf = (skill: ManagedSkillSummary): readonly string[] =>
    slugScenes.get(skill.name.trim().toLowerCase())
    ?? titleScenes.get((skill.title ?? '').trim().toLowerCase())
    ?? titleScenes.get(skill.name.trim().toLowerCase())
    ?? [];
  /**
   * 本地技能的「是否内置」：市场索引里有该技能时以它为准（管理员后台改动即时生效，市场是唯一真相）；
   * 索引里没有时（随包内置技能不在市场索引中）退回本机安装记录里的最后一次同步结果，
   * 市场索引整体不可用时同样用安装记录兜底。
   */
  const builtinOf = (skill: ManagedSkillSummary): boolean => {
    const indexed = authorizedReady
      ? slugBuiltin.get(skill.name.trim().toLowerCase())
        ?? titleBuiltin.get((skill.title ?? '').trim().toLowerCase())
        ?? titleBuiltin.get(skill.name.trim().toLowerCase())
      : undefined;
    return indexed ?? skill.builtin === true;
  };
  /**
   * 授权索引里的「是否客户端内置」：按后台 id、技能标识、名称三张表分别聚合。
   * 同名多条记录时取「或」（任一为 1 即按客户端内置处理），避免把随包资产误放开成可卸载。
   */
  const clientBuiltinIndex = useMemo(() => {
    const ids = new Map<string, boolean>();
    const slugs = new Map<string, boolean>();
    const titles = new Map<string, boolean>();
    const add = (map: Map<string, boolean>, key: string | undefined, value: boolean) => {
      const normalized = key?.trim().toLowerCase();
      if (!normalized) return;
      map.set(normalized, (map.get(normalized) ?? false) || value);
    };
    for (const row of authorized) {
      const value = row.clientBuiltin === true;
      add(ids, row.id, value); add(slugs, row.slug, value); add(titles, row.title, value);
    }
    return { ids, slugs, titles };
  }, [authorized]);
  /**
   * 本地技能的「是否客户端内置」：按后台 id（安装清单 assetId）优先，其次技能标识、名称；
   * 索引里完全匹配不到或市场不可用时回退到宿主按随包来源给出的本地兜底。
   */
  const clientBuiltinOf = (skill: ManagedSkillSummary): boolean => {
    const id = skill.assetId?.trim().toLowerCase();
    const indexed = authorizedReady
      ? (id ? clientBuiltinIndex.ids.get(id) : undefined)
        ?? clientBuiltinIndex.slugs.get(skill.name.trim().toLowerCase())
        ?? clientBuiltinIndex.titles.get((skill.title ?? '').trim().toLowerCase())
        ?? clientBuiltinIndex.titles.get(skill.name.trim().toLowerCase())
      : undefined;
    return indexed ?? skill.clientBuiltin === true;
  };
  /**
   * 本地技能对应的市场索引项：按后台 id（安装清单 assetId）优先，其次技能标识、名称。
   * 用于在本地卡片上展示授权/申请状态并给出申请入口，口径与技能市场一致。
   */
  const marketRefOf = (skill: ManagedSkillSummary): SkillMarketAuthorized | undefined => {
    if (!authorizedReady) return undefined;
    const id = skill.assetId?.trim().toLowerCase();
    const byId = id ? authorized.find(row => row.id.trim().toLowerCase() === id) : undefined;
    if (byId) return byId;
    const slug = skill.name.trim().toLowerCase();
    const title = (skill.title ?? '').trim().toLowerCase();
    return authorized.find(row => row.slug.trim().toLowerCase() === slug)
      ?? (title ? authorized.find(row => row.title.trim().toLowerCase() === title) : undefined);
  };
  /**
   * 市场条目的「已安装」状态由宿主判定（安装记录 + 本机技能标识/名称匹配，见 SkillMarketService），
   * 界面只负责展示，因此卡片上的「＋」与详情页的「安装 / 卸载」始终跟着它走。
   */
  const isInstalled = (entry: SkillMarketItem) => entry.installed === true;
  /**
   * 技能不可用的原因文案：授权问题优先（后台撤权需要先重新申请），
   * 其次才是完整性（本地文件被修改，需要重新安装）。两者都只在各自卡片上展示。
   */
  const blockedReasonOf = (skill: ManagedSkillSummary): string | undefined =>
    skill.authState !== undefined ? skill.authReason : skill.integrityReason;

  const dictTexts = marketDict.map(item => item.text);
  /**
   * 业务场景栏只展示后台字典项：字典是筛选的唯一口径（文案要映射回 value 才能下发 bizScene）。
   * 技能列表里出现、但字典没有的场景不再追加，避免出现「选中了却筛不出来」的胶囊。
   */
  const options = dictTexts;
  /** 只保留当前页签仍存在的选中项：切页签或字典变化后，失效的选择自动丢弃。 */
  const activeScenes = scenes.filter(name => options.includes(name));
  const filter: SkillMarketFilter = { scenes: activeScenes, keyword: query, builtin: builtinFilter, install: installFilter, auth: authFilter, apply: applyFilter };
  /** 安装状态是客户端过滤：卡片渲染只用这里的可见条目。 */
  const marketEntries = marketItemsByInstall(market.items, installFilter);

  // 技能列表只在用户主动操作时取数：进入页面、点击页签、点刷新、改筛选/检索、安装或卸载之后。
  // 窗口焦点、visibilitychange 等隐式信号不触发任何查询。

  const normalizedQuery = query.trim().toLowerCase();
  const visibleLocal = skills.filter(skill => {
    const sceneLabels = scenesOf(skill);
    if (builtinFilter !== undefined && builtinOf(skill) !== builtinFilter) return false;
    const text = `${skill.name} ${titleOf(skill)} ${skill.localizedDescription ?? skill.description} ${skill.whenToUse ?? ''} ${sceneLabels.join(' ')}`;
    return text.toLowerCase().includes(normalizedQuery) && (!activeScenes.length || sceneLabels.some(label => activeScenes.includes(label)));
  });
  const marketEntry = marketDetailId ? market.items.find(entry => entry.id === marketDetailId) : undefined;
  /**
   * 已有数据时后台静默刷新：重取列表（切页签、换筛选）不把正在展示的卡片换成空白或「读取中」，
   * 只有首次加载（还没有任何数据）才显示读取提示。
   */
  const marketVisible = !marketError && marketEntries.length > 0;
  const marketEmpty = !marketBusy && !marketError && marketEntries.length === 0;
  /** 我的申请：详情按申请单 id 定位；状态文案优先字典，字典缺失时回退后台下发的 status_dictText。 */
  const applicationEntry = applicationId ? applications.items.find(item => item.id === applicationId) : undefined;
  // 列表刷新后申请单不再存在（被筛掉或已删除）时关掉详情，避免下次加载时意外弹出。
  useEffect(() => {
    if (applicationId && !applications.items.some(item => item.id === applicationId)) setApplicationId(undefined);
  }, [applicationId, applications]);
  const applicationStatusOptions = listingOptions?.statuses ?? [];
  const statusTextOf = (item: SkillListingItem) => applicationStatusOptions.find(option => option.value === item.status)?.label ?? item.statusText ?? item.status;
  const applicationVisible = !applicationError && applications.items.length > 0;
  const applicationEmpty = !applicationBusy && !applicationError && applications.items.length === 0;
  const capabilityTabs = [['experts', '专家'], ['skills', '技能'], ['connectors', '连接器']] as const;
  const capabilityKey: Record<string, string> = { experts: 'workdsh-experts', skills: 'workdsh-skills', connectors: 'workdsh-connectors' };
  const counts = tab === 'local'
    ? `共 ${skills.length} 个已安装技能 · 当前显示 ${visibleLocal.length} 个`
    : tab === 'market'
      ? `共 ${market.total} 个技能 · 当前显示 ${marketEntries.length} 个`
      : `共 ${applications.total} 条上架申请 · 当前显示 ${applications.items.length} 条`;
  const countsLine = <div role="status" aria-live="polite" className={error ? 'error counts' : notice ? 'notice counts' : 'muted counts'}>{(tab === 'local' ? busy : tab === 'market' ? marketBusy : applicationBusy) ? '正在读取…' : error || notice || counts}</div>;
  /**
   * 查询覆盖层：只统计当前页签的列表请求。
   * 请求一发出就显示；请求结束（成功、失败、超时）或组件卸载时随状态复位立即移除。
   */
  const listingBusy = tab === 'local' ? busy : tab === 'market' ? marketBusy : applicationBusy;
  /**
   * 首屏骨架：只有当前页签还没有任何数据且正在加载时才用；
   * 已有数据时仍用覆盖层，避免刷新把正在看的内容换成占位卡。
   */
  const localSkeleton = tab === 'local' && busy && !skills.length;
  const marketSkeleton = tab === 'market' && marketBusy && !market.items.length;
  const skeletonVisible = localSkeleton || marketSkeleton;
  /** 骨架屏已经表达了加载态，不再叠加覆盖层。 */
  const overlayVisible = listingBusy && !skeletonVisible;
  const batchBar = <div className="batch-bar" role="toolbar" aria-label="批量管理技能"><span>已选择 {selectedNames.length} 项</span><Button disabled={!selectedNames.length || busy} onClick={() => void runBatch('enable')}>启用</Button><Button disabled={!selectedNames.length || busy} onClick={() => void runBatch('disable')}>停用</Button><Button tone="danger" className="danger" disabled={!selectedNames.length || busy} onClick={() => setConfirmBatchUninstall(true)}>卸载</Button></div>;
  const renderSkillCard = (skill: ManagedSkillSummary) => {
    const sceneText = scenesOf(skill).join(' · ');
    const title = titleOf(skill);
    const blocked = skill.authState !== undefined || skill.integrityState !== undefined;
    // 随客户端内置：默认启用、不允许停用和卸载；索引不可用时由宿主按随包来源兜底。
    const clientBuiltin = clientBuiltinOf(skill);
    // 只有「授权已失效」的技能才展示授权/申请状态与申请入口，其它技能保持原样。
    const revoked = skill.authState === 'revoked';
    const marketRef = revoked ? marketRefOf(skill) : undefined;
    const applyRef = marketRef?.applyStatus;
    const applyApplicable = revoked && applyRef !== 'pending';
    const applyCancelable = revoked && applyRef === 'pending';
    const version = skill.version ? `v${skill.version.replace(/^v/iu, '')}` : undefined;
    return <article className={`card local-card ${skill.state === 'disabled' || blocked ? 'disabled' : skill.state === 'invalid' ? 'invalid' : ''}`} key={skill.name}>
      <div className="card-top">{batchMode && skill.manageable ? <button className="batch-check" role="checkbox" aria-checked={selectedNames.includes(skill.name)} aria-label={`选择技能 ${skill.name}`} onClick={() => toggleBatchSelection(skill.name)}>{selectedNames.includes(skill.name) ? '✓' : ''}</button> : null}<button className="card-open" aria-label={`查看技能 ${skill.name}`} onClick={() => batchMode && skill.manageable ? toggleBatchSelection(skill.name) : void openDetail(skill.name)}><SkillMark name={skill.name} title={title} iconUrl={marketIconOf(skill)} /><span className="card-title"><strong title={title}>{title}</strong>{title !== skill.name ? <small className="market-slug" title={skill.name}>{skill.name}</small> : null}</span></button>
        {!batchMode && <button className="switch" role="switch" disabled={!skill.manageable || skill.state === 'invalid' || blocked || clientBuiltin} aria-checked={clientBuiltin || (skill.state === 'enabled' && !blocked)} aria-label={`${clientBuiltin || skill.state === 'enabled' ? '停用' : '启用'}技能 ${skill.name}`} onClick={() => void setEnabled(skill, skill.state !== 'enabled')} />}
      </div>
      {sceneText ? <span className="skill-scene" title={sceneText}>{sceneText}</span> : null}
      <p className="card-summary">{skill.localizedDescription ?? skill.description}</p>
      {skill.state === 'invalid' && <small className="diagnostic">需要修复 · {skill.diagnostics?.[0]?.message}</small>}{blockedReasonOf(skill) ? <small className="auth-reason">{blockedReasonOf(skill)}</small> : null}{trialErrors[skill.name] ? <small className="auth-reason" role="alert">{trialErrors[skill.name]}</small> : null}
      {/* 与技能市场一致：第一行状态标签靠左，第二行操作按钮靠右。 */}
      <div className="market-card-foot">
        <div className="market-card-tags">
          {version ? <span className="version-tag">{version}</span> : null}
          {builtinOf(skill) ? <span className="builtin-pill">内置</span> : <span className="external-pill">非内置</span>}
          {revoked ? <span className="apply-pill none">未授权</span> : null}
          {revoked && applyRef ? <span className={`apply-pill ${applyRef}`}>{APPLY_LABEL[applyRef]}</span> : null}
        </div>
        <div className="market-card-actions">
          {/* 不可用的技能不展示「去试试」：试用只对当前真正可调用的技能有意义。 */}
          {(skill.state === 'enabled' || skill.state === 'readonly') && !blocked
            ? <button type="button" className="market-action primary" aria-label={`试用技能 ${title}`} onClick={() => void trial(skill.name)}>去试试</button>
            : null}
          {applyCancelable && marketRef ? <button type="button" className="market-action primary" aria-label={`取消申请 ${title}`} disabled={ssoBusy} onClick={() => void openAuthSso('cancel', marketRef)}>取消申请</button> : null}
          {applyApplicable && marketRef ? <button type="button" className="market-action primary" aria-label={`申请技能 ${title}`} disabled={ssoBusy} onClick={() => void openAuthSso('apply', marketRef)}>申请</button> : null}
          {skill.manageable && !clientBuiltin ? <button type="button" className="market-action danger" aria-label={`卸载技能 ${title}`} onClick={() => void prepareUninstall(skill)}>卸载</button> : null}
        </div>
      </div>
    </article>;
  };
  const renderMarketCard = (entry: SkillMarketItem) => {
    const sceneText = skillMarketSceneText(entry, marketDict);
    const installing = marketInstalling === entry.id;
    const failure = marketFailures[entry.id];
    const installed = isInstalled(entry);
    const authorized = entry.authorized === true;
    // 申请状态只在未授权时参与按钮：只有「申请中」是取消申请；已通过但被后台撤权的仍要能重新申请。
    const applicable = !authorized && entry.applyStatus !== 'pending';
    const cancelable = !authorized && entry.applyStatus === 'pending';
    return <article className={`card market-card${installing ? ' is-installing' : ''}`} key={entry.id}>
      <button className="card-open" aria-label={`查看技能 ${entry.title}`} onClick={() => void openMarketDetail(entry)}><SkillMark name={entry.slug} title={entry.title} iconUrl={entry.icon} /><span className="card-title"><strong title={entry.title}>{entry.title}</strong><small className="market-slug" title={entry.slug}>{entry.slug}</small></span></button>
      {sceneText ? <small className="tag" title={sceneText}>{sceneText}</small> : null}
      <p className="muted">{entry.description}</p>
      <div className="market-card-foot">
        {/* 第一行：状态标签靠左；第二行：操作按钮靠右。 */}
        <div className="market-card-tags">
          {entry.version ? <span className="version-tag">{entry.version}</span> : null}
          <span className={entry.builtin ? 'builtin-pill' : 'external-pill'}>{entry.builtin ? '内置' : '非内置'}</span>
          <span className={installed ? 'installed-pill' : 'uninstalled-pill'}>{installed ? '已安装' : '未安装'}</span>
          {/* 授权状态只看 isAuthorized；申请状态只看 applyStatus，两者互不影响。 */}
          <span className={`apply-pill ${authorized ? 'approved' : 'none'}`}>{authorized ? '已授权' : '未授权'}</span>
          <span className={`apply-pill ${entry.applyStatus}`}>{APPLY_LABEL[entry.applyStatus]}</span>
        </div>
        <div className="market-card-actions">
          {!installed && authorized
            ? installing
              ? <span className="plus installing" role="status" aria-label={`正在安装 ${entry.title}`}><i className="spinner" /></span>
              : <button type="button" className="install" aria-label={`安装技能 ${entry.title}`} title="安装到本机" disabled={Boolean(marketInstalling)} onClick={() => void installFromMarket(entry)}>安装</button>
            : null}
          {cancelable ? <button type="button" className="install" aria-label={`取消申请 ${entry.title}`} disabled={ssoBusy} onClick={() => void openAuthSso('cancel', entry)}>取消申请</button> : null}
          {applicable ? <button type="button" className="install" aria-label={`申请技能 ${entry.title}`} disabled={ssoBusy} onClick={() => void openAuthSso('apply', entry)}>申请</button> : null}
          {/* 危险操作固定靠右：随客户端内置的技能随安装包发布，市场侧不提供卸载入口。 */}
          {installed && entry.clientBuiltin !== true ? <button type="button" className="market-action danger" aria-label={`卸载技能 ${entry.title}`} onClick={() => void uninstallFromMarket(entry)}>卸载</button> : null}
        </div>
      </div>
      {installing ? <div className="install-bar" role="progressbar" aria-label={`正在安装 ${entry.title}`}><i className="install-bar-fill" /></div> : null}
      {failure && !installed ? <p className="card-error" role="alert">{failure}</p> : null}
    </article>;
  };
  /** 我的一条上架申请：撤销按钮放在卡片右下角，保留名称完整展示。 */
  const renderApplicationCard = (item: SkillListingItem) => {
    const sceneText = item.sceneLabels.join(' · ');
    const statusText = statusTextOf(item);
    return <article className="card application-card" key={item.id}>
      <div className="card-top">
        <button className="card-open" aria-label={`查看申请 ${item.title}`} onClick={() => setApplicationId(item.id)}><SkillMark name={item.slug} title={item.title} iconUrl={item.icon} /><span className="card-title"><strong title={item.title}>{item.title}</strong><small className="slug">{item.slug}</small>{sceneText ? <small className="tag" title={sceneText}>{sceneText}</small> : null}</span></button>
      </div>
      <p className="muted">{item.description}</p>
      <div className="application-meta">
        <span className={`status-badge ${statusToneOf(statusText)}`}>{statusText}</span>
        {item.version ? <small>版本 {item.version}</small> : null}
        {item.createdAt ? <small>{item.createdAt}</small> : null}
      </div>
      <div className="application-actions"><Button tone="danger" className="danger withdraw" aria-label={`撤销申请 ${item.title}`} onClick={() => setNotice('撤销申请功能暂未开放。')}>撤销</Button></div>
    </article>;
  };
  return <section className="wd-skills" data-testid="workdsh-skills">
    <style>{skillsCss + skillsActionsCss + skillsMarketCss + skillsListingCss + cardSkeletonCss + queryOverlayCss}</style>
    {/* 面板内容整体滚动；查询覆盖层作为同级绝对定位层，才能始终罩满可视区并居中。 */}
    <div className="skill-panel-scroll" onScroll={event => {
      const node = event.currentTarget;
      if (node.scrollHeight - node.scrollTop - node.clientHeight >= MARKET_SCROLL_THRESHOLD) return;
      if (tab === 'market' && marketOn && !marketBusy && !marketMore && market.hasMore) void loadMoreMarket();
      if (tab === 'applications' && marketOn && !applicationBusy && !applicationMore && applications.hasMore) void loadMoreApplications();
    }}>
    <header className="cap-header">
      <button className="nav-toggle" onClick={toggleNavigation} aria-label="切换导航">导航</button>
      {capabilityTabs.map(([key, label]) => {
        const active = key === 'skills';
        const target = capabilityKey[key];
        const enabled = active || (target !== undefined && hasCapability(target));
        return <button key={key} className={`cap-tab ${active ? 'active' : ''}`} disabled={!enabled}
          aria-current={active ? 'page' : undefined}
          onClick={() => { if (!active && target) openCapability(target); }}>{icon(key)}{label}</button>;
      })}
      <Input ref={search} className="search" aria-label="搜索技能" placeholder="请输入技能名称/标识/描述" value={query} onChange={event => changeQuery(event.currentTarget.value)} />
      <Button className="refresh" onClick={() => void reloadAll()} disabled={busy}>刷新列表</Button>
      {/* 批量管理入口暂时隐藏（连接与批量接口保留，打开开关即可恢复）。 */}
      {BATCH_UI_ENABLED ? <Button className={batchMode ? 'batch-toggle active' : 'batch-toggle'} onClick={toggleBatch}>{batchMode ? '退出批量' : '批量管理'}</Button> : null}
      <Button className="trash-button" onClick={() => void openTrash()}>最近卸载</Button>
      <Button className="create-skill" disabled={creating} onClick={() => void beginSkillTask('create')}>创建技能</Button>
      <Button variant="primary" className="add-skill" disabled={ssoBusy} onClick={() => void openListingAdmin()}>上架申请</Button>
      {tab === 'local' ? <Button className="open-root" onClick={() => void openRootDirectory()}>打开文件夹</Button> : null}
    </header>
    <div className="section-head"><h1>技能管理</h1></div>
    <nav className="source-tabs" aria-label="技能来源">
      <button className={tab === 'local' ? 'active' : ''} aria-current={tab === 'local' ? 'page' : undefined} onClick={() => switchTab('local')}>本地技能<i className="count" title="本机已安装技能数量">{skills.length}</i></button>
      {marketOn ? <button className={tab === 'market' ? 'active' : ''} aria-current={tab === 'market' ? 'page' : undefined} onClick={() => switchTab('market')}>技能市场{/* 数量取后台返回的总数，首次加载完成前不显示 0 */}{marketBusy && !market.items.length ? null : <i className="count" title="技能总数">{market.total}</i>}</button> : null}
    </nav>
    {tab === 'applications'
      ? <div className="listing-toolbar"><label className="listing-status-filter"><span>审批状态</span><Select aria-label="审批状态" value={applicationStatus} disabled={listingOptionsBusy} onChange={event => changeApplicationStatus(event.currentTarget.value)}><option value="">全部</option>{applicationStatusOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</Select></label>{listingOptionsError ? <span className="muted">状态字典读取失败，可按「刷新」重试。</span> : null}</div>
      : <div className="skill-filters">
        {/* 是否内置、业务场景与本机/服务端状态条件都是「胶囊栏 + 前置说明」，各自独立、可同时生效。 */}
        <div className="filter-group builtin-filter"><span className="filter-label">是否内置：</span><CategoryBar categories={BUILTIN_OPTIONS} values={builtinFilter === undefined ? [] : [builtinFilter ? BUILTIN_YES : BUILTIN_OPTIONS[1]]} onChange={changeBuiltin} /></div>
        {/* 三个状态条件只作用于技能市场；本地技能页签里它们没有意义。 */}
        {tab === 'market' ? <>
          <div className="filter-group"><span className="filter-label">安装状态：</span><CategoryBar categories={INSTALL_OPTIONS} values={installFilter === undefined ? [] : [installFilter === 'installed' ? INSTALL_OPTIONS[0] : INSTALL_OPTIONS[1]]} onChange={changeInstall} /></div>
          <div className="filter-group"><span className="filter-label">授权状态：</span><CategoryBar categories={AUTH_OPTIONS} values={authFilter === undefined ? [] : [authFilter === 'Y' ? AUTH_OPTIONS[0] : AUTH_OPTIONS[1]]} onChange={changeAuth} /></div>
          <div className="filter-group"><span className="filter-label">申请状态：</span><CategoryBar categories={APPLY_OPTIONS} values={applyFilter === undefined ? [] : [APPLY_LABEL[applyFilter]]} onChange={changeApply} /></div>
        </> : null}
        <div className="filter-group scenes-filter"><span className="filter-label">业务场景：</span><CategoryBar categories={options} values={activeScenes} onChange={changeScene} /></div>
      </div>}
    <div className="skill-content">
    {tab === 'local' && batchMode ? batchBar : null}
    {countsLine}

    {tab === 'local' ? <>
      {localSkeleton ? <div className="grid"><CardSkeleton /></div> : null}
      {!busy && !visibleLocal.length ? <div className="empty"><strong>暂无技能</strong></div> : null}
      {visibleLocal.length ? <div className="grid">{visibleLocal.map(renderSkillCard)}</div> : null}
    </> : tab === 'market' ? <>
      {marketError ? <p className="error" role="alert">{marketError}<Button className="secondary" disabled={marketBusy} onClick={() => void loadMarket(filter)}>重试</Button></p> : null}
      {marketMoreError ? <p className="error" role="alert">{marketMoreError}<Button className="secondary" disabled={marketMore} onClick={() => void loadMoreMarket()}>重试</Button></p> : null}
      {/* 首次加载用骨架占位；已有卡片时后台静默重取，列表原地保留直到新结果替换它。 */}
      {marketSkeleton ? <div className="grid"><CardSkeleton /></div> : null}
      {marketVisible ? <div className="grid">{marketEntries.map(renderMarketCard)}</div> : null}
      {marketVisible && !marketBusy ? <div className="market-foot" role="status">{marketMore ? <span className="muted">正在加载更多…</span> : market.hasMore ? <span className="muted">继续向下滚动加载更多</span> : <span className="muted">已加载全部 {marketEntries.length} 个技能</span>}</div> : null}
      {marketEmpty ? <div className="empty"><strong>暂无技能</strong></div> : null}
    </> : <>
      {applicationError ? <p className="error" role="alert">{applicationError}<Button className="secondary" disabled={applicationBusy} onClick={() => void loadApplications({ keyword: query, status: applicationStatus })}>重试</Button></p> : null}
      {applicationMoreError ? <p className="error" role="alert">{applicationMoreError}<Button className="secondary" disabled={applicationMore} onClick={() => void loadMoreApplications()}>重试</Button></p> : null}
      {applicationBusy && !applications.items.length ? <div className="market-foot" role="status"><span className="muted">正在读取我的申请…</span></div> : null}
      {applicationVisible ? <div className="grid">{applications.items.map(renderApplicationCard)}</div> : null}
      {applicationVisible && !applicationBusy ? <div className="market-foot" role="status">{applicationMore ? <span className="muted">正在加载更多…</span> : applications.hasMore ? <span className="muted">继续向下滚动加载更多</span> : <span className="muted">已加载全部 {applications.total} 条申请</span>}</div> : null}
      {applicationEmpty ? <div className="empty"><strong>{applications.total ? '没有匹配的申请' : '还没有上架申请'}</strong><span className="muted">{applications.total ? '换个关键词或审批状态再试。' : '点「＋ 添加技能 → 技能上架申请」提交，审批通过后可在技能市场安装。'}</span></div> : null}
    </>}
    </div>
    </div>
    {/* 查询覆盖层罩住整个面板可视区，不随内容滚动，因此始终在可视区正中。 */}
    {overlayVisible ? <QueryOverlay /> : null}

    <Modal open={Boolean(marketEntry)} label={marketEntry ? `${marketEntry.title} 技能详情` : '技能详情'} className="skill-detail-dialog" onClose={() => { setMarketDetailId(undefined); setMarketDoc(undefined); setMarketDocError(''); }}>
      {marketEntry && <article data-testid="skill-market-detail"><div className="detail-hero"><SkillMark large name={marketEntry.slug} title={marketEntry.title} iconUrl={marketEntry.icon} /><div className="detail-title"><h1>{marketEntry.title}</h1><p className="slug">{marketEntry.slug}</p><div className="detail-actions">{isInstalled(marketEntry) ? <><Button className="installed-action" disabled>已安装</Button>{!marketEntry.authorized && marketEntry.applyStatus === 'pending' ? <Button className="try" disabled={ssoBusy} onClick={() => void openAuthSso('cancel', marketEntry)}>取消申请</Button> : null}{!marketEntry.authorized && marketEntry.applyStatus !== 'pending' ? <Button variant="primary" className="try" disabled={ssoBusy} onClick={() => void openAuthSso('apply', marketEntry)}>申请</Button> : null}{marketEntry.clientBuiltin !== true && <Button tone="danger" className="danger" onClick={() => void uninstallFromMarket(marketEntry)}>卸载</Button>}</> : marketEntry.authorized ? <Button variant="primary" className="try" disabled={Boolean(marketInstalling)} onClick={() => void installFromMarket(marketEntry)}>{marketInstalling === marketEntry.id ? '正在安装…' : marketFailures[marketEntry.id] ? '重试安装' : '安装'}</Button> : marketEntry.applyStatus === 'pending' ? <Button className="try" disabled={ssoBusy} onClick={() => void openAuthSso('cancel', marketEntry)}>取消申请</Button> : <Button variant="primary" className="try" disabled={ssoBusy} onClick={() => void openAuthSso('apply', marketEntry)}>申请</Button>}</div></div></div>
        <p className="detail-summary">{marketEntry.description}</p>
        {marketInstalling === marketEntry.id ? <div className="install-bar" role="progressbar" aria-label={`正在安装 ${marketEntry.title}`}><i className="install-bar-fill" /></div> : null}
        {marketFailures[marketEntry.id] && !isInstalled(marketEntry) && marketInstalling !== marketEntry.id ? <p className="error" role="alert">{marketFailures[marketEntry.id]}</p> : null}
        <h2 className="detail-section-title">{icon('library')}概述</h2>
        <div className="detail-body"><dl><dt>名称</dt><dd>{marketEntry.slug}</dd><dt>业务场景</dt><dd>{skillMarketSceneText(marketEntry, marketDict) || '未标注'}</dd><dt>版本</dt><dd>{marketEntry.version ?? '未标注'}</dd></dl></div>
        <h2 className="detail-section-title">{icon('library')}详细说明</h2>
        <div className="detail-body">
          {marketDocBusy ? <p className="muted" role="status">正在读取技能说明…</p> : null}
          {marketDocError ? <p className="error" role="alert">{marketDocError}</p> : null}
          {marketDoc ? <><dl><dt>说明文件</dt><dd>{marketDoc.fileName}{marketDoc.size ? `（${sizeOf(marketDoc.size)}）` : ''}</dd></dl>{marketDoc.text ? <pre className="skill-document">{marketDoc.text}</pre> : <p className="muted">该附件不是可直接展示的 SKILL.md，或解包失败；安装后可在「本地技能」详情中查看完整内容。</p>}</> : null}
        </div>
      </article>}
    </Modal>
    <Modal open={Boolean(selected)} label={selected ? `${selected.name} 技能详情` : '技能详情'} className="skill-detail-dialog" onClose={() => { setSelected(undefined); setEditing(false); setResource(undefined); }}>
      {selected && <article data-testid="skill-detail"><div className="detail-hero"><SkillMark large name={selected.name} title={titleOf(selected)} iconUrl={marketIconOf(selected)} /><div className="detail-title"><h1>{titleOf(selected)}</h1>{titleOf(selected) !== selected.name ? <p className="slug">{selected.name}</p> : null}<div className="detail-actions"><Button className="try" disabled={(selected.state !== 'enabled' && selected.state !== 'readonly') || selected.authState !== undefined || selected.integrityState !== undefined} onClick={() => void trial(selected.name)}>去试试</Button>{(selected.manageable || selected.directoryPath) && <Button disabled={!selected.directoryPath} onClick={() => void openDirectory(selected)}>打开文件夹</Button>}{selected.manageable && !clientBuiltinOf(selected) && <Button tone="danger" className="danger" onClick={() => void prepareUninstall(selected)}>卸载</Button>}</div></div><button className="switch" role="switch" disabled={!selected.manageable || selected.state === 'invalid' || clientBuiltinOf(selected)} aria-checked={clientBuiltinOf(selected) || selected.state === 'enabled'} onClick={() => void setEnabled(selected, selected.state !== 'enabled')} /></div>
        <p className="detail-summary">{selected.localizedDescription ?? selected.description}</p>
        {blockedReasonOf(selected) ? <p className="error" role="alert">{blockedReasonOf(selected)}</p> : null}
        {trialErrors[selected.name] ? <p className="error" role="alert">{trialErrors[selected.name]}</p> : null}
        <h2 className="detail-section-title">{icon('library')}概述</h2>
        <div className="detail-body">{resource ? <><div className="resource-editor-head"><Button onClick={() => setResource(undefined)}>返回概述</Button><strong>{resource.path}</strong></div><label className="editor-label" htmlFor="resource-document">资源文件</label><Textarea id="resource-document" className="skill-editor" value={resourceDocument} onChange={event => setResourceDocument(event.currentTarget.value)} spellCheck={false} /><div className="editor-actions"><Button onClick={() => { setResourceDocument(resource.document); setResource(undefined); }}>取消</Button><Button variant="primary" className="save" disabled={busy || (!resource.isNew && resourceDocument === resource.document)} onClick={() => void saveResource()}>保存资源</Button></div></> : editing ? <><label className="editor-label" htmlFor="skill-document">SKILL.md</label><Textarea id="skill-document" className="skill-editor" value={skillDocument} onChange={event => setSkillDocument(event.currentTarget.value)} spellCheck={false} /><div className="editor-actions"><Button onClick={() => { setSkillDocument(selected.document ?? ''); setEditing(false); }}>取消</Button><Button variant="primary" className="save" disabled={busy || skillDocument === selected.document} onClick={() => void save()}>保存并重新发现</Button></div></> : <><dl><dt>名称</dt><dd>{selected.name}</dd><dt>业务场景</dt><dd>{scenesOf(selected).join(' · ') || '未标注'}</dd><dt>状态</dt><dd>{selected.state === 'enabled' ? '已启用' : selected.state === 'disabled' ? '已停用' : selected.state === 'invalid' ? '需要修复' : '只读'}</dd><dt>调用方式</dt><dd><code className="command">/{selected.name}</code></dd></dl>{selected.diagnostics?.length ? <section className="validation-errors"><h3>校验问题</h3><ul>{selected.diagnostics.map(item => <li key={`${item.code}-${item.path ?? ''}`}>{item.message}</li>)}</ul><Button onClick={() => setEditing(true)}>修复 SKILL.md</Button></section> : null}{selected.manageable && <section className="resource-section"><h3>资源文件</h3>{selected.resources.length ? <div className="resource-list">{selected.resources.map(path => <Button key={path} onClick={() => void openResource(path)}>{path}</Button>)}</div> : <p className="muted">暂无附加资源</p>}<div className="new-resource"><Input aria-label="新资源路径" placeholder="例如 references/guide.md" value={newResourcePath} onChange={event => setNewResourcePath(event.currentTarget.value)} /><Button disabled={!newResourcePath.trim()} onClick={beginResource}>新建资源</Button></div></section>}<pre className="skill-document">{selected.document ?? selected.whenToUse ?? selected.description}</pre></>}{error && <p className="error" role="alert">{error}</p>}</div>
      </article>}
    </Modal>
    <Modal open={Boolean(applicationEntry)} label={applicationEntry ? `${applicationEntry.title} 上架申请` : '上架申请详情'} className="skill-detail-dialog" onClose={() => setApplicationId(undefined)}>
      {applicationEntry && <article data-testid="skill-listing-detail"><div className="detail-hero"><SkillMark large name={applicationEntry.slug} title={applicationEntry.title} iconUrl={applicationEntry.icon} /><div className="detail-title"><h1>{applicationEntry.title}</h1><p className="slug">{applicationEntry.slug}</p><div className="detail-actions"><span className={`status-badge ${statusToneOf(statusTextOf(applicationEntry))}`}>{statusTextOf(applicationEntry)}</span><Button tone="danger" className="danger withdraw" onClick={() => setNotice('撤销申请功能暂未开放。')}>撤销</Button></div></div></div>
        <p className="detail-summary">{applicationEntry.description}</p>
        <h2 className="detail-section-title">{icon('library')}申请信息</h2>
        <div className="detail-body"><dl><dt>名称</dt><dd>{applicationEntry.title}</dd><dt>英文名称</dt><dd>{applicationEntry.slug}</dd><dt>版本</dt><dd>{applicationEntry.version ?? '未标注'}</dd><dt>Skill 类型</dt><dd>{applicationEntry.skillTypeText ?? applicationEntry.skillType ?? '未标注'}</dd><dt>业务场景</dt><dd>{applicationEntry.sceneLabels.join(' · ') || '未标注'}</dd><dt>来源节点</dt><dd>{applicationEntry.sourceNodeText ?? applicationEntry.sourceNode ?? '未标注'}</dd><dt>自定义标签</dt><dd>{applicationEntry.tags.join(' · ') || '未标注'}</dd><dt>审批状态</dt><dd>{statusTextOf(applicationEntry)}</dd><dt>提交时间</dt><dd>{applicationEntry.createdAt ?? '未标注'}</dd><dt>上架原因</dt><dd>{applicationEntry.reason ?? '未填写'}</dd><dt>审批意见</dt><dd>{applicationEntry.comments ?? '暂无'}</dd><dt>附件</dt><dd>{applicationEntry.files.length ? applicationEntry.files.map(file => `${file.fileName}${file.size ? `（${sizeOf(file.size)}）` : ''}`).join('、') : '无'}</dd></dl></div>
      </article>}
    </Modal>
    <Modal open={Boolean(confirmUninstall)} label="确认卸载技能" className="confirm-dialog" onClose={() => setConfirmUninstall(undefined)}>{confirmUninstall && <div><h2>卸载 {confirmUninstall.skill.name}？</h2><p>技能将移入回收目录，并从所有任务的可调用技能中移除。</p>{confirmUninstall.impact.dependents.length ? <div className="dependency-impact"><strong>依赖影响</strong><ul>{confirmUninstall.impact.dependents.map(item => <li key={`${item.kind}-${item.id}`}>{item.label}{item.blocking ? '（需先解除）' : ''}</li>)}</ul></div> : <p className="dependency-clear">未发现依赖此技能的对象。</p>}<div className="confirm-actions"><Button onClick={() => setConfirmUninstall(undefined)}>取消</Button><Button tone="danger" className="danger solid" disabled={confirmUninstall.impact.dependents.some(item => item.blocking)} onClick={() => void uninstall()}>确认卸载</Button></div></div>}</Modal>
    <Modal open={confirmBatchUninstall} label="确认批量卸载技能" className="confirm-dialog" onClose={() => setConfirmBatchUninstall(false)}><div><h2>卸载所选 {selectedNames.length} 个技能？</h2><p>每个成功卸载的技能会分别进入可恢复目录；失败项会保留选择并显示原因。</p><div className="confirm-actions"><Button onClick={() => setConfirmBatchUninstall(false)}>取消</Button><Button tone="danger" className="danger solid" onClick={() => void runBatch('uninstall')}>确认卸载</Button></div></div></Modal>
    <Modal open={trashOpen} label="最近卸载的技能" className="trash-dialog" onClose={() => setTrashOpen(false)}><h2>最近卸载</h2>{trash.length ? <div className="trash-list">{trash.map(entry => <div key={entry.id}><div><strong>{entry.name}</strong><small>{new Date(entry.removedAt).toLocaleString()} · {entry.previousState === 'enabled' ? '原为启用' : '原为停用'}</small></div><Button disabled={busy} onClick={() => void restore(entry)}>恢复</Button></div>)}</div> : <p className="muted">没有可恢复的技能。</p>}{error && <p className="error" role="alert">{error}</p>}</Modal>
    <Modal open={Boolean(ssoPromptUrl)} label="后台未接入提醒" className="confirm-dialog" onClose={() => setSsoPromptUrl(undefined)}><div><h2>无法自动登录后台</h2><p>当前未接入业务后台或登录已失效。继续将打开后台管理系统登录页，请登录后重新发起上架申请。</p><div className="confirm-actions"><Button onClick={() => setSsoPromptUrl(undefined)}>取消</Button><Button variant="primary" onClick={() => { const url = ssoPromptUrl; setSsoPromptUrl(undefined); if (url) openAdminSso(url); }}>继续打开</Button></div></div></Modal>
    <SkillListingModal open={listingOpen} management={management} options={listingOptions} optionsError={listingOptionsError} onReloadOptions={() => void loadListingOptions()} onClose={() => setListingOpen(false)} onSubmitted={focusApplications} />
  </section>;
}
