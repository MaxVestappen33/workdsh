import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { CardSkeleton, cardSkeletonCss, QueryOverlay, queryOverlayCss } from 'workdsh-ui';
import {
  MODEL_TYPES, installActionLabel, installability, inputTypes, splitList,
  type CustomModelDraft, type CustomModelEntry, type ModelMarketDetail, type ModelMarketModel, type ModelMarketPage,
} from '../shared.js';
import { createModelMarketClient } from './management.js';
import { modelMarketCss } from './styles.js';
import { CustomModelForm } from './CustomModelForm.js';

const PAGE_SIZE = 10;
const QUERY_DEBOUNCE_MS = 250;

/** 标签配色：对齐 ant-design-vue 的 a-tag 观感（浅底 + 同系文字 + 1px 同系描边 + 4px 圆角）。 */
interface TagTone {
  readonly bg: string;
  readonly color: string;
  readonly border: string;
  readonly dot?: string;
}

const PROVIDER_TAG_TONE: Readonly<Record<string, TagTone>> = {
  OPENAI: { bg: '#E8F8F3', color: '#087F5B', border: '#A7E8D6' },
  ZHIPU: { bg: '#E6F4FF', color: '#0958D9', border: '#91CAFF' },
  QIANFAN: { bg: '#E6FFFB', color: '#08979C', border: '#87E8DE' },
  QWEN: { bg: '#F9F0FF', color: '#531DAB', border: '#D3ADF7' },
  DEEPSEEK: { bg: '#F0F5FF', color: '#1D39C4', border: '#ADC6FF' },
  OLLAMA: { bg: '#F5F5F5', color: '#262626', border: '#D9D9D9' },
  SELF: { bg: '#FFF7E6', color: '#D46B08', border: '#FFD591' },
  OTHER: { bg: '#FFF0F6', color: '#C41D7F', border: '#FFADD2' },
};

const MODEL_TYPE_TAG_TONE: Readonly<Record<string, TagTone>> = {
  LLM: { bg: '#FFFFFF', color: '#1D39C4', border: '#ADC6FF' },
  MLLM: { bg: '#FFFFFF', color: '#9D174D', border: '#FBCFE8' },
  ASR: { bg: '#FFFFFF', color: '#A16207', border: '#FDE68A' },
  EMBED: { bg: '#FFFFFF', color: '#0F766E', border: '#99F6E4' },
  RERANKER: { bg: '#FFFFFF', color: '#B91C1C', border: '#FECACA' },
  OTHER: { bg: '#FFFFFF', color: '#4B5563', border: '#D1D5DB' },
};

const INPUT_TYPE_TAG_TONE: Readonly<Record<string, TagTone>> = {
  TEXT: { bg: '#F8FAFC', color: '#334155', border: '#E2E8F0', dot: '#64748B' },
  IMAGE: { bg: '#F5F3FF', color: '#5B21B6', border: '#DDD6FE', dot: '#7C3AED' },
  OTHER: { bg: '#FAFAFA', color: '#525252', border: '#E5E5E5', dot: '#A3A3A3' },
};

/** 中性标签与技能市场的版本号一致；模型标识用 cyan，默认模型用 blue。 */
const NEUTRAL_TAG_TONE: TagTone = { bg: 'whitesmoke', color: '#434343', border: '#ffffff' };
const CYAN_TAG_TONE: TagTone = { bg: '#e6fffb', color: '#08979c', border: '#87e8de' };
const BLUE_TAG_TONE: TagTone = { bg: '#e6f4ff', color: '#0958d9', border: '#91caff' };
const GRAY_TAG_TONE: TagTone = { bg: '#f5f5f5', color: '#434343', border: '#d9d9d9' };

/** 后台取值大小写不统一（LLM / Reranker），匹配时先精确再忽略大小写，最后落到 OTHER。 */
function toneOf(map: Readonly<Record<string, TagTone>>, key: string): TagTone {
  const direct = map[key.trim()];
  if (direct) return direct;
  const upper = key.trim().toUpperCase();
  const matched = Object.keys(map).find(name => name.toUpperCase() === upper);
  return (matched ? map[matched] : undefined) ?? map.OTHER ?? NEUTRAL_TAG_TONE;
}

