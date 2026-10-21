import type { BackendChannel } from 'workdsh-provider-backend-channel';
import type { ConnectorToolParameter } from './shared.js';

/** 市场分类：字段名沿用后台字典对象（DictModel）。 */
export interface MarketCategory {
  readonly value: string;
  readonly text: string;
  readonly color?: string;
}

/** 市场工具：结构见 mcp-market-api-spec.md §3。真实数据里没有 kind 字段，不做类型标签假设。 */
export interface MarketTool {
  readonly name: string;
  readonly description?: string;
  readonly parameters: readonly ConnectorToolParameter[];
}

/** 市场条目归一化后的结构，字段映射见 mcp-market-api-spec.md §1。 */
export interface MarketItem {
  /** 市场条目 id，安装后作为连接器 originId，用于「已安装」判定与卸载。 */
  readonly originId: string;
  /** serviceId，安装后作为连接器唯一键 serverName。 */
  readonly serverName: string;
  readonly title: string;
  readonly description: string;
  /**
   * bizScene 拆出的分类值：后台该字段是逗号分隔的多值，这里拆成去空、去重的数组。
   * 取值与分类字典 value、列表 bizScene 筛选参数同一口径。
   */
  readonly categories: readonly string[];
  /**
   * bizSceneList 逐项展开后的分类名称（后台按 bizScene 顺序下发，见 §2.2）。
   * 界面标签直接用这里的文案展示，不再回查分类字典；为空时再退回字典映射。
   */
  readonly categoryLabels: readonly string[];
  readonly transport: 'stdio' | 'streamable-http';
  readonly url?: string;
  readonly command?: string;
  readonly args?: readonly string[];
  /**
   * 启动方式：`direct` 直接执行 command（node/python/绝对路径，本机自备解释器）；
   * `package` 表示 command 是包管理器（npx/npm/pnpm…），必须先把 packageSpec 指向的 npm 包
   * 从内网仓库装到本机，再以绝对路径启动。
   */
  readonly launch: 'direct' | 'package';
  /** launch=package 时的包说明符，例如 `chrome-devtools-mcp@latest`。 */
  readonly packageSpec?: string;
  /** launch=package 时传给 MCP 服务自身的参数（已去掉包说明符与下载器子命令词）。 */
  readonly packageArgs?: readonly string[];
  /** 卡片图标：后台下发 http(s) 可达的 URL，为空或不可达时由界面退回名称首字符。 */
  readonly icon?: string;
  /** 图标底色，可能为空，空时由界面使用默认底色。 */
  readonly color?: string;
  /**
   * 市场下发的连接令牌：原样作为 `Authorization` 请求头使用。
   * 安装时写入官方凭据服务，连接器定义里只保留引用，连接器列表与详情都不回传。
   */
  readonly authorization?: string;
  readonly subscribers: number;
  readonly downloads: number;
  readonly stars: number;
  readonly tools: readonly MarketTool[];
}

/** 市场查询参数：分类与关键词都由服务端筛选（后台按实体字段直查）。 */
export interface MarketQuery {
  readonly page?: number;
  readonly pageSize?: number;
  /**
   * 分类筛选：下发为列表接口的 `bizScene` 参数，取值是分类字典的 value。
   * 多选时用英文逗号连接（如 `a,b`），后台语义为命中任一；为空表示不筛选。
   */
  readonly scene?: string;
  /** 关键词：下发为列表接口的 `keyword` 参数；为空表示不筛选。 */
  readonly keyword?: string;
}

/** 一页市场列表：`page` 是后台返回的当前页码（缺省时回落到请求页码）。 */
export interface MarketPage {
  readonly items: readonly MarketItem[];
  readonly total: number;
  readonly page: number;
}

/** 市场接口路径：全部由宿主配置注入，不写死在业务逻辑里。 */
export interface MarketPaths {
  readonly list: string;
  readonly categories: string;
  /** 安装上报接口：安装时调用，后台只记录安装行为。 */
  readonly install: string;
  /** 卸载上报接口：卸载时调用，后台只记录卸载行为。 */
  readonly uninstall: string;
}

export interface Config {
  readonly paths: MarketPaths;
  /** 通用后台通道（workdshBackend）：请求头、地址拼接、信封解开与错误透传都由它负责。 */
  readonly backend: BackendChannel;
}

/** 列表默认每页条数：真实分页由服务端执行，界面滚动到接近底部再取下一页。 */
const MARKET_LIST_PAGE_SIZE = 24;

