import { useState } from 'react';
import {
  CUSTOM_API_PROTOCOLS, CUSTOM_PROVIDER_ID, formatCapacity, parseContextWindow,
  type CustomModelDefinition, type CustomModelDraft, type CustomModelEntry,
} from '../shared.js';

interface FormModel {
  id: string;
  name: string;
  context: string;
  maxTokens: string;
  text: boolean;
  image: boolean;
  expanded: boolean;
}

const blankModel = (): FormModel => ({ id: '', name: '', context: '', maxTokens: '', text: true, image: false, expanded: true });

export interface CustomModelFormProps {
  readonly busy: boolean;
  readonly error: string;
  /** 传入已安装的自定义模型时进入编辑模式，表单回显现有配置。 */
  readonly initial?: CustomModelEntry;
  readonly onSubmit: (draft: CustomModelDraft) => void;
  readonly onCancel: () => void;
  readonly onDiscover: (input: { apiUrl: string; apiProtocol: string; apiKey: string }) => Promise<readonly CustomModelDefinition[]>;
}

/** 自定义模型表单：复用官方 llm-pi-ai 的配置结构，但不复制官方设置页。 */
export function CustomModelForm({ busy, error, initial, onSubmit, onCancel, onDiscover }: CustomModelFormProps) {
  const editing = initial !== undefined;
  const [providerId, setProviderId] = useState(initial?.providerId ?? '');
  const [displayName, setDisplayName] = useState(initial?.displayName ?? '');
  const [apiUrl, setApiUrl] = useState(initial?.apiUrl ?? '');
  const [apiProtocol, setApiProtocol] = useState<string>(initial?.apiProtocol ?? CUSTOM_API_PROTOCOLS[0][0]);
  const [apiKey, setApiKey] = useState('');
  const [models, setModels] = useState<FormModel[]>(() => initial
    ? initial.models.map((model, index) => ({
      id: model.id,
      name: model.name,
      context: formatCapacity(model.contextWindow),
      maxTokens: formatCapacity(model.maxTokens),
      text: model.input.includes('text') || !model.input.length,
      image: model.input.includes('image'),
      expanded: index === 0,
    }))
    : [blankModel()]);
  const [localError, setLocalError] = useState('');
  const [discoverOpen, setDiscoverOpen] = useState(false);
  const [discoverLoading, setDiscoverLoading] = useState(false);
  const [discoverError, setDiscoverError] = useState('');
  const [candidates, setCandidates] = useState<readonly CustomModelDefinition[]>([]);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [discoverQuery, setDiscoverQuery] = useState('');

  const updateModel = (index: number, patch: Partial<FormModel>) => {
    setModels(current => current.map((model, position) => position === index ? { ...model, ...patch } : model));
  };

  const validateTarget = (): string => {
    const id = providerId.trim();
    if (!CUSTOM_PROVIDER_ID.test(id)) return 'Provider ID 必须以小写字母开头，且只包含小写字母、数字和连字符。';
    try {
      const parsed = new URL(apiUrl.trim());
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('protocol');
    } catch {
      return 'API 地址必须是有效的 HTTP 或 HTTPS 地址。';
    }
    if (!apiKey.trim() && !editing) return '请填写 API 密钥。';
    return '';
  };

  const discover = async () => {
    setLocalError('');
    setDiscoverError('');
    const invalid = validateTarget();
    if (invalid) {
      setLocalError(invalid);
      return;
    }
    if (editing && !apiKey.trim()) {
      setLocalError('编辑时如需重新获取可用模型，请先填写 API 密钥。');
      return;
    }
    setDiscoverLoading(true);
    setDiscoverOpen(true);
    setCandidates([]);
    setSelectedIds(new Set());
    try {
      setCandidates(await onDiscover({ apiUrl: apiUrl.trim(), apiProtocol, apiKey: apiKey.trim() }));
    } catch (cause) {
      setDiscoverError(cause instanceof Error ? cause.message : '获取可用模型失败。');
    } finally {
      setDiscoverLoading(false);
    }
  };

  const addSelected = () => {
    const additions = candidates.filter(candidate => selectedIds.has(candidate.id));
    if (!additions.length) {
      setDiscoverError('请先勾选要添加的模型。');
      return;
    }
    setModels(current => {
      const kept = current.filter(model => model.id.trim() || model.name.trim() || model.context.trim() || model.maxTokens.trim());
      const ids = new Set(kept.map(model => model.id.trim()).filter(Boolean));
      return [
        ...kept,
        ...additions.flatMap(candidate => {
          if (ids.has(candidate.id)) return [];
          ids.add(candidate.id);
          return [{
            id: candidate.id,
            name: candidate.name,
            context: formatCapacity(candidate.contextWindow),
            maxTokens: formatCapacity(candidate.maxTokens),
            text: candidate.input.includes('text') || !candidate.input.length,
            image: candidate.input.includes('image'),
            expanded: true,
          }];
        }),
      ];
    });
    setDiscoverOpen(false);
    setDiscoverError('');
  };

  const submit = () => {
    setLocalError('');
    const invalid = validateTarget();
    if (invalid) {
      setLocalError(invalid);
      return;
    }
    const definitions: CustomModelDefinition[] = [];
    const seen = new Set<string>();
    if (!models.length) {
      setLocalError('请至少添加一个模型。');
      return;
    }
    for (const model of models) {
      const modelId = model.id.trim();
      if (!modelId) {
        setLocalError('模型 ID 不能为空。');
        return;
      }
      if (seen.has(modelId)) {
        setLocalError(`模型 ID 重复：${modelId}。`);
        return;
      }
      seen.add(modelId);
      const input = [...(model.text ? ['text' as const] : []), ...(model.image ? ['image' as const] : [])];
      if (!input.length) {
        setLocalError(`模型 ${modelId} 至少选择一种输入类型。`);
        return;
      }
      const contextText = model.context.trim();
      const contextWindow = contextText ? parseContextWindow(contextText) : undefined;
      if (contextText && contextWindow === undefined) {
        setLocalError(`模型 ${modelId} 的上下文窗口格式无效，支持 256K、1M 或数字。`);
        return;
      }
      const maxText = model.maxTokens.trim();
      const maxTokens = maxText ? parseContextWindow(maxText) : undefined;
      if (maxText && maxTokens === undefined) {
        setLocalError(`模型 ${modelId} 的最大输出 token 数格式无效，支持 32K 或数字。`);
        return;
      }
      definitions.push({
        id: modelId,
        name: model.name.trim() || modelId,
        ...(contextWindow === undefined ? {} : { contextWindow }),
        ...(maxTokens === undefined ? {} : { maxTokens }),
        input,
      });
    }
    onSubmit({
      providerId: providerId.trim(),
      displayName: displayName.trim() || providerId.trim(),
      apiUrl: apiUrl.trim(),
      apiProtocol,
      apiKey: apiKey.trim(),
      models: definitions,
      setDefault: false,
    });
  };

  const normalizedQuery = discoverQuery.trim().toLowerCase();
  const visibleCandidates = candidates.filter(candidate =>
    !normalizedQuery || `${candidate.id} ${candidate.name}`.toLowerCase().includes(normalizedQuery));

  return (
    <div className="mm-custom-form">
      <button type="button" className="mm-back" onClick={onCancel}>
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        返回模型市场
      </button>
      <h1 className="mm-title">{editing ? '编辑自定义模型' : '添加自定义模型'}</h1>
      <p className="mm-hint">连接中转站、自部署服务或其他兼容 OpenAI / Anthropic 协议的接口。</p>
      {localError || error ? <p className="mm-error" role="alert">{localError || error}</p> : null}

      <section className="mm-form-section">
        <h2 className="mm-section-title">基本信息</h2>
        <label className="mm-field">
          <span>Provider ID</span>
          <input value={providerId} placeholder="acme-gateway" disabled={editing} onChange={event => setProviderId(event.currentTarget.value)} />
          <small>{editing ? 'Provider ID 创建后不可修改。' : '以小写字母开头的唯一标识，将作为请求中的 provider 路由名。'}</small>
        </label>
        <label className="mm-field">
          <span>显示名称</span>
          <input value={displayName} placeholder="例如：公司模型网关" onChange={event => setDisplayName(event.currentTarget.value)} />
        </label>
        <label className="mm-field">
          <span>API 地址</span>
          <input value={apiUrl} placeholder="https://gateway.example/v1" onChange={event => setApiUrl(event.currentTarget.value)} />
        </label>
        <label className="mm-field">
          <span>API 协议</span>
          <select value={apiProtocol} onChange={event => setApiProtocol(event.currentTarget.value)}>
            {CUSTOM_API_PROTOCOLS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="mm-field">
          <span>API 密钥</span>
          <input
            type="password"
            autoComplete="new-password"
            value={apiKey}
            placeholder={editing ? '留空则沿用现有密钥' : '输入 API 密钥'}
            onChange={event => setApiKey(event.currentTarget.value)}
          />
          <small>{editing ? '留空表示沿用已保存的密钥，填写则会覆盖。' : '密钥写入本机官方凭据存储，不会出现在页面或日志里。'}</small>
        </label>
      </section>

      <section className="mm-form-section">
        <div className="mm-form-section-head">
          <h2 className="mm-section-title">模型目录</h2>
          <button type="button" className="mm-discover-trigger" disabled={discoverLoading || busy} onClick={() => void discover()}>
            {discoverLoading ? <><span className="mm-spinner" />探测中…</> : '获取可用模型'}
          </button>
        </div>
        {discoverOpen ? (
          <div className="mm-discover">
            <div className="mm-discover-tools">
              <input
                className="mm-search"
                placeholder="搜索模型 ID 或名称"
                value={discoverQuery}
                onChange={event => setDiscoverQuery(event.currentTarget.value)}
              />
              <button
                type="button"
                className="mm-discover-link"
                onClick={() => setSelectedIds(new Set(visibleCandidates.map(candidate => candidate.id)))}
              >
                全选可见
              </button>
              <button type="button" className="mm-discover-link" onClick={() => setDiscoverOpen(false)}>取消</button>
            </div>
            {discoverError ? <p className="mm-error" role="alert">{discoverError}</p> : null}
            <div className="mm-discover-list">
              {visibleCandidates.map(candidate => (
                <label className="mm-discover-item" key={candidate.id}>
                  <input
                    type="checkbox"
                    checked={selectedIds.has(candidate.id)}
                    onChange={event => {
                      setSelectedIds(current => {
                        const next = new Set(current);
                        if (event.currentTarget.checked) next.add(candidate.id);
                        else next.delete(candidate.id);
                        return next;
                      });
                    }}
                  />
                  <span className="mm-discover-name">{candidate.name || candidate.id}</span>
                  <span className="mm-discover-meta">
                    {candidate.id}
                    {candidate.contextWindow ? ` · ${formatCapacity(candidate.contextWindow)}` : ''}
                    {candidate.maxTokens ? ` · 输出 ${formatCapacity(candidate.maxTokens)}` : ''}
                  </span>
                </label>
              ))}
              {!discoverLoading && !discoverError && !visibleCandidates.length ? <p className="mm-hint">没有匹配的模型。</p> : null}
            </div>
            <div className="mm-discover-actions">
              <button type="button" className="mm-action" onClick={() => setDiscoverOpen(false)}>取消</button>
              <button type="button" className="mm-action install" onClick={addSelected}>添加所选</button>
            </div>
          </div>
        ) : null}
        <div className="mm-model-list">
          {models.map((model, index) => (
            <div className="mm-model-row" key={index}>
              <div className="mm-model-row-head">
                <input
                  className="mm-model-id"
                  value={model.id}
                  placeholder="模型 ID"
                  aria-label={`模型 ${index + 1} 的模型 ID`}
                  onChange={event => updateModel(index, { id: event.currentTarget.value })}
                />
                <input
                  className="mm-model-name"
                  value={model.name}
                  placeholder="显示名称"
                  aria-label={`模型 ${index + 1} 的显示名称`}
                  onChange={event => updateModel(index, { name: event.currentTarget.value })}
                />
                <button
                  type="button"
                  className="mm-model-toggle"
                  aria-expanded={model.expanded}
                  aria-label={model.expanded ? `收起模型 ${index + 1}` : `展开模型 ${index + 1}`}
                  onClick={() => updateModel(index, { expanded: !model.expanded })}
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path
                      d={model.expanded
                        ? 'M4 6L7.29289 9.29289C7.68342 9.68342 8.31658 9.68342 8.70711 9.29289L12 6'
                        : 'M6 12L9.29289 8.70711C9.68342 8.31658 9.68342 7.68342 9.29289 7.29289L6 4'}
                      stroke="currentColor"
                      strokeWidth="1"
                    />
                  </svg>
                </button>
                <button
                  type="button"
                  className="mm-remove-model"
                  aria-label={`删除模型 ${index + 1}`}
                  onClick={() => setModels(current => current.filter((_, position) => position !== index))}
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path d="M1.28149 3.88831H14.7187" stroke="currentColor" strokeWidth="1" />
                    <path d="M5.41602 3.88833V2.47962C5.41602 2.29282 5.52492 2.11366 5.71876 1.98157C5.9126 1.84948 6.17551 1.77527 6.44964 1.77527H9.55053C9.82466 1.77527 10.0876 1.84948 10.2814 1.98157C10.4753 2.11366 10.5842 2.29282 10.5842 2.47962V3.88833" stroke="currentColor" strokeWidth="1" />
                    <path d="M2.57349 3.88831L3.19366 13.2943C3.21937 13.5502 3.33952 13.7872 3.53065 13.9593C3.72178 14.1313 3.97016 14.2259 4.22729 14.2246H11.7728C12.0299 14.2259 12.2783 14.1313 12.4694 13.9593C12.6605 13.7872 12.7807 13.5502 12.8064 13.2943L13.4266 3.88831" stroke="currentColor" strokeWidth="1" />
                    <path d="M6.44946 6.98926V11.1238" stroke="currentColor" strokeWidth="1" />
                    <path d="M9.55054 6.98926V11.1238" stroke="currentColor" strokeWidth="1" />
                  </svg>
                </button>
              </div>
              {model.expanded ? (
                <div className="mm-model-grid">
                  <label className="mm-field">
                    <span>上下文窗口</span>
                    <input value={model.context} placeholder="256K" onChange={event => updateModel(index, { context: event.currentTarget.value })} />
                  </label>
                  <label className="mm-field">
                    <span>最大输出 token 数</span>
                    <input value={model.maxTokens} placeholder="32K" onChange={event => updateModel(index, { maxTokens: event.currentTarget.value })} />
                  </label>
                  <fieldset className="mm-input-types" aria-label={`输入类型 ${index + 1}`}>
                    <legend className="mm-field-label">输入类型</legend>
                    <div className="mm-check-group">
                      <label className="mm-checkbox">
                        <input
                          type="checkbox"
                          checked={model.text}
                          disabled={model.text && !model.image}
                          onChange={event => updateModel(index, { text: event.currentTarget.checked })}
                        />
                        文本
                      </label>
                      <label className="mm-checkbox">
                        <input
                          type="checkbox"
                          checked={model.image}
                          disabled={model.image && !model.text}
                          onChange={event => updateModel(index, { image: event.currentTarget.checked })}
                        />
                        图片
                      </label>
                    </div>
                  </fieldset>
                </div>
              ) : null}
            </div>
          ))}
        </div>
        <button type="button" className="mm-add-model" onClick={() => setModels(current => [...current, blankModel()])}>＋ 添加模型</button>
      </section>

      <div className="mm-form-actions">
        <button type="button" className="mm-action" disabled={busy} onClick={onCancel}>取消</button>
        <button type="button" className="mm-action install" disabled={busy} onClick={submit}>
          {busy ? <><span className="mm-spinner" />{editing ? '保存中…' : '创建中…'}</> : editing ? '保存修改' : '创建并安装'}
        </button>
      </div>
    </div>
  );
}