function tagStyle(tone: TagTone): CSSProperties {
  return { background: tone.bg, borderColor: tone.border, color: tone.color };
}

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

/** 供应商 / 模型标识 / 版本号 / 模型类型：详情页与列表卡片共用同一套标签。 */
function ModelMetaTags({ model }: { readonly model: ModelMarketModel }) {
  return (
    <div className="mm-tags">
      <span className="mm-tag" style={tagStyle(toneOf(PROVIDER_TAG_TONE, model.provider))}>
        {model.providerName || model.provider || '未知供应商'}
      </span>
      {model.modelCode ? <span className="mm-tag" style={tagStyle(CYAN_TAG_TONE)}>{model.modelCode}</span> : null}
      {model.version ? <span className="mm-tag" style={tagStyle(NEUTRAL_TAG_TONE)}>{model.version}</span> : null}
      <span className="mm-tag" style={tagStyle(toneOf(MODEL_TYPE_TAG_TONE, model.modelType))}>
        {model.modelTypeName || model.modelType || '类型未知'}
      </span>
    </div>
  );
}

/** 输入模态标签（带圆点），逗号分隔、未知取值原样展示。 */
function InputTypeTags({ value }: { readonly value: string }) {
  return (
    <>
      {inputTypes(value).map(({ key, label }) => {
        // 配色按后台原始取值匹配（text/image），不能拿译文去查表，否则图片会落到 OTHER 的灰色。
        const tone = toneOf(INPUT_TYPE_TAG_TONE, key);
        return (
          <span key={`input:${key}`} className="mm-tag" style={tagStyle(tone)}>
            <span className="mm-tag-dot" style={{ background: tone.dot ?? tone.color }} />
            {label}
          </span>
        );
      })}
    </>
  );
}