/** 市场请求错误：code 为宿主侧错误码，message 为可直接展示的中文文案。 */
export class MarketRequestError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'MarketRequestError';
  }
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const text = (value: unknown): string | undefined => typeof value === 'string' && value.trim() ? value.trim() : undefined;
const count = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
/** 决策 3：http 与 sse 都按 streamable-http 处理，只有 stdio 是本地进程。 */
const transportOf = (value: unknown): 'stdio' | 'streamable-http' => text(value) === 'stdio' ? 'stdio' : 'streamable-http';
/** 图标只接受 http(s) 可达的 URL；其它取值（含为空）一律视为没有图标，由界面回退。 */
const iconOf = (value: unknown): string | undefined => {
  const icon = text(value);
  return icon && /^https?:\/\//iu.test(icon) ? icon : undefined;
};
/** args 表里是「每行一个」，连接器侧是字符串数组。 */
const argsOf = (value: unknown): readonly string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const rows = value.flatMap(item => (typeof item === 'string' && item.trim() ? [item.trim()] : []));
  return rows.length ? rows : undefined;
};
/** bizScene 是多值字段（逗号分隔）：拆成去空、去重的值数组，供筛选取值与界面展示。 */
const categoriesOf = (value: unknown): readonly string[] => {
  const raw = text(value);
  if (!raw) return [];
  return [...new Set(raw.split(',').map(part => part.trim()).filter(Boolean))];
};
/**
 * bizSceneList：后台按 biz_scene 逐项展开后的分类对象数组（DictModel 形态：value / text / label / title / color）。
 * 只取名称字段作为展示文案（text 优先，其次 label / title），去空、去重并保持后台顺序；
 * 不拿 value 兜底，避免把编码当成名称显示给用户。
 */
