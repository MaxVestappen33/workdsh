import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as React from 'react';
import { applyStatusTone, Button, CardSkeleton, formatTagVersion, Modal, QueryOverlay, TongyunTagScrollRow, TongyunTagSingle } from 'workdsh-ui';
import type { ExpertDefinition, RemoteExpertApplyStatus, RemoteExpertScene, RemoteExpertSummary } from '../shared.js';
import type { ExpertManagementClient } from './management.js';
import { EXPERT_AUTH_SSO } from './management.js';
import { ExpertWorkSummary } from './ExpertWorkSummary.js';
import { CategoryBar } from './components/CategoryBar.js';
import {
  EXPERT_APPLY_LABEL, EXPERT_APPLY_OPTIONS, EXPERT_APPLY_VALUE, EXPERT_AUTH_OPTIONS, EXPERT_BUILTIN_OPTIONS,
  EXPERT_INSTALL_OPTIONS, appendExpertMarketList, emptyExpertMarketList, expertMarketQuery, marketItemsByInstall,
  needsInstallFill, startExpertMarketList, type ExpertMarketFilter, type ExpertMarketListState,
} from './market-list.js';

/**
 * Backend expert catalog with an explicit install action.
 *
 * Only rows the business backend lists (`status=3`) appear here. Nothing from this
 * list can be summoned until it is installed: install downloads the package,
 * verifies it, creates the local expert and publishes it. Uninstall is a hard
 * delete and therefore warns about Sessions already bound to the expert.
 */

interface RemoteExpertsProps {
  readonly management: ExpertManagementClient;
  readonly kind: 'agent' | 'team';
  readonly keyword: string;
  /** Refresh the local catalog/counts after install/uninstall. */
  readonly onChanged: () => void;
  /** Bumped by the panel's 刷新 button. */
  readonly reloadKey?: number;
  /** Installed rows open the full local detail page owned by the panel. */
  readonly onOpenInstalled?: (expertId: string, remote: { remoteKey: string; boundSessions: number }) => void;
  /** 后台目录总数：页签上的数量用它，首次加载完成前由面板保持未知。 */
  readonly onTotal?: (total: number) => void;
  /** 绑定不可用时交给面板统一弹窗提醒，再打开后台登录页。 */
  readonly onSsoPrompt?: (url: string) => void;
}

/** 安装状态是客户端过滤：一页被过滤空时继续向后取，最多补拉这么多页。 */
const FILL_MAX_PAGES = 10;
/** 骨架屏只在首屏没有数据时出现。 */
const SKELETON_COUNT = 12;

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : '操作失败，请重试。';
}

function codeOf(cause: unknown): string | undefined {
  return (cause as { code?: unknown } | undefined)?.code as string | undefined;
}

function RemoteAvatar({ item }: { item: RemoteExpertSummary }) {
  const [broken, setBroken] = useState(false);
  if (item.icon && !broken) {
    return <span className="detail-avatar has-image"><img src={item.icon} alt="" style={{ width: '100%', height: '100%', borderRadius: 'inherit', objectFit: 'cover' }} onError={() => setBroken(true)} /></span>;
  }
  return <span className="detail-avatar" style={item.color ? { background: item.color, color: '#fff' } : undefined} aria-hidden>{item.name.trim().charAt(0) || '专'}</span>;
}

/**
 * 市场条目的安装阻断原因：返回 undefined 表示可以安装/更新。
 *
 * 不具备安装条件的状态：未授权（需先申请）、后台未返回安装包、后台标记资产签名不可用。
 * 已安装且已是最新版、或正在安装中时不渲染安装入口，由按钮的出现条件处理。
 */
function installBlockedReason(item: RemoteExpertSummary): string | undefined {
  if (!item.authorized) return '尚未授权，请先申请';
  if (item.package === undefined) return '后台未返回安装包，暂不能安装';
  if (item.signatureState === 'unavailable') return item.signatureReason || '该条目资产签名不可用，暂不能安装';
  return undefined;
}

