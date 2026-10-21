/**
 * 通用业务后台通道（Jeecg 平台）的纯逻辑客户端。
 *
 * 只负责四件事：按需取绑定、标准请求头、解开响应信封、把后台的中文 message 透传给上层。
 * 它不持有地址、路径与凭据：每次请求都重新向绑定提供者索取，凭据永不缓存、不写入任何
 * 持久化状态，也不会出现在日志、错误消息或返回值里。地址与接口路径一律由调用方提供，
 * 本层不内置任何字面量地址或路径。
 */

/** 一次请求所需的绑定。authorization 由身份提供方按需下发，本层只把它放进请求头。 */
export interface BackendBinding {
  /** 后台根地址，已含网关前缀（例如 http://127.0.0.1:18080/ytsj-ai）。 */
  readonly url: string;
  /** 裸 JWT，不加 Bearer 前缀。只允许出现在请求头，不得回传或记录。 */
  readonly authorization: string;
}

/** 绑定来源：每次请求前调用，返回 undefined 表示当前环境没有后台绑定。 */
export type BackendBindingSource = (signal?: AbortSignal) => Promise<BackendBinding | undefined>;

/**
 * 绑定提供者：按需下发绑定，并在后台把成员身份的请求判定为未授权时通知宿主。
 * 兼容旧形态：构造参数仍可直接传 `BackendBindingSource` 函数，通道内部归一化后等同于
 * 只实现了 `binding` 的对象，`unauthorized` 缺省即不通知。
 */
export interface BackendBindingProvider {
  /** 每次请求前调用一次；返回 undefined 表示当前环境没有后台绑定。 */
  binding(signal?: AbortSignal): Promise<BackendBinding | undefined>;
  /**
   * 可选：成员身份的请求被后台判定为未授权（HTTP 401 或信封 code 401）时通知宿主触发失效流程。
   * 它是尽力而为的通知，通道会吞掉它抛出的任何异常，绝不用它替换原始的 `backend/unauthorized`。
   */
  unauthorized?(): Promise<void> | void;
}

/** 通用通道错误码。消费方按码映射自己的错误码与界面文案。 */
export type BackendErrorCode =
  /** 当前环境没有后台绑定（个人模式、未登录或登录态已失效）。 */
  | 'backend/unavailable'
  /** 绑定地址不是合法的 HTTP/HTTPS 地址（含查询串、片段或账号密码，或协议不是 http/https）。 */
  | 'backend/address-invalid'
  /** 接口路径不是以 / 开头、或含查询串与片段。 */
  | 'backend/path-invalid'
  /** 绑定下发的授权值不可用，通常意味着登录状态已变化。 */
  | 'backend/authority-invalid'
  /** 网络错误或超时。 */
  | 'backend/unreachable'
  /** 后台把本次成员身份的请求判定为未授权（HTTP 401 或信封 code 401），会话已失效。 */
  | 'backend/unauthorized'
  /** 后台信封 code 非 200，message 为后台原文。 */
  | 'backend/rejected'
  /** 回包不是可识别的 JSON 信封。 */
  | 'backend/response-invalid';

export class BackendRequestError extends Error {
  constructor(readonly code: BackendErrorCode, message: string, readonly status?: number) {
    super(message);
    this.name = 'BackendRequestError';
  }
}

export type BackendQuery = URLSearchParams | Readonly<Record<string, string | number | undefined>>;

/** 功能插件依赖注入面：只声明路径、查询参数与请求体，不接触请求头与信封。 */
export interface BackendChannelClient {
  get<T = unknown>(path: string, query?: BackendQuery, signal?: AbortSignal): Promise<T>;
  post<T = unknown>(path: string, body?: unknown, query?: BackendQuery, signal?: AbortSignal): Promise<T>;
  /**
   * multipart 上传：用于附件与图标这类二进制提交。
   * 不设置 Content-Type，交给 fetch 生成带 boundary 的头；超时可单独放宽。
   */
  postForm<T = unknown>(path: string, form: FormData, signal?: AbortSignal, timeoutMs?: number): Promise<T>;
}

