import { useEffect, useState } from 'react';
import {
  CUSTOM_API_PROTOCOLS, CUSTOM_PROVIDER_ID, INITIAL_REASONING_LEVELS, REASONING_LEVELS,
  formatCapacity, mergeDiscoveredModels, parseContextWindow,
  type CustomModelDefinition, type CustomModelDraft, type CustomModelEntry,
} from '../shared.js';

interface FormReasoningLevel {
  level: string;
  value: string;
}

interface FormModel {
  id: string;
  name: string;
  context: string;
  maxTokens: string;
  text: boolean;
  image: boolean;
  reasoningEnabled: boolean;
  reasoning: FormReasoningLevel[];
  expanded: boolean;
}

/** 档位默认发送的参数值：Off 不发送，其余与档位名相同（与官方编辑器一致）。 */
const defaultWire = (level: string): string => level === 'off' ? '' : level;

const isReasoningLevel = (level: string): boolean => (REASONING_LEVELS as readonly string[]).includes(level);

const initialReasoning = (): FormReasoningLevel[] =>
  INITIAL_REASONING_LEVELS.map(level => ({ level, value: defaultWire(level) }));

const blankModel = (): FormModel => ({
  id: '', name: '', context: '', maxTokens: '', text: true, image: false,
  reasoningEnabled: false, reasoning: [], expanded: true,
});

/** 把已保存的推理档位读回表单，保留存储顺序与 Off 的空值。 */
function readReasoning(model: CustomModelDefinition): FormReasoningLevel[] {
  if (!model.reasoningEfforts) return [];
  return Object.entries(model.reasoningEfforts)
    .map(([level, wire]) => ({ level, value: typeof wire === 'string' ? wire : '' }));
}

/** 行内实时提示：与官方一致，Off 以外必须有参数值，且至少一个 Off 以外的档位。 */
function reasoningError(model: FormModel): string {
  if (!model.reasoningEnabled) return '';
  const missing = model.reasoning.find(entry => entry.level !== 'off' && !entry.value.trim());
  if (missing) return `档位 ${missing.level} 需要填写 API 参数值。`;
  return model.reasoning.some(entry => entry.level !== 'off') ? '' : '至少添加一个 Off 以外的档位。';
}

export interface CustomModelFormProps {
  readonly busy: boolean;
  readonly error: string;
  /** 传入已安装的本地模型时进入编辑模式，表单回显现有配置。 */
  readonly initial?: CustomModelEntry;
  readonly onSubmit: (draft: CustomModelDraft) => void;
  readonly onCancel: () => void;
  readonly onDiscover: (input: { apiUrl: string; apiProtocol: string; apiKey: string }) => Promise<readonly CustomModelDefinition[]>;
}