/** Read-only projection for a backend row that has no local expert yet. */
function workDefinition(item: RemoteExpertSummary): ExpertDefinition {
  return {
    name: item.name,
    description: item.description,
    role: item.capability ?? '',
    methodology: item.useCase ?? '',
    boundaries: '',
    deliverables: item.capability ?? '',
    tags: [...item.tags],
    examples: [],
    skillRequirements: [],
    futureRequirements: [],
  };
}

/** 打开后台管理系统：Desktop 的 window.open 由主进程转交系统浏览器。 */
function openAdminSso(url: string): void {
  const popup = window.open(url, '_blank', 'noopener');
  if (!popup && !/Electron/iu.test(navigator.userAgent)) window.location.assign(url);
}

export function RemoteExperts({ management, kind, keyword, onChanged, reloadKey = 0, onOpenInstalled, onTotal, onSsoPrompt }: RemoteExpertsProps) {
  const [state, setState] = useState<ExpertMarketListState>(emptyExpertMarketList);
  const [detail, setDetail] = useState<RemoteExpertSummary>();
  const [available, setAvailable] = useState(true);
  const [reason, setReason] = useState<string>();
  const [busy, setBusy] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [acting, setActing] = useState<string>();
  const [error, setError] = useState('');
  /** 安装失败按条目留存（对齐技能市场 marketFailures）：卡片底部就地展示，不占用列表计数行。 */
  const [installFailures, setInstallFailures] = useState<Record<string, string>>({});
  const [moreError, setMoreError] = useState('');
  const [notice, setNotice] = useState<string>();
  /** Scene options discovered from the loaded rows; they accumulate so a filter never loses tabs. */
  const [sceneOptions, setSceneOptions] = useState<readonly RemoteExpertScene[]>([]);
  const [scenes, setScenes] = useState<readonly string[]>([]);
  const [builtin, setBuiltin] = useState<boolean>();
  const [installFilter, setInstallFilter] = useState<'installed' | 'uninstalled'>();
  const [auth, setAuth] = useState<'Y' | 'N'>();
  const [apply, setApply] = useState<RemoteExpertApplyStatus>();
  /** 申请/取消申请跳转占用：与安装分开，避免互相禁用。 */
  const [ssoBusy, setSsoBusy] = useState(false);
  /** 卸载确认弹窗：与技能市场一致，先弹确认再执行，不再用原生 confirm。 */
  const [confirmUninstall, setConfirmUninstall] = useState<RemoteExpertSummary>();
  const sequence = useRef(0);
  const kindLabel = kind === 'team' ? '专家团' : '专家';
  /** 场景 options 的同步快照：发请求时立即读取，避免等待 state 更新。 */
  const optionsRef = useRef<readonly RemoteExpertScene[]>([]);
  const sentinel = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef<() => void>(() => {});
  /** 总数回调也放进 ref：父组件即使每次渲染都传新函数，也不会触发重复请求。 */
  const totalCallback = useRef(onTotal);
  totalCallback.current = onTotal;

  /** 筛选条件是请求依赖：用 useMemo 固定引用，否则每次渲染都会重新取数。 */
  const filter = useMemo<ExpertMarketFilter>(
    () => ({ scenes, keyword, builtin, install: installFilter, auth, apply }),
    [scenes, keyword, builtin, installFilter, auth, apply],
  );

  /** 合并新页里的业务场景选项：只增不减，筛选栏不会因为翻页而丢失选项。 */
  const mergeScenes = useCallback((items: readonly RemoteExpertSummary[]) => {
    const merged = new Map(optionsRef.current.map(scene => [scene.value, scene]));
    let changed = false;
    for (const item of items) {
      for (const scene of item.scenes) {
        if (merged.has(scene.value)) continue;
        merged.set(scene.value, scene);
        changed = true;
      }
    }
    if (!changed) return;
    optionsRef.current = [...merged.values()];
    setSceneOptions(optionsRef.current);
  }, []);

  /** 首屏与筛选变化：业务场景/内置/授权/申请状态都交给服务端，一律从第 1 页重新取。 */
  const load = useCallback(async () => {
    const generation = ++sequence.current;
    setBusy(true);
    setError('');
    setMoreError('');
    setLoadingMore(false);
    try {
      let result = await management.remoteList(expertMarketQuery(filter, 1, optionsRef.current, kind));
      if (generation !== sequence.current) return;
      mergeScenes(result.items);
      let listed = startExpertMarketList(result.items, result.total, result.pageNo);
      // 安装状态是客户端过滤：可见条目不足一页时继续向后取，避免一页被过滤空。
      for (let fetched = 1; needsInstallFill(listed.items, filter.install) && listed.hasMore && fetched < FILL_MAX_PAGES; fetched++) {
        if (generation !== sequence.current) return;
        result = await management.remoteList(expertMarketQuery(filter, listed.page + 1, optionsRef.current, kind));
        if (generation !== sequence.current) return;
        mergeScenes(result.items);
        listed = appendExpertMarketList(listed, result.items, result.total, result.pageNo);
      }
      if (generation !== sequence.current) return;
      setAvailable(result.available);
      setReason(result.reason);
      setState(listed);
      totalCallback.current?.(result.total);
    } catch (cause) {
      if (generation !== sequence.current) return;
      setAvailable(false);
      setReason(messageOf(cause));
      setError(messageOf(cause));
      setState(emptyExpertMarketList);
    } finally {
      if (generation === sequence.current) setBusy(false);
    }
  }, [management, filter, kind, mergeScenes]);

  useEffect(() => { void load(); }, [load, reloadKey]);

  /** 加载更多：滚动接近底部时按当前筛选追加下一页；失败只影响加载更多。 */
  const loadMore = useCallback(async () => {
    if (busy || loadingMore || !state.hasMore) return;
    const generation = sequence.current;
    setLoadingMore(true);
    setMoreError('');
    try {
      let result = await management.remoteList(expertMarketQuery(filter, state.page + 1, optionsRef.current, kind));
      if (generation !== sequence.current) return;
      mergeScenes(result.items);
      let next = appendExpertMarketList(state, result.items, result.total, result.pageNo);
      for (let fetched = 1; needsInstallFill(next.items, filter.install) && next.hasMore && fetched < FILL_MAX_PAGES; fetched++) {
        if (generation !== sequence.current) return;
        result = await management.remoteList(expertMarketQuery(filter, next.page + 1, optionsRef.current, kind));
        if (generation !== sequence.current) return;
        mergeScenes(result.items);
        next = appendExpertMarketList(next, result.items, result.total, result.pageNo);
      }
      if (generation !== sequence.current) return;
      setState(next);
    } catch (cause) {
      if (generation !== sequence.current) return;
      setMoreError(messageOf(cause));
    } finally {
      if (generation === sequence.current) setLoadingMore(false);
    }
  }, [busy, loadingMore, state, filter, management, mergeScenes, kind]);
  loadMoreRef.current = () => { void loadMore(); };

  // 滚动加载：底部哨兵进入可视区附近就取下一页；容器由面板滚动，浏览器会正确裁剪可视区域。
  useEffect(() => {
    const node = sentinel.current;
    if (!node || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) loadMoreRef.current();
    }, { rootMargin: '240px 0px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const install = async (item: RemoteExpertSummary) => {
    setActing(item.remoteId); setError(''); setNotice(undefined);
    // 清除该条上一次的失败：再次点击安装即重试，不在列表级留错误。
    setInstallFailures(current => {
      if (!(item.remoteId in current)) return current;
      const next = { ...current }; delete next[item.remoteId]; return next;
    });
    try {
      const receipt = await management.installRemote(
        { expertType: item.expertType, remoteId: item.remoteId, version: item.version },
        management.newOperationId('install'),
      );
      if (receipt.published) setNotice(`已安装「${item.name}」，现在可以召唤使用。`);
      else {
        const detailText = receipt.issues.map(issue => issue.message).slice(0, 2).join('；');
        setNotice(`已安装「${item.name}」，但缺少依赖，暂不能召唤。${detailText ? `（${detailText}）` : ''}`);
      }
      await load();
      onChanged();
    } catch (cause) {
      const code = codeOf(cause);
      setInstallFailures(current => ({
        ...current,
        [item.remoteId]: code === 'experts/install-package-missing'
          ? `「${item.name}」暂不能安装：${messageOf(cause)}`
          : messageOf(cause),
      }));
    } finally { setActing(undefined); }
  };

  /** 点「卸载」先打开确认弹窗（对齐技能市场的二次确认）。 */
  const uninstall = (item: RemoteExpertSummary) => {
    if (!item.installed) return;
    setConfirmUninstall(item);
  };

  /** 弹窗确认后的真实卸载：按钮进入「卸载中…」，完成后刷新列表并回传父组件。 */
  const runUninstall = async (item: RemoteExpertSummary) => {
    setActing(item.remoteId); setError(''); setNotice(undefined);
    try {
      const receipt = await management.uninstallRemote(`${item.expertType}-${item.remoteId}`, management.newOperationId('uninstall'));
      setNotice(`已卸载「${item.name}」，删除 ${receipt.deletedExpertIds.length} 条本地专家记录${receipt.boundSessions > 0 ? `（影响 ${receipt.boundSessions} 个会话）` : ''}。`);
      setConfirmUninstall(undefined);
      setDetail(undefined);
      await load();
      onChanged();
    } catch (cause) {
      setError(messageOf(cause));
    } finally { setActing(undefined); }
  };

  /** 点过申请/取消申请后置位：用户从后台回到本页时消费一次，强制重拉市场列表。 */
  const pendingAuthRefresh = useRef(false);
  /**
   * 授权申请 / 取消申请：沿用技能市场的单点登录方式。
   * assetType 按专家类型注入（agent → expert、team → expert_group），assetId 取后台主键。
   */
  const openAuth = async (action: 'apply' | 'cancel', assetId: string) => {
    if (ssoBusy) return;
    setSsoBusy(true); setError(''); setNotice(undefined);
    try {
      const target = EXPERT_AUTH_SSO[action];
      const result = await management.adminSsoFor(EXPERT_AUTH_SSO.menuId, {
        ...target,
        assetType: kind === 'team' ? 'expert_group' : 'expert',
        assetId,
      });
      // 申请状态要等用户在后台操作完才变化：记一个标记，回到本页时强制重拉市场列表。
      pendingAuthRefresh.current = true;
      if (result.degraded && onSsoPrompt) onSsoPrompt(result.url);
      else openAdminSso(result.url);
    } catch (cause) { setError(messageOf(cause)); }
    finally { setSsoBusy(false); }
  };

  /**
   * 回跳刷新：市场卡片的申请状态只来自后台列表，宿主没有索引缓存需要绕过，
   * 但此前这条路径完全没触发重拉，导致返回后仍显示「申请」。
   * Electron 切回窗口通常只有 window focus，没有 visibilitychange，两个信号都听。
   */
  useEffect(() => {
    const onReturn = () => {
      if (!pendingAuthRefresh.current) return;
      pendingAuthRefresh.current = false;
      void load();
    };
    const onVisible = () => { if (document.visibilityState === 'visible') onReturn(); };
    window.addEventListener('focus', onReturn);
    document.addEventListener('visibilitychange', onVisible);
    return () => { window.removeEventListener('focus', onReturn); document.removeEventListener('visibilitychange', onVisible); };
  }, [load]);

  // 数量取当前查询下面的真实条数口径（后台 total），安装状态过滤会影响可见卡片数。
  const entries = marketItemsByInstall(state.items, installFilter);
  const summary = state.items.length === 0 ? '' : `共 ${state.total} 个${kindLabel} · 当前显示 ${entries.length} 个`;
  /** 首屏骨架只在还没有任何列表数据时出现；已有数据刷新交给覆盖层。 */
  const skeletonVisible = busy && !state.items.length;
  const overlayVisible = busy && state.items.length > 0;
  const sceneTexts = useMemo(() => sceneOptions.map(scene => scene.label), [sceneOptions]);

  if (!available) {
    return <div className="empty">
      <strong>后台专家目录不可用</strong>
      <span className="muted">{reason || '当前未接入业务后台。'}</span>
      <div className="empty-actions"><Button onClick={() => void load()}>重试</Button></div>
    </div>;
  }

  return <>
    {/* 筛选行：是否内置 / 安装状态 / 授权状态 / 申请状态 / 业务场景，各自独立、可同时生效。 */}
    <div className="skill-filters">
      <div className="filter-group"><span className="filter-label">是否内置：</span>
        <CategoryBar label="是否内置" categories={EXPERT_BUILTIN_OPTIONS} values={builtin === undefined ? [] : [builtin ? EXPERT_BUILTIN_OPTIONS[0] : EXPERT_BUILTIN_OPTIONS[1]]}
          onChange={next => setBuiltin(next.length ? next[next.length - 1] === EXPERT_BUILTIN_OPTIONS[0] : undefined)} />
      </div>
      <div className="filter-group"><span className="filter-label">安装状态：</span>
        <CategoryBar label="安装状态" categories={EXPERT_INSTALL_OPTIONS} values={installFilter === undefined ? [] : [installFilter === 'installed' ? EXPERT_INSTALL_OPTIONS[0] : EXPERT_INSTALL_OPTIONS[1]]}
          onChange={next => setInstallFilter(next.length ? (next[next.length - 1] === EXPERT_INSTALL_OPTIONS[0] ? 'installed' : 'uninstalled') : undefined)} />
      </div>
      <div className="filter-group"><span className="filter-label">授权状态：</span>
        <CategoryBar label="授权状态" categories={EXPERT_AUTH_OPTIONS} values={auth === undefined ? [] : [auth === 'Y' ? EXPERT_AUTH_OPTIONS[0] : EXPERT_AUTH_OPTIONS[1]]}
          onChange={next => setAuth(next.length ? (next[next.length - 1] === EXPERT_AUTH_OPTIONS[0] ? 'Y' : 'N') : undefined)} />
      </div>
      <div className="filter-group"><span className="filter-label">申请状态：</span>
        <CategoryBar label="申请状态" categories={EXPERT_APPLY_OPTIONS} values={apply === undefined ? [] : [EXPERT_APPLY_LABEL[apply]]}
          onChange={next => setApply(next.length ? EXPERT_APPLY_VALUE[next[next.length - 1]] : undefined)} />
      </div>
      <div className="filter-group scenes-filter"><span className="filter-label">业务场景：</span>
        <CategoryBar label="业务场景" categories={sceneTexts} values={scenes} onChange={next => setScenes(next)} />
      </div>
    </div>
    <div className="expert-content">
    {/* 计数行与技能市场同口径：正常显示计数；错误（卸载/加载等）红色，成功提示绿色，同一行互斥。 */}
    <div role="status" aria-live="polite" className={error ? 'error counts' : notice ? 'notice counts' : 'counts'}>{busy && !state.items.length ? '正在读取列表…' : error || notice || summary}</div>
    {moreError ? <p className="error" role="alert">{moreError}<Button className="secondary" disabled={loadingMore} onClick={() => void loadMore()}>重试</Button></p> : null}
    {!busy && !entries.length ? <div className="empty">
      <span className="empty-text">{keyword.trim() || scenes.length || builtin !== undefined || installFilter !== undefined || auth !== undefined || apply !== undefined
        ? `没有找到与查询条件匹配的${kindLabel}`
        : `暂无${kindLabel}数据`}</span>
    </div> : null}
    {entries.length ? <div className="grid">{entries.map(item => {
        const installed = item.installed;
        const working = acting === item.remoteId;
        const sceneText = item.scenes.map(scene => scene.label).join(' · ');
        const sourceText = item.sourceNodeList.join(' · ');
        const publicText = item.isPublic === undefined ? '' : item.isPublic ? '公开' : '非公开';
        // 申请状态只在未授权时参与按钮：只有「申请中」是取消申请；已通过但被撤权的仍可重新申请。
        const applicable = !item.authorized && item.applyStatus !== 'pending';
        const cancelable = !item.authorized && item.applyStatus === 'pending';
        return <article className={`card expert-market-card${installed ? ' published' : ''}`} key={item.remoteId}>
          <div className="card-top">
            <button className="card-open" aria-label={`查看${kindLabel} ${item.name}`} onClick={() => {
              // Installed rows open the full local detail page; a catalog-only row has no
              // local record to load, so it opens the read-only backend detail instead.
              if (installed && onOpenInstalled) {
                onOpenInstalled(installed.expertId, {
                  remoteKey: `${item.expertType}-${item.remoteId}`,
                  boundSessions: installed.boundSessions,
                });
                return;
              }
              setDetail(item);
            }}>
              <RemoteAvatar item={item} />
              <span className="card-title">
                <strong title={item.name}>{item.name}</strong>
                {/* 第二行：来源节点与公开状态改为状态标签，单行不换行（窄宽度裁切，不撑破卡片）。 */}
                <span className="card-meta-tags">
                  {item.sourceNodeList.length ? <TongyunTagSingle tone="blue" title={sourceText}>{sourceText}</TongyunTagSingle> : null}
                  {item.isPublic === undefined ? null : <TongyunTagSingle color={item.isPublic ? '#ADFF2F' : '#808000'}>{publicText}</TongyunTagSingle>}
                  {!item.sourceNodeList.length && item.isPublic === undefined ? <span className="card-meta">—</span> : null}
                </span>
              </span>
            </button>
          </div>
          {sceneText ? <small className="skill-scene" title={sceneText}>{sceneText}</small> : null}
          {/* 简介统一读后台「专家说明」（capability），空值保留现有占位文案。 */}
          <p className="desc">{item.capability || <span className="muted">（暂无简介）</span>}</p>
          {/* 标签行统一走 TongyunTagScrollRow：单行不换行，溢出显示左右翻页箭头。 */}
          {item.tags.length ? <TongyunTagScrollRow tags={item.tags} /> : null}
          <div className="market-card-foot">
            <div className="market-card-tags">
              {item.version ? <TongyunTagSingle>{formatTagVersion(item.version)}</TongyunTagSingle> : null}
              {item.builtin === undefined ? null : <TongyunTagSingle tone={item.builtin ? 'gray' : 'cyan'}>{item.builtin ? '内置' : '非内置'}</TongyunTagSingle>}
              <TongyunTagSingle tone={installed ? 'green' : 'gray'}>{installed ? '已安装' : '未安装'}</TongyunTagSingle>
              <TongyunTagSingle auth={item.authorized}>{item.authorized ? '已授权' : '未授权'}</TongyunTagSingle>
              <TongyunTagSingle tone={applyStatusTone(item.applyStatus)}>{EXPERT_APPLY_LABEL[item.applyStatus]}</TongyunTagSingle>
            </div>
            <div className="market-card-actions">
              {/* 按钮顺序与技能市场一致：申请 → 取消申请 → 安装 → 卸载。 */}
              {applicable ? <button type="button" className="market-action primary" aria-label={`申请${kindLabel} ${item.name}`} disabled={ssoBusy} onClick={() => void openAuth('apply', item.remoteId)}>申请</button> : null}
              {cancelable ? <button type="button" className="market-action primary" aria-label={`取消申请 ${item.name}`} disabled={ssoBusy} onClick={() => void openAuth('cancel', item.remoteId)}>取消申请</button> : null}
              {!installed ? <button type="button" className="install" disabled={working || installBlockedReason(item) !== undefined} title={installBlockedReason(item) ?? '安装到本地'} onClick={() => void install(item)}>{working ? '安装中…' : '安装'}</button> : null}
              {installed && installed.status === 'missing-dependency' ? <button type="button" className="install" disabled={working || installBlockedReason(item) !== undefined} title={installBlockedReason(item) ?? '重新发布该专家'} onClick={() => void install(item)}>{working ? '处理中…' : '重试发布'}</button> : null}
              {installed && installed.updateAvailable && installed.status !== 'missing-dependency' ? <button type="button" className="install" disabled={working || installBlockedReason(item) !== undefined} title={installBlockedReason(item) ?? '更新到最新版本'} onClick={() => void install(item)}>{working ? '更新中…' : '更新'}</button> : null}
              {installed ? <button type="button" className="market-action danger" disabled={working} onClick={() => void uninstall(item)}>卸载</button> : null}
            </div>
          </div>
          {/* 安装/更新失败留在该条目卡片底部（对齐技能市场 card-error）；重试或成功后清除。 */}
          {installFailures[item.remoteId] ? <p className="card-error" role="alert">{installFailures[item.remoteId]}</p> : null}
          {/* 后台下发的签名不可用状态与原因：装前就让用户知道该条目可能无法通过校验。 */}
          {item.signatureState === 'unavailable' ? <p className="card-error" role="status">{item.signatureReason || '后台标记该条目的资产签名不可用，安装可能被拒绝。'}</p> : null}
        </article>;
      })}</div> : null}
    {skeletonVisible ? <div className="grid" role="status" aria-label="正在读取列表…"><CardSkeleton variant="avatar" count={SKELETON_COUNT} /></div> : null}
    {overlayVisible ? <QueryOverlay /> : null}
    {entries.length ? <div className="market-foot" role="status">
      {loadingMore ? <span className="muted">正在加载更多…</span>
        : state.hasMore ? <Button className="secondary" onClick={() => void loadMore()}>继续向下滚动加载更多</Button>
          : <span className="muted">已加载全部 {entries.length} 个{kindLabel}</span>}
    </div> : null}
    <div ref={sentinel} aria-hidden />
    </div>

    {detail && <Modal open label={`${detail.name} 详情`} className="expert-dialog" onClose={() => setDetail(undefined)}>
      <div className="dialog-scroll">
        <header className="detail-header">
          <RemoteAvatar item={detail} />
          <div className="detail-title">
            <h1>{detail.name}</h1>
            <p className="detail-subtitle">
              {detail.version}{detail.domainLabel ? ` · ${detail.domainLabel}` : ''} · {detail.expertType === 'team' ? '专家团' : '专家'} · {detail.installed ? '已安装' : '未安装'}
            </p>
            <div className="detail-head-actions">
              {!detail.authorized && detail.applyStatus !== 'pending' ? <Button variant="primary" className="summon" disabled={ssoBusy} onClick={() => void openAuth('apply', detail.remoteId)}>申请</Button> : null}
              {!detail.authorized && detail.applyStatus === 'pending' ? <Button className="summon" disabled={ssoBusy} onClick={() => void openAuth('cancel', detail.remoteId)}>取消申请</Button> : null}
              {!detail.installed ? <Button variant="primary" className="summon" disabled={acting === detail.remoteId || installBlockedReason(detail) !== undefined}
                title={installBlockedReason(detail) ?? '安装到本地'}
                onClick={() => void install(detail)}>{acting === detail.remoteId ? '安装中…' : '安装'}</Button> : null}
              {detail.installed && detail.installed.status === 'missing-dependency' ? <Button variant="primary" className="summon" disabled={acting === detail.remoteId || installBlockedReason(detail) !== undefined}
                title={installBlockedReason(detail) ?? '重新发布该专家'}
                onClick={() => void install(detail)}>{acting === detail.remoteId ? '处理中…' : '重试发布'}</Button> : null}
              {detail.installed && detail.installed.updateAvailable && detail.installed.status !== 'missing-dependency' ? <Button variant="primary" className="summon" disabled={acting === detail.remoteId || installBlockedReason(detail) !== undefined}
                title={installBlockedReason(detail) ?? '更新到最新版本'}
                onClick={() => void install(detail)}>{acting === detail.remoteId ? '更新中…' : '更新'}</Button> : null}
              {detail.installed ? <Button tone="danger" disabled={acting === detail.remoteId} onClick={() => void uninstall(detail)}>卸载</Button> : null}
            </div>
          </div>
        </header>

        {/* 详情与卡片同口径：优先后台「专家说明」（capability），缺失时才退回 description。 */}
        {(detail.capability || detail.description) && <p className="detail-desc" style={{ marginTop: 20 }}>{detail.capability || detail.description}</p>}
        {/* 详情弹窗内的安装失败位置与技能市场一致：紧跟说明区，错误文本内联展示。 */}
        {installFailures[detail.remoteId] ? <p className="card-error" role="alert" style={{ marginTop: 12 }}>{installFailures[detail.remoteId]}</p> : null}
        {detail.signatureState === 'unavailable' ? <p className="card-error" role="status" style={{ marginTop: 12 }}>{detail.signatureReason || '后台标记该条目的资产签名不可用，安装可能被拒绝。'}</p> : null}
        {detail.tags.length > 0 && <div className="tag-row">{detail.tags.map(tag => <span className="tag" key={tag}>{tag}</span>)}</div>}
        {(detail.owner || detail.department) && <p className="detail-subtitle" style={{ marginTop: 16 }}>
          {[detail.owner, detail.department].filter(Boolean).join(' · ')}
        </p>}
        {detail.expertType === 'team' && detail.memberIds.length > 0 && <p className="detail-subtitle">团队成员 {detail.memberIds.length} 位</p>}

        <ExpertWorkSummary definition={workDefinition(detail)} />

        {!detail.package && <div className="notice warn" role="status" style={{ marginTop: 20 }}>
          <div className="notice-body"><strong>暂不能安装</strong><span>后台未返回该条目的安装包附件（fjxxList），请等待后台补充。</span></div>
        </div>}
      </div>
    </Modal>}
    {/* 卸载确认：与技能市场同一套 confirm-dialog 结构与文案口径。 */}
    <Modal open={Boolean(confirmUninstall)} label="确认卸载专家" className="confirm-dialog" onClose={() => { if (!confirmUninstall || acting !== confirmUninstall.remoteId) setConfirmUninstall(undefined); }}>
      {confirmUninstall && <div>
        <h2>卸载 {confirmUninstall.name}？</h2>
        <p>专家及其全部文件将从本机移除，相关会话将无法继续使用该专家。</p>
        {confirmUninstall.installed && confirmUninstall.installed.boundSessions > 0
          ? <p>该专家已被 {confirmUninstall.installed.boundSessions} 个会话使用，卸载后这些会话将无法继续使用。</p>
          : null}
        <div className="confirm-actions">
          <Button onClick={() => setConfirmUninstall(undefined)} disabled={acting === confirmUninstall.remoteId}>取消</Button>
          <Button tone="danger" className="danger solid" disabled={acting === confirmUninstall.remoteId}
            onClick={() => void runUninstall(confirmUninstall)}>{acting === confirmUninstall.remoteId ? '卸载中…' : '确认卸载'}</Button>
        </div>
      </div>}
    </Modal>
  </>;
}
