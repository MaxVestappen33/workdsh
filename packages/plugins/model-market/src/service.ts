/** 模型市场的宿主侧服务：授权模型查询、默认模型种子、安装/卸载与安装状态。 */
import { createHash } from 'node:crypto';
import { Service, type Context } from '@deepseek-ai/cordis';
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import {
  CUSTOM_API_PROTOCOLS, CUSTOM_PROVIDER_ID, DEFAULT_MODEL_MARKET_PATHS, installability, modelRouteEntry, protocolApi,
  type CustomModelDefinition, type CustomModelDraft, type CustomModelEntry,
  type ModelMarketDetail, type ModelMarketInstallResult, type ModelMarketModel, type ModelMarketPage,
  type ModelMarketPaths, type ModelMarketQuery, type ModelMarketUninstallResult,
} from './shared.js';
import { ModelMarketBackend, ModelMarketError, type BackendChannelLike, type BackendModel } from './market.js';
import { readMarketRecords, writeMarketRecords, type MarketRecordFile } from './records.js';

const SETTINGS_NS = 'llm-pi-ai';
const DEFAULT_MODEL_NS = 'agent-default-model';
const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_RETRY_MIN_MS = 15_000;
const DEFAULT_RETRY_MAX_MS = 300_000;

type SettingsPathOp =
  | { readonly op: 'set'; readonly path: readonly string[]; readonly value: unknown }
  | { readonly op: 'unset'; readonly path: readonly string[] };

interface SettingsDescriptorLike {
  readonly ns: string;
  readonly value?: unknown;
  readonly user?: unknown;
  readonly revision: number;
}

interface SettingsLike {
  readonly writable: boolean;
  describe(options?: { redactSecrets?: boolean }): readonly SettingsDescriptorLike[];
  mutate(ns: string, ops: readonly SettingsPathOp[], expectedRevision?: number): Promise<void>;
}

/** 与 settings 服务解耦的最小可用面：官方未挂载时明确报错，而不是静默写坏配置。 */
type ContextWithSettings = Context & { settings?: SettingsLike };

const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

const text = (value: unknown): string => typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';

const providersOf = (descriptor: SettingsDescriptorLike | undefined): Record<string, unknown> =>
  record(record(descriptor?.value)?.providers) ?? {};

const providerOf = (providers: Record<string, unknown>, route: string): Record<string, unknown> =>
  record(providers[route]) ?? {};

const modelsOf = (provider: Record<string, unknown>): Record<string, unknown>[] =>
  Array.isArray(provider.models) ? provider.models.flatMap(item => { const row = record(item); return row ? [row] : []; }) : [];

const isConflict = (cause: unknown): boolean =>
  cause !== null && typeof cause === 'object'
  && ((cause as { code?: unknown }).code === 'SETTINGS_CONFLICT' || (cause as { name?: unknown }).name === 'SettingsConflictError');

function routeBase(provider: string): string {
  const slug = provider.toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '');
  return slug ? `workdsh-${slug}` : 'workdsh-model';
}

function credentialName(route: string): string {
  return `${route.replace(/-/gu, '_').toUpperCase()}_API_KEY`;
}

function groupHashOf(model: BackendModel): string {
  return createHash('sha256')
    .update(`${model.provider}\u0000${model.apiProtocol}\u0000${model.apiUrl}\u0000${model.apiKey}`)
    .digest('hex');
}

function sanitize(model: BackendModel): ModelMarketModel {
  // 已经归一化过的字段不能再走一遍 normalizeModel：它会按后台原始字段名重新取值，
  // 导致 detail 返回的 providerName / departName 等 _dictText 结果丢失。
  const { apiKey: _apiKey, ...safe } = model;
  return safe;
}

const customProtocols = new Set<string>(CUSTOM_API_PROTOCOLS.map(([value]) => value));

function invalidCustom(message: string): never {
  throw new ModelMarketError('model-market/invalid-custom', message);
}

