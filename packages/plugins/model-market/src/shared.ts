/** 模型市场的公共类型、字典与纯函数；Host 与 Client 共用。 */

export interface ModelMarketPaths {
  /** 已授权模型列表（GET）。 */
  readonly list: string;
  /** 使用模型上报（POST）。 */
  readonly use: string;
  /** 卸载模型上报（POST）。 */
  readonly unuse: string;
}

/** 与 Desktop 随包 workdsh-app.json 的 server 段保持一致；Desktop 可通过插件选项覆盖。 */
export const DEFAULT_MODEL_MARKET_PATHS: ModelMarketPaths = {
  list: '/desktop-client/model/queryAuthorizedModelList',
  use: '/desktop-client/model/useModel',
  unuse: '/desktop-client/model/unUseModel',
};

/** 后台字典（与 jeecg 字典 model_provider 一致）。 */
export const MODEL_PROVIDERS = [
  ['OPENAI', 'OpenAI'],
  ['ZHIPU', '智谱AI'],
  ['QIANFAN', '千帆大模型'],
  ['QWEN', '通义千问'],
  ['DEEPSEEK', 'DeepSeek'],
  ['OLLAMA', 'Ollama'],
  ['SELF', '自研'],
] as const;

/** 后台字典（与 jeecg 字典 model_type_new 一致）。 */
export const MODEL_TYPES = [
  ['LLM', '大语言模型'],
  ['MLLM', '多模态模型'],
  ['ASR', '语音识别'],
  ['EMBED', '向量模型'],
  ['Reranker', '重排序模型'],
] as const;

/** 后台字典（与 jeecg 字典 api_protocol 一致）。 */
export const API_PROTOCOLS = [
  ['01', 'OpenAI 兼容'],
  ['02', 'Anthropic'],
  ['03', '自定义 HTTP'],
  ['04', 'gRPC'],
] as const;

/** 自定义模型表单支持的协议（与官方 pi-ai 适配器一致）。 */
export const CUSTOM_API_PROTOCOLS = [
  ['openai-completions', 'OpenAI Chat Completions'],
  ['openai-responses', 'OpenAI Responses'],
  ['anthropic-messages', 'Anthropic Messages'],
] as const;

/** Provider ID：小写字母开头，只含小写字母、数字与连字符，最长 48 字符。 */
export const CUSTOM_PROVIDER_ID = /^[a-z][a-z0-9-]{0,47}$/u;

export interface CustomModelDefinition {
  readonly id: string;
  readonly name: string;
  readonly contextWindow?: number;
  readonly maxTokens?: number;
  readonly input: readonly ('text' | 'image')[];
}

export interface CustomModelDraft {
  readonly providerId: string;
  readonly displayName: string;
  readonly apiUrl: string;
  readonly apiProtocol: string;
  readonly apiKey: string;
  readonly models: readonly CustomModelDefinition[];
  readonly setDefault: boolean;
}

/** 市场里展示的本地自定义模型（来自本机安装记录，不是后台授权模型）。 */
export interface CustomModelEntry {
  readonly key: string;
  readonly providerId: string;
  readonly displayName: string;
  readonly apiUrl: string;
  readonly apiProtocol: string;
  readonly models: readonly CustomModelDefinition[];
  readonly installed: true;
  /** 是否为当前会话默认模型。 */
  readonly isDefault: boolean;
}

/** 当前客户端只支持对话模型：语音、向量与重排序模型展示但不可安装。 */
const INSTALLABLE_TYPES = new Set(['LLM', 'MLLM']);

/** 官方 pi-ai 适配器支持的协议标识。 */
const PROTOCOL_API: Readonly<Record<string, string>> = {
  '01': 'openai-completions',
  '02': 'anthropic-messages',
};

export interface ModelMarketQuery {
  readonly pageNo?: number;
  readonly pageSize?: number;
  readonly keyword?: string;
  readonly provider?: string;
  readonly modelType?: string;
  readonly apiProtocol?: string;
  readonly isDefault?: boolean;
}

/** 发给界面展示的模型信息：永远不包含 apiKey。 */
export interface ModelMarketModel {
  readonly id: string;
  readonly provider: string;
  readonly providerName: string;
  readonly modelName: string;
  readonly version: string;
  readonly modelCode: string;
  readonly modelType: string;
  readonly modelTypeName: string;
  readonly contextLength: string;
  readonly icon: string;
  readonly apiProtocol: string;
  readonly apiProtocolName: string;
  readonly apiUrl: string;
  readonly isDefault: boolean;
  readonly description: string;
  readonly tag: string;
  readonly owner: string;
  readonly depart: string;
  readonly departName: string;
  readonly createTime: string;
  readonly updateTime: string;
}

export interface ModelMarketPage {
  readonly current: number;
  readonly pages: number;
  readonly size: number;
  readonly total: number;
  readonly records: readonly ModelMarketModel[];
  /** 本机已安装的模型主键，界面据此显示「已安装」。 */
  readonly installedIds: readonly string[];
}