/** 本地自定义模型没有单条模态字段，取各子模型的模态并集。 */
function customInputTypes(entry: CustomModelEntry): string {
  const seen = new Set<string>();
  for (const model of entry.models) for (const item of model.input) seen.add(item);
  return [...seen].join(',');
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
  const [customLoading, setCustomLoading] = useState(false);
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

  // 可用性只在进入页面时探测一次；未接入时由页面上的「重新检测」手动重试，不做定时轮询。
  useEffect(() => {
    let active = true;
    client.available()
      .then(result => { if (active) setAvailable(result.available); })
      .catch(() => { if (active) setAvailable(false); });
    return () => { active = false; };
  }, [client, availabilityKey]);

  // 成功提示 3 秒后自动消失；错误提示保留到下一次操作。
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 3_000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  // 市场列表只在用户主动操作时取数：进入页面、翻页、改筛选/检索、点刷新、添加或移除之后。
  // 窗口焦点、visibilitychange 等隐式信号不触发任何查询。
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
    setCustomLoading(true);
    client.customList()
      .then(rows => { if (active) setCustomEntries(rows); })
      .catch(() => { if (active) setCustomEntries([]); })
      .finally(() => { if (active) setCustomLoading(false); });
    return () => { active = false; setCustomLoading(false); };
  }, [available, client, reloadKey]);

  const installed = useMemo(() => new Set(page?.installedIds ?? []), [page]);
  /**
   * 刷新：一轮只重取当前展示的数据，单飞——同一轮未结束时再点直接忽略，
   * 不会因为连点叠出多轮请求。市场模型页签下是一次列表请求 + 一次本地模型请求。
   */
  const refresh = () => {
    if (loading || customLoading) return;
    setReloadKey(value => value + 1);
  };
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
                <div className="mm-detail-main">
                  <div className="mm-detail-title-row">
                    <span className="mm-detail-title">{model.modelName || model.modelCode}</span>
                    <span className={detail?.installed ? 'mm-state on' : 'mm-state'}>{detail?.installed ? '已添加' : '未添加'}</span>
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
                  <ModelMetaTags model={model} />
                </div>
              </div>
              {/* 第二行：是否默认、输入模态与业务标签直接以标签呈现，不加字段名。 */}
              <div className="mm-tags">
                <span className="mm-tag" style={tagStyle(model.isDefault ? BLUE_TAG_TONE : GRAY_TAG_TONE)}>
                  {model.isDefault ? '默认模型' : '非默认模型'}
                </span>
                <InputTypeTags value={model.inputTypes} />
                {splitList(model.tag).map(item => (
                  <span key={`tag:${item}`} className="mm-tag" style={tagStyle(NEUTRAL_TAG_TONE)}>{item}</span>
                ))}
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
              <div className="mm-detail-desc">{model.description || '暂无模型描述'}</div>
              <div className="mm-info-grid">
                <div className="mm-info"><span className="k">上下文长度</span><span className="v">{model.contextLength || '—'}</span></div>
                <div className="mm-info"><span className="k">最大输出 token</span><span className="v">{model.maxOutputTokens || '—'}</span></div>
                <div className="mm-info"><span className="k">负责人</span><span className="v">{model.owner || '—'}</span></div>
                <div className="mm-info"><span className="k">负责部门</span><span className="v">{model.departName || model.depart || '—'}</span></div>
                <div className="mm-info"><span className="k">订阅数</span><span className="v">{model.subscribeCount}</span></div>
                <div className="mm-info"><span className="k">发布时间</span><span className="v">{model.createTime || '—'}</span></div>
                <div className="mm-info"><span className="k">API 协议</span><span className="v">{model.apiProtocolName || model.apiProtocol || '—'}</span></div>
                <div className="mm-info">
                  <span className="k">是否开启推理等级</span>
                  <span className="v">{model.reasoningLevelEnabled ? '是' : '否'}</span>
                </div>
              </div>
              {model.reasoningLevelEnabled && model.reasoningLevels.length ? (
                <div className="mm-reasoning-table">
                  <div className="mm-quote">推理等级详细设置</div>
                  <table>
                    <colgroup>
                      <col className="col-tier" />
                      <col className="col-wire" />
                      <col />
                      <col className="col-rate" />
                    </colgroup>
                    <thead>
                      <tr>
                        <th scope="col">档位</th>
                        <th scope="col">API 参数值</th>
                        <th scope="col">推理等级描述</th>
                        <th scope="col">消耗速度</th>
                      </tr>
                    </thead>
                    <tbody>
                      {model.reasoningLevels.map(level => (
                        <tr key={level.tier || level.value}>
                          <td>{level.tier || '—'}</td>
                          <td>{level.value || '—'}</td>
                          <td>{level.description || '—'}</td>
                          <td>{level.rate ? `${level.rate}x` : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
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
      <style>{modelMarketCss + cardSkeletonCss + queryOverlayCss}</style>
      <div className="mm-head">
        <h1 className="mm-title">模型管理</h1>
        <span className="mm-count">
          市场模型 {page?.records.length ?? 0} 个{customEntries.length ? ` · 本地模型 ${customEntries.length} 个` : ''}
        </span>
        <div className="mm-head-actions">
          <button
            type="button"
            className="mm-action mm-refresh"
            disabled={loading || customLoading}
            onClick={refresh}
          >
            刷新
          </button>
          <button
            type="button"
            className="mm-action install"
            onClick={() => { setCreating(true); setError(''); }}
          >
            添加本地模型
          </button>
        </div>
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
                  {/* 第一块（两行）：图标跨两行，右侧一行名称、一行供应商标识。 */}
                  <div className="mm-card-head">
                    <span className="mm-icon lg" aria-hidden="true">{(entry.displayName || entry.providerId).slice(0, 2).toUpperCase()}</span>
                    <div className="mm-card-head-main">
                      <div className="mm-name">{entry.displayName}</div>
                      <div className="mm-tags">
                        <span className="mm-tag" style={tagStyle(NEUTRAL_TAG_TONE)}>{entry.providerId}</span>
                      </div>
                    </div>
                  </div>
                  <div className="mm-tags">
                      <span className="mm-tag" style={tagStyle(entry.isDefault ? BLUE_TAG_TONE : GRAY_TAG_TONE)}>
                        {entry.isDefault ? '默认模型' : '非默认模型'}
                      </span>
                      <span className="mm-tag" style={tagStyle(NEUTRAL_TAG_TONE)}>{protocolBrand(entry.apiProtocol)}</span>
                      <InputTypeTags value={customInputTypes(entry)} />
                    </div>
                    <div className="mm-desc">{entry.models.map(model => model.name || model.id).join('、') || '暂无模型描述'}</div>
                    <div className="mm-foot">
                      <span className="mm-foot-left">
                        <span className="mm-state on">已添加</span>
                        <span className="mm-tag mm-tip" style={tagStyle(NEUTRAL_TAG_TONE)} data-tip="模型数量">{entry.models.length} 个</span>
                      </span>
                    <span className="mm-card-actions">
                      <button
                        type="button"
                        className="mm-action primary"
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
          {/* 只看本地模型时市场区不渲染，刷新反馈落在本地列表这一块。 */}
          {source === 'custom' && customLoading ? <QueryOverlay /> : null}
        </div>
      ) : null}
      {source === 'custom' && customLoading && !customEntries.length ? (
        <div className="mm-loading" role="status">正在读取本地模型…</div>
      ) : null}
      <div className="mm-content">
      {/* 分组标题不等接口：先渲染出来，数量随首页数据补齐，避免进入页面时分组整体缺失。 */}
      {source !== 'custom' ? (
        <GroupHead
          title="模型市场"
          count={page?.records.length ?? 0}
          expanded={!marketCollapsed}
          onToggle={() => setMarketCollapsed(value => !value)}
        />
      ) : null}
      {source !== 'custom' && loading && !page ? (
        <div className="mm-grid" role="status" aria-label="正在加载模型市场…"><CardSkeleton variant="model" count={PAGE_SIZE} /></div>
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
                  {/* 第一块（两行）：图标跨两行，右侧一行名称、一行模型标识。 */}
                  <div className="mm-card-head">
                    <ModelIcon model={model} large />
                    <div className="mm-card-head-main">
                      <div className="mm-name">{model.modelName || model.modelCode}</div>
                      <div className="mm-tags">
                        {model.modelCode ? (
                          <span className="mm-tag" style={tagStyle(CYAN_TAG_TONE)}>{model.modelCode}</span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  {/* 第二块：默认态、供应商、类型、版本、输入模态与业务标签。 */}
                  <div className="mm-tags">
                    <span className="mm-tag" style={tagStyle(model.isDefault ? BLUE_TAG_TONE : GRAY_TAG_TONE)}>
                      {model.isDefault ? '默认模型' : '非默认模型'}
                    </span>
                    <span className="mm-tag" style={tagStyle(toneOf(PROVIDER_TAG_TONE, model.provider))}>
                      {model.providerName || model.provider || '未知供应商'}
                    </span>
                    <span className="mm-tag" style={tagStyle(toneOf(MODEL_TYPE_TAG_TONE, model.modelType))}>
                      {model.modelTypeName || model.modelType || '类型未知'}
                    </span>
                    {model.version ? (
                      <span className="mm-tag" style={tagStyle(NEUTRAL_TAG_TONE)}>{model.version}</span>
                    ) : null}
                    <InputTypeTags value={model.inputTypes} />
                    {splitList(model.tag).map(item => (
                      <span key={`tag:${item}`} className="mm-tag" style={tagStyle(NEUTRAL_TAG_TONE)}>{item}</span>
                    ))}
                  </div>
                  <div className="mm-desc">{model.description || '暂无模型描述'}</div>
                  <div className="mm-foot">
                    <span className="mm-foot-left">
                      <span className={isInstalled ? 'mm-state on' : 'mm-state'}>{isInstalled ? '已添加' : '未添加'}</span>
                      {/* 数值只显示自己，字段名放进 data-tip，由 .mm-tip 的伪元素即时提示。 */}
                      <span className="mm-tag mm-tip" style={tagStyle(NEUTRAL_TAG_TONE)} data-tip="上下文长度">
                        {model.contextLength || '—'}
                      </span>
                      <span className="mm-tag mm-tip" style={tagStyle(NEUTRAL_TAG_TONE)} data-tip="最大输出 token">
                        {model.maxOutputTokens || '—'}
                      </span>
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
          <strong>未查询到数据</strong>
        </div>
      ) : null}
      {source !== 'custom' && loading && page ? <QueryOverlay /> : null}
      </div>
      {source === 'custom' && !customEntries.length && !customLoading ? (
        <div className="mm-empty">
          <strong>未查询到数据</strong>
        </div>
      ) : null}
    </section>
  );
}
