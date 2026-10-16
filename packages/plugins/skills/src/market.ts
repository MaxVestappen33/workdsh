/**
 * 技能市场（后台「查询已授权的技能列表」）在本插件内的契约：
 * 接口路径、查询参数、归一化后的条目结构，以及只做协议转发的 HTTP 客户端。
 * 请求头、地址拼接、信封解开与错误透传都由通用后台通道（workdshBackend）负责。
 */

/** 业务场景字典项：字段名沿用后台字典对象（DictModel）。 */
export interface SkillScene {
  readonly value: string;
  readonly text: string;
  readonly color?: string;
}

/** 市场条目归一化后的结构。 */
export interface SkillMarketItem {
  /** 后台技能 id：列表去重键，后续安装/卸载上报的标识。 */
  readonly id: string;
  /** skillName：界面主标题。 */
  readonly title: string;
  /** skillNameEn：技能标识，与本地已安装技能名（目录名 / SKILL.md name）同口径，用于「已安装」判定。 */
  readonly slug: string;
  readonly description: string;
  /** skillVersion：后台自带版本前缀（如 V1.0.0），原样展示。 */
  readonly version?: string;
  /** bizScene 拆出的业务场景编码：与业务场景字典 value、列表筛选参数同一口径。 */
  readonly scenes: readonly string[];
  /**
   * bizSceneList 逐项展开后的业务场景名称（后台按 bizScene 顺序下发）。
   * 界面标签直接用这里的文案展示，不再回查字典；为空时再退回字典映射。
   */
  readonly sceneLabels: readonly string[];
  /** 图标：后台下发 http(s) 可达的 URL；ant-design 图标名等非 URL 取值由界面回退名称首字符。 */
  readonly icon?: string;
  /** 图标底色，可能为空。 */
  readonly color?: string;
}

/** 市场查询参数：业务场景与关键词都由服务端筛选。 */
export interface SkillMarketQuery {
  readonly page?: number;
  readonly pageSize?: number;
  /**
   * 业务场景筛选：下发为列表接口的 `bizScene` 参数，取值是业务场景字典的 value。
   * 多选时用英文逗号连接（如 `a,b`），后台语义为命中任一；为空表示不筛选。
   */
  readonly scene?: string;
  /** 关键词：下发为列表接口的 `keyword` 参数；为空表示不筛选。 */
  readonly keyword?: string;
}

/** 一页市场列表：`page` 是后台返回的当前页码（缺省时回落到请求页码）。 */
export interface SkillMarketPage {
  readonly items: readonly SkillMarketItem[];
  readonly total: number;
  readonly page: number;
}

/**
 * 授权技能索引项：本地技能按标识匹配业务场景时只需要这三个字段。
 * 索引必须覆盖全部已授权技能，因此由 Host 侧翻页取全（见 index()）。
 */
export interface SkillMarketAuthorized {
  readonly slug: string;
  readonly title: string;
  readonly sceneLabels: readonly string[];
}

/** 市场接口路径：全部由宿主配置注入，不写死在业务逻辑里。 */
export interface SkillMarketPaths {
  readonly list: string;
  readonly categories: string;
  /** 安装接口：安装时调用。后台当前是预留实现（只记录安装行为，本机安装待下一轮接入）。 */
  readonly install: string;
  /** 卸载接口：卸载时调用。后台当前是预留实现（只记录卸载行为，本机卸载待下一轮接入）。 */
  readonly uninstall: string;
}

/**
 * 通用后台通道在本插件用到的最小结构。这里用结构化类型而不是 import 通道包，
 * 是为了让 skills 包不新增跨包依赖：绑定缺失时通道整体不可用，市场随之降级。
 */
export interface SkillMarketBackend {
  /** 绑定存在且可用于请求时为 true；界面据此隐藏技能市场入口。 */
  available(): Promise<boolean>;
  get<T = unknown>(path: string, query?: URLSearchParams, signal?: AbortSignal): Promise<T>;
  /** 参数顺序与通用通道一致：body 在 query 之前，query 为空时也要显式占位。 */
  post<T = unknown>(path: string, body?: unknown, query?: URLSearchParams, signal?: AbortSignal): Promise<T>;
}

export interface Config {
  readonly paths: SkillMarketPaths;
  readonly backend: SkillMarketBackend;
}

/** 列表默认每页条数：真实分页由服务端执行，界面滚动到接近底部再取下一页。 */
const MARKET_LIST_PAGE_SIZE = 24;
/** 索引翻页的每页条数：索引是一次性取全，用大页减少请求次数。 */
const INDEX_PAGE_SIZE = 200;
/** 索引翻页上限：防止后台异常返回永远取不完的数据。 */
const INDEX_MAX_PAGES = 25;