function parseCustomModels(value: unknown): readonly CustomModelDefinition[] {
  if (!Array.isArray(value) || value.length === 0) invalidCustom('请至少填写一个模型。');
  const seen = new Set<string>();
  return value.map(raw => {
    const row = record(raw);
    if (!row) invalidCustom('模型信息格式无效。');
    const id = text(row.id).trim();
    if (!id) invalidCustom('模型 ID 不能为空。');
    if (seen.has(id)) invalidCustom(`模型 ID 重复：${id}。`);
    seen.add(id);
    const contextValue = row.contextWindow;
    if (contextValue !== undefined && (typeof contextValue !== 'number' || !Number.isInteger(contextValue) || contextValue <= 0)) {
      invalidCustom(`模型 ${id} 的上下文窗口必须是正整数。`);
    }
    const maxValue = row.maxTokens;
    if (maxValue !== undefined && (typeof maxValue !== 'number' || !Number.isInteger(maxValue) || maxValue <= 0)) {
      invalidCustom(`模型 ${id} 的最大输出 token 数必须是正整数。`);
    }
    const inputs = Array.isArray(row.input)
      ? [...new Set(row.input.filter((item): item is 'text' | 'image' => item === 'text' || item === 'image'))]
      : [];
    if (!inputs.length) invalidCustom(`模型 ${id} 至少选择一种输入类型。`);
    return {
      id,
      name: text(row.name).trim() || id,
      ...(contextValue === undefined ? {} : { contextWindow: contextValue }),
      ...(maxValue === undefined ? {} : { maxTokens: maxValue }),
      input: inputs,
    };
  });
}