export interface BackendClientOptions {
  /** 绑定提供者；兼容旧形态，可直接传 `BackendBindingSource` 函数。 */
  readonly binding: BackendBindingProvider | BackendBindingSource;
  readonly timeoutMs?: number;
}

const defaultTimeoutMs = 10_000;
/** spec §0.2：Accept 固定，tenant 与 version 为固定值；后台不校验 X-Sign，因此本层不发该头。 */
const accept = 'application/json, text/plain, */*';
const tenantId = '0';
const apiVersion = 'v3';

const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const text = (value: unknown): string | undefined => typeof value === 'string' && value.trim() ? value.trim() : undefined;

/**
 * 绑定地址已含网关前缀，去掉结尾多余的 / 后按字面拼接路径，避免吃掉前缀。
 * 协议只允许 http / https：隔离内网（如公安网）按明文 HTTP 部署是既定事实，
 * 这里不再强制 HTTPS，否则整条后台能力链路（MCP 市场等）在部署环境直接不可用。
 * 地址里不允许带查询串、片段与账号密码，避免把凭据写进配置。
 */
function backendBaseUrl(value: unknown): string {
  let url: URL;
  try { url = new URL(typeof value === 'string' ? value : ''); }
  catch { throw new BackendRequestError('backend/address-invalid', '业务后台地址无效。'); }
  if (url.search || url.hash || url.username || url.password)
    throw new BackendRequestError('backend/address-invalid', '业务后台地址无效。');
  if (url.protocol !== 'https:' && url.protocol !== 'http:')
    throw new BackendRequestError('backend/address-invalid', '业务后台地址必须使用 HTTP 或 HTTPS。');
  return `${url.origin}${url.pathname}`.replace(/\/+$/u, '');
}