/** 本地模型表单：复用官方 llm-pi-ai 的配置结构，但不复制官方设置页。 */
export function CustomModelForm({ busy, error, initial, onSubmit, onCancel, onDiscover }: CustomModelFormProps) {
  const editing = initial !== undefined;
  const [providerId, setProviderId] = useState(initial?.providerId ?? '');
  const [displayName, setDisplayName] = useState(initial?.displayName ?? '');
  const [apiUrl, setApiUrl] = useState(initial?.apiUrl ?? '');
  const [apiProtocol, setApiProtocol] = useState<string>(initial?.apiProtocol ?? CUSTOM_API_PROTOCOLS[0][0]);
  const [apiKey, setApiKey] = useState('');
  const [defaultReasoning, setDefaultReasoning] = useState(initial?.defaultReasoning ?? '');
  const [models, setModels] = useState<FormModel[]>(() => initial
    ? initial.models.map((model, index) => {
      const reasoning = readReasoning(model);
      return {
        id: model.id,
        name: model.name,
        context: formatCapacity(model.contextWindow),
        maxTokens: formatCapacity(model.maxTokens),
        text: model.input.includes('text') || !model.input.length,
        image: model.input.includes('image'),
        reasoningEnabled: reasoning.length > 0,
        reasoning,
        expanded: index === 0,
      };
    })
    : [blankModel()]);
  const [localError, setLocalError] = useState('');
  const [localNotice, setLocalNotice] = useState('');
  const [discoverOpen, setDiscoverOpen] = useState(false);
  const [discoverLoading, setDiscoverLoading] = useState(false);
  const [discoverError, setDiscoverError] = useState('');
  const [candidates, setCandidates] = useState<readonly CustomModelDefinition[]>([]);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [discoverQuery, setDiscoverQuery] = useState('');

  // 成功提示 3 秒后自动消失，避免吸顶横幅长期占用空间。
  useEffect(() => {
    if (!localNotice) return;
    const timer = window.setTimeout(() => setLocalNotice(''), 3_000);
    return () => window.clearTimeout(timer);
  }, [localNotice]);

  const updateModel = (index: number, patch: Partial<FormModel>) => {
    setModels(current => current.map((model, position) => position === index ? { ...model, ...patch } : model));
  };

  const updateReasoning = (index: number, position: number, patch: Partial<FormReasoningLevel>) => {
    setModels(current => current.map((model, at) => at === index
      ? { ...model, reasoning: model.reasoning.map((entry, slot) => slot === position ? { ...entry, ...patch } : entry) }
      : model));
  };

  // 与官方一致：开启时重置为 Off + 常见三档，关闭时不写 reasoningEfforts（手写模型即不提供推理）。
  const toggleReasoning = (index: number, on: boolean) => {
    updateModel(index, on ? { reasoningEnabled: true, reasoning: initialReasoning() } : { reasoningEnabled: false });
  };

  const changeReasoningLevel = (index: number, position: number, from: string, wire: string, to: string) => {
    // 非 Off 档位之间切换且已自定义参数值时保留原值，否则回到档位默认值。
    const next = typeof wire === 'string' && wire.length > 0 && wire !== from && from !== 'off' && to !== 'off'
      ? wire
      : defaultWire(to);
    updateReasoning(index, position, { level: to, value: next });
  };

  const addReasoningLevel = (index: number) => {
    setModels(current => current.map((model, at) => {
      if (at !== index) return model;
      const used = new Set(model.reasoning.map(entry => entry.level));
      const highest = Math.max(-1, ...model.reasoning.map(entry => (REASONING_LEVELS as readonly string[]).indexOf(entry.level)));
      const level = REASONING_LEVELS.find((candidate, slot) => slot > highest && !used.has(candidate))
        ?? REASONING_LEVELS.find(candidate => !used.has(candidate));
      return level === undefined ? model : { ...model, reasoning: [...model.reasoning, { level, value: defaultWire(level) }] };
    }));
  };

  /** 档位下拉的候选：当前值即使不在官方档位里也保留，其余只列未使用的档位。 */
  const reasoningChoices = (model: FormModel, level: string): readonly string[] => [
    ...(isReasoningLevel(level) ? [] : [level]),
    ...REASONING_LEVELS.filter(choice => choice === level || !model.reasoning.some(entry => entry.level === choice)),
  ];

  /** 把表单里的档位转换为 pi-ai 的 reasoningEfforts；返回字符串表示校验失败原因。 */
  const buildReasoning = (model: FormModel): Record<string, string | null> | string => {
    const efforts: [string, string | null][] = [];
    const seen = new Set<string>();
    for (const entry of model.reasoning) {
      if (seen.has(entry.level)) return `推理档位重复：${entry.level}。`;
      seen.add(entry.level);
      const wire = entry.value.trim();
      if (entry.level === 'off') {
        efforts.push(['off', wire || null]);
        continue;
      }
      if (!wire) return `档位 ${entry.level} 需要填写 API 参数值。`;
      efforts.push([entry.level, wire]);
    }
    if (!efforts.some(([level]) => level !== 'off')) return '至少添加一个 Off 以外的档位；不需要思考请关闭推理等级。';
    return Object.fromEntries(efforts);
  };

  /** 当前表单中所有模型声明过的档位，作为 Provider 默认档位的候选。 */
  const declaredLevels = [...new Set(models.flatMap(model =>
    model.reasoningEnabled ? model.reasoning.map(entry => entry.level) : []))]
    .filter(isReasoningLevel)
    .sort((left, right) => (REASONING_LEVELS as readonly string[]).indexOf(left) - (REASONING_LEVELS as readonly string[]).indexOf(right));

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
    setLocalNotice('');
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
    // 合并而不是覆盖：同 id 条目用探测结果更新元数据（保留原顺序与展开状态），
    // 新 id 追加到末尾，未勾选/未探测到的手工条目保持不变。
    const kept = models.filter(model => model.id.trim() || model.name.trim() || model.context.trim() || model.maxTokens.trim());
    const discovered = additions.map(candidate => ({
      id: candidate.id,
      name: candidate.name,
      context: formatCapacity(candidate.contextWindow),
      maxTokens: formatCapacity(candidate.maxTokens),
      text: candidate.input.includes('text') || !candidate.input.length,
      image: candidate.input.includes('image'),
      reasoningEnabled: false,
      reasoning: [],
      expanded: true,
    }));
    const { rows, added, updated } = mergeDiscoveredModels(kept, discovered, (existing, addition) => {
      // 探测结果只覆盖容量与输入类型；推理档位是手工声明，合并时必须保留。
      const merged = {
        ...existing,
        ...addition,
        reasoningEnabled: existing.reasoningEnabled,
        reasoning: existing.reasoning,
        expanded: existing.expanded,
      };
      const unchanged = merged.name === existing.name && merged.context === existing.context
        && merged.maxTokens === existing.maxTokens && merged.text === existing.text
        && merged.image === existing.image;
      return unchanged ? existing : merged;
    });
    setModels(rows);
    setDiscoverOpen(false);
    setDiscoverError('');
    setLocalError('');
    setLocalNotice(added || updated
      ? `已${added ? `添加 ${added} 个` : ''}${added && updated ? '、' : ''}${updated ? `更新 ${updated} 个` : ''}模型。`
      : '所选模型均已在列表中，无需重复添加。');
  };

  const submit = () => {
    setLocalError('');
    setLocalNotice('');
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
      const reasoning = model.reasoningEnabled ? buildReasoning(model) : undefined;
      if (typeof reasoning === 'string') {
        setLocalError(`模型 ${modelId}：${reasoning}`);
        return;
      }
      definitions.push({
        id: modelId,
        name: model.name.trim() || modelId,
        ...(contextWindow === undefined ? {} : { contextWindow }),
        ...(maxTokens === undefined ? {} : { maxTokens }),
        input,
        ...(model.reasoningEnabled && reasoning ? { reasoningEfforts: reasoning } : {}),
      });
    }
    if (defaultReasoning && !declaredLevels.includes(defaultReasoning)) {
      setLocalError(`默认推理等级 ${defaultReasoning} 未在任何模型中声明，请重新选择。`);
      return;
    }
    onSubmit({
      providerId: providerId.trim(),
      displayName: displayName.trim() || providerId.trim(),
      apiUrl: apiUrl.trim(),
      apiProtocol,
      apiKey: apiKey.trim(),
      models: definitions,
      ...(defaultReasoning ? { defaultReasoning } : {}),
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
        返回模型列表
      </button>
      {/* 页面级提示吸顶显示：表单较长时，滚动到任何位置都能立即看到校验/请求结果。 */}
      {localError || error || localNotice ? (
        <div className="mm-banners">
          {localError || error ? <p className="mm-error" role="alert">{localError || error}</p> : null}
          {localNotice ? <p className="mm-notice" role="status">{localNotice}</p> : null}
        </div>
      ) : null}

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
        {declaredLevels.length || defaultReasoning ? (
          <label className="mm-field">
            <span>默认推理等级</span>
            <select value={defaultReasoning} onChange={event => setDefaultReasoning(event.currentTarget.value)}>
              <option value="">跟随供应商默认</option>
              {declaredLevels.map(level => <option key={level} value={level}>{level}</option>)}
              {defaultReasoning && !declaredLevels.includes(defaultReasoning)
                ? <option value={defaultReasoning}>{defaultReasoning}（未声明）</option>
                : null}
            </select>
            <small>整个 Provider 生效，会话里未手动选择时使用该档位；模型未声明该档位时自动忽略。</small>
          </label>
        ) : null}
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
                全选
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
                      // 先取出选中状态：函数式更新回调可能延迟到事件结束后执行，
                      // 那时合成事件的 currentTarget 已被置空，直接读取会抛异常导致整页空白。
                      const checked = event.currentTarget.checked;
                      setSelectedIds(current => {
                        const next = new Set(current);
                        if (checked) next.add(candidate.id);
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
                  <div className="mm-reasoning">
                    <div className="mm-reasoning-head">
                      <span className="mm-reasoning-label">
                        <span className="mm-field-label">推理等级</span>
                        <span className="mm-help-wrap">
                          <button
                            type="button"
                            className="mm-help"
                            aria-label="推理等级说明"
                            aria-describedby={`mm-reasoning-help-${index}`}
                          >
                            ?
                          </button>
                          <span className="mm-tooltip" role="tooltip" id={`mm-reasoning-help-${index}`}>
                            API 参数值会写入请求的推理强度字段（如 OpenAI 的 reasoning_effort），默认与档位名相同；如有不同，以模型提供商的 API 文档为准。Off 表示关闭思考，不需要填写参数值；配置中已写入的值会保留并发送。
                          </span>
                        </span>
                      </span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={model.reasoningEnabled}
                        aria-label={`模型 ${index + 1} 推理等级`}
                        className={model.reasoningEnabled ? 'mm-switch on' : 'mm-switch'}
                        onClick={() => toggleReasoning(index, !model.reasoningEnabled)}
                      >
                        <span className="mm-switch-thumb" aria-hidden="true" />
                      </button>
                    </div>
                    {model.reasoningEnabled ? (
                      <>
                        {model.reasoning.length ? (
                          <div className="mm-reasoning-row mm-reasoning-columns" aria-hidden="true">
                            <span className="mm-field-label">档位</span>
                            <span className="mm-field-label">API 参数值</span>
                          </div>
                        ) : null}
                        {model.reasoning.map((entry, position) => (
                          <div className="mm-reasoning-row" key={`${entry.level}-${position}`}>
                            <select
                              className="mm-reasoning-select"
                              value={entry.level}
                              aria-label={`档位 ${position + 1}`}
                              onChange={event => changeReasoningLevel(index, position, entry.level, entry.value, event.currentTarget.value)}
                            >
                              {reasoningChoices(model, entry.level).map(choice => <option key={choice} value={choice}>{choice}</option>)}
                            </select>
                            <input
                              className="mm-reasoning-value"
                              value={entry.value}
                              disabled={entry.level === 'off'}
                              placeholder={entry.level === 'off' ? '关闭思考' : entry.level}
                              aria-label={`${entry.level} API 参数值`}
                              onChange={event => updateReasoning(index, position, { value: event.currentTarget.value })}
                              onBlur={() => {
                                // 非 Off 档位留空时回落到档位名，避免写出官方适配器会拒绝的空参数值。
                                if (entry.level !== 'off' && !entry.value.trim()) updateReasoning(index, position, { value: defaultWire(entry.level) });
                              }}
                            />
                            <button
                              type="button"
                              className="mm-remove-model"
                              aria-label={`删除档位 ${entry.level}`}
                              onClick={() => updateModel(index, { reasoning: model.reasoning.filter((_, slot) => slot !== position) })}
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
                        ))}
                        {reasoningError(model) ? <p className="mm-reasoning-error" role="alert">{reasoningError(model)}</p> : null}
                        <button
                          type="button"
                          className="mm-add-model"
                          disabled={model.reasoning.length >= REASONING_LEVELS.length}
                          onClick={() => addReasoningLevel(index)}
                        >
                          ＋ 添加档位
                        </button>
                      </>
                    ) : null}
                  </div>
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
          {busy ? <><span className="mm-spinner" />保存中…</> : '保存'}
        </button>
      </div>
    </div>
  );
}
