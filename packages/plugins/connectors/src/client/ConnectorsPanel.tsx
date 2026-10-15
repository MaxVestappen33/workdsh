import { Button, Icon, Input, Modal } from 'workdsh-ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { MarketCategory, MarketItem } from '../market.js';
import type { ConnectorSummary } from '../shared.js';
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

const ALL = '全部';
const CUSTOM = '自定义';
/** 滚动到距底部这么多像素时自动加载下一页。 */
const MARKET_SCROLL_THRESHOLD = 160;
const capabilityTabs = [['experts', '专家'], ['skills', '技能'], ['connectors', '连接器']] as const;
const capabilityKey: Record<string, string> = { experts: 'workdsh-experts', skills: 'workdsh-skills', connectors: 'workdsh-connectors' };

export function ConnectorsPanel({ toggleNavigation, management, openCapability, hasCapability }: Props) {
  const [rows, setRows] = useState<readonly ConnectorSummary[]>([]);
  const [tab, setTab] = useState<'local' | 'market'>('local');
  const [category, setCategory] = useState(ALL);
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
  /** 分类字典的同步快照：发请求时立即读取，避免等待 state 更新。 */
  const dictionaryRef = useRef<readonly MarketCategory[]>([]);
  /** 请求代号：筛选变化时递增，用于丢弃过期响应，避免旧结果覆盖新筛选。 */
  const generationRef = useRef(0);

  /** 市场分类代码 → 界面文案；字典缺失时退回代码本身。 */
  const categoryText = useCallback((code: string) => marketDict.find(item => item.value === code)?.text ?? code, [marketDict]);
  /** 本地实例分类来自条目（bizScene 的第一个值），自建实例没有分类代码，归入「自定义」。 */
  const categoryOf = useCallback((row: ConnectorSummary) => (row.category?.trim() ? categoryText(row.category.trim()) : CUSTOM), [categoryText]);
  const searchTextOf = (row: ConnectorSummary): string =>
    `${row.title} ${row.description} ${row.serverName} ${categoryOf(row)} ${row.toolNames.join(' ')}`;

  const localCategories = useMemo(() => {
    const used = new Set(rows.map(categoryOf));
    const list = marketDict.map(item => item.text).filter(text => used.has(text));
    if (rows.some(row => !row.originId)) list.push(CUSTOM);
    return list;
  }, [rows, categoryOf, marketDict]);
  const marketCategories = useMemo(() => marketDict.map(item => item.text), [marketDict]);
  const options = useMemo(() => (tab === 'local' ? localCategories : marketCategories), [tab, localCategories, marketCategories]);
  const activeCategory = options.includes(category) ? category : ALL;
  const filter: MarketListFilter = { category: activeCategory, keyword: query };

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
      if (available) await loadMarket({ category: ALL, keyword: '' });
    })();
    return () => {
      active = false;
    };
  }, [management, loadMarket]);
  useEffect(() => {
    if (!marketOn && tab === 'market') setTab('local');
  }, [marketOn, tab]);

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
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await management.setEnabled(row.id, enabled);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '连接器启停失败。');
      setBusy(false);
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
  const installMarket = async (entry: MarketItem) => {
    setBusy(true);
    setError('');
    setNotice('');
    setMarketDetailId(undefined);
    try {
      const installed = await management.marketInstall(entry.originId);
      setNotice(`已从市场安装「${installed.title}」。`);
      await refresh();
      if (marketOn) await loadMarket(filter);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '从市场安装失败。');
    } finally {
      setBusy(false);
    }
  };

  const switchTab = (next: 'local' | 'market') => {
    setTab(next);
    setQuery('');
    setCategory(ALL);
    setBatch(false);
    setSelected([]);
    // 进入市场：清空筛选后按服务端最新数据重新取第一页。
    if (next === 'market' && marketOn) void loadMarket({ category: ALL, keyword: '' });
  };
  const changeCategory = (next: string) => {
    if (next === category) return;
    setCategory(next);
    // 分类由服务端筛选：切换分类重置到第 1 页并重新拉取。
    if (tab !== 'market' || !marketOn) return;
    void loadMarket({ category: next, keyword: query });
  };
  const changeQuery = (next: string) => {
    setQuery(next);
    // 市场关键词同样由服务端筛选；本地 Tab 的关键词仍是即时本地过滤。
    if (tab !== 'market' || !marketOn) return;
    void loadMarket({ category: activeCategory, keyword: next });
  };
  const toggleBatch = () => {
    setBatch(value => !value);
    setSelected([]);
  };
  const toggleSelected = (id: string) =>
    setSelected(current => (current.includes(id) ? current.filter(value => value !== id) : [...current, id]));

  const normalized = query.trim().toLowerCase();
  const matchText = (text: string) => !normalized || text.toLowerCase().includes(normalized);
  const visibleLocal = rows.filter(row => matchText(searchTextOf(row)) && (activeCategory === ALL || categoryOf(row) === activeCategory));
  // 市场不做任何本地过滤：分类与关键词都由服务端筛选，界面只负责拼接分页结果。
  const total = tab === 'local' ? rows.length : market.total;
  // 已安装判定：本机实例的 originId（市场条目 id）或 serverName（市场 serviceId）。
  const localOrigins = new Set(rows.flatMap(row => [row.originId, row.serverName]).filter((value): value is string => Boolean(value)));
  const isInstalled = (entry: MarketItem) => localOrigins.has(entry.originId) || localOrigins.has(entry.serverName);
  const connected = rows.filter(row => row.enabled && row.state === 'ready').length;
  const detail = rows.find(row => row.id === detailId);
  const marketDetail = marketDetailId ? market.items.find(entry => entry.originId === marketDetailId) : undefined;
  const selectedTitles = rows.filter(row => selected.includes(row.id)).map(row => row.title);
  const searchPlaceholder = tab === 'local' ? '搜索连接器' : '搜索 MCP 市场';
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
          <Button className="secondary" disabled={busy} onClick={() => void handleRefresh()}>刷新状态</Button>
          {tab === 'local' ? (
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
          </Button>
        </div>
      </header>

      <div className="section-head">
        <h1>MCP 管理</h1>
        <span className="head-meta">{connected} 个已连接 · 本地共 {rows.length}</span>
      </div>

      <nav className="source-tabs" aria-label="MCP 来源">
        <button type="button" className={tab === 'local' ? 'active' : ''} aria-current={tab === 'local' ? 'page' : undefined} onClick={() => switchTab('local')}>
          我的本地 MCP <i className="count">{rows.length}</i>
        </button>
        {marketOn ? (
          <button type="button" className={tab === 'market' ? 'active' : ''} aria-current={tab === 'market' ? 'page' : undefined} onClick={() => switchTab('market')}>
            MCP 市场
          </button>
        ) : null}
      </nav>

      <CategoryBar categories={options} value={activeCategory} onChange={changeCategory} />

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
              category={marketCategoryText(entry.categories, marketDict)}
              installed={isInstalled(entry)}
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
        category={detail ? categoryOf(detail) : ALL}
        market={market.items}
        busy={busy}
        onClose={() => setDetailId(undefined)}
        onEdit={target => void edit(target)}
        onToggle={(target, enabled) => void toggle(target, enabled)}
        onRemove={target => setConfirm({ row: target, mode: 'remove' })}
        onUninstall={target => setConfirm({ row: target, mode: 'uninstall' })}
      />
      <MarketMcpDetailModal
        entry={marketDetail}
        category={marketDetail ? marketCategoryText(marketDetail.categories, marketDict) : ''}
        installed={Boolean(marketDetail && isInstalled(marketDetail))}
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
