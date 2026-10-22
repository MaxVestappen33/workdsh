import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as React from 'react';
import { Button, Modal } from 'workdsh-ui';
import type { ExpertDefinition, RemoteExpertScene, RemoteExpertSummary } from '../shared.js';
import type { ExpertManagementClient } from './management.js';
import { ExpertWorkSummary } from './ExpertWorkSummary.js';

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
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : '操作失败，请重试。';
}

function codeOf(cause: unknown): string | undefined {
  return (cause as { code?: unknown } | undefined)?.code as string | undefined;
}

function RemoteAvatar({ item }: { item: RemoteExpertSummary }) {
  const [broken, setBroken] = useState(false);
  if (item.icon && !broken) {
    return <span className="detail-avatar"><img src={item.icon} alt="" style={{ width: '100%', height: '100%', borderRadius: 'inherit', objectFit: 'cover' }} onError={() => setBroken(true)} /></span>;
  }
  return <span className="detail-avatar" style={item.color ? { background: item.color, color: '#fff' } : undefined} aria-hidden>{item.name.trim().charAt(0) || '专'}</span>;
}

function stateBadge(item: RemoteExpertSummary): { label: string; tone: string } {
  const installed = item.installed;
  if (!installed) return { label: '未安装', tone: 'muted' };
  if (installed.status === 'missing-dependency') return { label: '缺少依赖', tone: 'warn' };
  if (installed.updateAvailable) return { label: '可更新', tone: 'warn' };
  return { label: '已安装', tone: 'ready' };
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

export function RemoteExperts({ management, kind, keyword, onChanged, reloadKey = 0, onOpenInstalled }: RemoteExpertsProps) {
  const [items, setItems] = useState<readonly RemoteExpertSummary[]>([]);
  const [detail, setDetail] = useState<RemoteExpertSummary>();
  const [available, setAvailable] = useState(true);
  const [reason, setReason] = useState<string>();
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(true);
  const [acting, setActing] = useState<string>();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<string>();
  /** Scene options discovered from `bizSceneList`; they accumulate so a filter never loses tabs. */
  const [sceneOptions, setSceneOptions] = useState<readonly RemoteExpertScene[]>([]);
  const [scenes, setScenes] = useState<readonly string[]>([]);
  const sequence = useRef(0);
  const kindLabel = kind === 'team' ? '专家团' : '专家';
  const sceneKey = scenes.join(',');

  const load = useCallback(async () => {
    const current = ++sequence.current;
    setBusy(true); setError('');
    try {
      const result = await management.remoteList({
        expertType: kind, pageNo: 1, pageSize: 24,
        ...(keyword ? { keyword } : {}),
        ...(sceneKey ? { bizScene: sceneKey } : {}),
      });
      if (current !== sequence.current) return;
      setAvailable(result.available);
      setReason(result.reason);
      setItems(result.items);
      setTotal(result.total);
      setSceneOptions(prev => {
        const merged = new Map(prev.map(scene => [scene.value, scene]));
        for (const item of result.items) {
          for (const scene of item.scenes) if (!merged.has(scene.value)) merged.set(scene.value, scene);
        }
        return [...merged.values()];
      });
      return result.items;
    } catch (cause) {
      if (current !== sequence.current) return;
      setAvailable(false);
      setReason(messageOf(cause));
      setItems([]); setTotal(0);
      return undefined;
    } finally {
      if (current === sequence.current) setBusy(false);
    }
  }, [management, kind, keyword, sceneKey]);

  useEffect(() => { void load(); }, [load, reloadKey]);

  const install = async (item: RemoteExpertSummary) => {
    setActing(item.remoteId); setError(''); setNotice(undefined);
    try {
      const receipt = await management.installRemote(
        { expertType: item.expertType, remoteId: item.remoteId, version: item.version },
        management.newOperationId('install'),
      );
      if (receipt.published) setNotice(`已安装「${item.name}」，现在可以召唤使用。`);
      else {
        const detail = receipt.issues.map(issue => issue.message).slice(0, 2).join('；');
        setNotice(`已安装「${item.name}」，但缺少依赖，暂不能召唤。${detail ? `（${detail}）` : ''}`);
      }
      const rows = await load();
      const fresh = rows?.find(row => row.remoteId === item.remoteId);
      if (fresh) setDetail(current => (current && current.remoteId === item.remoteId ? fresh : current));
      onChanged();
    } catch (cause) {
      const code = codeOf(cause);
      setError(code === 'experts/install-package-missing'
        ? `「${item.name}」暂不能安装：${messageOf(cause)}`
        : messageOf(cause));
    } finally { setActing(undefined); }
  };

  const uninstall = async (item: RemoteExpertSummary) => {
    const installed = item.installed;
    if (!installed) return;
    const warning = installed.boundSessions > 0
      ? `「${item.name}」已被 ${installed.boundSessions} 个会话使用，卸载后这些会话将无法继续使用。\n\n将删除本地专家及其全部文件，确定卸载吗？`
      : `将删除本地专家「${item.name}」及其全部文件，确定卸载吗？`;
    if (!window.confirm(warning)) return;
    setActing(item.remoteId); setError(''); setNotice(undefined);
    try {
      const receipt = await management.uninstallRemote(`${item.expertType}-${item.remoteId}`, management.newOperationId('uninstall'));
      setNotice(`已卸载「${item.name}」，删除 ${receipt.deletedExpertIds.length} 条本地专家记录${receipt.boundSessions > 0 ? `（影响 ${receipt.boundSessions} 个会话）` : ''}。`);
      const rows = await load();
      const fresh = rows?.find(row => row.remoteId === item.remoteId);
      if (fresh) setDetail(fresh);
      onChanged();
    } catch (cause) {
      setError(messageOf(cause));
    } finally { setActing(undefined); }
  };

  const summary = useMemo(() => items.length === 0 ? '' : `目录共 ${total} 个${kindLabel} · 当前显示 ${items.length} 个`, [items.length, total, kindLabel]);
  const toggleScene = (value: string) => setScenes(prev => prev.includes(value) ? prev.filter(item => item !== value) : [...prev, value]);

  if (!available) {
    return <div className="empty">
      <strong>后台专家目录不可用</strong>
      <span className="muted">{reason || '当前未接入业务后台。'}</span>
      <div className="empty-actions"><Button onClick={() => void load()}>重试</Button></div>
    </div>;
  }

  return <>
    {/* 应用场景与技能市场一致：胶囊多选，全部 = 不筛选，条件交给后台 bizScene 执行。 */}
    {sceneOptions.length > 0 && <div className="scene-bar" role="group" aria-label="应用场景">
      <button type="button" className={scenes.length === 0 ? 'active' : ''} aria-pressed={scenes.length === 0} onClick={() => setScenes([])}>全部</button>
      {sceneOptions.map(scene => <button key={scene.value} type="button"
        className={scenes.includes(scene.value) ? 'active' : ''} aria-pressed={scenes.includes(scene.value)}
        onClick={() => toggleScene(scene.value)}>{scene.label}</button>)}
    </div>}
    {busy
      ? <div className="remote-status" role="status" aria-live="polite"><span className="muted">正在读取列表…</span></div>
      : <>
    <div role="status" aria-live="polite" className={error ? 'error counts' : 'counts'}>{error || summary}</div>
    {notice && <div className="notice info" role="status"><div className="notice-body"><span>{notice}</span></div><Button onClick={() => setNotice(undefined)} aria-label="关闭提示">×</Button></div>}
    {items.length === 0
      ? <div className="empty">
        <strong>{keyword || scenes.length > 0 ? `没有匹配的${kindLabel}` : `后台暂无可用${kindLabel}`}</strong>
        <span className="muted">{keyword || scenes.length > 0 ? '保留搜索词或应用场景，可清除后重试。' : '后台只返回已上架且已授权的条目。'}</span>
      </div>
      : <div className="grid">{items.map(item => {
        const badge = stateBadge(item);
        const installed = item.installed;
        const working = acting === item.remoteId;
        return <article className={`card ${installed ? 'published' : 'draft'}`} key={item.remoteId}>
          <div className="card-top">
            <button className="card-open" aria-label={`查看${kindLabel} ${item.name}`} onClick={() => {
              // Installed rows open the full local detail page; a catalog-only row has no
              // local record to load, so it opens the read-only backend detail instead.
              if (item.installed && onOpenInstalled) {
                onOpenInstalled(item.installed.expertId, {
                  remoteKey: `${item.expertType}-${item.remoteId}`,
                  boundSessions: item.installed.boundSessions,
                });
                return;
              }
              setDetail(item);
            }}>
              <RemoteAvatar item={item} />
              <span className="card-title">
                <strong title={item.name}>{item.name}</strong>
                <span className="card-meta">{item.version}{item.domainLabel ? ` · ${item.domainLabel}` : ''}</span>
              </span>
            </button>
          </div>
          <p className="desc">{item.description || <span className="muted">（暂无简介）</span>}</p>
          {item.capability && <p className="desc muted">{item.capability}</p>}
          <div className="domain-tags">{item.tags.slice(0, 3).map(tag => <span key={tag}>{tag}</span>)}</div>
          <div className="card-foot">
            <span className="badge">{kindLabel}</span>
            <span className={`badge ${badge.tone === 'ready' ? 'ready' : ''}`}>{badge.label}</span>
            <span style={{ flex: 1 }} />
            {!installed && <Button variant="primary" size="sm" disabled={working || !item.package} title={item.package ? '安装到本地' : '后台未返回安装包，暂不能安装'} onClick={() => void install(item)}>{working ? '安装中…' : '安装'}</Button>}
            {installed && installed.status === 'missing-dependency' && <Button variant="primary" size="sm" disabled={working || !item.package} onClick={() => void install(item)}>{working ? '处理中…' : '重试发布'}</Button>}
            {installed && installed.updateAvailable && installed.status !== 'missing-dependency' && <Button variant="primary" size="sm" disabled={working || !item.package} onClick={() => void install(item)}>{working ? '更新中…' : '更新'}</Button>}
            {installed && <Button size="sm" tone="danger" disabled={working} onClick={() => void uninstall(item)}>卸载</Button>}
          </div>
        </article>;
      })}</div>}
      </>}

    {detail && <Modal open label={`${detail.name} 详情`} className="expert-dialog" onClose={() => setDetail(undefined)}>
      <div className="dialog-scroll">
        <header className="detail-header">
          <RemoteAvatar item={detail} />
          <div className="detail-title">
            <h1>{detail.name}</h1>
            <p className="detail-subtitle">
              {detail.version}{detail.domainLabel ? ` · ${detail.domainLabel}` : ''} · {detail.expertType === 'team' ? '专家团' : '专家'} · {stateBadge(detail).label}
            </p>
            <div className="detail-head-actions">
              {!detail.installed && <Button variant="primary" className="summon" disabled={acting === detail.remoteId || !detail.package}
                title={detail.package ? '安装到本地' : '后台未返回安装包，暂不能安装'}
                onClick={() => void install(detail)}>{acting === detail.remoteId ? '安装中…' : '安装'}</Button>}
              {detail.installed && detail.installed.status === 'missing-dependency' && <Button variant="primary" className="summon" disabled={acting === detail.remoteId || !detail.package}
                onClick={() => void install(detail)}>{acting === detail.remoteId ? '处理中…' : '重试发布'}</Button>}
              {detail.installed && detail.installed.updateAvailable && detail.installed.status !== 'missing-dependency' && <Button variant="primary" className="summon" disabled={acting === detail.remoteId || !detail.package}
                onClick={() => void install(detail)}>{acting === detail.remoteId ? '更新中…' : '更新'}</Button>}
              {detail.installed && <Button tone="danger" disabled={acting === detail.remoteId} onClick={() => void uninstall(detail)}>卸载</Button>}
            </div>
          </div>
        </header>

        {detail.description && <p className="detail-desc" style={{ marginTop: 20 }}>{detail.description}</p>}
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
  </>;
}
