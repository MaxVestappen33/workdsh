/** 授权提示词的宿主侧客户端：只做请求、分页归一化与错误归类，地址与凭据由后台通道负责。 */
import {
  PROMPT_PAGE_SIZE, PromptRequestError,
  type PromptItem, type PromptPage, type PromptPaths, type PromptQuery,
} from './shared.js';

/** 通用业务后台通道（由 workdsh-provider-backend-channel 提供）的最小结构。 */
export interface PromptBackend {
  available(): Promise<boolean>;
  get<T = unknown>(path: string, query?: Readonly<Record<string, string | number | undefined>>, signal?: AbortSignal): Promise<T>;
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

const text = (value: unknown): string => typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';

const positive = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback;

const nonNegative = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : fallback;

/**
 * 后台一行的归一化。缺少主键的行无法稳定去重与作为 React key，直接丢弃；
 * 名称与正文都为空的行没有任何可展示或可插入的内容，同样丢弃。
 */
export function normalizePrompt(value: unknown): PromptItem | undefined {
  const row = record(value);
  if (!row) return undefined;
  const id = text(row.id).trim();
  const name = text(row.name).trim();
  const description = text(row.description).trim();
  const content = text(row.content);
  if (!id || (!name && !content.trim())) return undefined;
  return { id, name, description, content };
}

/** 分页结果：records 不是数组说明回包不可识别，由调用方转成可展示的错误。 */
export function normalizePromptPage(value: unknown, requested: { readonly page: number; readonly pageSize: number }): PromptPage {
  const page = record(value);
  if (!page || !Array.isArray(page.records))
    throw new PromptRequestError('prompt/response-invalid', '提示词列表返回的数据无法识别，请稍后重试。');
  const pageSize = positive(page.size, requested.pageSize);
  const total = nonNegative(page.total, page.records.length);
  const current = positive(page.current, requested.page);
  const pages = positive(page.pages, Math.ceil(total / Math.max(pageSize, 1)));
  return {
    items: page.records.flatMap(entry => { const item = normalizePrompt(entry); return item ? [item] : []; }),
    page: current,
    pageSize,
    total,
    hasMore: current < pages,
  };
}

/**
 * 通用通道错误按 name + code 判定，而不是 instanceof：通道与插件可能在 Host 中
 * 解析到不同的模块实例，跨包 instanceof 不可靠。
 */
const backendCode = (error: unknown): string | undefined => {
  if (!(error instanceof Error) || error.name !== 'BackendRequestError') return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
};

/** 通用通道错误码 → 提示词错误码与界面文案。 */
export function promptError(error: unknown): Error {
  const code = backendCode(error);
  const message = error instanceof Error && error.message ? error.message : '';
  if (code === 'backend/rejected') return new PromptRequestError('prompt/rejected', message || '提示词接口拒绝了本次请求。');
  if (code === 'backend/unauthorized') return new PromptRequestError('prompt/unauthorized', message || '登录已过期，请重新登录。');
  if (code === 'backend/authority-invalid') return new PromptRequestError('prompt/unauthorized', '当前登录状态已变化，请重新登录后再试。');
  if (code === 'backend/response-invalid') return new PromptRequestError('prompt/response-invalid', '提示词列表返回的数据无法识别，请稍后重试。');
  if (code === 'backend/address-invalid' || code === 'backend/path-invalid' || code === 'backend/unavailable')
    return new PromptRequestError('prompt/unavailable', '当前环境未接入提示词服务。');
  if (error instanceof PromptRequestError) return error;
  return new PromptRequestError('prompt/unavailable', '无法连接提示词服务，请检查网络后重试。');
}

/** 宿主侧客户端：路径来自宿主配置，关键词与分页都交给服务端筛选。 */
export class PromptClient {
  private readonly listPath: string;

  constructor(private readonly config: { readonly paths: PromptPaths; readonly backend: PromptBackend }) {
    this.listPath = config.paths.list;
  }

  async available(): Promise<boolean> {
    try {
      return await this.config.backend.available();
    } catch {
      return false;
    }
  }

  async list(input: PromptQuery = {}, signal?: AbortSignal): Promise<PromptPage> {
    const page = positive(input.page, 1);
    const pageSize = positive(input.pageSize, PROMPT_PAGE_SIZE);
    const query: Record<string, string | number | undefined> = { pageNo: page, pageSize, _t: Date.now() };
    const keyword = input.keyword?.trim();
    // 关键词为空时不下发，避免与后台「未筛选」判定混淆。
    if (keyword) query.keyword = keyword;
    let raw: unknown;
    try {
      raw = await this.config.backend.get(this.listPath, query, signal);
    } catch (cause) {
      throw promptError(cause);
    }
    return normalizePromptPage(raw, { page, pageSize });
  }
}
