import { Button, CardSkeleton, cardSkeletonCss, Icon, Input, Modal, QueryOverlay, queryOverlayCss, tongyunTagSingleCss } from 'workdsh-ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { ConnectorApplyStatus, MarketCategory, MarketIndexItem, MarketItem } from '../market.js';
import type { ConnectorInstallTask, ConnectorSummary } from '../shared.js';
import { MCP_AUTH_SSO, type ConnectorManagementClient } from './management.js';
import { connectorCss } from './styles.js';
import {
  appendMarketList, emptyMarketList, MARKET_FILL_MAX_PAGES, marketCategoryText, marketItemsByFilter, marketListQuery,
  needsFill, startMarketList, type MarketListFilter, type MarketListState,
} from './market-list.js';
import { APPLY_LABEL, LocalMcpCard, MarketMcpCard } from './components/McpCard.js';
import { BatchBar } from './components/BatchBar.js';
import { CategoryBar } from './components/CategoryBar.js';
import { LocalMcpDetailModal, MarketMcpDetailModal } from './components/McpDetailModal.js';
import { McpFormModal, blankDraft, draftFromConfig, type ConnectorDraft } from './components/McpFormModal.js';

type Injected = {
  toggleNavigation: () => void;
  management: ConnectorManagementClient;
  openCapability: (key: string) => void;
  hasCapability: (key: string) => boolean;
  /** 「去试试」：新建会话、预选该 MCP 并预填提示词（宿主侧实现，见 client.tsx）。 */
  startConnectorTrial: (connectorId: string, title: string) => Promise<void>;
};
type Props = PropsRuntime<'main'> & InjectFace<Injected>;

/** 滚动到距底部这么多像素时自动加载下一页。 */
const MARKET_SCROLL_THRESHOLD = 160;
/** 成功提示的自动消失时间：错误提示不做自动消失，避免用户还没看清就没了。 */
const NOTICE_DURATION_MS = 3_000;
/** 市场关键词防抖：关键词由服务端筛选，等输入停顿这么久再发请求，避免每敲一键打一次后台。 */
const MARKET_QUERY_DEBOUNCE_MS = 250;
/**
 * 本机安装任务的轮询间隔。依赖下载在 Host 侧后台执行，装多久由内网仓库和包体积决定，
 * 这里只负责定期取状态：装完刷新列表，失败把原因留在卡片上，不做时间上的失败判定。
 */
const MARKET_INSTALL_POLL_MS = 5_000;
const capabilityTabs = [['experts', '专家'], ['skills', '技能'], ['connectors', '连接器']] as const;
const capabilityKey: Record<string, string> = { experts: 'workdsh-experts', skills: 'workdsh-skills', connectors: 'workdsh-connectors' };
/** 是否内置筛选：与业务场景胶囊同款，单选，都不选即「全部」。 */
const BUILTIN_OPTIONS = ['内置', '非内置'] as const;
const BUILTIN_YES = BUILTIN_OPTIONS[0];
/** 安装状态是本机判定，只在客户端过滤；授权/申请状态交给服务端。 */
const INSTALL_OPTIONS = ['已安装', '未安装'] as const;
const AUTH_OPTIONS = ['已授权', '未授权'] as const;
const APPLY_OPTIONS: readonly { readonly label: string; readonly value: ConnectorApplyStatus }[] = [
  { label: '未申请', value: 'none' },
  { label: '申请中', value: 'pending' },
  { label: '已通过', value: 'approved' },
  { label: '未通过', value: 'rejected' },
];

/**
 * 打开后台管理系统：Desktop 的 window.open 由主进程转交系统浏览器，
 * Web 预览被拦截时退回当前页跳转。
 */
function openAdminSso(url: string): void {
  const popup = window.open(url, '_blank', 'noopener');
  if (!popup && !/Electron/iu.test(navigator.userAgent)) window.location.assign(url);
}

