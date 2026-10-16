import { Button, Input, Textarea } from 'workdsh-ui';
import { Icon, Modal, type IconName } from 'workdsh-ui';
import * as React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { SkillMarketAuthorized, SkillMarketItem, SkillScene } from '../market.js';
import type { ManagedSkillDetail, ManagedSkillResource, ManagedSkillSummary, SkillDependencyImpact, TrashedSkillSummary } from '../shared.js';
import type { SkillTaskKind } from './drafts.js';
import type { SkillManagementClient } from './management.js';
import { CategoryBar } from './components/CategoryBar.js';
import { ImportSkillModal } from './ImportSkillModal.js';
import { appendSkillMarketList, emptySkillMarketList, skillMarketQuery, skillMarketSceneText, startSkillMarketList, type SkillMarketFilter, type SkillMarketListState } from './market-list.js';
import { skillsActionsCss, skillsCss, skillsMarketCss } from './styles.js';

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

function icon(kind: string) { return <Icon name={kind as IconName} />; }
function messageOf(cause: unknown): string { return cause instanceof Error ? cause.message : '技能操作失败，请重试。'; }

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
  /** 页签：本地技能＝本机发现结果，技能市场＝后台已授权技能。 */
  const [tab, setTab] = useState<'local' | 'market'>('local');
  const [query, setQuery] = useState('');
  /** 已选业务场景（多选，数组顺序即用户选择顺序）；空数组等价于「全部」。 */
  const [scenes, setScenes] = useState<readonly string[]>([]);
  /** 授权技能索引：本地技能的业务场景标签只能来自后台，后台不可用时为空。 */
  const [authorized, setAuthorized] = useState<readonly SkillMarketAuthorized[]>([]);
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
  const [selected, setSelected] = useState<ManagedSkillDetail>();
  const [editing, setEditing] = useState(false);
  const [skillDocument, setSkillDocument] = useState('');
  const [resource, setResource] = useState<(ManagedSkillResource & { isNew?: boolean })>();
  const [resourceDocument, setResourceDocument] = useState('');
  const [newResourcePath, setNewResourcePath] = useState('');
  const [trash, setTrash] = useState<readonly TrashedSkillSummary[]>([]);
  const [trashOpen, setTrashOpen] = useState(false);
  const [confirmUninstall, setConfirmUninstall] = useState<{ skill: ManagedSkillSummary; impact: SkillDependencyImpact }>();
  const [creating, setCreating] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [actionMenu, setActionMenu] = useState<string>();
  const [batchMode, setBatchMode] = useState(false);
  const [selectedNames, setSelectedNames] = useState<readonly string[]>([]);
  const [confirmBatchUninstall, setConfirmBatchUninstall] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const addMenu = useRef<HTMLDivElement>(null);
  /** 分类字典的同步快照：发请求时立即读取，避免等待 state 更新。 */
  const dictionaryRef = useRef<readonly SkillScene[]>([]);
  /** 请求代号：筛选变化时递增，用于丢弃过期响应，避免旧结果覆盖新筛选。 */
  const generationRef = useRef(0);
  /** 关键词防抖计时器：市场关键词由服务端筛选，输入停顿后才发请求。 */
  const queryTimerRef = useRef<number>(undefined);

  const refresh = useCallback(async () => {
    setBusy(true); setError('');
    try { setSkills(await management.list()); }
    catch (cause) { console.error('[workdsh:skills:list]', cause); setError(messageOf(cause)); }
    finally { setBusy(false); }
  }, [management]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const revalidate = () => { if (document.visibilityState === 'visible') void refresh(); };
    window.addEventListener('focus', revalidate); document.addEventListener('visibilitychange', revalidate);
    return () => { window.removeEventListener('focus', revalidate); document.removeEventListener('visibilitychange', revalidate); };
  }, [refresh]);
  useEffect(() => {
    if (!addMenuOpen) return;
    const outside = (event: PointerEvent) => { if (!addMenu.current?.contains(event.target as Node)) setAddMenuOpen(false); };
    document.addEventListener('pointerdown', outside); return () => document.removeEventListener('pointerdown', outside);
  }, [addMenuOpen]);
  useEffect(() => {
    if (!actionMenu) return;
    const outside = (event: PointerEvent) => { if (!(event.target instanceof Element) || !event.target.closest('.card-actions')) setActionMenu(undefined); };
    document.addEventListener('pointerdown', outside); return () => document.removeEventListener('pointerdown', outside);
  }, [actionMenu]);
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
      const [dictionary, listed] = await Promise.all([
        management.marketCategories(),
        management.marketList(skillMarketQuery(next, 1, dictionaryRef.current)),
      ]);
      if (generationRef.current !== generation) return;
      dictionaryRef.current = dictionary;
      setMarketDict(dictionary);
      setMarket(startSkillMarketList(listed));
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
    if (!marketOn && tab === 'market') setTab('local');
  }, [marketOn, tab]);

  /** 授权技能索引：本地技能的业务场景标签来自它；失败时保持为空，本地技能就不显示标签。 */
  const loadAuthorized = useCallback(async () => {
    if (!marketOn) return;
    try { setAuthorized(await management.marketIndex()); }
    catch (cause) { console.error('[workdsh:skills:market-index]', cause); setAuthorized([]); }
  }, [management, marketOn]);
  useEffect(() => { void loadAuthorized(); }, [loadAuthorized]);

  /** 刷新：本地技能、授权索引与市场首页一起重新取一遍。 */
  const reloadAll = async () => {
    await refresh();
    await loadAuthorized();
    if (marketOn) await loadMarket(filter);
  };
  // 加载更多：滚动接近底部时按当前筛选追加下一页；失败只影响加载更多，不清空已有列表。
  const loadMoreMarket = async () => {
    if (marketBusy || marketMore || !market.hasMore) return;
    const generation = generationRef.current;
    setMarketMore(true);
    setMarketMoreError('');
    try {
      const listed = await management.marketList(skillMarketQuery(filter, market.page + 1, dictionaryRef.current));
      if (generationRef.current !== generation) return;
      setMarket(appendSkillMarketList(market, listed));
    } catch (cause) {
      if (generationRef.current !== generation) return;
      setMarketMoreError(messageOf(cause));
    } finally {
      if (generationRef.current === generation) setMarketMore(false);
    }
  };

  const openDetail = async (name: string) => {
    setActionMenu(undefined); setError('');
    try { const detail = await management.detail(name); setSelected(detail); setSkillDocument(detail.document ?? ''); setEditing(false); setResource(undefined); }
    catch (cause) { setError(messageOf(cause)); }
  };
  const beginSkillTask = async (kind: SkillTaskKind) => {
    setCreating(true); setAddMenuOpen(false); setError('');
    try { await startSkillTask(kind); }
    catch (cause) { setError(messageOf(cause)); setCreating(false); }
  };
  const trial = async (name: string) => { setCreating(true); try { await startSkillTrial(name); } catch (cause) { setError(messageOf(cause)); setCreating(false); } };
  const setEnabled = async (skill: ManagedSkillSummary, enabled: boolean) => {
    setActionMenu(undefined); setError('');
    try { await management.setEnabled(skill.name, enabled); await refresh(); if (selected?.name === skill.name) await openDetail(skill.name); }
    catch (cause) { setError(messageOf(cause)); }
  };
  const openDirectory = async (skill: ManagedSkillSummary) => {
    setActionMenu(undefined); setError('');
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
    setBusy(true); setError('');
    try { await management.uninstall(confirmUninstall.skill.name, confirmUninstall.impact.revision); if (selected?.name === confirmUninstall.skill.name) setSelected(undefined); setConfirmUninstall(undefined); await refresh(); }
    catch (cause) { setError(messageOf(cause)); setBusy(false); setConfirmUninstall(undefined); }
  };
  const prepareUninstall = async (skill: ManagedSkillSummary) => {
    setActionMenu(undefined); setError('');
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
  /**
   * 安装/卸载入口：本轮已接通「渲染层 → Connection 端点 → 市场服务 → 后台安装/卸载接口」，
   * 点击即把安装/卸载行为上报后台；本机落盘部分待下一轮接入，宿主会返回明确提示。
   */
  const marketAction = async (kind: 'install' | 'uninstall', id: string) => {
    setError(''); setNotice('');
    try {
      if (kind === 'install') await management.marketInstall(id);
      else await management.marketUninstall({ id });
    } catch (cause) { setNotice(messageOf(cause)); }
  };

  const switchTab = (next: 'local' | 'market') => {
    setTab(next);
    setQuery('');
    setScenes([]);
    setBatchMode(false);
    setSelectedNames([]);
    // 提示属于上一个页签的操作结果，切页签时一并清掉，否则出错信息会跟到另一个页签上。
    setError('');
    setNotice('');
    window.clearTimeout(queryTimerRef.current);
    // 进入市场：清空筛选后按服务端最新数据重新取第一页。
    if (next === 'market' && marketOn) void loadMarket({ scenes: [], keyword: '' });
  };
  const changeScene = (next: readonly string[]) => {
    setScenes(next);
    // 业务场景是明确的一次点击，立即取数；同时作废还在等待中的关键词请求，避免重复请求。
    window.clearTimeout(queryTimerRef.current);
    if (tab !== 'market' || !marketOn) return;
    void loadMarket({ scenes: next, keyword: query });
  };
  const changeQuery = (next: string) => {
    setQuery(next);
    // 本地页签的关键词是即时本地过滤；市场页签的关键词交给服务端，等输入停顿后再发一次请求。
    if (tab !== 'market' || !marketOn) return;
    window.clearTimeout(queryTimerRef.current);
    queryTimerRef.current = window.setTimeout(() => {
      void loadMarket({ scenes: activeScenes, keyword: next });
    }, MARKET_QUERY_DEBOUNCE_MS);
  };

  /** 授权技能索引：标识（skillNameEn）优先、名称（skillName）兜底，用于本地技能的业务场景匹配。 */
  const slugScenes = useMemo(() => new Map(authorized.map(row => [row.slug.trim().toLowerCase(), row.sceneLabels])), [authorized]);
  const titleScenes = useMemo(() => new Map(authorized.map(row => [row.title.trim().toLowerCase(), row.sceneLabels])), [authorized]);
  /** 本地技能的业务场景文案：匹配不到后台授权条目时为空，界面不显示占位。 */
  const scenesOf = (skill: ManagedSkillSummary): readonly string[] =>
    slugScenes.get(skill.name.trim().toLowerCase())
    ?? titleScenes.get((skill.title ?? '').trim().toLowerCase())
    ?? titleScenes.get(skill.name.trim().toLowerCase())
    ?? [];
  const localNames = useMemo(() => new Set(skills.map(skill => skill.name.trim().toLowerCase())), [skills]);
  /** 市场条目的「已安装」判定：本机存在同标识（skillNameEn）的技能。 */
  const isInstalled = (entry: SkillMarketItem) => localNames.has(entry.slug.trim().toLowerCase());

  const dictTexts = marketDict.map(item => item.text);
  /** 本地页签只提供本机技能真正用到的业务场景：字典顺序在前，字典里没有的按出现顺序追加。 */
  const localSceneNames = [...new Set(skills.flatMap(scenesOf))];
  const options = tab === 'local'
    ? [...dictTexts.filter(text => localSceneNames.includes(text)), ...localSceneNames.filter(text => !dictTexts.includes(text))]
    : dictTexts;
  /** 只保留当前页签仍存在的选中项：切页签或字典变化后，失效的选择自动丢弃。 */
  const activeScenes = scenes.filter(name => options.includes(name));
  const filter: SkillMarketFilter = { scenes: activeScenes, keyword: query };

  const normalizedQuery = query.trim().toLowerCase();
  const visibleLocal = skills.filter(skill => {
    const sceneLabels = scenesOf(skill);
    const text = `${skill.name} ${skill.title ?? ''} ${skill.localizedDescription ?? skill.description} ${skill.whenToUse ?? ''} ${sceneLabels.join(' ')}`;
    return text.toLowerCase().includes(normalizedQuery) && (!activeScenes.length || sceneLabels.some(label => activeScenes.includes(label)));
  });
  const marketEntry = marketDetailId ? market.items.find(entry => entry.id === marketDetailId) : undefined;
  const marketReady = !marketError && !marketBusy;
  const marketEmpty = tab === 'market' && marketReady && !market.items.length;
  const capabilityTabs = [['experts', '专家'], ['skills', '技能'], ['connectors', '连接器']] as const;
  const capabilityKey: Record<string, string> = { experts: 'workdsh-experts', skills: 'workdsh-skills', connectors: 'workdsh-connectors' };
  const counts = tab === 'local'
    ? `共 ${skills.length} 个已安装技能 · 当前显示 ${visibleLocal.length} 个`
    : `共 ${market.total} 个授权技能 · 当前显示 ${market.items.length} 个`;
  const countsLine = <div role="status" aria-live="polite" className={error ? 'error counts' : notice ? 'notice counts' : 'muted counts'}>{(tab === 'local' ? busy : marketBusy) ? '正在读取…' : error || notice || counts}</div>;
  const batchBar = <div className="batch-bar" role="toolbar" aria-label="批量管理技能"><span>已选择 {selectedNames.length} 项</span><Button disabled={!selectedNames.length || busy} onClick={() => void runBatch('enable')}>启用</Button><Button disabled={!selectedNames.length || busy} onClick={() => void runBatch('disable')}>停用</Button><Button tone="danger" className="danger" disabled={!selectedNames.length || busy} onClick={() => setConfirmBatchUninstall(true)}>卸载</Button></div>;
  const renderSkillCard = (skill: ManagedSkillSummary) => {
    const sceneText = scenesOf(skill).join(' · ');
    return <article className={`card ${skill.state === 'disabled' ? 'disabled' : skill.state === 'invalid' ? 'invalid' : ''} ${actionMenu === skill.name ? 'menu-open' : ''}`} key={skill.name}>
      <div className="card-top">{batchMode && skill.manageable ? <button className="batch-check" role="checkbox" aria-checked={selectedNames.includes(skill.name)} aria-label={`选择技能 ${skill.name}`} onClick={() => toggleBatchSelection(skill.name)}>{selectedNames.includes(skill.name) ? '✓' : ''}</button> : null}<button className="card-open" aria-label={`查看技能 ${skill.name}`} onClick={() => batchMode && skill.manageable ? toggleBatchSelection(skill.name) : void openDetail(skill.name)}><SkillMark name={skill.name} title={skill.title} iconUrl={skill.iconUrl} /><span className="card-title"><strong title={skill.name}>{skill.title ?? skill.name}</strong>{skill.title && skill.title !== skill.name ? <small className="slug">{skill.name}</small> : null}{sceneText ? <small className="tag" title={sceneText}>{sceneText}</small> : null}</span></button>
        {!batchMode && skill.manageable && <div className="card-actions"><Button variant="ghost" size="sm" className="more-button" aria-label={`管理技能 ${skill.name}`} aria-haspopup="menu" aria-expanded={actionMenu === skill.name} onClick={() => setActionMenu(current => current === skill.name ? undefined : skill.name)}>•••</Button>{actionMenu === skill.name && <div className="card-menu" role="menu"><button role="menuitem" disabled={skill.state !== 'enabled'} onClick={() => void trial(skill.name)}>去试试</button><button role="menuitem" onClick={() => void openDetail(skill.name)}>编辑</button><button role="menuitem" onClick={() => void openDirectory(skill)}>打开文件夹</button><button className="danger" role="menuitem" onClick={() => void prepareUninstall(skill)}>卸载</button></div>}</div>}
        {!batchMode && <button className="switch" role="switch" disabled={!skill.manageable || skill.state === 'invalid'} aria-checked={skill.state === 'enabled'} aria-label={`${skill.state === 'enabled' ? '停用' : '启用'}技能 ${skill.name}`} onClick={() => void setEnabled(skill, skill.state !== 'enabled')} />}
      </div><p className="muted">{skill.localizedDescription ?? skill.description}</p>{skill.state === 'invalid' && <small className="diagnostic">需要修复 · {skill.diagnostics?.[0]?.message}</small>}
    </article>;
  };
  const renderMarketCard = (entry: SkillMarketItem) => {
    const sceneText = skillMarketSceneText(entry, marketDict);
    return <article className="card market-card" key={entry.id}>
      <div className="card-top">
        <button className="card-open" aria-label={`查看技能 ${entry.title}`} onClick={() => { setError(''); setNotice(''); setMarketDetailId(entry.id); }}><SkillMark name={entry.slug} title={entry.title} iconUrl={entry.icon} /><span className="card-title"><strong title={entry.title}>{entry.title}</strong><small className="slug">{entry.slug}</small>{sceneText ? <small className="tag" title={sceneText}>{sceneText}</small> : null}</span></button>
        {isInstalled(entry) ? <span className="installed-pill">已安装</span> : <Button className="install" aria-label={`安装技能 ${entry.title}`} title="安装到本机：先上报后台，本机安装待下一轮接入" onClick={() => void marketAction('install', entry.id)}>＋</Button>}
      </div>
      <p className="muted">{entry.description}</p>
      {entry.version ? <small className="market-version">版本 {entry.version}</small> : null}
    </article>;
  };
  return <section className="wd-skills" data-testid="workdsh-skills" onScroll={event => {
    if (tab !== 'market' || !marketOn || marketBusy || marketMore || !market.hasMore) return;
    const node = event.currentTarget;
    if (node.scrollHeight - node.scrollTop - node.clientHeight < MARKET_SCROLL_THRESHOLD) void loadMoreMarket();
  }}>
    <style>{skillsCss + skillsActionsCss + skillsMarketCss}</style>
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
      <Input ref={search} className="search" aria-label="搜索技能" placeholder="搜索技能" value={query} onChange={event => changeQuery(event.currentTarget.value)} />
      <Button className={batchMode ? 'batch-toggle active' : 'batch-toggle'} onClick={toggleBatch}>{batchMode ? '退出批量' : '批量管理'}</Button>
      <Button className="trash-button" onClick={() => void openTrash()}>最近卸载</Button>
      <div className="add-menu-wrap" ref={addMenu}><Button variant="primary" className="add-skill" disabled={creating} aria-haspopup="menu" aria-expanded={addMenuOpen} onClick={() => setAddMenuOpen(open => !open)}>＋ 添加技能</Button>{addMenuOpen && <div className="add-menu" role="menu"><button role="menuitem" onClick={() => { setAddMenuOpen(false); setImportOpen(true); }}>上传技能</button><button role="menuitem" onClick={() => void beginSkillTask('create')}>创建技能</button></div>}</div>
    </header>
    <div className="section-head"><h1>技能管理</h1><Button className="refresh" onClick={() => void reloadAll()} disabled={busy}>刷新</Button></div>
    <nav className="source-tabs" aria-label="技能来源">
      <button className={tab === 'local' ? 'active' : ''} aria-current={tab === 'local' ? 'page' : undefined} onClick={() => switchTab('local')}>本地技能<i className="count" title="本机已安装技能数量">{skills.length}</i></button>
      {marketOn ? <button className={tab === 'market' ? 'active' : ''} aria-current={tab === 'market' ? 'page' : undefined} onClick={() => switchTab('market')}>技能市场{/* 数量恒取后台授权总数，首次加载完成前不显示 0 */}{marketBusy && !market.total ? null : <i className="count" title="后台已授权技能数量">{market.total}</i>}</button> : null}
    </nav>
    <CategoryBar categories={options} values={activeScenes} onChange={changeScene} />
    {tab === 'local' && batchMode ? batchBar : null}
    {countsLine}

    {tab === 'local' ? <>
      {!busy && !visibleLocal.length ? <div className="empty"><strong>{skills.length ? '没有匹配的技能' : '尚未发现已安装技能'}</strong><span className="muted">{skills.length ? '换个关键词，或点「全部」清空筛选。' : '点「＋ 添加技能」上传或创建技能。'}</span></div> : null}
      {visibleLocal.length ? <div className="grid">{visibleLocal.map(renderSkillCard)}</div> : null}
    </> : <>
      {marketBusy ? <div className="market-foot" role="status"><span className="muted">正在读取技能市场…</span></div> : null}
      {marketError ? <p className="error" role="alert">{marketError}<Button className="secondary" disabled={marketBusy} onClick={() => void loadMarket(filter)}>重试</Button></p> : null}
      {marketMoreError ? <p className="error" role="alert">{marketMoreError}<Button className="secondary" disabled={marketMore} onClick={() => void loadMoreMarket()}>重试</Button></p> : null}
      {marketReady && market.items.length ? <div className="grid">{market.items.map(renderMarketCard)}</div> : null}
      {marketReady && market.items.length ? <div className="market-foot" role="status">{marketMore ? <span className="muted">正在加载更多…</span> : market.hasMore ? <span className="muted">继续向下滚动加载更多</span> : <span className="muted">已加载全部 {market.total} 个技能</span>}</div> : null}
      {marketEmpty ? <div className="empty"><strong>{market.total ? '没有匹配的技能' : '市场暂无可用的技能'}</strong><span className="muted">{market.total ? '换个关键词，或点「全部」清空筛选。' : '可以稍后重试，或联系管理员确认技能授权情况。'}</span></div> : null}
    </>}

    <Modal open={Boolean(marketEntry)} label={marketEntry ? `${marketEntry.title} 技能详情` : '技能详情'} className="skill-detail-dialog" onClose={() => setMarketDetailId(undefined)}>
      {marketEntry && <article data-testid="skill-market-detail"><div className="detail-hero"><SkillMark large name={marketEntry.slug} title={marketEntry.title} iconUrl={marketEntry.icon} /><div className="detail-title"><h1>{marketEntry.title}</h1><p className="slug">{marketEntry.slug}</p><div className="detail-actions">{isInstalled(marketEntry) ? <><Button className="installed-action" disabled>已安装</Button><Button tone="danger" className="danger" onClick={() => void marketAction('uninstall', marketEntry.id)}>卸载</Button></> : <Button variant="primary" className="try" onClick={() => void marketAction('install', marketEntry.id)}>安装</Button>}</div></div></div>
        <p className="detail-summary">{marketEntry.description}</p><h2 className="detail-section-title">{icon('library')}概述</h2>
        <div className="detail-body"><dl><dt>名称</dt><dd>{marketEntry.slug}</dd><dt>业务场景</dt><dd>{skillMarketSceneText(marketEntry, marketDict) || '未标注'}</dd><dt>版本</dt><dd>{marketEntry.version ?? '未标注'}</dd></dl></div>
      </article>}
    </Modal>
    <Modal open={Boolean(selected)} label={selected ? `${selected.name} 技能详情` : '技能详情'} className="skill-detail-dialog" onClose={() => { setSelected(undefined); setEditing(false); setResource(undefined); }}>
      {selected && <article data-testid="skill-detail"><div className="detail-hero"><SkillMark large name={selected.name} title={selected.title} iconUrl={selected.iconUrl} /><div className="detail-title"><h1>{selected.title ?? selected.name}</h1>{selected.title && selected.title !== selected.name ? <p className="slug">{selected.name}</p> : null}<div className="detail-actions"><Button className="try" disabled={selected.state !== 'enabled'} onClick={() => void trial(selected.name)}>去试试</Button>{selected.manageable && <><Button onClick={() => setEditing(true)}>编辑</Button><Button onClick={() => void openDirectory(selected)}>打开文件夹</Button><Button tone="danger" className="danger" onClick={() => void prepareUninstall(selected)}>卸载</Button></>}</div></div><button className="switch" role="switch" disabled={!selected.manageable || selected.state === 'invalid'} aria-checked={selected.state === 'enabled'} onClick={() => void setEnabled(selected, selected.state !== 'enabled')} /></div>
        <p className="detail-summary">{selected.localizedDescription ?? selected.description}</p><h2 className="detail-section-title">{icon('library')}概述</h2>
        <div className="detail-body">{resource ? <><div className="resource-editor-head"><Button onClick={() => setResource(undefined)}>返回概述</Button><strong>{resource.path}</strong></div><label className="editor-label" htmlFor="resource-document">资源文件</label><Textarea id="resource-document" className="skill-editor" value={resourceDocument} onChange={event => setResourceDocument(event.currentTarget.value)} spellCheck={false} /><div className="editor-actions"><Button onClick={() => { setResourceDocument(resource.document); setResource(undefined); }}>取消</Button><Button variant="primary" className="save" disabled={busy || (!resource.isNew && resourceDocument === resource.document)} onClick={() => void saveResource()}>保存资源</Button></div></> : editing ? <><label className="editor-label" htmlFor="skill-document">SKILL.md</label><Textarea id="skill-document" className="skill-editor" value={skillDocument} onChange={event => setSkillDocument(event.currentTarget.value)} spellCheck={false} /><div className="editor-actions"><Button onClick={() => { setSkillDocument(selected.document ?? ''); setEditing(false); }}>取消</Button><Button variant="primary" className="save" disabled={busy || skillDocument === selected.document} onClick={() => void save()}>保存并重新发现</Button></div></> : <><dl><dt>名称</dt><dd>{selected.name}</dd><dt>业务场景</dt><dd>{scenesOf(selected).join(' · ') || '未标注'}</dd><dt>状态</dt><dd>{selected.state === 'enabled' ? '已启用' : selected.state === 'disabled' ? '已停用' : selected.state === 'invalid' ? '需要修复' : '只读'}</dd><dt>调用方式</dt><dd><code className="command">/{selected.name}</code></dd></dl>{selected.diagnostics?.length ? <section className="validation-errors"><h3>校验问题</h3><ul>{selected.diagnostics.map(item => <li key={`${item.code}-${item.path ?? ''}`}>{item.message}</li>)}</ul><Button onClick={() => setEditing(true)}>修复 SKILL.md</Button></section> : null}{selected.manageable && <section className="resource-section"><h3>资源文件</h3>{selected.resources.length ? <div className="resource-list">{selected.resources.map(path => <Button key={path} onClick={() => void openResource(path)}>{path}</Button>)}</div> : <p className="muted">暂无附加资源</p>}<div className="new-resource"><Input aria-label="新资源路径" placeholder="例如 references/guide.md" value={newResourcePath} onChange={event => setNewResourcePath(event.currentTarget.value)} /><Button disabled={!newResourcePath.trim()} onClick={beginResource}>新建资源</Button></div></section>}<pre className="skill-document">{selected.document ?? selected.whenToUse ?? selected.description}</pre></>}{error && <p className="error" role="alert">{error}</p>}</div>
      </article>}
    </Modal>
    <Modal open={Boolean(confirmUninstall)} label="确认卸载技能" className="confirm-dialog" onClose={() => setConfirmUninstall(undefined)}>{confirmUninstall && <div><h2>卸载 {confirmUninstall.skill.name}？</h2><p>技能将移入 WorkDSH 回收目录，并从所有任务的可调用技能中移除。</p>{confirmUninstall.impact.dependents.length ? <div className="dependency-impact"><strong>依赖影响</strong><ul>{confirmUninstall.impact.dependents.map(item => <li key={`${item.kind}-${item.id}`}>{item.label}{item.blocking ? '（需先解除）' : ''}</li>)}</ul></div> : <p className="dependency-clear">未发现 WorkDSH 对象依赖此技能。</p>}<div className="confirm-actions"><Button onClick={() => setConfirmUninstall(undefined)}>取消</Button><Button tone="danger" className="danger solid" disabled={confirmUninstall.impact.dependents.some(item => item.blocking)} onClick={() => void uninstall()}>确认卸载</Button></div></div>}</Modal>
    <Modal open={confirmBatchUninstall} label="确认批量卸载技能" className="confirm-dialog" onClose={() => setConfirmBatchUninstall(false)}><div><h2>卸载所选 {selectedNames.length} 个技能？</h2><p>每个成功卸载的技能会分别进入可恢复目录；失败项会保留选择并显示原因。</p><div className="confirm-actions"><Button onClick={() => setConfirmBatchUninstall(false)}>取消</Button><Button tone="danger" className="danger solid" onClick={() => void runBatch('uninstall')}>确认卸载</Button></div></div></Modal>
    <Modal open={trashOpen} label="最近卸载的技能" className="trash-dialog" onClose={() => setTrashOpen(false)}><h2>最近卸载</h2>{trash.length ? <div className="trash-list">{trash.map(entry => <div key={entry.id}><div><strong>{entry.name}</strong><small>{new Date(entry.removedAt).toLocaleString()} · {entry.previousState === 'enabled' ? '原为启用' : '原为停用'}</small></div><Button disabled={busy} onClick={() => void restore(entry)}>恢复</Button></div>)}</div> : <p className="muted">没有可恢复的技能。</p>}{error && <p className="error" role="alert">{error}</p>}</Modal>
    <ImportSkillModal open={importOpen} management={management} onClose={() => setImportOpen(false)} onInstalled={async name => { await refresh(); await openDetail(name); }} />
  </section>;
}