function backendPath(value: unknown): string {
  const path = typeof value === 'string' ? value.trim() : '';
  if (!path.startsWith('/') || /[?#]/u.test(path))
    throw new BackendRequestError('backend/path-invalid', '业务后台接口路径无效。');
  return path;
}

function backendQuery(query: BackendQuery | undefined): string {
  if (query === undefined) return '';
  const params = query instanceof URLSearchParams ? query
    : new URLSearchParams(Object.entries(query).flatMap(([key, value]) => value === undefined ? [] : [[key, String(value)]]));
  const serialized = params.toString();
  return serialized ? `?${serialized}` : '';
}

/** 裸 JWT 直接作为头值，因此拒绝空值与任何空白字符，避免请求头被拆分。 */
function backendAuthorization(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 8192 || /\s/u.test(value))
    throw new BackendRequestError('backend/authority-invalid', '当前登录状态已变化，请重新登录后再试。');
  return value;
}

/**
 * 宿主侧后台客户端。构造参数是绑定提供者，因此地址与凭据都不在本层落位；
 * 绑定缺失时抛出 backend/unavailable，由消费方决定是降级还是提示。
 */
export class BackendClient implements BackendChannelClient {
  private readonly provider: BackendBindingProvider;
  private readonly timeoutMs: number;

  constructor(options: BackendClientOptions) {
    const source = options?.binding;
    // 兼容旧形态：函数形式的绑定来源归一化为只实现 binding 的提供者（没有失效通知）。
    const provider = typeof source === 'function' ? { binding: source } : source;
    if (typeof provider?.binding !== 'function')
      throw new BackendRequestError('backend/unavailable', '业务后台缺少绑定来源。');
    this.provider = provider;
    this.timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
  }

  get<T = unknown>(path: string, query?: BackendQuery, signal?: AbortSignal): Promise<T> {
    return this.request('GET', path, query, undefined, signal) as Promise<T>;
  }

  post<T = unknown>(path: string, body?: unknown, query?: BackendQuery, signal?: AbortSignal): Promise<T> {
    return this.request('POST', path, query, body, signal) as Promise<T>;
  }

  postForm<T = unknown>(path: string, form: FormData, signal?: AbortSignal, timeoutMs?: number): Promise<T> {
    return this.request('POST', path, undefined, form, signal, timeoutMs) as Promise<T>;
  }

  private async request(method: 'GET' | 'POST', path: string, query: BackendQuery | undefined, body: unknown, signal?: AbortSignal, timeoutMs?: number): Promise<unknown> {
    signal?.throwIfAborted();
    // 凭据不缓存：每次都重新向绑定提供者索取。绑定取不到（未实现、未登录、已失效）一律
    // 归一为 unavailable，既不静默继续，也不把身份侧的原始错误文本带到上层。
    let binding: BackendBinding | undefined;
    try { binding = await this.provider.binding(signal); }
    catch { throw new BackendRequestError('backend/unavailable', '当前环境未接入业务后台。'); }
    if (!binding) throw new BackendRequestError('backend/unavailable', '当前环境未接入业务后台。');
    const authorization = backendAuthorization(binding.authorization);
    const target = `${backendBaseUrl(binding.url)}${backendPath(path)}${backendQuery(query)}`;
    // multipart 由 fetch 自行生成带 boundary 的 Content-Type，不能覆盖成 application/json。
    const form = body instanceof FormData ? body : undefined;
    let response: Response;
    try {
      response = await fetch(target, {
        method,
        headers: {
          Accept: accept,
          // spec §0.2：Authorization 与 X-Access-Token 携带同一个裸 JWT，不加 Bearer 前缀。
          Authorization: authorization,
          'X-Access-Token': authorization,
          // X-TIMESTAMP 取本次请求发起时刻的毫秒值。
          'X-TIMESTAMP': String(Date.now()),
          'X-Tenant-Id': tenantId,
          'X-Version': apiVersion,
          ...(body === undefined || form ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : form ?? JSON.stringify(body),
        redirect: 'error',
        signal: AbortSignal.any([AbortSignal.timeout(timeoutMs ?? this.timeoutMs), ...(signal ? [signal] : [])]),
      });
    } catch {
      // 不回显请求头与凭据，只给出可展示的通用文案。
      throw new BackendRequestError('backend/unreachable', '无法连接业务后台，请检查网络后重试。');
    }
    // 会话失效判定先于「回包是否为 JSON 信封」：HTTP 401 即使是网关错误页这类非 JSON
    // 回包，也必须归类为失效，而不是误报成「数据无法识别」。信封 code 为 401 同样失效。
    // 解析失败时 envelope 保持 undefined，只影响 message 的取值，不影响 401 的分类。
    let envelope: Record<string, unknown> | undefined;
    try { envelope = record(await response.json()); } catch { /* 非 JSON 回包：交由下面的分类处理 */ }
    if (response.status === 401 || envelope?.code === 401) {
      // 先通知宿主（尽力而为，失败被吞掉，不覆盖原始错误），再抛出与轮询一致的失效错误。
      await this.notifyUnauthorized();
      throw new BackendRequestError('backend/unauthorized', text(envelope?.message) ?? '登录已过期，请重新登录。', response.status);
    }
    if (!envelope) throw new BackendRequestError('backend/response-invalid', '业务后台返回的数据无法识别，请稍后重试。');
    // spec §0.1：信封 code 为 200 才算成功；失败时把后台原文 message 抛给上层展示。
    if (envelope.code !== 200)
      throw new BackendRequestError('backend/rejected', text(envelope.message) ?? '业务后台拒绝了本次请求。', response.status);
    return envelope.result;
  }

  /** 通知绑定提供者：一次成员身份的请求被后台判定为未授权。通知失败只被忽略，不影响原始错误。 */
  private async notifyUnauthorized(): Promise<void> {
    try { await this.provider.unauthorized?.(); } catch { /* 尽力而为的失效通知：保留原始 backend/unauthorized */ }
  }
}