export function ConnectorsPanel({ toggleNavigation, management, openCapability, hasCapability, startConnectorTrial }: Props) {
  const [rows, setRows] = useState<readonly ConnectorSummary[]>([]);
  const [tab, setTab] = useState<'local' | 'market'>('local');
  /** 已选分类（多选，数组顺序即用户选择顺序）；空数组等价于「全部」。 */
  const [categories, setCategories] = useState<readonly string[]>([]);
  const [query, setQuery] = useState('');
  /** 是否内置（单选）；undefined 等价于「全部」。 */
  const [builtinFilter, setBuiltinFilter] = useState<boolean>();
  /** 安装状态在本机判定、客户端过滤；授权状态与申请状态下发给服务端。undefined 均等价于「全部」。 */
  const [installFilter, setInstallFilter] = useState<'installed' | 'uninstalled'>();
  const [authFilter, setAuthFilter] = useState<'Y' | 'N'>();
  const [applyFilter, setApplyFilter] = useState<ConnectorApplyStatus>();
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [batch, setBatch] = useState(false);
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [detailId, setDetailId] = useState<string>();
  const [marketDetailId, setMarketDetailId] = useState<string>();
  const [draft, setDraft] = useState<ConnectorDraft>();
  const [confirm, setConfirm] = useState<{ readonly row: ConnectorSummary; readonly mode: 'remove' | 'uninstall' }>();
  const [batchConfirm, setBatchConfirm] = useState(false);
  // 市场：可用性来自宿主绑定，不可用时整条链路（Tab、数据、安装）都不出现。
  const [marketOn, setMarketOn] = useState(false);
  /** 闸门是否生效；默认按开启处理，拉取成功后切换。关闸时后台 isAuthorized 一律按 Y。 */
  const [gateEnforced, setGateEnforced] = useState(true);
  const [marketDict, setMarketDict] = useState<readonly MarketCategory[]>([]);
  const [market, setMarket] = useState<MarketListState>(emptyMarketList);
  // 三种加载状态分开：首次/筛选重置（marketBusy）、滚动加载更多（marketMore）、失败（marketError / marketMoreError）。
  const [marketBusy, setMarketBusy] = useState(false);
  const [marketMore, setMarketMore] = useState(false);
  const [marketError, setMarketError] = useState('');
  const [marketMoreError, setMarketMoreError] = useState('');
  /** 市场条目的本机安装任务：驱动卡片/详情弹窗的安装中、失败与重试，由固定间隔轮询推进。 */
  const [installs, setInstalls] = useState<Record<string, ConnectorInstallTask>>({});
  /**
   * 同步安装（一次请求内完成）的失败原因，按条目 id 就地展示。
   * 授权刚通过但快照未同步、仓库不可达这类失败不产生后台任务，只靠列表上方的横幅很容易被忽略，
   * 因此与技能市场一致：把原因留在条目上，按钮变「重试安装」，用户点一下就是重试。
   */
  const [installFailures, setInstallFailures] = useState<Record<string, string>>({});
  /** 正在等待 market-install 首次响应的条目：任务态回来之前先让卡片进入安装中。 */
  const [installPending, setInstallPending] = useState<string>();
  /** 轮询读取的安装任务快照：轮询器读 ref，避免把 installs 放进依赖数组后每次状态更新都重置计时器。 */
  const installsRef = useRef<Record<string, ConnectorInstallTask>>({});
  /** 正在启停的本地实例 id：启停要拉起或断开 MCP 进程，同样需要逐行加载态。 */
  const [togglingId, setTogglingId] = useState<string>();
  /** 全量授权索引：本地实例按后台编号/市场标识匹配授权与申请状态。 */
  const [marketIndex, setMarketIndex] = useState<readonly MarketIndexItem[]>([]);
  /** 单点跳转请求占用：申请/取消申请期间禁用按钮。 */
  const [ssoBusy, setSsoBusy] = useState(false);
  /** 绑定不可用时待确认打开的单点地址，非空即弹出提醒。 */
  const [ssoPromptUrl, setSsoPromptUrl] = useState<string>();
  /** 市场条目卸载确认：先定位本机实例，再走市场卸载并上报。 */
  const [marketConfirm, setMarketConfirm] = useState<MarketItem>();
  /** 分类字典的同步快照：发请求时立即读取，避免等待 state 更新。 */
  const dictionaryRef = useRef<readonly MarketCategory[]>([]);
  /** 请求代号：筛选变化时递增，用于丢弃过期响应，避免旧结果覆盖新筛选。 */
  const generationRef = useRef(0);
  /** 关键词防抖计时器：市场关键词由服务端筛选，输入停顿后才发请求。 */
  const queryTimerRef = useRef<number>(undefined);
  /** 点过申请/取消申请后置位：用户从后台回到页面时消费一次，补拉一次市场列表。 */
  const pendingAuthRefresh = useRef(false);

  /** 本地实例分类：安装时落盘的市场分类名称（bizSceneList 文案），多个用「 · 」分隔；自建实例为空。 */
  const categoryOf = useCallback((row: ConnectorSummary) => (row.categories ?? []).join(' · '), []);
  const searchTextOf = (row: ConnectorSummary): string =>
    `${row.title} ${row.description} ${row.serverName} ${categoryOf(row)} ${row.toolNames.join(' ')}`;

  const marketCategories = useMemo(() => marketDict.map(item => item.text), [marketDict]);
  /**
   * 业务场景栏只展示后台字典项：字典是筛选的唯一口径（文案要映射回 value 才能下发 bizScene），
   * 不再追加本地实例里出现、但字典没有的分类，避免出现「选中了却筛不出来」的胶囊。
   */
  const options = marketCategories;
  /** 只保留当前页签仍存在的选中项：切页签或分类字典变化后，失效的选择自动丢弃。 */
  const activeCategories = useMemo(() => categories.filter(name => options.includes(name)), [categories, options]);
  /** 本地实例的 row 快照：安装判定要读最新列表，但不能把它放进回调依赖里反复重建请求。 */
  const rowsRef = useRef(rows);
  useEffect(() => { rowsRef.current = rows; }, [rows]);
  /** 已安装判定：本机实例的 originId（市场条目 id）或 serverName（市场 serviceId）。 */
  const isInstalled = useCallback((entry: MarketItem) => rowsRef.current.some(row =>
    row.originId === entry.originId || row.serverName === entry.originId || row.serverName === entry.serverName), []);
  const filter: MarketListFilter = useMemo(() => ({
    categories: activeCategories, keyword: query,
    builtin: builtinFilter, install: installFilter,
    ...(gateEnforced ? { auth: authFilter, apply: applyFilter } : {}),
  }), [activeCategories, query, builtinFilter, installFilter, authFilter, applyFilter, gateEnforced]);

  /** `silent`：后台重拉（如回到窗口），不切到骨架屏，避免列表闪一下。 */
  const refresh = useCallback(async (silent = false) => {
    if (!silent) setBusy(true);
    setError('');
    try {
      // 闸门开关可能刚在后台变更：列表与按钮按新状态渲染。
      try { setGateEnforced((await management.assetGateState()).enforced); } catch { /* 保持开启态 */ }
      setRows(await management.list());
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '读取连接器失败。');
      return false;
    } finally {
      if (!silent) setBusy(false);
    }
  }, [management]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  // 关闸后授权类筛选立即失效并清空已选值，避免继续用旧条件过滤服务端结果。
  useEffect(() => {
    if (gateEnforced) return;
    setAuthFilter(undefined);
    setApplyFilter(undefined);
  }, [gateEnforced]);
  // 成功提示 3 秒后自动消失；错误提示保持显示，直到下一次操作把它清掉。
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), NOTICE_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);
  // 面板卸载时取消还没发出的关键词请求。
  useEffect(() => () => window.clearTimeout(queryTimerRef.current), []);

  /**
   * 用户经常在外部改动 MCP 配置或安装目录：回到应用窗口时静默重拉本地列表，
   * 让「文件已被修改 / 已缺失」这类状态立即显示在卡片上。5 秒内的连续聚焦只刷新一次。
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

  /** 首屏与筛选变化：分类与关键词都交给服务端，一律从第 1 页重新取，并用新结果替换旧列表。 */
  const loadMarket = useCallback(async (next: MarketListFilter) => {
    const generation = ++generationRef.current;
    setMarketBusy(true);
    setMarketError('');
    setMarketMoreError('');
    // 重置会作废进行中的「加载更多」（它的 finally 因代号不匹配不会再清标志）。
    setMarketMore(false);
    try {
      // 分类字典是静态参考数据：首次取到后常驻，后续刷新与筛选不再重复请求。
      const dictionary = dictionaryRef.current.length ? dictionaryRef.current : await management.marketCategories();
      let listed = startMarketList(await management.marketList(marketListQuery(next, 1, dictionary)));
      // 是否内置与安装状态是客户端过滤：可见条目不足一页时继续向后取，避免结果只剩零星几条或空白。
      for (let fetched = 1; needsFill(listed.items, next, isInstalled) && listed.hasMore && fetched < MARKET_FILL_MAX_PAGES; fetched++) {
        if (generationRef.current !== generation) return;
        listed = appendMarketList(listed, await management.marketList(marketListQuery(next, listed.page + 1, dictionary)));
      }
      if (generationRef.current !== generation) return;
      if (!dictionaryRef.current.length) {
        dictionaryRef.current = dictionary;
        setMarketDict(dictionary);
      }
      setMarket(listed);
    } catch (cause) {
      if (generationRef.current !== generation) return;
      setMarketError(cause instanceof Error ? cause.message : '读取 MCP 市场失败。');
    } finally {
      if (generationRef.current === generation) setMarketBusy(false);
    }
  }, [management, isInstalled]);

  useEffect(() => {
    let active = true;
    void (async () => {
      let available = false;
      try {
        available = (await management.marketAvailable()).available;
      } catch {
        available = false;
      }
      if (!active) return;
      setMarketOn(available);
      if (available) await loadMarket({ categories: [], keyword: '' });
    })();
    return () => {
      active = false;
    };
  }, [management, loadMarket]);
  useEffect(() => {
    if (!marketOn && tab === 'market') setTab('local');
  }, [marketOn, tab]);

  /**
   * 切屏刷新：市场列表平时完全不做隐式轮询；只有用户点过申请/取消申请，
   * 从后台回到本页时才补拉一次，之后继续回到「不自动查询」。
   */
  /**
   * 全量授权索引：本地实例的授权/申请状态只能来自后台索引；
   * 取不到时保持为空，界面退回只显示本机闸门给出的 authState，不伪造授权状态。
   * `force` 为真时绕过宿主索引缓存（回跳、切回本地页签、手动刷新）。
   */
  const loadIndex = useCallback(async (force = false) => {
    if (!marketOn) { setMarketIndex([]); return; }
    try { setMarketIndex(await management.marketIndex(force)); }
    catch (cause) { console.error('[workdsh:connectors:market-index]', cause); setMarketIndex([]); }
  }, [management, marketOn]);
  useEffect(() => { void loadIndex(); }, [loadIndex]);

  useEffect(() => {
    // Electron 切回窗口通常只有 window focus，没有 visibilitychange，两个信号都听。
    const onReturn = (): void => {
      if (!pendingAuthRefresh.current) return;
      pendingAuthRefresh.current = false;
      // 回跳后不论页签都强制重取授权索引：本地卡片的申请状态只来自索引，且索引有 TTL。
      void loadIndex(true);
      void refresh(true);
      if (tab === 'market' && marketOn) void loadMarket(filter);
    };
    const onVisible = (): void => {
      if (document.visibilityState !== 'visible') return;
      onReturn();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onReturn);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onReturn);
    };
  }, [tab, marketOn, loadMarket, filter, loadIndex, refresh]);

  // 轮询器读 ref 里的最新任务快照：安装态自身的变化不该重置计时器。
  useEffect(() => {
    installsRef.current = installs;
  }, [installs]);

  /** 取仍在安装中的条目的任务状态：装完刷新本地列表与市场，失败把原因留在卡片上可重试。 */
  const pollInstalls = useCallback(async (originIds: readonly string[]) => {
    let finished = false;
    for (const originId of originIds) {
      let task: ConnectorInstallTask | null = null;
      try {
        task = await management.marketInstallStatus(originId);
      } catch {
        continue;
      }
      if (!task) continue;
      setInstalls(current => ({ ...current, [originId]: task }));
      if (task.state === 'ready') {
        finished = true;
        setNotice(`已从市场安装「${task.title}」。`);
        setMarketDetailId(undefined);
      } else if (task.state === 'failed') {
        setError(`${task.title} 安装失败：${task.message ?? '请重试。'}`);
      }
    }
    if (finished) {
      // 安装完成只同步本机实例；市场卡片由「已安装」推导就地变化，不重拉市场列表。
      await refresh();
      await loadIndex(true);
    }
  }, [management, refresh, loadIndex]);
  const pollRef = useRef(pollInstalls);
  useEffect(() => {
    pollRef.current = pollInstalls;
  }, [pollInstalls]);
  useEffect(() => {
    if (!marketOn) return;
    // 常驻的固定间隔轮询器：没有安装任务时什么都不做，避免按任务增删计时器。
    const timer = window.setInterval(() => {
      const pending = Object.values(installsRef.current).filter(task => task.state === 'installing').map(task => task.originId);
      if (pending.length) void pollRef.current(pending);
    }, MARKET_INSTALL_POLL_MS);
    return () => window.clearInterval(timer);
  }, [marketOn]);

  /** 市场条目上的安装态：等待首次响应或后台任务仍在安装都算「安装中」，失败则带上原因供重试。 */
  const installStateOf = (originId: string): { installing: boolean; failure?: string } => {
    const task = installs[originId];
    if (installPending === originId || task?.state === 'installing') return { installing: true };
    if (task?.state === 'failed') return { installing: false, failure: task.message ?? '安装失败，请重试。' };
    const failure = installFailures[originId];
    return failure === undefined ? { installing: false } : { installing: false, failure };
  };

  /** 清掉某条目留在界面上的安装态与失败原因（任务已是 ready，或条目被卸载）。 */
  const clearInstall = (originId: string) => {
    setInstalls(current => {
      if (!(originId in current)) return current;
      const next = { ...current };
      delete next[originId];
      return next;
    });
    setInstallFailures(current => {
      if (!(originId in current)) return current;
      const next = { ...current };
      delete next[originId];
      return next;
    });
  };

  // 加载更多：滚动接近底部时按当前筛选追加下一页；失败只影响加载更多，不清空已有列表。
  const loadMoreMarket = async () => {
    if (marketBusy || marketMore || !market.hasMore) return;
    const generation = generationRef.current;
    setMarketMore(true);
    setMarketMoreError('');
    try {
      let next = appendMarketList(market, await management.marketList(marketListQuery(filter, market.page + 1, dictionaryRef.current)));
      // 客户端过滤下追加一页仍不满一页时继续补拉，保持滚动加载的连贯。
      for (let fetched = 1; needsFill(next.items, filter, isInstalled) && next.hasMore && fetched < MARKET_FILL_MAX_PAGES; fetched++) {
        if (generationRef.current !== generation) return;
        next = appendMarketList(next, await management.marketList(marketListQuery(filter, next.page + 1, dictionaryRef.current)));
      }
      if (generationRef.current !== generation) return;
      setMarket(next);
    } catch (cause) {
      if (generationRef.current !== generation) return;
      setMarketMoreError(cause instanceof Error ? cause.message : '加载更多 MCP 失败。');
    } finally {
      if (generationRef.current === generation) setMarketMore(false);
    }
  };

  const handleRefresh = async () => {
    setNotice('');
    if (await refresh()) setNotice('已重新检测全部本地 MCP 的连接状态。');
  };
  const toggle = async (row: ConnectorSummary, enabled: boolean) => {
    setError('');
    setNotice('');
    // 启停会真正拉起或断开 MCP 进程：只标记这一行，卡片显示加载态，其余行保持可操作。
    setTogglingId(row.id);
    try {
      await management.setEnabled(row.id, enabled);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '连接器启停失败。');
    } finally {
      // 结束前保持加载态，避免开关先跳回旧状态再翻正。
      await refresh();
      setTogglingId(undefined);
    }
  };
  /**
   * 「去试试」：新建一个会话，把该 MCP 勾选进去，并预填一句提示词后打开。
   * 与技能试用同一交互（技能预填的是 `/技能名`，MCP 没有斜杠命令，因此预填自然语言）。
   */
  const trial = async (row: ConnectorSummary) => {
    setError('');
    setNotice('');
    try { await startConnectorTrial(row.id, row.title); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '打开试用会话失败，请重试。'); }
  };
  const edit = async (row: ConnectorSummary) => {
    setError('');
    setNotice('');
    setDetailId(undefined);
    try {
      setDraft(draftFromConfig(await management.config(row.id)));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法读取 MCP 配置。');
    }
  };
  const save = async () => {
    if (!draft) return;
    setBusy(true);
    setError('');
    const input = {
      title: draft.title,
      description: draft.description,
      serverName: draft.serverName,
      transport: draft.transport,
      ...(draft.transport === 'stdio'
        ? {
            command: draft.command,
            args: draft.argsText
              .split('\n')
              .map(value => value.trim())
              .filter(Boolean),
          }
        : {
            url: draft.url,
            ...(draft.authorizationToken.trim() ? { authorizationToken: draft.authorizationToken } : {}),
          }),
    };
    try {
      if (draft.id) await management.update(draft.id, input);
      else await management.create(input);
      const added = draft.id ? undefined : draft.title;
      setDraft(undefined);
      await refresh();
      setNotice(added ? `已添加「${added}」。` : '已保存并重新连接。');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存连接器失败。');
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!confirm) return;
    setBusy(true);
    setError('');
    setNotice('');
    const { row, mode } = confirm;
    try {
      // 卸载走市场接口：先移除本机实例，成功后再上报后台，避免上报成功但本机卸载失败。
      let reported = true;
      if (mode === 'uninstall') reported = (await management.marketUninstall({ originId: row.originId, id: row.id })).reported;
      else await management.remove(row.id);
      // 卸载后条目重新变成「未安装」：清掉遗留的安装态，避免卡片还显示上次的失败原因。
      if (row.originId) clearInstall(row.originId);
      setConfirm(undefined);
      setDetailId(undefined);
      setSelected(current => current.filter(value => value !== row.id));
      await refresh();
      if (mode === 'uninstall') await loadIndex(true);
      if (mode !== 'uninstall') setNotice(`已删除「${row.title}」。`);
      else if (reported) setNotice(`已卸载「${row.title}」并从本机移除。`);
      else setNotice(`已从本机移除「${row.title}」，但市场卸载上报失败，后台记录可能未同步。`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '删除连接器失败。');
      setBusy(false);
    }
  };
  const runBatchRemove = async () => {
    const targets = rows.filter(row => selected.includes(row.id));
    if (!targets.length) return;
    setBusy(true);
    setError('');
    setNotice('');
    const failed: string[] = [];
    for (const row of targets) {
      try {
        await management.remove(row.id);
      } catch (cause) {
        failed.push(`${row.title}（${cause instanceof Error ? cause.message : '删除失败'}）`);
      }
    }
    setBatch(false);
    setSelected([]);
    setBatchConfirm(false);
    await refresh();
    if (failed.length) setError(`${targets.length - failed.length} 项已删除，${failed.length} 项失败：${failed.join('；')}`);
    else setNotice(`已删除 ${targets.length} 个 MCP。`);
  };
  /**
   * 从市场安装。直接执行的条目一次请求就完成（建连后返回 ready）；
   * 需要从内网仓库下载依赖的条目立即返回 installing，之后由轮询推进——
   * 界面不会把一次可能几分钟的装包过程挂在单个请求上。
   */
  const installMarket = async (entry: MarketItem) => {
    setError('');
    setNotice('');
    setInstallPending(entry.originId);
    // 重试时就地清掉上一次的失败原因：成功与否都会在随后重新写入。
    setInstallFailures(current => {
      if (!(entry.originId in current)) return current;
      const next = { ...current };
      delete next[entry.originId];
      return next;
    });
    try {
      const result = await management.marketInstall(entry.originId);
      if (result.state === 'ready' || result.state === 'existing') {
        clearInstall(entry.originId);
        setNotice(result.state === 'existing'
          ? `本机已有「${result.title}」，已标记为「已安装」。`
          : `已从市场安装「${result.title}」。`);
        setMarketDetailId(undefined);
        // 只刷新本机列表：市场条目本身不变，「已安装」状态由本机实例推导，
        // 就地更新卡片即可，不整页重拉市场列表（避免列表闪空、丢失滚动位置）。
        await refresh();
        await loadIndex(true);
      } else {
        // 先落一个安装中态让卡片立刻有反馈；真实状态从下一次轮询开始覆盖它。
        setInstalls(current => ({
          ...current,
          [entry.originId]: {
            originId: entry.originId, serverName: entry.serverName, title: entry.title, state: 'installing',
            startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
          },
        }));
      }
    } catch (cause) {
      // 安装是「后台上报 + 本机建连」两段串联：超时或中断时本机可能已经装好，
      // 因此失败提示之外还要同步一次真实状态，避免界面显示"失败"但实例其实已存在。
      // 原因留在该条目上（卡片与详情弹窗都能就地重试），不再只挂列表上方的横幅。
      setInstallFailures(current => ({ ...current, [entry.originId]: cause instanceof Error ? cause.message : '从市场安装失败。' }));
      await refresh();
    } finally {
      setInstallPending(undefined);
    }
  };

  /** 市场页签的刷新入口：重取当前筛选的第一页，并绕过索引缓存。 */
  const handleMarketRefresh = async () => {
    setNotice('');
    await loadMarket(filter);
    await loadIndex(true);
    setNotice('已刷新 MCP 市场。');
  };
  /** 市场卡片上的卸载：按条目 id 定位本机实例，走市场卸载并在本机移除后上报。 */
  const removeMarketEntry = async () => {
    if (!marketConfirm) return;
    const entry = marketConfirm;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const { reported } = await management.marketUninstall({ originId: entry.originId });
      clearInstall(entry.originId);
      setMarketConfirm(undefined);
      setMarketDetailId(undefined);
      await refresh();
      await loadIndex(true);
      setNotice(reported
        ? `已卸载「${entry.title}」并从本机移除。`
        : `已从本机移除「${entry.title}」，但市场卸载上报失败，后台记录可能未同步。`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '卸载 MCP 失败。');
    } finally {
      setBusy(false);
    }
  };
  /**
   * 授权申请 / 取消申请：与技能资产走同一个后台菜单（同入口、同参数），差异只有 assetType=mcp。
   *
   * `assetId` 必须是连接器记录里那个后台编号（市场安装时写入的 installManifest.assetId）：
   * 后台按它定位待授权资产，用本地 id、serverName 或市场 serviceId 代替都会申请到错误的对象，
   * 因此取不到编号时直接给出说明，不发请求。
   */
  const openAuthSso = async (action: 'apply' | 'cancel', assetId: string | undefined) => {
    if (ssoBusy) return;
    if (!assetId) {
      setError('该 MCP 没有后台资产编号，无法发起授权申请；请从 MCP 市场重新安装后再试。');
      return;
    }
    setSsoBusy(true);
    setError('');
    setNotice('');
    try {
      const target = MCP_AUTH_SSO[action];
      if (!target.menuId) { setNotice('MCP 授权申请跳转地址待配置，请联系管理员。'); return; }
      const result = await management.marketSso(target.menuId, { ...target.bizParams, assetId });
      // 申请状态要等用户在后台操作完才变化：记一个标记，回到本页时补拉一次。
      pendingAuthRefresh.current = true;
      if (result.degraded) setSsoPromptUrl(result.url);
      else openAdminSso(result.url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '申请授权失败，请重试。');
    } finally {
      setSsoBusy(false);
    }
  };
  /** 本地实例对应的市场授权条目：后台编号优先，其次市场条目 id、serviceId。 */
  const marketRefOf = (row: ConnectorSummary): MarketIndexItem | undefined => {
    const assetId = row.installManifest?.assetId?.trim();
    if (assetId) {
      const byId = marketIndex.find(item => item.originId.trim() === assetId);
      if (byId) return byId;
    }
    const originId = row.originId?.trim();
    if (originId) {
      const byOrigin = marketIndex.find(item => item.originId === originId);
      if (byOrigin) return byOrigin;
    }
    return marketIndex.find(item => item.serverName === row.serverName || item.serverName === row.marketServiceId);
  };
  /** 本地实例的「是否内置」：索引里有就以索引为准，否则按「没有市场来源」判定。 */
  const builtinOf = (row: ConnectorSummary): boolean => marketRefOf(row)?.builtin ?? !row.originId;
  /**
   * 授权申请用的资产编号：只认后台资产编号。
   *
   * 优先取安装清单里市场安装写入的 `assetId`；旧记录可能只有来源 id（`originId`），
   * 再退回授权索引里的同一个值。本地 id、serverName、marketServiceId 都不是后台编号，
   * 一律不参与，避免把申请投到错误的资产上。
   */
  const authAssetIdOf = (row: ConnectorSummary): string | undefined =>
    row.installManifest?.assetId?.trim() || row.originId?.trim() || marketRefOf(row)?.originId?.trim() || undefined;
  const switchTab = (next: 'local' | 'market') => {
    setTab(next);
    setBatch(false);
    setSelected([]);
    // 提示属于上一个页签的操作结果，切页签时一并清掉，否则出错信息会跟到另一个页签上。
    setError('');
    setNotice('');
    window.clearTimeout(queryTimerRef.current);
    // 用户主动点页签：保留已选业务场景/内置/状态条件，按当前筛选重新取数。
    if (next === 'market' && marketOn) void loadMarket(filter);
    // 切回本地：强制重取授权索引并静默重拉本地实例，避免卡片仍显示回跳前的申请状态。
    if (next === 'local') { void refresh(true); void loadIndex(true); }
  };
  const changeCategory = (next: readonly string[]) => {
    setCategories(next);
    // 分类是明确的一次点击，立即取数；同时作废还在等待中的关键词请求，避免重复请求。
    window.clearTimeout(queryTimerRef.current);
    if (tab !== 'market' || !marketOn) return;
    void loadMarket({ ...filter, categories: next });
  };
  /** 是否内置是单选：胶囊栏只在「选中一个」与「全部」之间切换。 */
  const changeBuiltin = (next: readonly string[]) => {
    const value = next.length ? next[next.length - 1] === BUILTIN_YES : undefined;
    setBuiltinFilter(value);
    window.clearTimeout(queryTimerRef.current);
    if (tab !== 'market' || !marketOn) return;
    // 内置属性是客户端过滤：只有已加载数据不足一页时才需要重新取数。
    if (!needsFill(market.items, { ...filter, builtin: value }, isInstalled) || !market.hasMore) return;
    void loadMarket({ ...filter, builtin: value });
  };
  /** 安装状态：本机判定，只改客户端过滤条件；数据不足一页时补拉。 */
  const changeInstall = (next: readonly string[]) => {
    const label = next[next.length - 1];
    const value = next.length ? (label === INSTALL_OPTIONS[0] ? 'installed' as const : 'uninstalled' as const) : undefined;
    setInstallFilter(value);
    window.clearTimeout(queryTimerRef.current);
    if (tab !== 'market' || !marketOn) return;
    if (!needsFill(market.items, { ...filter, install: value }, isInstalled) || !market.hasMore) return;
    void loadMarket({ ...filter, install: value });
  };
  /** 授权状态是服务端条件：明确的一次点击，立即从第 1 页重新取数。 */
  const changeAuth = (next: readonly string[]) => {
    const label = next[next.length - 1];
    const value = next.length ? (label === AUTH_OPTIONS[0] ? 'Y' as const : 'N' as const) : undefined;
    setAuthFilter(value);
    window.clearTimeout(queryTimerRef.current);
    if (tab !== 'market' || !marketOn) return;
    void loadMarket({ ...filter, auth: value });
  };
  /** 申请状态是服务端条件：与授权状态同口径，点击即重新取数。 */
  const changeApply = (next: readonly string[]) => {
    const option = next.length ? APPLY_OPTIONS.find(item => item.label === next[next.length - 1]) : undefined;
    setApplyFilter(option?.value);
    window.clearTimeout(queryTimerRef.current);
    if (tab !== 'market' || !marketOn) return;
    void loadMarket({ ...filter, apply: option?.value });
  };
  const changeQuery = (next: string) => {
    setQuery(next);
    // 本地页签的关键词是即时本地过滤；市场页签的关键词交给服务端，等输入停顿后再发一次请求。
    if (tab !== 'market' || !marketOn) return;
    window.clearTimeout(queryTimerRef.current);
    queryTimerRef.current = window.setTimeout(() => {
      void loadMarket({ ...filter, keyword: next });
    }, MARKET_QUERY_DEBOUNCE_MS);
  };
  const toggleBatch = () => {
    setBatch(value => !value);
    setSelected([]);
  };
  const toggleSelected = (id: string) =>
    setSelected(current => (current.includes(id) ? current.filter(value => value !== id) : [...current, id]));

  const normalized = query.trim().toLowerCase();
  const matchText = (text: string) => !normalized || text.toLowerCase().includes(normalized);
  const visibleLocal = rows.filter(row =>
    (builtinFilter === undefined || builtinOf(row) === builtinFilter)
    && matchText(searchTextOf(row))
    && (!activeCategories.length || (row.categories ?? []).some(label => activeCategories.includes(label))));
  // 市场不做任何本地过滤，只有「是否内置 / 安装状态」是客户端条件（后台暂未支持 isNzzc 过滤）。
  // 展示数量一律取客户端二次过滤后的真实条数，后台 total 只用于分页判断。
  const marketVisibleItems = marketItemsByFilter(market.items, filter, isInstalled);
  const connected = rows.filter(row => row.enabled && row.state === 'ready').length;
  const detail = rows.find(row => row.id === detailId);
  const marketDetail = marketDetailId ? market.items.find(entry => entry.originId === marketDetailId) : undefined;
  const selectedTitles = rows.filter(row => selected.includes(row.id)).map(row => row.title);
  const searchPlaceholder = '请输入MCP名称搜索...';
  const empty = tab === 'local'
    ? !busy && !visibleLocal.length
    : !marketBusy && !marketError && !marketVisibleItems.length;
  /** 是否内置筛选只在后台真的下发了该属性时展示，避免一个永远筛不出结果的胶囊。 */
  const builtinFilterAvailable = tab === 'local' || market.items.some(item => item.builtin !== undefined);
  /** 当前页签的条目统计：与技能市场同款计数行，避免「已加载条数」被误当成总数。 */
  const counts = tab === 'local'
    ? `共 ${rows.length} 个已安装 MCP · 当前显示 ${visibleLocal.length} 个`
    : `共 ${market.total} 个 MCP · 当前显示 ${marketVisibleItems.length} 个`;
  const countsLine = <div className="muted counts" role="status" aria-live="polite">
    {tab === 'local' ? (busy ? '正在读取…' : counts) : (marketBusy ? '正在读取…' : counts)}
  </div>;
  /**
   * 首屏骨架：只有当前页签还没有任何数据且正在加载时才用；
   * 已有数据刷新时保留卡片，改用覆盖层，避免把正在看的内容换成占位卡。
   */
  const localSkeleton = tab === 'local' && busy && !rows.length;
  const marketSkeleton = tab === 'market' && marketBusy && !market.items.length;
  const skeletonVisible = localSkeleton || marketSkeleton;
  /** 覆盖层只统计当前页签的列表请求；骨架已表达加载态时不叠加。 */
  const overlayVisible = (tab === 'local' ? busy : marketBusy) && !skeletonVisible;

  return (
    <section
      className="wd-connectors"
      data-testid="workdsh-connectors"
      onScroll={event => {
        if (tab !== 'market' || !marketOn || marketBusy || marketMore || !market.hasMore) return;
        const node = event.currentTarget;
        if (node.scrollHeight - node.scrollTop - node.clientHeight < MARKET_SCROLL_THRESHOLD) void loadMoreMarket();
      }}
    >
      <style>{connectorCss + cardSkeletonCss + tongyunTagSingleCss + queryOverlayCss}</style>
      <header className="cap-header">
        <button type="button" className="nav-toggle" onClick={toggleNavigation} aria-label="切换导航">导航</button>
        {capabilityTabs.map(([key, label]) => {
          const active = key === 'connectors';
          const target = capabilityKey[key];
          const enabled = active || Boolean(target && hasCapability(target));
          return (
            <button
              key={key}
              type="button"
              className={`cap-tab ${active ? 'active' : ''}`}
              disabled={!enabled}
              aria-current={active ? 'page' : undefined}
              onClick={() => {
                if (!active && target) openCapability(target);
              }}
            >
              <Icon name={key} />
              {label}
            </button>
          );
        })}
        <div className="head-tools">
          <Input
            className="search"
            aria-label={searchPlaceholder}
            placeholder={searchPlaceholder}
            value={query}
            onChange={event => changeQuery(event.currentTarget.value)}
          />
          {/* 本地页签刷新本机连接状态；市场页签重取当前筛选的第一页，两个入口都保留。 */}
          {tab === 'local'
            ? <Button className="secondary" disabled={busy} onClick={() => void handleRefresh()}>刷新状态</Button>
            : <Button className="secondary" disabled={marketBusy} onClick={() => void handleMarketRefresh()}>刷新列表</Button>}
          {/* {tab === 'local' ? (
            <Button className={batch ? 'secondary active' : 'secondary'} onClick={toggleBatch}>{batch ? '退出批量' : '批量删除'}</Button>
          ) : null}
          <Button
            variant="primary"
            className="primary"
            onClick={() => {
              setDraft(blankDraft());
            }}
          >
            ＋ 添加 MCP
          </Button> */}
        </div>
      </header>

      <div className="section-head">
        <h1>MCP管理</h1>
      </div>

      <nav className="source-tabs" aria-label="MCP 来源">
        <button type="button" className={tab === 'local' ? 'active' : ''} aria-current={tab === 'local' ? 'page' : undefined} onClick={() => switchTab('local')}>
          本地MCP<i className="count" title="本机 MCP 数量">{rows.length}</i>
        </button>
        {marketOn ? (
          <button type="button" className={tab === 'market' ? 'active' : ''} aria-current={tab === 'market' ? 'page' : undefined} onClick={() => switchTab('market')}>
            MCP市场{/* 数量取后台返回的筛选后总数，首次加载完成前不显示 0 */}
            {marketBusy && !market.items.length ? null : <i className="count" title="MCP 总数">{market.total}</i>}
          </button>
        ) : null}
      </nav>

      {/* 筛选栏与技能市场一致：每个条件带前置说明，各自独立、可同时生效。 */}
      <div className="skill-filters">
        {builtinFilterAvailable ? (
          <div className="filter-group builtin-filter">
            <span className="filter-label">是否内置：</span>
            <CategoryBar
              categories={BUILTIN_OPTIONS}
              values={builtinFilter === undefined ? [] : [builtinFilter ? BUILTIN_YES : BUILTIN_OPTIONS[1]]}
              onChange={changeBuiltin}
            />
          </div>
        ) : null}
        {/* 三个状态条件只作用于市场；本地实例没有「安装状态」的概念，业务场景与内置条件仍然可用。 */}
        {tab === 'market' ? (
          <>
            <div className="filter-group">
              <span className="filter-label">安装状态：</span>
              <CategoryBar
                categories={INSTALL_OPTIONS}
                values={installFilter === undefined ? [] : [installFilter === 'installed' ? INSTALL_OPTIONS[0] : INSTALL_OPTIONS[1]]}
                onChange={changeInstall}
              />
            </div>
            {gateEnforced ? <>
              <div className="filter-group">
                <span className="filter-label">授权状态：</span>
                <CategoryBar
                  categories={AUTH_OPTIONS}
                  values={authFilter === undefined ? [] : [authFilter === 'Y' ? AUTH_OPTIONS[0] : AUTH_OPTIONS[1]]}
                  onChange={changeAuth}
                />
              </div>
              <div className="filter-group">
                <span className="filter-label">申请状态：</span>
                <CategoryBar
                  categories={APPLY_OPTIONS.map(item => item.label)}
                  values={applyFilter === undefined ? [] : [APPLY_LABEL[applyFilter]]}
                  onChange={changeApply}
                />
              </div>
            </> : null}
          </>
        ) : null}
        <div className="filter-group scenes-filter">
          <span className="filter-label">业务场景：</span>
          <CategoryBar categories={options} values={activeCategories} onChange={changeCategory} />
        </div>
      </div>
      {countsLine}

      {tab === 'local' && batch ? (
        <BatchBar count={selected.length} busy={busy} onDelete={() => setBatchConfirm(true)} onExit={toggleBatch} />
      ) : null}
      {error ? <p className="error" role="alert">{error}</p> : null}
      {notice ? <p className="notice" role="status">{notice}</p> : null}
      {tab === 'market' && marketError ? (
        <p className="error" role="alert">
          {marketError}
          <Button className="secondary" disabled={marketBusy} onClick={() => void loadMarket(filter)}>重试</Button>
        </p>
      ) : null}
      {tab === 'market' && marketMoreError ? (
        <p className="error" role="alert">
          {marketMoreError}
          <Button className="secondary" disabled={marketMore} onClick={() => void loadMoreMarket()}>重试</Button>
        </p>
      ) : null}

      <div className="panel-content">
        {tab === 'local' && visibleLocal.length ? (
          <div className="grid">
            {visibleLocal.map(row => (
              <LocalMcpCard
                key={row.id}
                row={row}
                category={categoryOf(row)}
                market={market.items}
                marketRef={marketRefOf(row)}
                busy={busy}
                toggling={togglingId === row.id}
                ssoBusy={ssoBusy}
                batchMode={batch}
                selected={selected.includes(row.id)}
                onOpen={setDetailId}
                onToggle={(target, enabled) => void toggle(target, enabled)}
                /* 危险按钮统一叫「卸载」：市场来源走市场卸载并上报，自建/内置只在本机移除。 */
                onUninstall={target => setConfirm({ row: target, mode: target.originId ? 'uninstall' : 'remove' })}
                onSelect={toggleSelected}
                onApply={target => void openAuthSso('apply', authAssetIdOf(target))}
                onCancelApply={target => void openAuthSso('cancel', authAssetIdOf(target))}
                builtin={builtinOf(row)}
                onTrial={target => void trial(target)}
              />
            ))}
          </div>
        ) : null}
        {localSkeleton ? (
          <div className="grid" role="status" aria-label="正在读取本地 MCP…"><CardSkeleton variant="tile" count={12} /></div>
        ) : null}
        {tab === 'market' && !marketError && marketVisibleItems.length ? (
          <div className="grid">
            {marketVisibleItems.map(entry => (
              <MarketMcpCard
                key={entry.originId}
                entry={entry}
                category={marketCategoryText(entry, marketDict)}
                installed={isInstalled(entry)}
                {...installStateOf(entry.originId)}
                busy={busy}
                ssoBusy={ssoBusy}
                gateEnforced={gateEnforced}
                onOpen={setMarketDetailId}
                onInstall={entry => void installMarket(entry)}
                onUninstall={entry => setMarketConfirm(entry)}
                onApply={entry => void openAuthSso('apply', entry.originId)}
                onCancelApply={entry => void openAuthSso('cancel', entry.originId)}
              />
            ))}
          </div>
        ) : null}
        {marketSkeleton ? (
          <div className="grid" role="status" aria-label="正在加载 MCP 市场…"><CardSkeleton variant="tile" count={12} /></div>
        ) : null}
        {tab === 'market' && !marketError && marketVisibleItems.length ? (
          <div className="market-foot" role="status">
            {marketMore
              ? <span className="muted">正在加载更多…</span>
              : market.hasMore
                ? <span className="muted">继续向下滚动加载更多</span>
                : <span className="muted">已加载全部 {marketVisibleItems.length} 个 MCP</span>}
          </div>
        ) : null}
        {empty ? (
          <div className="empty">
            <span className="empty-text">{query.trim() || activeCategories.length || builtinFilter !== undefined || installFilter !== undefined || authFilter !== undefined || applyFilter !== undefined
              ? '没有找到与查询条件匹配的连接器'
              : '暂无连接器数据'}</span>
          </div>
        ) : null}
        {overlayVisible ? <QueryOverlay /> : null}
      </div>

      <LocalMcpDetailModal
        row={detail}
        category={detail ? categoryOf(detail) : ''}
        market={market.items}
        busy={busy}
        toggling={Boolean(detail && togglingId === detail.id)}
        onClose={() => setDetailId(undefined)}
        onToggle={(target, enabled) => void toggle(target, enabled)}
        onRemove={target => setConfirm({ row: target, mode: 'remove' })}
        onUninstall={target => setConfirm({ row: target, mode: 'uninstall' })}
      />
      <MarketMcpDetailModal
        entry={marketDetail}
        category={marketDetail ? marketCategoryText(marketDetail, marketDict) : ''}
        installed={Boolean(marketDetail && isInstalled(marketDetail))}
        {...(marketDetail ? installStateOf(marketDetail.originId) : { installing: false })}
        busy={busy}
        onClose={() => setMarketDetailId(undefined)}
        onInstall={entry => void installMarket(entry)}
      />
      <McpFormModal
        draft={draft}
        busy={busy}
        onChange={setDraft}
        onClose={() => {
          setDraft(undefined);
        }}
        onSubmit={() => void save()}
      />
      <Modal
        open={Boolean(confirm)}
        label="卸载 MCP"
        className="connector-confirm-dialog"
        onClose={() => setConfirm(undefined)}
      >
        {confirm ? (
          <>
            <h2>{`卸载「${confirm.row.title}」？`}</h2>
            <p>{confirm.mode === 'uninstall'
              ? '卸载后立即断开该服务，并从本机移除这个市场实例及其全部工具。'
              : '该实例由本机添加，不在市场记录中：卸载后立即断开该服务，并从 AI 工具目录移除它的工具和资源。'}</p>
            <div className="form-actions">
              <Button className="secondary" onClick={() => setConfirm(undefined)}>取消</Button>
              <Button tone="danger" className="danger" disabled={busy} onClick={() => void remove()}>卸载</Button>
            </div>
          </>
        ) : null}
      </Modal>
      <Modal
        open={batchConfirm}
        label="批量删除 MCP"
        className="connector-confirm-dialog"
        onClose={() => setBatchConfirm(false)}
      >
        <h2>删除所选 {selected.length} 个 MCP？</h2>
        <p>将删除：{selectedTitles.join('、')}。删除后立即断开并移除全部工具。</p>
        <div className="form-actions">
          <Button className="secondary" onClick={() => setBatchConfirm(false)}>取消</Button>
          <Button tone="danger" className="danger" disabled={busy} onClick={() => void runBatchRemove()}>全部删除</Button>
        </div>
      </Modal>
      {/* 市场侧卸载：先在本机移除，成功后再上报后台，避免上报成功但本机卸载失败。 */}
      <Modal
        open={Boolean(marketConfirm)}
        label="卸载 MCP"
        className="connector-confirm-dialog"
        onClose={() => setMarketConfirm(undefined)}
      >
        {marketConfirm ? (
          <>
            <h2>卸载「{marketConfirm.title}」？</h2>
            <p>卸载后立即断开该服务，并从本机移除这个市场实例及其全部工具；市场记录随后同步上报。</p>
            <div className="form-actions">
              <Button className="secondary" onClick={() => setMarketConfirm(undefined)}>取消</Button>
              <Button tone="danger" className="danger" disabled={busy} onClick={() => void removeMarketEntry()}>卸载</Button>
            </div>
          </>
        ) : null}
      </Modal>
      {/* 后台绑定不可用时的降级确认：只拿到纯登录地址，需用户确认后再打开。 */}
      <Modal open={Boolean(ssoPromptUrl)} label="绑定后台管理系统" className="connector-confirm-dialog" onClose={() => setSsoPromptUrl(undefined)}>
        <h2>无法自动完成登录授权</h2>
        <p>当前环境没有绑定后台管理系统账号，打开后需要先登录，再手动完成申请。是否继续打开？</p>
        <div className="form-actions">
          <Button className="secondary" onClick={() => setSsoPromptUrl(undefined)}>取消</Button>
          <Button className="primary" onClick={() => { const url = ssoPromptUrl; setSsoPromptUrl(undefined); if (url) openAdminSso(url); }}>继续打开</Button>
        </div>
      </Modal>
    </section>
  );
}