const categoryLabelsOf = (value: unknown): readonly string[] => {
  if (!Array.isArray(value)) return [];
  const labels = value.flatMap(item => {
    const row = record(item);
    const label = text(row?.text) ?? text(row?.label) ?? text(row?.title);
    return label ? [label] : [];
  });
  return [...new Set(labels)];
};
/** 入参取自 inputSchema.properties，必填由 inputSchema.required 数组决定。 */
const parametersOf = (value: unknown): readonly ConnectorToolParameter[] => {
  const schema = record(value);
  const properties = record(schema?.properties);
  if (!properties) return [];
  const required = Array.isArray(schema?.required) ? schema.required.flatMap(item => (typeof item === 'string' ? [item] : [])) : [];
  return Object.entries(properties).flatMap(([name, raw]) => {
    const description = text(record(raw)?.description);
    return [{ name, required: required.includes(name), ...(description ? { description } : {}) }];
  });
};
/** tools 在后台是 JSON 字符串，需要二次 JSON.parse；解析失败或不是数组时降级为空数组。 */
const toolsOf = (value: unknown): readonly MarketTool[] => {
  let parsed: unknown = value;
  if (typeof parsed === 'string') {
    const raw = parsed.trim();
    if (!raw) return [];
    try { parsed = JSON.parse(raw); } catch { return []; }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap(item => {
    const row = record(item); const name = text(row?.name);
    if (!row || !name) return [];
    const description = text(row.description);
    return [{ name, ...(description ? { description } : {}), parameters: parametersOf(row.inputSchema) }];
  });
};
/**
 * 包管理器型启动命令。后台维护的是「启动命令 + 每行一个参数」，
 * 运维习惯写 `npx chrome-devtools-mcp@latest --channel=canary`，但这在离线环境里没有 npm/npx 可执行，
 * 必须由客户端改成「先从内网仓库装包，再用随包 Node 起绝对路径」。
 */
const packageManagers = new Set(['npx', 'pnpx', 'bunx', 'npm', 'pnpm', 'yarn', 'yarnpkg', 'bun']);
/** 下载器的子命令词：`pnpm dlx foo`、`npm exec foo` 里真正的包名在它后面。 */
const dlxVerbs = new Set(['dlx', 'exec', 'x']);

/** 拆出「需要装到本机」的包说明符与真正传给 MCP 的参数；不是包管理器启动时返回 undefined。 */
const packageLaunchOf = (transport: 'stdio' | 'streamable-http', command: string | undefined, args: readonly string[] | undefined): { spec: string; args: readonly string[] } | undefined => {
  if (transport !== 'stdio' || !command || !args?.length) return undefined;
  if (!packageManagers.has(command.trim().toLowerCase())) return undefined;
  const head = dlxVerbs.has(args[0]!.toLowerCase()) ? 1 : 0;
  const spec = args[head];
  if (!spec) return undefined;
  return { spec, args: args.slice(head + 1) };
};

/** 缺少 id / serviceId / name 的条目无法安装或判重，跳过而不是让整页失败。 */
const itemOf = (value: unknown): MarketItem | undefined => {
  const row = record(value); if (!row) return undefined;
  const originId = text(row.id); const serverName = text(row.serviceId); const title = text(row.name);
  if (!originId || !serverName || !title) return undefined;
  const url = text(row.endpoint); const command = text(row.command); const args = argsOf(row.args);
  const icon = iconOf(row.icon); const color = text(row.color); const authorization = text(row.token);
  const transport = transportOf(row.transport);
  const launch = packageLaunchOf(transport, command, args);
  return { originId, serverName, title, description: text(row.description) ?? '', categories: categoriesOf(row.bizScene),
    categoryLabels: categoryLabelsOf(row.bizSceneList),
    transport, ...(url ? { url } : {}), ...(command ? { command } : {}), ...(args ? { args } : {}),
    ...(launch ? { launch: 'package' as const, packageSpec: launch.spec, packageArgs: launch.args } : { launch: 'direct' as const }),
    ...(icon ? { icon } : {}), ...(color ? { color } : {}), ...(authorization ? { authorization } : {}),
    subscribers: count(row.subscribers), downloads: count(row.downloadCount), stars: count(row.starCount),
    tools: toolsOf(row.tools) };
};
const pathOf = (value: unknown, label: string): string => {
  const path = typeof value === 'string' ? value.trim() : '';
  if (!path.startsWith('/') || /[?#]/u.test(path))
    throw new MarketRequestError('connector/market-unavailable', `MCP 市场${label}路径无效。`);
  return path;
};
const pathsOf = (value: MarketPaths): MarketPaths => ({
  list: pathOf(value?.list, '列表'),
  categories: pathOf(value?.categories, '分类'),
  install: pathOf(value?.install, '安装'),
  uninstall: pathOf(value?.uninstall, '卸载'),
});

/**
 * 安装/卸载上报的请求体。后台接口是 `@RequestBody JSONObject`（参数在请求体，不是 query），
 * 同时给出市场条目 id 与服务标识，让后台少做一次关联。
 * 请求体字段名为待对齐项，后台实现后可调整。
 */
const reportBody = (id: string, serviceId?: string): Record<string, string> => {
  const service = text(serviceId);
  return { id, ...(service ? { serviceId: service } : {}), clientType: 'workdsh-desktop' };
};

/**
 * 通用通道错误按 name + code 判定，而不是 instanceof：通道与市场可能在
 * Host 中解析到不同的模块实例，跨包 instanceof 不可靠。
 */
const backendCode = (error: unknown): string | undefined => {
  if (!(error instanceof Error) || error.name !== 'BackendRequestError') return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
};

/** 通用通道错误码 → 市场错误码与界面文案：通用通道只描述后台，市场保留自己的用户可见文案。 */
const marketError = (error: unknown): Error => {
  const code = backendCode(error);
  if (code === 'backend/rejected')
    return new MarketRequestError('connector/market-rejected', error instanceof Error && error.message ? error.message : 'MCP 市场拒绝了本次请求。');
  if (code === 'backend/response-invalid')
    return new MarketRequestError('connector/market-response-invalid', '市场返回的数据无法识别，请稍后重试。');
  if (code === 'backend/authority-invalid')
    return new MarketRequestError('connector/market-authority-changed', '当前登录状态已变化，请重新登录后再试。');
  // 后台判定会话失效：透传后台原文，拿不到时用「登录已过期，请重新登录。」，绝不落入「数据无法识别」。
  if (code === 'backend/unauthorized')
    return new MarketRequestError('connector/market-unauthorized', error instanceof Error && error.message ? error.message : '登录已过期，请重新登录。');
  if (code === 'backend/address-invalid')
    return new MarketRequestError('connector/market-unavailable', 'MCP 市场地址无效。');
  if (code === 'backend/path-invalid')
    return new MarketRequestError('connector/market-unavailable', 'MCP 市场路径无效。');
  if (code === 'backend/unavailable')
    return new MarketRequestError('connector/market-unavailable', '当前环境未接入 MCP 市场。');
  if (error instanceof MarketRequestError) return error;
  if (error instanceof Error) return new MarketRequestError('connector/market-unavailable', '无法连接 MCP 市场，请检查网络后重试。');
  return new MarketRequestError('connector/market-unavailable', '无法连接 MCP 市场，请检查网络后重试。');
};

/** 宿主侧市场客户端：只声明路径与字段映射；地址、授权头、信封与超时都由通用后台通道负责。 */
export class ConnectorMarketClient {
  private readonly paths: MarketPaths;
  private readonly backend: BackendChannel;
  /** 最近见到的市场条目，安装时用于补齐订阅接口不返回的说明与分类。 */
  private readonly catalog = new Map<string, MarketItem>();

  constructor(config: Config) {
    if (!config.backend || typeof config.backend.get !== 'function' || typeof config.backend.post !== 'function')
      throw new MarketRequestError('connector/market-unavailable', 'MCP 市场缺少后台通道。');
    this.paths = pathsOf(config.paths);
    this.backend = config.backend;
  }

  /** 市场列表归一化后的条目缓存，供安装流程读取。 */
  item(originId: string): MarketItem | undefined { return this.catalog.get(originId); }

  async list(input: MarketQuery = {}, signal?: AbortSignal): Promise<MarketPage> {
    // 分类与关键词都由服务端筛选：后台列表走 QueryGenerator，实体字段可以直接当查询参数，
    // 因此分类下发 bizScene（分类字典的 value），关键词下发 keyword；两者为空时不下发，
    // 避免与「全部 / 未输入」混淆。分页是服务端能力，pageNo/pageSize 逐页取数。
    // 排序参数（column/order）按要求不再下发，顺序由后台决定；_t 仅用于防缓存。
    const page = input.page && input.page > 0 ? Math.trunc(input.page) : 1;
    const query = new URLSearchParams({
      pageNo: String(page),
      pageSize: String(input.pageSize && input.pageSize > 0 ? Math.trunc(input.pageSize) : MARKET_LIST_PAGE_SIZE),
      _t: String(Date.now()),
    });
    const scene = text(input.scene);
    if (scene) query.set('bizScene', scene);
    const keyword = text(input.keyword);
    if (keyword) query.set('keyword', keyword);
    const result = record(await this.request('GET', this.paths.list, query, undefined, signal));
    if (!result || !Array.isArray(result.records))
      throw new MarketRequestError('connector/market-response-invalid', '市场列表返回的数据无法识别，请稍后重试。');
    const items = result.records.flatMap(entry => { const item = itemOf(entry); return item ? [item] : []; });
    for (const item of items) this.catalog.set(item.originId, item);
    const total = typeof result.total === 'number' ? count(result.total) : items.length;
    const current = typeof result.current === 'number' && result.current > 0 ? Math.trunc(result.current) : page;
    return { items, total, page: current };
  }

  async categories(signal?: AbortSignal): Promise<readonly MarketCategory[]> {
    const result = await this.request('GET', this.paths.categories, undefined, undefined, signal);
    if (!Array.isArray(result))
      throw new MarketRequestError('connector/market-response-invalid', '市场分类返回的数据无法识别，请稍后重试。');
    return result.flatMap(entry => {
      const row = record(entry); const value = text(row?.value); const label = text(row?.text);
      if (!row || !value || !label) return [];
      const color = text(row.color);
      return [{ value, text: label, ...(color ? { color } : {}) }];
    });
  }

  /**
   * 安装上报：安装到本机时告知后台。后台目前只记录行为、不回传业务字段，
   * 因此这里不解析响应体，也不因为返回体缺少字段而判失败。
   * 连接配置不再从后台获取，安装所需的字段全部取自列表结果（见 ConnectorMarketService.install）。
   */
  async reportInstall(id: string, serviceId?: string, signal?: AbortSignal): Promise<void> {
    const key = text(id);
    if (!key) throw new MarketRequestError('connector/market-rejected', '缺少市场条目标识，无法安装。');
    await this.request('POST', this.paths.install, undefined, reportBody(key, serviceId), signal);
  }

  /**
   * 卸载上报：卸载本机实例时告知后台，参数形态与安装上报一致。
   * 调用方负责决定上报失败时的取舍（当前为不阻断本地卸载）。
   */
  async reportUninstall(id: string, serviceId?: string, signal?: AbortSignal): Promise<void> {
    const key = text(id);
    if (!key) throw new MarketRequestError('connector/market-rejected', '缺少市场条目标识，无法卸载。');
    await this.request('POST', this.paths.uninstall, undefined, reportBody(key, serviceId), signal);
  }

  /** 只做协议转发：市场不实现请求头、地址拼接与信封解开。 */
  private async request(method: 'GET' | 'POST', path: string, query: URLSearchParams | undefined, body: unknown, signal?: AbortSignal): Promise<unknown> {
    try {
      return method === 'GET'
        ? await this.backend.get(path, query, signal)
        : await this.backend.post(path, body, query, signal);
    } catch (error) {
      throw marketError(error);
    }
  }
}