/** 市场请求错误：code 为宿主侧错误码，message 为可直接展示的中文文案。 */
export class SkillMarketRequestError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'SkillMarketRequestError';
  }
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const text = (value: unknown): string | undefined => typeof value === 'string' && value.trim() ? value.trim() : undefined;
const count = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
/** 图标只接受 http(s) 可达的 URL；后台的 ant-design 图标名等取值一律视为没有图标，由界面回退。 */
const iconOf = (value: unknown): string | undefined => {
  const icon = text(value);
  return icon && /^https?:\/\//iu.test(icon) ? icon : undefined;
};
/** bizScene 是多值字段（逗号分隔）：拆成去空、去重的值数组，供筛选取值与界面展示。 */
const scenesOf = (value: unknown): readonly string[] => {
  const raw = text(value);
  if (!raw) return [];
  return [...new Set(raw.split(',').map(part => part.trim()).filter(Boolean))];
};
/**
 * bizSceneList：后台按 biz_scene 逐项展开后的业务场景对象数组（DictModel 形态：value / text / label / title）。
 * 只取名称字段作为展示文案（text 优先，其次 label / title），去空、去重并保持后台顺序；
 * 不拿 value 兜底，避免把编码当成名称显示给用户。
 */
const sceneLabelsOf = (value: unknown): readonly string[] => {
  if (!Array.isArray(value)) return [];
  const labels = value.flatMap(item => {
    const row = record(item);
    const label = text(row?.text) ?? text(row?.label) ?? text(row?.title);
    return label ? [label] : [];
  });
  return [...new Set(labels)];
};

/** 缺少 id 或技能名的条目无法判重与展示，跳过而不是让整页失败。 */
const itemOf = (value: unknown): SkillMarketItem | undefined => {
  const row = record(value); if (!row) return undefined;
  const id = text(row.id); const title = text(row.skillName);
  if (!id || !title) return undefined;
  const slug = text(row.skillNameEn) ?? title;
  const version = text(row.skillVersion);
  const description = text(row.skillDescr);
  const icon = iconOf(row.icon); const color = text(row.color);
  return {
    id, title, slug, description: description ?? '',
    ...(version ? { version } : {}),
    scenes: scenesOf(row.bizScene), sceneLabels: sceneLabelsOf(row.bizSceneList),
    ...(icon ? { icon } : {}), ...(color ? { color } : {}),
  };
};

