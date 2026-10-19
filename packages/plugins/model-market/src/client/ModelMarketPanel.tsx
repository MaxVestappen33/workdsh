import { useEffect, useMemo, useState } from 'react';
import {
  MODEL_TYPES, installActionLabel, installability,
  type CustomModelDraft, type CustomModelEntry, type ModelMarketDetail, type ModelMarketModel, type ModelMarketPage,
} from '../shared.js';
import { createModelMarketClient } from './management.js';
import { modelMarketCss } from './styles.js';
import { CustomModelForm } from './CustomModelForm.js';

const PAGE_SIZE = 10;
const QUERY_DEBOUNCE_MS = 250;

function ModelIcon({ model, large = false }: { model: ModelMarketModel; large?: boolean }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [model.icon]);
  const initial = (model.modelName || model.modelCode || 'M').slice(0, 2).toUpperCase();
  return (
    <span className={large ? 'mm-icon lg' : 'mm-icon'} aria-hidden="true">
      {model.icon && !failed ? <img src={model.icon} alt="" onError={() => setFailed(true)} /> : initial}
    </span>
  );
}

function GroupHead({ title, count, expanded, onToggle }: { title: string; count: number; expanded: boolean; onToggle: () => void }) {
  return (
    <div className="mm-local-head">
      <button type="button" className="mm-group-head" aria-expanded={expanded} onClick={onToggle}>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            d={expanded
              ? 'M4 6L7.29289 9.29289C7.68342 9.68342 8.31658 9.68342 8.70711 9.29289L12 6'
              : 'M6 12L9.29289 8.70711C9.68342 8.31658 9.68342 7.68342 9.29289 7.29289L6 4'}
            stroke="currentColor"
            strokeWidth="1"
          />
        </svg>
        <span className="mm-section-title">{title}</span>
        <span className="mm-count-pill">{count}</span>
      </button>
    </div>
  );
}