function parseCustomDraft(value: unknown, options: { requireKey?: boolean } = {}): CustomModelDraft {
  const row = record(value);
  if (!row) invalidCustom('自定义模型信息格式无效。');
  const providerId = text(row.providerId).trim();
  if (!CUSTOM_PROVIDER_ID.test(providerId)) invalidCustom('Provider ID 必须以小写字母开头，且只包含小写字母、数字和连字符。');
  const apiUrl = text(row.apiUrl).trim();
  let url: URL;
  try {
    url = new URL(apiUrl);
  } catch {
    invalidCustom('API 地址不是有效的 URL。');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') invalidCustom('API 地址必须使用 HTTP 或 HTTPS。');
  const apiProtocol = text(row.apiProtocol).trim();
  if (!customProtocols.has(apiProtocol)) invalidCustom('请选择支持的 API 协议。');
  const apiKey = text(row.apiKey).trim();
  if (!apiKey && options.requireKey !== false) invalidCustom('请填写 API 密钥。');
  return {
    providerId,
    displayName: text(row.displayName).trim() || providerId,
    apiUrl,
    apiProtocol,
    apiKey,
    models: parseCustomModels(row.models),
    setDefault: row.setDefault === true,
  };
}

const positiveNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.trunc(value) : undefined;

function inputModalities(value: unknown): readonly ('text' | 'image')[] {
  const rows = Array.isArray(value) ? value : [];
  const result = new Set<'text' | 'image'>();
  for (const item of rows) {
    const label = text(item).toLowerCase();
    if (label.includes('image') || label.includes('vision')) result.add('image');
    if (label.includes('text')) result.add('text');
  }
  return result.size ? [...result] : ['text'];
}

/** 把 OpenAI / Anthropic 的模型列表响应归一化为表单候选。 */
function discoveredModels(payload: unknown): readonly CustomModelDefinition[] {
  const root = record(payload) ?? {};
  const source = Array.isArray(root.data)
    ? root.data
    : Array.isArray(root.models)
      ? root.models
      : record(root.models)
        ? Object.entries(root.models as Record<string, unknown>).map(([id, value]) => ({ ...(record(value) ?? {}), id }))
        : [];
  const seen = new Set<string>();
  return source.flatMap(raw => {
    const row = record(raw);
    if (!row) return [];
    const id = text(row.id).trim();
    if (!id || seen.has(id)) return [];
    seen.add(id);
    const contextWindow = positiveNumber(row.context_window)
      ?? positiveNumber(row.context_length)
      ?? positiveNumber(row.max_input_tokens)
      ?? positiveNumber(row.contextWindow);
    const maxTokens = positiveNumber(row.max_output_tokens)
      ?? positiveNumber(row.max_tokens)
      ?? positiveNumber(row.maxTokens);
    return [{
      id,
      name: text(row.display_name) || text(row.name) || id,
      ...(contextWindow === undefined ? {} : { contextWindow }),
      ...(maxTokens === undefined ? {} : { maxTokens }),
      input: inputModalities(row.input ?? row.input_modalities ?? row.inputModalities ?? row.modalities),
    }];
  });
}

export interface ModelMarketOptions {
  /** 市场接口路径；Desktop 从 workdsh-app.json 注入，未配置时回退到内置默认值。 */
  readonly paths?: Partial<ModelMarketPaths>;
}

export interface ModelMarketServiceApi {
  available(): Promise<boolean>;
  list(input?: ModelMarketQuery, signal?: AbortSignal): Promise<ModelMarketPage>;
  detail(id: string, signal?: AbortSignal): Promise<ModelMarketDetail>;
  install(id: string, signal?: AbortSignal): Promise<ModelMarketInstallResult>;
  uninstall(id: string, signal?: AbortSignal): Promise<ModelMarketUninstallResult>;
  /** 本机自定义模型（来自安装记录，不属于后台授权列表）。 */
  customList(): Promise<readonly CustomModelEntry[]>;
  customInstall(input: unknown): Promise<CustomModelEntry>;
  /** 编辑已安装的自定义模型；key 可以省略 custom: 前缀。 */
  customUpdate(key: string, input: unknown): Promise<CustomModelEntry>;
  customUninstall(key: string): Promise<ModelMarketUninstallResult>;
  /** 用当前表单的地址、协议和密钥探测可用的模型目录。 */
  customDiscover(input: unknown): Promise<readonly CustomModelDefinition[]>;
}

declare module '@deepseek-ai/cordis' { interface Context { workdshModelMarket: ModelMarketServiceApi } }

export class ModelMarketService extends Service implements ModelMarketServiceApi {
  static inject = ['settings', 'credentials', 'connection'];
  private readonly backend: ModelMarketBackend;
  /** 串行化安装/卸载与默认模型种子，避免同一配置被并发写坏。 */
  private serial: Promise<unknown> = Promise.resolve();
  private defaultsTimer?: ReturnType<typeof setTimeout>;
  private defaultsDone = false;
  private retryDelay = DEFAULT_RETRY_MIN_MS;

  constructor(ctx: Context, options: ModelMarketOptions = {}) {
    super(ctx, 'workdshModelMarket');
    const paths: ModelMarketPaths = { ...DEFAULT_MODEL_MARKET_PATHS, ...options.paths };
    this.backend = new ModelMarketBackend(
      () => this.ctx.reflect.get('workdshBackend') as BackendChannelLike | undefined,
      paths,
    );
  }

  [Service.init](): void {
    this.ctx.effect(() => () => {
      if (this.defaultsTimer) clearTimeout(this.defaultsTimer);
      this.defaultsTimer = undefined;
    }, 'workdsh.modelMarket.defaults');
    // 登录绑定由身份提供方稍后建立；延迟首次尝试，失败后按指数退避重试。
    this.scheduleDefaults(3_000);
  }

  async available(): Promise<boolean> {
    return this.backend.available();
  }

  async list(input: ModelMarketQuery = {}, signal?: AbortSignal): Promise<ModelMarketPage> {
    const page = await this.backend.list(input, signal);
    // 市场页被打开时也尝试补齐默认模型，避免用户必须先重启客户端。
    this.scheduleDefaults(0);
    return { ...page, installedIds: await this.installedIds() };
  }

  async detail(id: string, signal?: AbortSignal): Promise<ModelMarketDetail> {
    const model = await this.backend.get(id, signal);
    const records = await readMarketRecords();
    const installed = (await this.installedIds()).includes(id);
    return { model: sanitize(model), installed, ...(installed && records.installs[id] ? { route: records.installs[id].route } : {}) };
  }

  async install(id: string, signal?: AbortSignal): Promise<ModelMarketInstallResult> {
    return this.enqueue(() => this.installInternal(id, signal, true));
  }

  async uninstall(id: string, signal?: AbortSignal): Promise<ModelMarketUninstallResult> {
    return this.enqueue(() => this.uninstallInternal(id, signal));
  }

  async customList(): Promise<readonly CustomModelEntry[]> {
    const descriptor = this.descriptor(SETTINGS_NS);
    if (!descriptor) return [];
    const providers = providersOf(descriptor);
    const records = await readMarketRecords();
    const defaultSelection = record(this.descriptor(DEFAULT_MODEL_NS)?.value) ?? {};
    return Object.entries(records.installs).flatMap(([key, install]) => {
      if (install.kind !== 'custom') return [];
      const provider = record(providers[install.route]);
      if (!provider) return [];
      const models = modelsOf(provider).flatMap(row => {
        const id = text(row.id);
        if (!id) return [];
        const contextWindow = typeof row.contextWindow === 'number' ? row.contextWindow : undefined;
        const maxTokens = typeof row.maxTokens === 'number' ? row.maxTokens : undefined;
        const inputs = Array.isArray(row.input)
          ? row.input.filter((item): item is 'text' | 'image' => item === 'text' || item === 'image')
          : [];
        return [{
          id,
          name: text(row.name) || id,
          ...(contextWindow === undefined ? {} : { contextWindow }),
          ...(maxTokens === undefined ? {} : { maxTokens }),
          input: inputs.length ? inputs : ['text'] as const,
        }];
      });
      return [{
        key,
        providerId: install.route,
        displayName: text(provider.displayName) || install.route,
        apiUrl: text(provider.baseURL),
        apiProtocol: text(provider.api),
        models,
        installed: true as const,
        isDefault: text(defaultSelection.provider) === install.route,
      }];
    }).sort((left, right) => left.displayName.localeCompare(right.displayName, 'zh-CN'));
  }

  async customInstall(input: unknown): Promise<CustomModelEntry> {
    return this.enqueue(() => this.customInstallInternal(input));
  }

  async customUpdate(key: string, input: unknown): Promise<CustomModelEntry> {
    return this.enqueue(() => this.customUpdateInternal(key, input));
  }

  async customUninstall(key: string): Promise<ModelMarketUninstallResult> {
    return this.enqueue(() => this.customUninstallInternal(key));
  }

  async customDiscover(input: unknown): Promise<readonly CustomModelDefinition[]> {
    return this.discoverCustomModels(input);
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.serial.then(task, task);
    this.serial = run.then(() => undefined, () => undefined);
    return run;
  }

  private settings(): SettingsLike {
    const service = (this.ctx as ContextWithSettings).settings;
    if (!service) throw new ModelMarketError('model-market/settings-unavailable', '当前环境缺少模型配置，无法安装。');
    return service;
  }

  private descriptor(ns: string): SettingsDescriptorLike | undefined {
    return this.settings().describe({ redactSecrets: true }).find(item => item.ns === ns);
  }

  private async installedIds(): Promise<readonly string[]> {
    const descriptor = this.descriptor(SETTINGS_NS);
    if (!descriptor) return [];
    const providers = providersOf(descriptor);
    const records = await readMarketRecords();
    return Object.entries(records.installs).flatMap(([id, install]) => {
      if (install.kind === 'custom') return [];
      const models = modelsOf(providerOf(providers, install.route));
      return models.some(model => text(model.id) === install.modelCode) ? [id] : [];
    });
  }

  private async installInternal(id: string, signal: AbortSignal | undefined, setDefault: boolean): Promise<ModelMarketInstallResult> {
    const records = await readMarketRecords();
    const model = await this.backend.get(id, signal);
    const usable = installability(model);
    if (!usable.installable) {
      const code = !model.modelCode.trim() || !model.apiUrl.trim()
        ? 'model-market/invalid-model'
        : protocolApi(model.apiProtocol) ? 'model-market/unsupported-type' : 'model-market/unsupported-protocol';
      throw new ModelMarketError(code, usable.reason);
    }
    const api = protocolApi(model.apiProtocol)!;
    if (!model.apiKey.trim()) throw new ModelMarketError('model-market/invalid-model', '模型缺少访问密钥，无法安装。');

    const settings = this.settings();
    if (!settings.writable) throw new ModelMarketError('model-market/settings-readonly', '当前配置为只读，无法安装模型。');
    const descriptor = this.descriptor(SETTINGS_NS);
    if (!descriptor) throw new ModelMarketError('model-market/settings-unavailable', '当前环境缺少模型配置，无法安装。');
    const providers = providersOf(descriptor);
    const groupHash = groupHashOf(model);
    const route = this.allocateRoute(model, groupHash, providers, records);
    const credentialRefName = credentialName(route);
    const entry = modelRouteEntry(model);

    const changedCredential = await this.writeCredential(credentialRefName, model.apiKey);
    try {
      await this.mutateProvider(providersNow => {
        const provider = providerOf(providersNow, route);
        const models = modelsOf(provider);
        const index = models.findIndex(item => text(item.id) === entry.id);
        const next = index >= 0
          ? models.map((item, position) => position === index ? { ...item, ...entry } : item)
          : [...models, entry];
        return [
          { op: 'set', path: ['providers', route, 'displayName'], value: model.providerName || model.provider || route },
          { op: 'set', path: ['providers', route, 'api'], value: api },
          { op: 'set', path: ['providers', route, 'baseURL'], value: model.apiUrl },
          { op: 'set', path: ['providers', route, 'apiKeyEnv'], value: credentialRefName },
          { op: 'set', path: ['providers', route, 'models'], value: next },
        ];
      });
    } catch (cause) {
      if (changedCredential) await this.removeCredential(credentialRefName);
      throw cause;
    }

    const install = { route, modelCode: entry.id, groupHash, credentialRef: credentialRefName, installedAt: new Date().toISOString() };
    await this.updateRecords(current => ({
      ...current,
      installs: { ...current.installs, [id]: install },
      handledDefaults: model.isDefault ? [...current.handledDefaults, id] : current.handledDefaults,
      // 用户重新安装某个默认模型后，撤销先前的卸载忽略，允许后续缺失时再次自动补齐。
      dismissedDefaults: current.dismissedDefaults.filter(value => value !== id),
    }));

    if (setDefault && model.isDefault) await this.setSessionDefault(model, route);
    await this.report('use', id);
    return { installed: true, route, modelCode: entry.id };
  }

  private async uninstallInternal(id: string, signal: AbortSignal | undefined): Promise<ModelMarketUninstallResult> {
    const records = await readMarketRecords();
    const install = records.installs[id];
    if (!install) throw new ModelMarketError('model-market/not-installed', '该模型尚未安装。');
    const descriptor = this.descriptor(SETTINGS_NS);
    if (!descriptor) throw new ModelMarketError('model-market/settings-unavailable', '当前环境缺少模型配置，无法卸载。');

    const providers = providersOf(descriptor);
    if (providers[install.route] !== undefined) {
      const remaining = modelsOf(providerOf(providers, install.route)).filter(model => text(model.id) !== install.modelCode);
      await this.mutateProvider(() => remaining.length === 0
        ? [{ op: 'unset', path: ['providers', install.route] }]
        : [{ op: 'set', path: ['providers', install.route, 'models'], value: remaining }]);
      if (remaining.length === 0) await this.removeCredential(install.credentialRef);
    }

    await this.updateRecords(current => ({
      ...current,
      installs: Object.fromEntries(Object.entries(current.installs).filter(([key]) => key !== id)),
      handledDefaults: [...new Set([...current.handledDefaults, id])],
      dismissedDefaults: [...new Set([...current.dismissedDefaults, id])],
    }));
    await this.clearSessionDefault(install.route, install.modelCode);
    const reported = await this.report('unuse', id, signal);
    return { uninstalled: true, reported };
  }

  private async customInstallInternal(input: unknown): Promise<CustomModelEntry> {
    const draft = parseCustomDraft(input);
    const settings = this.settings();
    if (!settings.writable) throw new ModelMarketError('model-market/settings-readonly', '当前配置为只读，无法安装模型。');
    const descriptor = this.descriptor(SETTINGS_NS);
    if (!descriptor) throw new ModelMarketError('model-market/settings-unavailable', '当前环境缺少模型配置，无法安装。');
    if (providersOf(descriptor)[draft.providerId] !== undefined) {
      throw new ModelMarketError('model-market/provider-exists', 'Provider ID 已存在，请换一个。');
    }

    const route = draft.providerId;
    const credentialRefName = credentialName(route);
    const changedCredential = await this.writeCredential(credentialRefName, draft.apiKey);
    try {
      await this.mutateProvider(providersNow => {
        if (providersNow[route] !== undefined) {
          throw new ModelMarketError('model-market/provider-exists', 'Provider ID 已存在，请换一个。');
        }
        return [
          { op: 'set', path: ['providers', route, 'displayName'], value: draft.displayName },
          { op: 'set', path: ['providers', route, 'api'], value: draft.apiProtocol },
          { op: 'set', path: ['providers', route, 'baseURL'], value: draft.apiUrl },
          { op: 'set', path: ['providers', route, 'apiKeyEnv'], value: credentialRefName },
          { op: 'set', path: ['providers', route, 'models'], value: draft.models },
        ];
      });
    } catch (cause) {
      if (changedCredential) await this.removeCredential(credentialRefName);
      throw cause;
    }

    const key = `custom:${route}`;
    await this.updateRecords(current => ({
      ...current,
      installs: {
        ...current.installs,
        [key]: {
          kind: 'custom', route, modelCode: '', modelCodes: draft.models.map(model => model.id),
          groupHash: key, credentialRef: credentialRefName, installedAt: new Date().toISOString(),
        },
      },
    }));
    if (draft.setDefault) await this.setSessionDefault({ modelCode: draft.models[0]!.id }, route);
    return {
      key,
      providerId: route,
      displayName: draft.displayName,
      apiUrl: draft.apiUrl,
      apiProtocol: draft.apiProtocol,
      models: draft.models,
      installed: true,
      isDefault: draft.setDefault,
    };
  }

  private async customUpdateInternal(key: string, input: unknown): Promise<CustomModelEntry> {
    const records = await readMarketRecords();
    const route = key.startsWith('custom:') ? key.slice('custom:'.length) : key;
    const recordKey = Object.keys(records.installs).find(candidate => {
      const install = records.installs[candidate];
      return install.kind === 'custom' && (candidate === key || install.route === route);
    });
    if (!recordKey) throw new ModelMarketError('model-market/not-installed', '该自定义模型尚未安装。');
    const install = records.installs[recordKey]!;
    // 编辑时密钥留空表示沿用现有凭据，因此不强制要求重新填写。
    const draft = parseCustomDraft(input, { requireKey: false });
    if (draft.providerId !== install.route) throw new ModelMarketError('model-market/invalid-custom', 'Provider ID 创建后不能修改。');
    const settings = this.settings();
    if (!settings.writable) throw new ModelMarketError('model-market/settings-readonly', '当前配置为只读，无法保存修改。');
    const descriptor = this.descriptor(SETTINGS_NS);
    if (!descriptor) throw new ModelMarketError('model-market/settings-unavailable', '当前环境缺少模型配置，无法保存修改。');
    if (providersOf(descriptor)[install.route] === undefined) {
      throw new ModelMarketError('model-market/not-installed', '该自定义模型尚未安装。');
    }

    if (draft.apiKey) await this.writeCredential(install.credentialRef, draft.apiKey);
    await this.mutateProvider(() => [
      { op: 'set', path: ['providers', install.route, 'displayName'], value: draft.displayName },
      { op: 'set', path: ['providers', install.route, 'api'], value: draft.apiProtocol },
      { op: 'set', path: ['providers', install.route, 'baseURL'], value: draft.apiUrl },
      { op: 'set', path: ['providers', install.route, 'apiKeyEnv'], value: install.credentialRef },
      { op: 'set', path: ['providers', install.route, 'models'], value: draft.models },
    ]);
    await this.updateRecords(current => ({
      ...current,
      installs: {
        ...current.installs,
        [recordKey]: { ...install, modelCodes: draft.models.map(model => model.id) },
      },
    }));

    // 会话默认指向被删掉的模型时回落到第一个模型，避免默认模型悬空。
    const selection = record(this.descriptor(DEFAULT_MODEL_NS)?.value) ?? {};
    const defaultRoute = text(selection.provider);
    const defaultModel = text(selection.model);
    if (defaultRoute === install.route && defaultModel && !draft.models.some(model => model.id === defaultModel)) {
      await this.setSessionDefault({ modelCode: draft.models[0]!.id }, install.route);
    }
    return {
      key: recordKey,
      providerId: install.route,
      displayName: draft.displayName,
      apiUrl: draft.apiUrl,
      apiProtocol: draft.apiProtocol,
      models: draft.models,
      installed: true,
      isDefault: defaultRoute === install.route,
    };
  }

  private async customUninstallInternal(key: string): Promise<ModelMarketUninstallResult> {
    const records = await readMarketRecords();
    const route = key.startsWith('custom:') ? key.slice('custom:'.length) : key;
    const recordKey = Object.keys(records.installs).find(candidate => {
      const install = records.installs[candidate];
      return install.kind === 'custom' && (candidate === key || install.route === route);
    });
    if (!recordKey) throw new ModelMarketError('model-market/not-installed', '该自定义模型尚未安装。');
    const install = records.installs[recordKey]!;
    const descriptor = this.descriptor(SETTINGS_NS);
    if (descriptor && providersOf(descriptor)[install.route] !== undefined) {
      await this.mutateProvider(() => [{ op: 'unset', path: ['providers', install.route] }]);
    }
    await this.removeCredential(install.credentialRef);
    await this.updateRecords(current => ({
      ...current,
      installs: Object.fromEntries(Object.entries(current.installs).filter(([id]) => id !== recordKey)),
    }));
    await this.clearSessionDefault(install.route);
    return { uninstalled: true, reported: true };
  }

  /** 用当前表单的接口信息探测模型目录；密钥只用于本次请求，不落盘。 */
  private async discoverCustomModels(input: unknown): Promise<readonly CustomModelDefinition[]> {
    const row = record(input);
    if (!row) throw new ModelMarketError('model-market/discover-failed', '探测参数无效。');
    const apiUrl = text(row.apiUrl).trim();
    const apiProtocol = text(row.apiProtocol).trim();
    const apiKey = text(row.apiKey).trim();
    let url: URL;
    try {
      url = new URL(apiUrl);
    } catch {
      throw new ModelMarketError('model-market/discover-failed', 'API 地址不是有效的 URL。');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new ModelMarketError('model-market/discover-failed', 'API 地址必须使用 HTTP 或 HTTPS。');
    }
    if (!customProtocols.has(apiProtocol)) throw new ModelMarketError('model-market/discover-failed', '请选择支持的 API 协议。');
    if (!apiKey) throw new ModelMarketError('model-market/discover-failed', '请先填写 API 密钥。');

    const base = apiUrl.replace(/\/+$/u, '');
    const anthropic = apiProtocol === 'anthropic-messages';
    const target = anthropic
      ? `${base}${base.endsWith('/v1') ? '' : '/v1'}/models?limit=1000`
      : `${base}/models`;
    const headers: Record<string, string> = anthropic
      ? { accept: 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
      : { accept: 'application/json', authorization: `Bearer ${apiKey}` };
    let response: Response;
    try {
      response = await fetch(target, { headers, redirect: 'error', signal: AbortSignal.timeout(20_000) });
    } catch {
      throw new ModelMarketError('model-market/discover-failed', '无法连接模型接口，请检查地址和网络。');
    }
    if (!response.ok) {
      throw new ModelMarketError('model-market/discover-failed', `模型接口返回 ${response.status}，请检查地址、协议和密钥。`);
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new ModelMarketError('model-market/discover-failed', '模型接口返回的数据无法识别。');
    }
    const models = discoveredModels(payload);
    if (!models.length) throw new ModelMarketError('model-market/discover-failed', '接口没有返回可用模型。');
    return models;
  }

  /** 同一组（供应商 + 协议 + 地址 + 密钥）复用已有路由，否则分配新的 workdsh-* 路由。 */
  private allocateRoute(
    model: BackendModel,
    groupHash: string,
    providers: Record<string, unknown>,
    records: MarketRecordFile,
  ): string {
    for (const install of Object.values(records.installs)) {
      if (install.groupHash === groupHash && providers[install.route] !== undefined) return install.route;
    }
    const base = routeBase(model.provider);
    let candidate = base;
    let suffix = 2;
    while (providers[candidate] !== undefined) candidate = `${base}-${suffix++}`;
    return candidate;
  }

  /** 写入 Key；由启动环境提供的只读凭据只在值与后台一致时接受。 */
  private async writeCredential(name: string, value: string): Promise<boolean> {
    const reference = credentialRef(name) as unknown as Parameters<Context['credentials']['describe']>[0];
    const described = await this.ctx.credentials.describe(reference);
    if (described.configured && !described.writable) {
      const current = await this.ctx.credentials.resolve(reference);
      if (current?.value !== value) {
        throw new ModelMarketError('model-market/credential-readonly', '模型密钥由启动环境提供，无法覆盖，请在该环境中更新。');
      }
      return false;
    }
    await this.ctx.credentials.set(reference, value);
    return !described.configured;
  }

  private async removeCredential(name: string): Promise<void> {
    const reference = credentialRef(name) as unknown as Parameters<Context['credentials']['describe']>[0];
    try {
      const described = await this.ctx.credentials.describe(reference);
      if (described.writable) await this.ctx.credentials.unset(reference);
    } catch {
      // 凭据清理是尽力而为：配置已经移除，残留密钥不会让模型继续可用。
    }
  }

  /** 读取最新 revision 后写入；并发修改时重读一次配置再构建操作。 */
  private async mutateProvider(build: (providers: Record<string, unknown>) => readonly SettingsPathOp[]): Promise<void> {
    const settings = this.settings();
    for (let attempt = 0; attempt < 2; attempt++) {
      const descriptor = this.descriptor(SETTINGS_NS);
      if (!descriptor) throw new ModelMarketError('model-market/settings-unavailable', '当前环境缺少模型配置，无法安装。');
      try {
        await settings.mutate(SETTINGS_NS, build(providersOf(descriptor)), descriptor.revision);
        return;
      } catch (cause) {
        if (attempt === 0 && isConflict(cause)) continue;
        if (cause instanceof ModelMarketError) throw cause;
        if (isConflict(cause)) throw new ModelMarketError('model-market/conflict', '模型配置已被其他操作修改，请刷新后重试。');
        throw new ModelMarketError('model-market/settings-rejected', cause instanceof Error ? cause.message : '模型配置写入失败。');
      }
    }
  }

  /** 把默认模型同步为会话默认；失败只记录日志，不影响模型已经安装成功。 */
  private async setSessionDefault(model: Pick<ModelMarketModel, 'modelCode'>, route: string): Promise<void> {
    try {
      const descriptor = this.descriptor(DEFAULT_MODEL_NS);
      if (!descriptor) return;
      const settings = this.settings();
      if (!settings.writable) return;
      const current = record(descriptor.value) ?? {};
      if (text(current.provider) === route && text(current.model) === model.modelCode) return;
      await settings.mutate(DEFAULT_MODEL_NS, [
        { op: 'set', path: ['provider'], value: route },
        { op: 'set', path: ['model'], value: model.modelCode },
        { op: 'unset', path: ['reasoningEffort'] },
      ], descriptor.revision);
    } catch (cause) {
      this.ctx.logger.warn(`模型市场：默认模型会话配置未写入（${cause instanceof Error ? cause.message : String(cause)}）。`);
    }
  }

  /** 卸载默认模型时撤销会话默认覆盖，回退到组成层默认值。 */
  private async clearSessionDefault(route: string, modelCode?: string): Promise<void> {
    try {
      const descriptor = this.descriptor(DEFAULT_MODEL_NS);
      if (!descriptor) return;
      const current = record(descriptor.value) ?? {};
      if (text(current.provider) !== route || (modelCode !== undefined && text(current.model) !== modelCode)) return;
      const settings = this.settings();
      if (!settings.writable) return;
      await settings.mutate(DEFAULT_MODEL_NS, [
        { op: 'unset', path: ['provider'] },
        { op: 'unset', path: ['model'] },
        { op: 'unset', path: ['reasoningEffort'] },
      ], descriptor.revision);
    } catch (cause) {
      this.ctx.logger.warn(`模型市场：会话默认模型未清除（${cause instanceof Error ? cause.message : String(cause)}）。`);
    }
  }

  private async updateRecords(update: (current: MarketRecordFile) => MarketRecordFile): Promise<void> {
    const current = await readMarketRecords();
    await writeMarketRecords(update(current));
  }

  /** 后台当前只做记账；失败不改变本机安装结果。 */
  private async report(kind: 'use' | 'unuse', id: string, signal?: AbortSignal): Promise<boolean> {
    try {
      if (kind === 'use') await this.backend.use(id, signal);
      else await this.backend.unuse(id, signal);
      return true;
    } catch (cause) {
      this.ctx.logger.warn(`模型市场：${kind === 'use' ? '使用' : '卸载'}上报失败（${cause instanceof Error ? cause.message : String(cause)}）。`);
      return false;
    }
  }

  private scheduleDefaults(delay: number): void {
    if (this.defaultsDone || this.defaultsTimer) return;
    this.defaultsTimer = setTimeout(() => {
      this.defaultsTimer = undefined;
      void this.enqueue(() => this.ensureDefaults()).catch(cause => {
        this.ctx.logger.warn(`模型市场：默认模型初始化失败（${cause instanceof Error ? cause.message : String(cause)}）。`);
      });
    }, delay);
    this.defaultsTimer.unref?.();
  }

  /** 首次登录后安装 isDefault=1 的模型；用户卸载过的默认模型不再自动装回。 */
  private async ensureDefaults(): Promise<void> {
    if (this.defaultsDone) return;
    if (!(await this.backend.available())) {
      this.scheduleDefaults(DEFAULT_RETRY_MIN_MS);
      return;
    }
    const defaults = await this.fetchDefaults();
    if (!defaults.length) {
      this.defaultsDone = true;
      return;
    }
    const handled = new Set<string>();
    let firstInstalled: ModelMarketModel | undefined;
    let pending = false;
    for (const model of defaults) {
      const current = await readMarketRecords();
      if (current.dismissedDefaults.includes(model.id) || current.handledDefaults.includes(model.id)) continue;
      if ((await this.installedIds()).includes(model.id)) {
        // 已经安装但不改写当前会话默认：避免每次启动都覆盖用户在模型选择器里的选择。
        handled.add(model.id);
        continue;
      }
      const usable = installability(model);
      if (!usable.installable) {
        // 类型/协议不支持是永久结论；缺少地址或密钥属于后台数据问题，下次启动继续尝试。
        const permanent = (model.modelType !== 'LLM' && model.modelType !== 'MLLM') || !protocolApi(model.apiProtocol);
        if (permanent) handled.add(model.id);
        this.ctx.logger.warn(`模型市场：默认模型「${model.modelName || model.modelCode}」跳过自动安装：${usable.reason}。`);
        continue;
      }
      try {
        await this.installInternal(model.id, undefined, false);
        handled.add(model.id);
        firstInstalled ??= model;
      } catch (cause) {
        pending = true;
        this.ctx.logger.warn(`模型市场：默认模型「${model.modelName || model.modelCode}」安装失败（${cause instanceof Error ? cause.message : String(cause)}）。`);
      }
    }
    if (handled.size) {
      await this.updateRecords(current => ({
        ...current,
        handledDefaults: [...new Set([...current.handledDefaults, ...handled])],
      }));
    }
    if (firstInstalled) {
      const records = await readMarketRecords();
      const route = records.installs[firstInstalled.id]?.route;
      if (route) await this.setSessionDefault(firstInstalled, route);
    }
    if (pending) {
      const delay = this.retryDelay;
      this.retryDelay = Math.min(this.retryDelay * 2, DEFAULT_RETRY_MAX_MS);
      this.scheduleDefaults(delay);
    } else {
      this.retryDelay = DEFAULT_RETRY_MIN_MS;
      this.defaultsDone = true;
    }
  }

  private async fetchDefaults(): Promise<readonly ModelMarketModel[]> {
    const rows: ModelMarketModel[] = [];
    for (let pageNo = 1; pageNo <= 10; pageNo++) {
      const page = await this.backend.list({ isDefault: true, pageNo, pageSize: DEFAULT_PAGE_SIZE });
      rows.push(...page.records);
      if (page.pages === 0 || pageNo >= page.pages || page.records.length === 0) break;
    }
    return rows;
  }
}