const pathOf = (value: unknown, label: string): string => {
  const path = typeof value === 'string' ? value.trim() : '';
  if (!path.startsWith('/') || /[?#]/u.test(path))
    throw new SkillMarketRequestError('skill/market-unavailable', `技能市场${label}路径无效。`);
  return path;
};
const pathsOf = (value: SkillMarketPaths): SkillMarketPaths => ({
  list: pathOf(value?.list, '列表'),
  categories: pathOf(value?.categories, '业务场景'),
  install: pathOf(value?.install, '安装'),
  uninstall: pathOf(value?.uninstall, '卸载'),
});

/**
 * 安装/卸载的请求体。后台接口是 `@RequestBody JSONObject`（参数在请求体，不是 query），
 * 同时给出市场条目 id 与技能标识（skillNameEn），让后台少做一次关联。
 * 字段名为待对齐项，后台实现后可调整；clientType 与 MCP 市场保持同一口径。
 */
const reportBody = (id?: string, slug?: string): Record<string, string> => {
  const key = text(id); const name = text(slug);
  return { ...(key ? { id: key } : {}), ...(name ? { skillNameEn: name } : {}), clientType: 'workdsh-desktop' };
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
    return new SkillMarketRequestError('skill/market-rejected', error instanceof Error && error.message ? error.message : '技能市场拒绝了本次请求。');
  if (code === 'backend/response-invalid')
    return new SkillMarketRequestError('skill/market-response-invalid', '技能市场返回的数据无法识别，请稍后重试。');
  if (code === 'backend/authority-invalid')
    return new SkillMarketRequestError('skill/market-authority-changed', '当前登录状态已变化，请重新登录后再试。');
  // 后台判定会话失效：透传后台原文，拿不到时用「登录已过期，请重新登录。」，绝不落入「数据无法识别」。
  if (code === 'backend/unauthorized')
    return new SkillMarketRequestError('skill/market-unauthorized', error instanceof Error && error.message ? error.message : '登录已过期，请重新登录。');
  if (code === 'backend/address-invalid' || code === 'backend/path-invalid' || code === 'backend/unavailable')
    return new SkillMarketRequestError('skill/market-unavailable', '当前环境未接入技能市场。');
  if (error instanceof SkillMarketRequestError) return error;
  if (error instanceof Error) return new SkillMarketRequestError('skill/market-unavailable', '无法连接技能市场，请检查网络后重试。');
  return new SkillMarketRequestError('skill/market-unavailable', '无法连接技能市场，请检查网络后重试。');
};

/** 宿主侧市场客户端：只声明路径与字段映射；地址、授权头、信封与超时都由通用后台通道负责。 */
export class SkillMarketClient {
  private readonly paths: SkillMarketPaths;
  private readonly backend: SkillMarketBackend;
  /** 最近见到的市场条目：安装/卸载上报时用于补齐后台不认识 id 时也能用的技能标识。 */
  private readonly catalog = new Map<string, SkillMarketItem>();

  constructor(config: Config) {
    if (!config.backend || typeof config.backend.get !== 'function' || typeof config.backend.post !== 'function')
      throw new SkillMarketRequestError('skill/market-unavailable', '技能市场缺少后台通道。');
    this.paths = pathsOf(config.paths);
    this.backend = config.backend;
  }

  /** 最近取到的市场条目（按 id），供安装/卸载上报补齐技能标识。 */
  item(id: string): SkillMarketItem | undefined { return this.catalog.get(id.trim()); }

  async list(input: SkillMarketQuery = {}, signal?: AbortSignal): Promise<SkillMarketPage> {
    // 业务场景与关键词都由服务端筛选：业务场景下发 bizScene（字典 value），关键词下发 keyword；
    // 两者为空时不下发，避免与「全部 / 未输入」混淆。分页是服务端能力，pageNo/pageSize 逐页取数；
    // _t 仅用于防缓存。
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
      throw new SkillMarketRequestError('skill/market-response-invalid', '技能市场列表返回的数据无法识别，请稍后重试。');
    const items = result.records.flatMap(entry => { const item = itemOf(entry); return item ? [item] : []; });
    for (const item of items) this.catalog.set(item.id, item);
    const total = typeof result.total === 'number' ? count(result.total) : items.length;
    const current = typeof result.current === 'number' && result.current > 0 ? Math.trunc(result.current) : page;
    return { items, total, page: current };
  }

  async categories(signal?: AbortSignal): Promise<readonly SkillScene[]> {
    const result = await this.request('GET', this.paths.categories, undefined, undefined, signal);
    if (!Array.isArray(result))
      throw new SkillMarketRequestError('skill/market-response-invalid', '技能市场业务场景返回的数据无法识别，请稍后重试。');
    return result.flatMap(entry => {
      const row = record(entry); const value = text(row?.value); const label = text(row?.text);
      if (!row || !value || !label) return [];
      const color = text(row.color);
      return [{ value, text: label, ...(color ? { color } : {}) }];
    });
  }

  /**
   * 授权技能索引：本地技能的业务场景标签只能来自后台，因此这里按大页翻页取全。
   * 不假设后台一定接受大页：以「本页是否带回新条目」与后台返回的 total 共同判定是否继续，
   * 既能在后台把 pageSize 压到较小值时继续翻页，也不会在后台忽略分页时反复取同一页。
   */
  async index(signal?: AbortSignal): Promise<readonly SkillMarketAuthorized[]> {
    const rows: SkillMarketAuthorized[] = [];
    const seen = new Set<string>();
    let page = 1;
    for (;;) {
      const listed = await this.list({ page, pageSize: INDEX_PAGE_SIZE }, signal);
      let added = 0;
      for (const item of listed.items) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        rows.push({ slug: item.slug, title: item.title, sceneLabels: item.sceneLabels });
        added += 1;
      }
      if (!added || rows.length >= listed.total || page >= INDEX_MAX_PAGES) break;
      page += 1;
    }
    return rows;
  }

  /**
   * 安装上报：调用后台的安装接口（`/skill/installSkill`）。后台当前是预留实现——
   * 只记录安装行为、不回传业务字段，因此这里不解析响应体，也不因为返回体缺少字段而判失败。
   */
  async reportInstall(id: string, slug?: string, signal?: AbortSignal): Promise<void> {
    const key = text(id);
    if (!key) throw new SkillMarketRequestError('skill/market-rejected', '缺少技能标识，无法安装。');
    await this.request('POST', this.paths.install, undefined, reportBody(key, slug), signal);
  }

  /**
   * 卸载上报：调用后台的卸载接口（`/skill/unInstallSkill`），参数形态与安装上报一致。
   * 市场条目 id 与技能标识至少要有一个；调用方负责决定上报失败时的取舍。
   */
  async reportUninstall(target: { readonly id?: string; readonly slug?: string }, signal?: AbortSignal): Promise<void> {
    const id = text(target.id); const slug = text(target.slug);
    if (!id && !slug) throw new SkillMarketRequestError('skill/market-rejected', '缺少技能标识，无法卸载。');
    await this.request('POST', this.paths.uninstall, undefined, reportBody(id, slug), signal);
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