export function ModelMarketPanel() {
  const client = useMemo(() => createModelMarketClient(), []);
  const [available, setAvailable] = useState<boolean>();
  const [availabilityKey, setAvailabilityKey] = useState(0);
  const [page, setPage] = useState<ModelMarketPage>();
  const [detail, setDetail] = useState<ModelMarketDetail>();
  const [selectedId, setSelectedId] = useState<string>();
  const [query, setQuery] = useState('');
  const [source, setSource] = useState('');
  const [modelType, setModelType] = useState('');
  const [pageNo, setPageNo] = useState(1);
  const [reloadKey, setReloadKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string>();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirmUninstall, setConfirmUninstall] = useState(false);
  const [confirmCardId, setConfirmCardId] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<CustomModelEntry>();
  const [customCollapsed, setCustomCollapsed] = useState(false);
  const [marketCollapsed, setMarketCollapsed] = useState(false);
  const [customEntries, setCustomEntries] = useState<readonly CustomModelEntry[]>([]);
  const [customBusyKey, setCustomBusyKey] = useState<string>();
  const [confirmCustomKey, setConfirmCustomKey] = useState<string>();

  useEffect(() => {
    let active = true;
    client.available()
      .then(result => { if (active) setAvailable(result.available); })
      .catch(() => { if (active) setAvailable(false); });
    return () => { active = false; };
  }, [client, availabilityKey]);

  // 登录绑定由身份提供方异步建立：首次检测失败时持续重试，避免设置页先打开就永久停在「未接入」。
  useEffect(() => {
    if (available !== false) return;
    const timer = window.setTimeout(() => setAvailabilityKey(value => value + 1), 5_000);
    return () => window.clearTimeout(timer);
  }, [available]);

  // 成功提示 3 秒后自动消失；错误提示保留到下一次操作。
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 3_000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    // 只看本地模型时不需要请求市场接口，避免多余的远程查询。
    if (!available || source === 'custom') return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError('');
      try {
        const result = await client.list({
          pageNo,
          pageSize: PAGE_SIZE,
          keyword: query.trim() || undefined,
          modelType: modelType || undefined,
        });
        if (!controller.signal.aborted) setPage(result);
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '读取模型市场失败。');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, query ? QUERY_DEBOUNCE_MS : 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [available, client, pageNo, query, source, modelType, reloadKey]);

  useEffect(() => {
    if (!available) return;
    let active = true;
    client.customList()
      .then(rows => { if (active) setCustomEntries(rows); })
      .catch(() => { if (active) setCustomEntries([]); });
    return () => { active = false; };
  }, [available, client, reloadKey]);

  const installed = useMemo(() => new Set(page?.installedIds ?? []), [page]);
  const refresh = () => setReloadKey(value => value + 1);
  const changeFilter = (apply: () => void) => {
    setPageNo(1);
    apply();
  };

  // 列表行已包含详情页展示的全部字段：直接用该行渲染，避免为同一份数据再请求后台。
  const openDetail = (model: ModelMarketModel) => {
    setSelectedId(model.id);
    setDetail({ model, installed: installed.has(model.id) });
    setConfirmUninstall(false);
    setError('');
  };

  const closeDetail = () => {
    setSelectedId(undefined);
    setDetail(undefined);
    setConfirmUninstall(false);
    setError('');
  };

  const install = async (model: Pick<ModelMarketModel, 'id' | 'modelName' | 'modelCode'>) => {
    setBusyId(model.id);
    setError('');
    setNotice('');
    try {
      const result = await client.install(model.id);
      // 添加已经成功：先本地落状态，避免列表刷新期间按钮仍显示「添加」。
      setPage(current => current && !current.installedIds.includes(model.id)
        ? { ...current, installedIds: [...current.installedIds, model.id] }
        : current);
      if (selectedId === model.id) {
        setDetail(current => current && current.model.id === model.id
          ? { ...current, installed: true, route: result.route }
          : current);
      }
      setNotice(`已添加「${model.modelName || model.modelCode}」。`);
      refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '添加模型失败。');
    } finally {
      setBusyId(undefined);
    }
  };

  const uninstall = async (model: ModelMarketModel) => {
    setBusyId(model.id);
    setError('');
    setNotice('');
    try {
      await client.uninstall(model.id);
      // 移除已经成功：先本地落状态，避免列表刷新期间按钮仍显示「移除」。
      setPage(current => current
        ? { ...current, installedIds: current.installedIds.filter(value => value !== model.id) }
        : current);
      if (selectedId === model.id) {
        setDetail(current => current && current.model.id === model.id
          ? { ...current, installed: false, route: undefined }
          : current);
      }
      setNotice(`已移除「${model.modelName || model.modelCode}」。`);
      setConfirmUninstall(false);
      setConfirmCardId(undefined);
      refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '移除模型失败。');
    } finally {
      setBusyId(undefined);
    }
  };

  const createCustom = async (draft: CustomModelDraft) => {
    setCustomBusyKey('__create__');
    setError('');
    setNotice('');
    try {
      const entry = await client.customInstall(draft);
      setNotice(`已添加本地模型「${entry.displayName}」。`);
      setCreating(false);
      refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '添加本地模型失败。');
    } finally {
      setCustomBusyKey(undefined);
    }
  };

  const updateCustom = async (entry: CustomModelEntry, draft: CustomModelDraft) => {
    setCustomBusyKey(entry.key);
    setError('');
    setNotice('');
    try {
      const saved = await client.customUpdate(entry.key, draft);
      setNotice(`已保存「${saved.displayName}」的修改。`);
      setEditing(undefined);
      refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存本地模型失败。');
    } finally {
      setCustomBusyKey(undefined);
    }
  };

  const uninstallCustom = async (entry: CustomModelEntry) => {
    setCustomBusyKey(entry.key);
    setError('');
    setNotice('');
    try {
      await client.customUninstall(entry.key);
      setCustomEntries(current => current.filter(item => item.key !== entry.key));
      setConfirmCustomKey(undefined);
      setNotice(`已移除本地模型「${entry.displayName}」。`);
      refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '移除本地模型失败。');
    } finally {
      setCustomBusyKey(undefined);
    }
  };

  // 卡片只展示协议品牌：openai-* 归为 OpenAI，anthropic-* 归为 Anthropic。
  const protocolBrand = (value: string) =>
    value.startsWith('openai-') ? 'OpenAI' : value.startsWith('anthropic-') ? 'Anthropic' : value;

  // 页面级提示使用吸顶容器：无论滚动到哪个位置操作，错误和成功提示都保持可见。
  const notices = error || notice ? (
    <div className="mm-banners">
      {error ? <p className="mm-error" role="alert">{error}</p> : null}
      {notice ? <p className="mm-notice" role="status">{notice}</p> : null}
    </div>
  ) : null;

  if (creating || editing) {
    return (
      <section className="wd-model-market" data-testid="workdsh-model-market">
        <style>{modelMarketCss}</style>
        <CustomModelForm
          busy={editing ? customBusyKey === editing.key : customBusyKey === '__create__'}
          error={error}
          {...(editing ? { initial: editing } : {})}
          onSubmit={draft => void (editing ? updateCustom(editing, draft) : createCustom(draft))}
          onCancel={() => { setCreating(false); setEditing(undefined); setError(''); }}
          onDiscover={input => client.customDiscover(input)}
        />
      </section>
    );
  }

  if (available === undefined) {
    return (
      <section className="wd-model-market" data-testid="workdsh-model-market" aria-busy="true">
        <style>{modelMarketCss}</style>
        <div className="mm-head"><h1 className="mm-title">模型管理</h1></div>
        <div className="mm-loading" role="status">正在检查模型管理…</div>
      </section>
    );
  }

  if (available === false) {
    return (
      <section className="wd-model-market" data-testid="workdsh-model-market">
        <style>{modelMarketCss}</style>
        <div className="mm-head"><h1 className="mm-title">模型管理</h1></div>
        <div className="mm-empty">
          <strong>当前环境未接入模型市场</strong>
          <span>请先登录公司账号，或联系管理员确认模型授权配置。</span>
          <button
            type="button"
            className="mm-action"
            style={{ marginTop: 12 }}
            onClick={() => setAvailabilityKey(value => value + 1)}
          >
            重新检测
          </button>
        </div>
      </section>
    );
  }

  if (selectedId) {
    const model = detail?.model;
    const usable = model ? installability(model) : undefined;
    const busy = Boolean(model && busyId === model.id);
    return (
      <section className="wd-model-market" data-testid="workdsh-model-market">
        <style>{modelMarketCss}</style>
        <div className="mm-detail">
          <button type="button" className="mm-back" onClick={closeDetail}>
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            返回模型管理
          </button>
          {notices}
          {!model ? (
            <div className="mm-loading" role="status">正在读取模型详情…</div>
          ) : (
            <>
              <div className="mm-detail-head">
                <ModelIcon model={model} large />
                <div style={{ minWidth: 0 }}>
                  <div className="mm-detail-title-row">
                    <span className="mm-detail-title">{model.modelName || model.modelCode}</span>
                    <span className={detail?.installed ? 'mm-state on' : 'mm-state'}>{detail?.installed ? '已添加' : '未添加'}</span>
                  </div>
                  <div className="mm-detail-sub">{model.providerName || model.provider}{model.version ? ` · ${model.version}` : ''}</div>
                </div>
                <span className="mm-detail-action">
                  {detail?.installed ? (
                    <button type="button" className="mm-action uninstall" disabled={busy} onClick={() => setConfirmUninstall(true)}>
                      {busy ? <><span className="mm-spinner" />移除中…</> : '移除'}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="mm-action install"
                      disabled={busy || !usable?.installable}
                      title={usable?.installable ? undefined : usable?.reason}
                      onClick={() => void install(model)}
                    >
                      {busy ? <><span className="mm-spinner" />添加中…</> : usable?.installable ? '添加' : installActionLabel(model, usable ?? { installable: false, reason: '' })}
                    </button>
                  )}
                </span>
              </div>
              <div className="mm-tags">
                {model.isDefault ? <span className="mm-badge default">默认模型</span> : null}
                <span className="mm-badge">{model.apiProtocolName || model.apiProtocol || '协议未知'}</span>
                <span className="mm-badge">{model.modelTypeName || model.modelType || '类型未知'}</span>
              </div>
              {confirmUninstall ? (
                <div className="mm-confirm" role="alertdialog" aria-label="确认移除模型">
                  <span>移除后将删除本机该模型的配置与凭据，确认移除？</span>
                  <button type="button" onClick={() => setConfirmUninstall(false)} disabled={busy}>取消</button>
                  <button type="button" className="danger" onClick={() => void uninstall(model)} disabled={busy}>
                    {busy ? '移除中…' : '确认移除'}
                  </button>
                </div>
              ) : null}
              <div className="mm-info-grid">
                <div className="mm-info"><span className="k">模型标识</span><span className="v">{model.modelCode || '—'}</span></div>
                <div className="mm-info"><span className="k">上下文长度</span><span className="v">{model.contextLength || '—'}</span></div>
                <div className="mm-info"><span className="k">供应商</span><span className="v">{model.providerName || model.provider || '—'}</span></div>
                <div className="mm-info"><span className="k">模型类型</span><span className="v">{model.modelTypeName || model.modelType || '—'}</span></div>
                <div className="mm-info"><span className="k">API 协议</span><span className="v">{model.apiProtocolName || model.apiProtocol || '—'}</span></div>
                <div className="mm-info"><span className="k">负责人</span><span className="v">{model.owner || '—'}</span></div>
                <div className="mm-info"><span className="k">所属部门</span><span className="v">{model.departName || model.depart || '—'}</span></div>
                <div className="mm-info"><span className="k">更新时间</span><span className="v">{model.updateTime || model.createTime || '—'}</span></div>
              </div>
              {model.tag ? (
                <div className="mm-tags">
                  {model.tag.split(',').flatMap(tag => {
                    const value = tag.trim();
                    return value ? [<span key={value} className="mm-badge">{value}</span>] : [];
                  })}
                </div>
              ) : null}
              {model.description ? (
                <div>
                  <h2 className="mm-section-title">说明</h2>
                  <div className="mm-block">{model.description}</div>
                </div>
              ) : null}
            </>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="wd-model-market" data-testid="workdsh-model-market">
      <style>{modelMarketCss}</style>
      <div className="mm-head">
        <h1 className="mm-title">模型管理</h1>
        <span className="mm-count">
          市场模型 {page?.total ?? 0} 个{customEntries.length ? ` · 本地模型 ${customEntries.length} 个` : ''}
        </span>
        <button
          type="button"
          className="mm-action install mm-head-add"
          onClick={() => { setCreating(true); setError(''); }}
        >
          ＋ 添加本地模型
        </button>
      </div>
      <div className="mm-tools">
        <input
          className="mm-search"
          aria-label="搜索模型"
          placeholder="请输入模型名称或说明"
          value={query}
          onChange={event => { setPageNo(1); setQuery(event.currentTarget.value); }}
        />
        <div className="mm-filters">
          <select className="mm-select" aria-label="模型来源" value={source} onChange={event => changeFilter(() => setSource(event.currentTarget.value))}>
            <option value="">全部来源</option>
            <option value="market">市场模型</option>
            <option value="custom">本地模型</option>
          </select>
          <select className="mm-select" aria-label="模型类型" value={modelType} onChange={event => changeFilter(() => setModelType(event.currentTarget.value))}>
            <option value="">全部类型</option>
            {MODEL_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
      </div>
      {notices}
      {source !== 'market' && customEntries.length ? (
        <div className="mm-local">
          <GroupHead
            title="本地模型"
            count={customEntries.length}
            expanded={!customCollapsed}
            onToggle={() => setCustomCollapsed(value => !value)}
          />
          {customCollapsed ? null : (
          <div className="mm-grid">
            {customEntries.map(entry => {
              const busy = customBusyKey === entry.key;
              return (
                <div className="mm-card mm-card-static" key={entry.key}>
                  <div className="mm-card-top">
                    <span className="mm-icon" aria-hidden="true">{(entry.displayName || entry.providerId).slice(0, 2).toUpperCase()}</span>
                    <div style={{ minWidth: 0 }}>
                      <div className="mm-name">{entry.displayName}</div>
                      <div className="mm-version">{entry.providerId}</div>
                    </div>
                  </div>
                  <div className="mm-meta">
                    <span className="mm-source custom">本地模型</span>
                    <span className="mm-meta-text">{protocolBrand(entry.apiProtocol)}</span>
                  </div>
                  <div className="mm-desc">{entry.models.map(model => model.name || model.id).join('、')}</div>
                  <div className="mm-foot">
                    <span className="mm-foot-left">
                      <span className="mm-state on">已添加</span>
                      {entry.isDefault ? <span className="mm-badge default">默认</span> : null}
                      <span className="mm-context">{entry.models.length} 个模型</span>
                    </span>
                    <span className="mm-card-actions">
                      <button
                        type="button"
                        className="mm-action"
                        disabled={busy}
                        onClick={() => { setEditing(entry); setError(''); }}
                      >
                        编辑
                      </button>
                      <button
                        type="button"
                        className="mm-action uninstall"
                        disabled={busy}
                        onClick={() => setConfirmCustomKey(entry.key)}
                      >
                        {busy ? <><span className="mm-spinner" />移除中…</> : '移除'}
                      </button>
                    </span>
                  </div>
                  {confirmCustomKey === entry.key ? (
                    <div className="mm-card-confirm">
                      <span>确认移除？</span>
                      <button type="button" onClick={() => setConfirmCustomKey(undefined)} disabled={busy}>取消</button>
                      <button type="button" className="danger" disabled={busy} onClick={() => void uninstallCustom(entry)}>
                        {busy ? '移除中…' : '确认移除'}
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
          )}
        </div>
      ) : null}
      {source !== 'custom' && loading && !page ? <div className="mm-loading" role="status">正在加载模型市场…</div> : null}
      {source !== 'custom' && page ? (
        <GroupHead
          title="模型市场"
          count={page.total}
          expanded={!marketCollapsed}
          onToggle={() => setMarketCollapsed(value => !value)}
        />
      ) : null}
      {source !== 'custom' && !marketCollapsed && page && page.records.length ? (
        <>
          <div className="mm-grid">
            {page.records.map(model => {
              const usable = installability(model);
              const isInstalled = installed.has(model.id);
              const busy = busyId === model.id;
              return (
                <div
                  key={model.id}
                  className={busy ? 'mm-card is-busy' : 'mm-card'}
                  role="button"
                  tabIndex={0}
                  aria-busy={busy}
                  onClick={() => openDetail(model)}
                  onKeyDown={event => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      openDetail(model);
                    }
                  }}
                >
                  <div className="mm-card-top">
                    <ModelIcon model={model} />
                    <div style={{ minWidth: 0 }}>
                      <div className="mm-name">{model.modelName || model.modelCode}</div>
                      <div className="mm-version">{model.version || '—'}</div>
                    </div>
                  </div>
                  <div className="mm-meta">
                    <span className="mm-source">市场模型</span>
                    <span className="mm-meta-text">{model.providerName || model.provider || '—'} · {model.modelTypeName || model.modelType || '—'}</span>
                  </div>
                  <div className="mm-desc">{model.description || '暂无说明'}</div>
                  <div className="mm-foot">
                    <span className="mm-foot-left">
                      <span className={isInstalled ? 'mm-state on' : 'mm-state'}>{isInstalled ? '已添加' : '未添加'}</span>
                      {model.isDefault ? <span className="mm-badge default">默认</span> : null}
                      <span className="mm-context">{model.contextLength || '—'}</span>
                    </span>
                    {isInstalled ? (
                      <button
                        type="button"
                        className="mm-action uninstall"
                        disabled={busy}
                        onClick={event => {
                          event.stopPropagation();
                          setConfirmCardId(model.id);
                        }}
                      >
                        {busy ? <><span className="mm-spinner" />移除中…</> : '移除'}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className={usable.installable ? 'mm-action install' : 'mm-action'}
                        disabled={busy || !usable.installable}
                        title={usable.installable ? undefined : usable.reason}
                        onClick={event => {
                          event.stopPropagation();
                          if (usable.installable) void install(model);
                        }}
                      >
                        {busy ? <><span className="mm-spinner" />添加中…</> : installActionLabel(model, usable)}
                      </button>
                    )}
                  </div>
                  {confirmCardId === model.id ? (
                    <div className="mm-card-confirm" onClick={event => event.stopPropagation()}>
                      <span>确认移除？</span>
                      <button type="button" onClick={() => setConfirmCardId(undefined)} disabled={busy}>取消</button>
                      <button type="button" className="danger" disabled={busy} onClick={() => void uninstall(model)}>
                        {busy ? '移除中…' : '确认移除'}
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
          {page.pages > 1 ? (
            <div className="mm-pager">
              <button type="button" disabled={pageNo <= 1} onClick={() => setPageNo(value => Math.max(1, value - 1))}>上一页</button>
              <span>{page.current} / {page.pages}</span>
              <button type="button" disabled={pageNo >= page.pages} onClick={() => setPageNo(value => value + 1)}>下一页</button>
            </div>
          ) : null}
        </>
      ) : null}
      {source !== 'custom' && !loading && page && page.records.length === 0 ? (
        <div className="mm-empty">
          <strong>{page.total ? '没有匹配的模型' : '暂无已授权的模型'}</strong>
          <span>{page.total ? '换个关键词或清空筛选条件后重试。' : '请联系管理员在后台授权模型后再刷新。'}</span>
        </div>
      ) : null}
      {source === 'custom' && !customEntries.length ? (
        <div className="mm-empty">
          <strong>还没有本地模型</strong>
          <span>点击右上角「＋ 添加本地模型」创建。</span>
        </div>
      ) : null}
    </section>
  );
}
