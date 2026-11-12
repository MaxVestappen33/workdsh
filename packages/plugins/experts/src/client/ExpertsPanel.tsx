import { Button, CardSkeleton, cardSkeletonCss, Input, QueryOverlay, queryOverlayCss } from 'workdsh-ui';
import * as React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
// The `main` slot PropsRuntime is augmented by the official layout client module;
// without this side-effect type import the slot name resolves to `never`.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client';
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import { Icon, Modal, type IconName } from 'workdsh-ui';
import type { ExpertAvailability, ExpertSummary } from '../shared.js';
import type { ExpertManagementClient } from './management.js';
import { ExpertDetailModal } from './ExpertDetailModal.js';
import { expertDraftId } from '../domain/navigation.js';
import { ExpertDraftEditor } from './ExpertDraftEditor.js';
import { ImportExpertModal } from './ImportExportModals.js';
import { RemoteExperts } from './RemoteExperts.js';
import { MyApplications } from './MyApplications.js';
import { expertsCss } from './styles.js';

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

function Avatar({ summary }: { summary: ExpertSummary }) {
  return <span className="avatar" aria-hidden>{summary.avatarRef?.startsWith('data:image/') ? <img src={summary.avatarRef} alt="" /> : summary.name.trim().charAt(0) || '专'}</span>;
}