export interface ModelMarketDetail {
  readonly model: ModelMarketModel;
  readonly installed: boolean;
  readonly route?: string;
}

export interface ModelMarketInstallResult {
  readonly installed: true;
  readonly route: string;
  readonly modelCode: string;
}

export interface ModelMarketUninstallResult {
  readonly uninstalled: true;
  /** 后台上报是否成功；失败不阻断本机卸载。 */
  readonly reported: boolean;
}

export type ModelMarketInstallability =
  | { readonly installable: true }
  | { readonly installable: false; readonly reason: string };

export function dictionaryLabel(options: readonly (readonly [string, string])[], value: string): string {
  return options.find(([key]) => key === value)?.[1] ?? value;
}

/** 添加前的静态校验：类型、协议与必填字段。 */
export function installability(model: ModelMarketModel): ModelMarketInstallability {
  if (!INSTALLABLE_TYPES.has(model.modelType)) return { installable: false, reason: '当前客户端仅支持对话模型' };
  if (!PROTOCOL_API[model.apiProtocol]) return { installable: false, reason: '该协议暂不支持添加' };
  if (!model.modelCode.trim() || !model.apiUrl.trim() || !model.id.trim()) return { installable: false, reason: '模型信息不完整，无法添加' };
  return { installable: true };
}

export function protocolApi(apiProtocol: string): string | undefined {
  return PROTOCOL_API[apiProtocol];
}

/** 不可添加时的按钮文案：类型/协议不支持与后台数据缺失分开表达。 */
export function installActionLabel(model: ModelMarketModel, result: ModelMarketInstallability): string {
  if (result.installable) return '添加';
  if ((model.modelType !== 'LLM' && model.modelType !== 'MLLM') || !protocolApi(model.apiProtocol)) return '不支持';
  return '待完善';
}

/**
 * 后台上下文长度是自由文本（例如 128K、1M、131072）。
 * 解析失败时返回 undefined，让 pi-ai 使用路由默认值，不伪造容量。
 */
export function parseContextWindow(value: string | undefined): number | undefined {
  const text = value?.trim().replace(/,/g, '');
  if (!text) return undefined;
  const match = /^(\d+(?:\.\d+)?)\s*([kKmM])?/u.exec(text);
  if (!match) return undefined;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return undefined;
  const unit = match[2]?.toLowerCase();
  return Math.round(amount * (unit === 'k' ? 1024 : unit === 'm' ? 1024 * 1024 : 1));
}

export interface ModelRouteEntry {
  readonly id: string;
  readonly name: string;
  readonly contextWindow?: number;
  readonly maxTokens?: number;
  readonly input: readonly string[];
}

/** 把一个市场模型转换为 pi-ai 路由里的模型条目。 */
export function modelRouteEntry(model: ModelMarketModel): ModelRouteEntry {
  const contextWindow = parseContextWindow(model.contextLength);
  return {
    id: model.modelCode,
    name: model.modelName || model.modelCode,
    ...(contextWindow === undefined ? {} : { contextWindow }),
    input: model.modelType === 'MLLM' ? ['text', 'image'] : ['text'],
  };
}

/** 把 token 数格式化为官方界面的 K/M 简写（无法整除时保留原数字）。 */
export function formatCapacity(value: number | undefined): string {
  if (value === undefined) return '';
  if (value >= 1024 * 1024 && value % (1024 * 1024) === 0) return `${value / (1024 * 1024)}M`;
  if (value >= 1024 && value % 1024 === 0) return `${value / 1024}K`;
  return String(value);
}

/**
 * 把探测到的模型合并进当前目录：按 id 新增或就地更新，保留原顺序与未选中的手工条目。
 * 覆盖会删除探测未返回的条目、冲掉手工修改，因此这里只在同 id 时用探测结果更新元数据。
 * @param current - 当前目录（调用方先过滤掉完全空白的行）。
 * @param additions - 本次勾选的模型。
 * @param merge - 合并同 id 行的策略；返回原对象表示无变化，不计入 updated。
 * @returns 合并后的目录与新增/更新数量。
 */
export function mergeDiscoveredModels<T extends { readonly id: string }>(
  current: readonly T[],
  additions: readonly T[],
  merge: (existing: T, addition: T) => T,
): { readonly rows: T[]; readonly added: number; readonly updated: number } {
  const rows = [...current];
  let added = 0;
  let updated = 0;
  for (const addition of additions) {
    const id = addition.id.trim();
    const index = rows.findIndex(row => row.id.trim() === id);
    if (index < 0) {
      rows.push(addition);
      added += 1;
      continue;
    }
    const merged = merge(rows[index]!, addition);
    if (merged !== rows[index]) {
      rows[index] = merged;
      updated += 1;
    }
  }
  return { rows, added, updated };
}

/** 归一化后台分页字段（JSON 数字可能是字符串）。 */
export function positiveInteger(value: unknown, fallback: number): number {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? Math.trunc(number) : fallback;
}

export function nonNegativeInteger(value: unknown, fallback: number): number {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.trunc(number) : fallback;
}
