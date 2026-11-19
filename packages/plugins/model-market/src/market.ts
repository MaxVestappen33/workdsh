/** 业务后台模型接口的宿主侧客户端：只负责请求、分页归一化与字段脱敏。 */
import {
  API_PROTOCOLS, MODEL_PROVIDERS, MODEL_TYPES, dictionaryLabel,
  nonNegativeInteger, positiveInteger,
  type ModelAdminSsoTarget, type ModelApplyStatus, type ModelMarketModel, type ModelMarketPage, type ModelMarketPaths,
  type ModelMarketQuery, type ModelReasoningLevel,
} from './shared.js';

/** 通用业务后台通道（由 workdsh-provider-backend-channel 提供）的最小结构。 */
export interface BackendChannelLike {
  available(): Promise<boolean>;
  get<T = unknown>(path: string, query?: Readonly<Record<string, string | number | undefined>>, signal?: AbortSignal): Promise<T>;
  post<T = unknown>(path: string, body?: unknown, query?: Readonly<Record<string, string | number | undefined>>, signal?: AbortSignal): Promise<T>;
}

export class ModelMarketError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'ModelMarketError';
  }
}

const text = (value: unknown): string =>
  typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';

const flag = (value: unknown): boolean =>
  value === true || value === 1 || value === '1' || value === 'true';

/**
 * isAuthorized：Y 已授权、N 未授权；字段缺失或未知取值按已授权兜底，
 * 与 MCP 市场对旧后台的口径一致。后台对 is_default=1 统一下发 Y，客户端不做特例。
 */
const authorizedOf = (value: unknown): boolean => {
  if (value === false || value === 0) return false;
  const raw = text(value).trim().toUpperCase();
  return raw !== 'N';
};

/** applyStatus：只接受四个已知取值，其它（含缺省）按 none（未申请）处理。 */
const applyStatusOf = (value: unknown): ModelApplyStatus => {
  const raw = text(value).trim().toLowerCase();
  return raw === 'pending' || raw === 'approved' || raw === 'rejected' ? raw : 'none';
};

const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

const rowsOf = (value: unknown): unknown[] => {
  const rows = record(value)?.records;
  return Array.isArray(rows) ? rows : [];
};

/**
 * 推理等级表：后台以 JSON 字符串返回。解析失败、为空或行结构不完整时按「没有档位」处理，
 * 界面上就不渲染推理等级表，不让脏数据把整页详情打挂。
 */
function reasoningLevels(value: unknown): readonly ModelReasoningLevel[] {
  let source: unknown = value;
  if (typeof value === 'string') {
    if (!value.trim()) return [];
    try {
      source = JSON.parse(value) as unknown;
    } catch {
      return [];
    }
  }
  if (!Array.isArray(source)) return [];
  return source.flatMap(item => {
    const row = record(item);
    if (!row) return [];
    const tier = text(row.tier).trim();
    const label = text(row.value).trim();
    if (!tier && !label) return [];
    return [{ tier, value: label, description: text(row.description), rate: text(row.rate) }];
  });
}

/** 把后台一行 AiModel 归一化为界面模型；缺少主键的行直接丢弃。 */
export function normalizeModel(value: unknown): ModelMarketModel | undefined {
  const row = record(value);
  if (!row) return undefined;
  const id = text(row.id).trim();
  if (!id) return undefined;
  const provider = text(row.provider);
  const modelType = text(row.modelType);
  const apiProtocol = text(row.apiProtocol);
  return {
    id,
    provider,
    providerName: text(row.provider_dictText) || dictionaryLabel(MODEL_PROVIDERS, provider),
    modelName: text(row.modelName),
    version: text(row.version),
    modelCode: text(row.modelCode),
    modelType,
    modelTypeName: text(row.modelType_dictText) || dictionaryLabel(MODEL_TYPES, modelType),
    contextLength: text(row.contextLength),
    maxOutputTokens: text(row.maxOutputTokens),
    inputTypes: text(row.inputTypes),
    reasoningLevelEnabled: flag(row.reasoningLevelEnabled),
    reasoningLevels: reasoningLevels(row.reasoningLevels),
    subscribeCount: nonNegativeInteger(row.subscribeCount, 0),
    icon: text(row.icon),
    apiProtocol,
    apiProtocolName: text(row.apiProtocol_dictText) || dictionaryLabel(API_PROTOCOLS, apiProtocol),
    apiUrl: text(row.apiUrl),
    isDefault: flag(row.isDefault),
    description: text(row.description),
    tag: text(row.tag),
    owner: text(row.owner),
    depart: text(row.depart),
    departName: text(row.depart_dictText),
    createTime: text(row.createTime),
    updateTime: text(row.updateTime),
    authorized: authorizedOf(row.isAuthorized),
    applyStatus: applyStatusOf(row.applyStatus),
    ...(text(row.assetId).trim() ? { assetId: text(row.assetId).trim() } : {}),
  };
}