export function ExpertsPanel({ toggleNavigation, management, openCapability, hasCapability, summon, createExpertTask, editExpertTask }: ExpertsPanelProps) {
  const [view, setView] = useState<View>(() => expertDraftId(window.location.search) || new URLSearchParams(window.location.search).get('expert-library') === 'mine' ? 'mine' : 'center');
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
  const [mineCount, setMineCount] = useState(0);
  /** 绑定不可用时待确认打开的单点地址，非空即弹出提醒。 */
  const [ssoPromptUrl, setSsoPromptUrl] = useState<string>();
  const [detailId, setDetailId] = useState<string>();
  /** Set when the detail was opened from the backend catalog: only 召唤 and 卸载 apply. */
  const [detailRemote, setDetailRemote] = useState<{ remoteKey: string; boundSessions: number }>();
  /** `expertId → remoteKey` for experts installed from the backend catalog. */
  const [installations, setInstallations] = useState<ReadonlyMap<string, string>>(new Map());
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

  const load = useCallback(async (cursor?: string) => {
    const sequence = ++loadSequence.current;
    const appending = cursor !== undefined;
    if (appending) setLoadingMore(true); else { setBusy(true); setNotice(undefined); }
    setError('');
    try {
      const base = buildQuery();
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

  const loadMineCount = useCallback(async () => {
    try { const [agent, team] = await Promise.all([management.list({ origin: 'personal', expertType: 'agent', limit: 1 }), management.list({ origin: 'personal', expertType: 'team', limit: 1 })]); setTypeCounts({ agent: agent.total, team: team.total }); setMineCount(agent.total + team.total); } catch { /* non-fatal badge */ }
  }, [management]);

  // The center view is backend-only, so the local catalog is fetched only for 「我的」.
  useEffect(() => {
    if (view !== 'mine') { setBusy(false); return; }
    void load();
  }, [load, view]);
  useEffect(() => { void loadMineCount(); }, [loadMineCount, items]);
  /** 上架入口：按当前类型跳转后台管理系统的申请页；绑定不可用时先提示再打开登录页。 */
  const openListingAdmin = useCallback(async () => {
    if (acting) return;
    setActing(true);
    setError('');
    try {
      const target = await management.adminSso(kind);
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
  }, [acting, kind, management]);
  const loadInstallations = useCallback(async () => {
    try {
      const rows = await management.installations();
      setInstallations(new Map(rows.map(row => [row.expertId, row.remoteKey])));
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
  /** 首屏骨架：只有「我的」列表还没有任何数据且正在加载时出现；已有数据刷新改用覆盖层。 */
  const skeletonVisible = busy && !items.length;
  const overlayVisible = busy && items.length > 0;

  /** 刷新按钮：只重取当前视图的数据源，避免一次点击同时打列表、计数与安装索引。 */
  const refresh = useCallback(() => {
    if (view === 'mine') { void load(); return; }
    // 中心页与「我的申请」都由 reloadKey 驱动。
    setRemoteReload(value => value + 1);
  }, [load, view]);
  /** 操作后的整体同步：安装/删除/启停可能改变我的作品数量与安装索引，需一并重取。 */
  const refreshAll = useCallback(() => {
    refresh();
    void loadMineCount();
    void loadInstallations();
  }, [refresh, loadMineCount, loadInstallations]);
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
  /** Hard-delete an expert installed from the backend catalog, then refresh the catalog. */
  const uninstallInstalled = async (remote: { remoteKey: string; boundSessions: number }) => {
    const warning = remote.boundSessions > 0
      ? `该专家已被 ${remote.boundSessions} 个会话使用，卸载后这些会话将无法继续使用。\n\n将删除本地专家及其全部文件，确定卸载吗？`
      : '将删除本地专家及其全部文件，确定卸载吗？';
    if (!window.confirm(warning)) return;
    setActing(true); setError('');
    try {
      await management.uninstallRemote(remote.remoteKey, management.newOperationId('uninstall'));
      setDetailId(undefined); setDetailRemote(undefined);
      refreshAll();
    } catch (cause) { setError(messageOf(cause)); }
    finally { setActing(false); }
  };
  const createExpert = async (type: 'agent' | 'team' = kind) => {
    setActing(true); setError('');
    try { await createExpertTask(type); } catch (cause) { setError(messageOf(cause)); } finally { setActing(false); }
  };
  /** Installed expert (opened from 「我的」): resolve its installation key, then hard delete. */
  const uninstallById = async (expertId: string) => {
    const remoteKey = installations.get(expertId);
    if (!remoteKey) { setError('未找到该专家的安装记录，请刷新后重试。'); return; }
    await uninstallInstalled({ remoteKey, boundSessions: 0 });
  };
  /** Self-made expert: hard delete records, members, bindings and preset files. */
  const deleteLocalById = async (expertId: string) => {
    if (!window.confirm('将删除该专家及其全部本地文件，删除后无法恢复。确定删除吗？')) return;
    setActing(true); setError('');
    try {
      await management.deleteExpert(expertId, management.newOperationId('delete'));
      setDetailId(undefined); setDetailRemote(undefined);
      setNotice({ kind: 'info', text: '已删除该专家及其本地文件。' });
      refreshAll();
    } catch (cause) { setError(messageOf(cause)); }
    finally { setActing(false); }
  };
  const setPreference = async (summary: ExpertSummary, pinned: boolean) => {
    setActionMenu(undefined);
    try { await management.setPreference(summary.id, pinned); refreshAll(); } catch (cause) { setError(messageOf(cause)); }
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
    <style>{expertsCss + cardSkeletonCss + queryOverlayCss}</style>
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
        placeholder={view === 'mine' ? `搜索我创建的${kind === 'team' ? '专家团' : '专家'}` : view === 'applications' ? '搜索我的上架申请' : `搜索${kindLabel}`}
        value={query}
        onChange={event => setQuery(event.currentTarget.value)} />
      <Button className="refresh" onClick={refresh} disabled={busy}>刷新</Button>
      {view !== 'applications' && <Button onClick={() => setImportOpen(true)}>导入</Button>}
      <Button variant="primary" className="mine-toggle" disabled={acting} onClick={() => void openListingAdmin()}>上架申请</Button>
      <Button className={`mine-toggle ${view === 'mine' ? 'active' : ''}`} aria-pressed={view === 'mine'}
        onClick={() => { setView('mine'); setQuery(''); }}>我的专家 {mineCount}</Button>
      <details className="create-menu"><summary className="create-expert">制作专家</summary><div role="menu">
        <button role="menuitem" disabled={acting} onClick={event => { event.currentTarget.closest('details')?.removeAttribute('open'); void createExpert('agent'); }}>创建专家</button>
        <button role="menuitem" disabled={acting} onClick={event => { event.currentTarget.closest('details')?.removeAttribute('open'); void createExpert('team'); }}>创建专家团</button>
      </div></details>
    </header>

    {view !== 'center' && <Button variant="ghost" size="sm" className="back-center" onClick={() => { setView('center'); setQuery(''); setStateFilter('all'); }}>‹ 全部专家</Button>}
    <div className="section-head">
      <nav className="work-types" aria-label={view === 'mine' ? '我的作品类型' : '专家中心类型'}>{([['agent', '专家'], ['team', '专家团']] as const).map(([type, label]) => <button key={type} className={kind === type ? 'active' : ''} aria-pressed={kind === type} onClick={() => { setKind(type); setQuery(''); }}>{label}{view === 'mine' && <span>{typeCounts[type]}</span>}</button>)}</nav>
    </div>

    {/* 中心页不提供来源筛选：后台目录是唯一来源；状态筛选只属于「我的」。 */}
    {view === 'mine' && <nav className="filter-tabs" aria-label="状态过滤">
      {([['all', '全部'], ['draft', '草稿'], ['published', '已发布'], ['disabled', '已停用'], ['archived', '已归档']] as const).map(([key, label]) =>
        <Button key={key} className={stateFilter === key ? 'active' : ''} aria-current={stateFilter === key ? 'page' : undefined}
          onClick={() => setStateFilter(key)}>{label}</Button>)}
    </nav>}

    {notice && <div className={`notice ${notice.kind}`} role="status"><div className="notice-body"><span>{notice.text}</span></div><Button onClick={() => setNotice(undefined)} aria-label="关闭提示">×</Button></div>}
    {/* 中心页只渲染后台目录：本地列表仅在「我的」出现，不存在两个数据源切换。 */}
    {view === 'center'
      ? <RemoteExperts management={management} kind={kind} keyword={debounced} onChanged={refreshAll} reloadKey={remoteReload}
        onOpenInstalled={(expertId, remote) => { setDetailId(expertId); setDetailRemote(remote); }} />
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
      ? <div className="empty">
          <strong>未查询到数据</strong>
          <div className="empty-actions">
            {debounced && <Button onClick={() => { setQuery(''); search.current?.focus(); }}>清除搜索</Button>}
            <Button variant="primary" className="create-expert" disabled={acting} onClick={() => void createExpert()}>创建{kindLabel}</Button>
            {view === 'mine' && <Button onClick={() => setView('center')}>浏览专家中心</Button>}
          </div>
        </div>
      : null}

    {visible.length
      ? <div className="grid">{visible.map(summary => {
          const readiness = READINESS[summary.readiness] ?? READINESS.unknown;
          const draft = isDraft(summary);
          const blocked = summary.authState !== undefined;
          const usable = summary.canUse && !blocked && !draft && summary.availability === 'enabled' && summary.readiness === 'ready';
          return <article className={`card ${draft ? 'draft' : ''} ${summary.availability !== 'enabled' || blocked ? 'unavailable' : ''} ${actionMenu === summary.id ? 'menu-open' : ''}`} key={summary.id}>
            <div className="card-top">
              <button className="card-open" aria-label={`查看专家 ${summary.name}`} onClick={() => setDetailId(summary.id)}>
                <Avatar summary={summary} />
                <span className="card-title"><strong title={summary.name}>{summary.name}</strong>
                  <span className="card-meta">{summary.profession || (summary.expertType === 'team' ? '专家团' : '专家')}{view === 'mine' && <span> · {stateLabel(summary)}</span>}</span></span>
              </button>
              {summary.canManage && <div className="card-actions">
                <Button variant="ghost" size="sm" className="more-button" aria-label={`管理专家 ${summary.name}`} aria-haspopup="menu" aria-expanded={actionMenu === summary.id}
                  onClick={() => setActionMenu(current => (current === summary.id ? undefined : summary.id))}>•••</Button>
                {actionMenu === summary.id && <div className="card-menu" role="menu">
                  {summary.installedFromCatalog ? <>
                    {/* 市场安装：只能召唤或卸载。 */}
                    <button role="menuitem" disabled={!usable || acting || summary.executionBlocked !== undefined}
                      title={summary.executionBlocked === 'approval-required' ? '需上架审核并安装后才能召唤' : undefined}
                      onClick={() => { setActionMenu(undefined); void runSummon(summary.id, summary.publishedRevisionRef?.revisionId, undefined); }}>召唤专家</button>
                    <button className="danger" role="menuitem" disabled={acting}
                      onClick={() => { setActionMenu(undefined); void uninstallById(summary.id); }}>卸载</button>
                  </> : <>
                    {draft
                      ? <button role="menuitem" onClick={() => { setActionMenu(undefined); void editInConversation(summary.id); }}>继续编辑</button>
                      : <button role="menuitem" disabled={!usable || acting || summary.executionBlocked !== undefined}
                          title={summary.executionBlocked === 'approval-required' ? '需上架审核并安装后才能召唤' : undefined}
                          onClick={() => { setActionMenu(undefined); void runSummon(summary.id, summary.publishedRevisionRef?.revisionId, undefined); }}>召唤专家</button>}
                    {summary.canEdit && !draft && <button role="menuitem" onClick={() => { setActionMenu(undefined); void editInConversation(summary.id); }}>编辑</button>}
                    <button role="menuitem" disabled={acting} onClick={() => { setActionMenu(undefined); void copyToMine(summary); }}>复制到我的专家</button>
                    <button role="menuitem" disabled={acting} onClick={() => { setActionMenu(undefined); void exportExpert(summary); }}>导出</button>
                    <button className="danger" role="menuitem" disabled={acting} onClick={() => { setActionMenu(undefined); void deleteLocalById(summary.id); }}>删除</button>
                  </>}
                </div>}
              </div>}
            </div>
            <p className="desc">{summary.description || <span className="muted">（暂无简介）</span>}</p>
            {summary.authState && summary.authReason ? <p className="auth-reason">{summary.authReason}</p> : null}
            <div className="domain-tags">{(summary.tags ?? []).slice(0, 3).map(tag => <span key={tag}>{tag}</span>)}</div>
            <div className="card-foot">
              <span className="badge">{summary.expertType === 'team' ? '专家团' : '专家'}</span>
              {!draft && <span className={`badge ${readiness.cls}`}>{readiness.label}</span>}
              {draft && <span className="badge">未发布</span>}
              {summary.executionBlocked === 'approval-required' && <span className="badge warn">需上架审核</span>}
              {summary.authState && <span className="badge warn">{summary.authState === 'revoked' ? '已失效' : '未授权'}</span>}
              {summary.origin === 'default' && <span className="badge">默认</span>}
              <button className={`pin ${summary.pinned ? 'on' : ''}`} role="switch" aria-checked={summary.pinned}
                aria-label={`${summary.pinned ? '取消置顶' : '置顶'}专家 ${summary.name}`}
                onClick={() => void setPreference(summary, !summary.pinned)}>★</button>
            </div>
          </article>;
        })}{view === 'mine' && <button className="card create-card" disabled={acting} onClick={() => void createExpert()}><span aria-hidden>＋</span>创建{kind === 'team' ? '专家团' : '专家'}</button>}</div>
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
          ? () => void uninstallInstalled(detailRemote)
          : installations.has(detailId) ? () => void uninstallById(detailId) : undefined}
        onSubmitListing={undefined}
        onDelete={installations.has(detailId) ? undefined : () => void deleteLocalById(detailId)}
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
  </section>;
}
