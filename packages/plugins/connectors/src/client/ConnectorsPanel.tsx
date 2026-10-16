import { Button, Icon, Input, Modal } from 'workdsh-ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { MarketCategory, MarketItem } from '../market.js';
import type { ConnectorInstallTask, ConnectorSummary } from '../shared.js';
import type { ConnectorManagementClient } from './management.js';
import { connectorCss } from './styles.js';
import {
  appendMarketList, emptyMarketList, marketCategoryText, marketListQuery, startMarketList,
  type MarketListFilter, type MarketListState,
} from './market-list.js';
import { BatchBar } from './components/BatchBar.js';
import { CategoryBar } from './components/CategoryBar.js';
import { LocalMcpCard, MarketMcpCard } from './components/McpCard.js';
import { LocalMcpDetailModal, MarketMcpDetailModal } from './components/McpDetailModal.js';
import { McpFormModal, blankDraft, draftFromConfig, type ConnectorDraft } from './components/McpFormModal.js';

type Injected = {
  toggleNavigation: () => void;
  management: ConnectorManagementClient;
  openCapability: (key: string) => void;
  hasCapability: (key: string) => boolean;
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

export function ConnectorsPanel({ toggleNavigation, management, openCapability, hasCapability }: Props) {
  const [rows, setRows] = useState<readonly ConnectorSummary[]>([]);
  const [tab, setTab] = useState<'local' | 'market'>('local');
  /** 已选分类（多选，数组顺序即用户选择顺序）；空数组等价于「全部」。 */
  const [categories, setCategories] = useState<readonly string[]>([]);
  const [query, setQuery] = useState('');
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
  const [marketDict, setMarketDict] = useState<readonly MarketCategory[]>([]);
  const [market, setMarket] = useState<MarketListState>(emptyMarketList);
  // 三种加载状态分开：首次/筛选重置（marketBusy）、滚动加载更多（marketMore）、失败（marketError / marketMoreError）。
  const [marketBusy, setMarketBusy] = useState(false);
  const [marketMore, setMarketMore] = useState(false);
  const [marketError, setMarketError] = useState('');
  const [marketMoreError, setMarketMoreError] = useState('');
  /** 市场条目的本机安装任务：驱动卡片/详情弹窗的安装中、失败与重试，由固定间隔轮询推进。 */
  const [installs, setInstalls] = useState<Record<string, ConnectorInstallTask>>({});
  /** 正在等待 market-install 首次响应的条目：任务态回来之前先让卡片进入安装中。 */
  const [installPending, setInstallPending] = useState<string>();
  /** 轮询读取的安装任务快照：轮询器读 ref，避免把 installs 放进依赖数组后每次状态更新都重置计时器。 */
  const installsRef = useRef<Record<string, ConnectorInstallTask>>({});
  /** 正在启停的本地实例 id：启停要拉起或断开 MCP 进程，同样需要逐行加载态。 */
  const [togglingId, setTogglingId] = useState<string>();
  /** 分类字典的同步快照：发请求时立即读取，避免等待 state 更新。 */
  const dictionaryRef = useRef<readonly MarketCategory[]>([]);
  /** 请求代号：筛选变化时递增，用于丢弃过期响应，避免旧结果覆盖新筛选。 */
  const generationRef = useRef(0);
  /** 关键词防抖计时器：市场关键词由服务端筛选，输入停顿后才发请求。 */
  const queryTimerRef = useRef<number>(undefined);

  /** 本地实例分类：安装时落盘的市场分类名称（bizSceneList 文案），多个用「 · 」分隔；自建实例为空。 */
  const categoryOf = useCallback((row: ConnectorSummary) => (row.categories ?? []).join(' · '), []);
  const searchTextOf = (row: ConnectorSummary): string =>
    `${row.title} ${row.description} ${row.serverName} ${categoryOf(row)} ${row.toolNames.join(' ')}`;

  const marketCategories = useMemo(() => marketDict.map(item => item.text), [marketDict]);
  /**
   * 业务场景栏恒为字典全量：本地 MCP 页签同样完整展示所有业务场景，
   * 本机没有实例用到某个场景时也照样显示（点它落到空列表），不因为没有数据就只剩「全部」。
   * 字典里缺失、但本机实例实际带有的分类追加在后面，避免出现无法筛选的分类。
   */
  const options = useMemo(() => {
    const extra = [...new Set(rows.flatMap(row => row.categories ?? []))].filter(text => !marketCategories.includes(text));
    return [...marketCategories, ...extra];
  }, [rows, marketCategories]);
  /** 只保留当前页签仍存在的选中项：切页签或分类字典变化后，失效的选择自动丢弃。 */
  const activeCategories = useMemo(() => categories.filter(name => options.includes(name)), [categories, options]);
  const filter: MarketListFilter = { categories: activeCategories, keyword: query };

  const refresh = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      setRows(await management.list());
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '读取连接器失败。');
      return false;
    } finally {
      setBusy(false);
    }
  }, [management]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  // 成功提示 3 秒后自动消失；错误提示保持显示，直到下一次操作把它清掉。
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), NOTICE_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);
  // 面板卸载时取消还没发出的关键词请求。
  useEffect(() => () => window.clearTimeout(queryTimerRef.current), []);

  /** 首屏与筛选变化：分类与关键词都交给服务端，一律从第 1 页重新取，并用新结果替换旧列表。 */
  const loadMarket = useCallback(async (next: MarketListFilter) => {
    const generation = ++generationRef.current;
    setMarketBusy(true);
    setMarketError('');
    setMarketMoreError('');
    // 重置会作废进行中的「加载更多」（它的 finally 因代号不匹配不会再清标志）。
    setMarketMore(false);
    try {
      const [dictionary, listed] = await Promise.all([
        management.marketCategories(),
        management.marketList(marketListQuery(next, 1, dictionaryRef.current)),
      ]);
      if (generationRef.current !== generation) return;
      dictionaryRef.current = dictionary;
      setMarketDict(dictionary);
      setMarket(startMarketList(listed));
    } catch (cause) {
      if (generationRef.current !== generation) return;
      setMarketError(cause instanceof Error ? cause.message : '读取 MCP 市场失败。');
    } finally {
      if (generationRef.current === generation) setMarketBusy(false);
    }
  }, [management]);

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
      await refresh();
      if (marketOn) await loadMarket(filter);
    }
  }, [management, refresh, marketOn, loadMarket, filter]);
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
    return task?.state === 'failed' ? { installing: false, failure: task.message ?? '安装失败，请重试。' } : { installing: false };
  };

  /** 清掉某条目留在界面上的安装态（任务已是 ready，或条目被卸载）。 */
  const clearInstall = (originId: string) =>
    setInstalls(current => {
      if (!(originId in current)) return current;
      const next = { ...current };
      delete next[originId];
      return next;
    });

  // 加载更多：滚动接近底部时按当前筛选追加下一页；失败只影响加载更多，不清空已有列表。
  const loadMoreMarket = async () => {
    if (marketBusy || marketMore || !market.hasMore) return;
    const generation = generationRef.current;
    setMarketMore(true);
    setMarketMoreError('');
    try {
      const listed = await management.marketList(marketListQuery(filter, market.page + 1, dictionaryRef.current));
      if (generationRef.current !== generation) return;
      setMarket(appendMarketList(market, listed));
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
      // 卸载走市场接口：先向后台上报卸载，再由宿主移除本机实例。
      let reported = true;
      if (mode === 'uninstall') reported = (await management.marketUninstall({ originId: row.originId, id: row.id })).reported;
      else await management.remove(row.id);
      // 卸载后条目重新变成「未安装」：清掉遗留的安装态，避免卡片还显示上次的失败原因。
      if (row.originId) clearInstall(row.originId);
      setConfirm(undefined);
      setDetailId(undefined);
      setSelected(current => current.filter(value => value !== row.id));
      await refresh();
      if (mode === 'uninstall' && marketOn) await loadMarket(filter);
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
    try {
      const result = await management.marketInstall(entry.originId);
      if (result.state === 'ready') {
        clearInstall(entry.originId);
        setNotice(`已从市场安装「${result.title}」。`);
        setMarketDetailId(undefined);
        // 保持加载态直到状态同步完成，避免卡片先闪回加号再变成「已安装」。
        await refresh();
        if (marketOn) await loadMarket(filter);
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
      setError(cause instanceof Error ? cause.message : '从市场安装失败。');
      await refresh();
    } finally {
      setInstallPending(undefined);
    }
  };

  const switchTab = (next: 'local' | 'market') => {
    setTab(next);
    setQuery('');
    setCategories([]);
    setBatch(false);
    setSelected([]);
    // 提示属于上一个页签的操作结果，切页签时一并清掉，否则出错信息会跟到另一个页签上。
    setError('');
    setNotice('');
    window.clearTimeout(queryTimerRef.current);
    // 进入市场：清空筛选后按服务端最新数据重新取第一页。
    if (next === 'market' && marketOn) void loadMarket({ categories: [], keyword: '' });
  };
  const changeCategory = (next: readonly string[]) => {
    setCategories(next);
    // 分类是明确的一次点击，立即取数；同时作废还在等待中的关键词请求，避免重复请求。
    window.clearTimeout(queryTimerRef.current);
    if (tab !== 'market' || !marketOn) return;
    void loadMarket({ categories: next, keyword: query });
  };
  const changeQuery = (next: string) => {
    setQuery(next);
    // 本地页签的关键词是即时本地过滤；市场页签的关键词交给服务端，等输入停顿后再发一次请求。
    if (tab !== 'market' || !marketOn) return;
    window.clearTimeout(queryTimerRef.current);
    queryTimerRef.current = window.setTimeout(() => {
      void loadMarket({ categories: activeCategories, keyword: next });
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
    matchText(searchTextOf(row))
    && (!activeCategories.length || (row.categories ?? []).some(label => activeCategories.includes(label))));
  // 市场不做任何本地过滤：分类与关键词都由服务端筛选，界面只负责拼接分页结果。
  const total = tab === 'local' ? rows.length : market.total;
  // 已安装判定：本机实例的 originId（市场条目 id）或 serverName（市场 serviceId）。
  const localOrigins = new Set(rows.flatMap(row => [row.originId, row.serverName]).filter((value): value is string => Boolean(value)));
  const isInstalled = (entry: MarketItem) => localOrigins.has(entry.originId) || localOrigins.has(entry.serverName);
  const connected = rows.filter(row => row.enabled && row.state === 'ready').length;
  const detail = rows.find(row => row.id === detailId);
  const marketDetail = marketDetailId ? market.items.find(entry => entry.originId === marketDetailId) : undefined;
  const selectedTitles = rows.filter(row => selected.includes(row.id)).map(row => row.title);
  const searchPlaceholder = '请输入MCP名称搜索...';
  const empty = tab === 'local' ? !busy && !visibleLocal.length : !marketBusy && !marketError && !market.items.length;
  const marketReady = tab !== 'market' || (!marketError && !marketBusy);

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
      <style>{connectorCss}</style>
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
          {/* 刷新状态只作用于本机实例的连接检测，因此在市场页签下不出现。 */}
          {tab === 'local' ? <Button className="secondary" disabled={busy} onClick={() => void handleRefresh()}>刷新状态</Button> : null}
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
            MCP市场{/* 数量恒取市场总数，不随当前页签变化；首次加载完成前不显示 0，避免与「正在加载市场…」冲突 */}
            {marketBusy && !market.total ? null : <i className="count" title="市场上架 MCP 数量">{market.total}</i>}
          </button>
        ) : null}
      </nav>

      <CategoryBar categories={options} values={activeCategories} onChange={changeCategory} />

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

      {tab === 'local' && visibleLocal.length ? (
        <div className="grid">
          {visibleLocal.map(row => (
            <LocalMcpCard
              key={row.id}
              row={row}
              category={categoryOf(row)}
              market={market.items}
              busy={busy}
              toggling={togglingId === row.id}
              batchMode={batch}
              selected={selected.includes(row.id)}
              onOpen={setDetailId}
              onToggle={(target, enabled) => void toggle(target, enabled)}
              onRemove={target => setConfirm({ row: target, mode: 'remove' })}
              onSelect={toggleSelected}
            />
          ))}
        </div>
      ) : null}
      {tab === 'market' && marketBusy ? (
        <div className="market-foot" role="status"><span className="muted">正在加载市场…</span></div>
      ) : null}
      {tab === 'market' && marketReady && market.items.length ? (
        <div className="grid">
          {market.items.map(entry => (
            <MarketMcpCard
              key={entry.originId}
              entry={entry}
              category={marketCategoryText(entry, marketDict)}
              installed={isInstalled(entry)}
              {...installStateOf(entry.originId)}
              busy={busy}
              onOpen={setMarketDetailId}
              onInstall={entry => void installMarket(entry)}
            />
          ))}
        </div>
      ) : null}
      {tab === 'market' && marketReady && market.items.length ? (
        <div className="market-foot" role="status">
          {marketMore
            ? <span className="muted">正在加载更多…</span>
            : market.hasMore
              ? <span className="muted">继续向下滚动加载更多</span>
              : <span className="muted">已加载全部 {total} 个 MCP</span>}
        </div>
      ) : null}
      {empty ? (
        <div className="empty">
          <strong>{total ? '没有匹配的 MCP' : tab === 'local' ? '还没有本地 MCP' : '市场暂无可用的 MCP'}</strong>
          <span className="muted">
            {total
              ? '换个关键词，或点「全部」清空筛选。'
              : tab === 'local'
                ? '点「＋ 添加 MCP」创建本机实例，或到「MCP 市场」订阅后安装到本机。'
                : '可以稍后重试，或联系管理员确认市场上架情况。'}
          </span>
        </div>
      ) : null}

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
        label={confirm?.mode === 'uninstall' ? '卸载 MCP' : '删除 MCP'}
        className="connector-confirm-dialog"
        onClose={() => setConfirm(undefined)}
      >
        {confirm ? (
          <>
            <h2>{confirm.mode === 'uninstall' ? `卸载「${confirm.row.title}」？` : `删除「${confirm.row.title}」？`}</h2>
            <p>{confirm.mode === 'uninstall' ? '卸载后立即断开该服务，并从本机移除这个市场实例及其全部工具。' : '删除后会立即断开该服务，并从 AI 工具目录移除它的工具和资源。'}</p>
            <div className="form-actions">
              <Button className="secondary" onClick={() => setConfirm(undefined)}>取消</Button>
              <Button tone="danger" className="danger" disabled={busy} onClick={() => void remove()}>{confirm.mode === 'uninstall' ? '卸载' : '删除'}</Button>
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
    </section>
  );
}