/** 宿主内部使用的完整记录：多一个只允许留在 Host 的 apiKey。 */
export interface BackendModel extends ModelMarketModel {
  readonly apiKey: string;
}

function backendModel(value: unknown): BackendModel | undefined {
  const model = normalizeModel(value);
  if (!model) return undefined;
  return { ...model, apiKey: text(record(value)?.apiKey) };
}

function pageOf(value: unknown): ModelMarketPage {
  const page = record(value) ?? {};
  const rows = rowsOf(value);
  const total = nonNegativeInteger(page.total, rows.length);
  const size = positiveInteger(page.size, rows.length || 10);
  return {
    current: positiveInteger(page.current, 1),
    pages: positiveInteger(page.pages, total > 0 ? Math.ceil(total / size) : 0),
    size,
    total,
    records: rows.flatMap(row => {
      const model = normalizeModel(row);
      return model ? [model] : [];
    }),
    installedIds: [],
  };
}

export class ModelMarketBackend {
  constructor(
    private readonly channel: () => BackendChannelLike | undefined,
    private readonly paths: ModelMarketPaths,
  ) {}

  async available(): Promise<boolean> {
    const channel = this.channel();
    if (!channel) return false;
    try {
      return await channel.available();
    } catch {
      return false;
    }
  }

  async list(input: ModelMarketQuery = {}, signal?: AbortSignal): Promise<ModelMarketPage> {
    const query: Record<string, string | number | undefined> = {
      pageNo: positiveInteger(input.pageNo, 1),
      pageSize: positiveInteger(input.pageSize, 10),
      keyword: input.keyword?.trim() || undefined,
      provider: input.provider?.trim() || undefined,
      modelType: input.modelType?.trim() || undefined,
      apiProtocol: input.apiProtocol?.trim() || undefined,
      isDefault: input.isDefault ? '1' : undefined,
      authStatus: input.authStatus,
      applyStatus: input.applyStatus,
    };
    return pageOf(await this.request(channel => channel.get(this.paths.list, query, signal)));
  }

  /**
   * 后台管理系统单点地址：用通用后台通道生成加密参数后拼到入口地址上。
   * 通道缺失、不可用或参数生成失败时退回纯地址并标记 degraded，由界面提示用户手动登录。
   */
  async adminSsoTarget(
    menuId: string,
    bizParams: Readonly<Record<string, string>>,
    ssoUrl: string,
    signal?: AbortSignal,
  ): Promise<ModelAdminSsoTarget> {
    const fallback: ModelAdminSsoTarget = { url: ssoUrl, degraded: true };
    const channel = this.channel();
    if (!channel) return fallback;
    try {
      if (!(await channel.available())) return fallback;
    } catch {
      return fallback;
    }
    const path = this.paths.ssoParams?.trim() || '';
    if (!path) return fallback;
    try {
      const result = await channel.post(path, { menuId, bizParams }, undefined, signal);
      if (typeof result !== 'string' || !result.trim()) return fallback;
      return { url: `${ssoUrl}?params=${encodeURIComponent(result.trim())}`, degraded: false };
    } catch {
      return fallback;
    }
  }

  /** 按主键取一条完整记录（含 apiKey，只在 Host 内使用）。 */
  async get(id: string, signal?: AbortSignal): Promise<BackendModel> {
    const direct = await this.request(channel => channel.get(this.paths.list, { id, pageNo: 1, pageSize: 1 }, signal));
    const directMatch = backendModel(rowsOf(direct).find(row => text(record(row)?.id) === id));
    if (directMatch) return directMatch;

    // 兼容后台忽略 id 条件的情况：翻页查找，避免把第一页第一条误当成目标模型。
    for (let pageNo = 1; pageNo <= 50; pageNo++) {
      const raw = await this.request(channel => channel.get(this.paths.list, { pageNo, pageSize: 100 }, signal));
      const match = backendModel(rowsOf(raw).find(row => text(record(row)?.id) === id));
      if (match) return match;
      const total = nonNegativeInteger(record(raw)?.total, 0);
      if (total === 0 || pageNo * 100 >= total) break;
    }
    throw new ModelMarketError('model-market/not-found', '未找到该模型。');
  }

  private async request<T>(request: (channel: BackendChannelLike) => Promise<T>): Promise<T> {
    const channel = this.channel();
    if (!channel) throw new ModelMarketError('model-market/unavailable', '当前环境未接入模型市场。');
    try {
      return await request(channel);
    } catch (cause) {
      if (cause instanceof ModelMarketError) throw cause;
      throw new ModelMarketError('model-market/backend', cause instanceof Error ? cause.message : '模型市场请求失败。');
    }
  }
}
