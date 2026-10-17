/** 业务后台模型接口的宿主侧客户端：只负责请求、分页归一化与字段脱敏。 */
import {
  API_PROTOCOLS, MODEL_PROVIDERS, MODEL_TYPES, dictionaryLabel,
  nonNegativeInteger, positiveInteger,
  type ModelMarketModel, type ModelMarketPage, type ModelMarketPaths, type ModelMarketQuery,
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

const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

const rowsOf = (value: unknown): unknown[] => {
  const rows = record(value)?.records;
  return Array.isArray(rows) ? rows : [];
};

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
    };
    return pageOf(await this.request(channel => channel.get(this.paths.list, query, signal)));
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

  /** 使用/卸载上报：后台当前为预留实现，失败由调用方按「尽力而为」处理。 */
  async use(id: string, signal?: AbortSignal): Promise<void> {
    await this.request(channel => channel.post(this.paths.use, { id }, undefined, signal));
  }

  async unuse(id: string, signal?: AbortSignal): Promise<void> {
    await this.request(channel => channel.post(this.paths.unuse, { id }, undefined, signal));
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
