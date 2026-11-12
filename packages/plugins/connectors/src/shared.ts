export type ConnectorState = 'discovering' | 'ready' | 'offline' | 'disabled';

/** 单个工具入参的展示信息。必填标记与说明来自官方工具 schema，仅用于界面展示。 */
export interface ConnectorToolParameter {
  readonly name: string;
  readonly required: boolean;
  readonly description?: string;
}

/** 建连时附加到 HTTP 请求上的一个请求头：名称与值都由配置方给出，不写死 Authorization。 */
export interface ConnectorRequestHeader {
  readonly key: string;
  readonly value: string;
}

/** 请求头条目上限：正常服务只需个位数，超出部分不予采纳。 */
const REQUEST_HEADER_LIMIT = 16;
/** HTTP 头名称允许的字符（RFC 9110 token）。 */
const requestHeaderName = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/u;
const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

/**
 * 归一化请求头：后台下发的是 JSON 字符串（`[{"key","value"}]`），也可能已是数组或
 * 「名称 → 值」对象。空名称、空值、非法名称一律丢弃；名称大小写不敏感去重（后值覆盖前值），
 * 并限定条目上限。解析失败时返回空数组，由调用方决定是否有回退来源。
 */
export const requestHeadersOf = (value: unknown): readonly ConnectorRequestHeader[] => {
  let parsed: unknown = value;
  if (typeof parsed === 'string') {
    const raw = parsed.trim();
    if (!raw) return [];
    try { parsed = JSON.parse(raw); } catch { return []; }
  }
  const pairs: [unknown, unknown][] = [];
  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      const row = asRecord(item);
      if (row) pairs.push([row.key, row.value]);
    }
  } else {
    const map = asRecord(parsed);
    if (map) pairs.push(...Object.entries(map));
  }
  const headers = new Map<string, ConnectorRequestHeader>();
  for (const [rawKey, rawValue] of pairs) {
    const key = typeof rawKey === 'string' ? rawKey.trim() : '';
    const headerValue = typeof rawValue === 'string' ? rawValue.trim() : '';
    if (!key || !headerValue || !requestHeaderName.test(key)) continue;
    headers.set(key.toLowerCase(), { key, value: headerValue });
    if (headers.size >= REQUEST_HEADER_LIMIT) break;
  }
  return [...headers.values()];
};

/** 单个 MCP 工具的展示信息，供连接器详情页渲染工具清单。 */
export interface ConnectorTool {
  readonly name: string;
  readonly description?: string;
  readonly parameters: readonly ConnectorToolParameter[];
}

export interface ConnectorInstallManifest {
  readonly assetType: 'mcp';
  /** 后台资产编号；内置与自建没有。 */
  readonly assetId?: string;
  readonly source: 'market' | 'builtin' | 'local';
  readonly installedAt: string;
  readonly version?: string;
  /**
   * 定义摘要：对 serverName/transport/command/args/url/title 求 sha256。
   * 连接器没有文件清单，启用前只能校验定义本身；旧记录没有该字段时视为「无法校验」。
   */
  readonly digest?: string;
}

/**
 * 按工具名反查连接器资产的结果。
 *
 * `found: false`（没有对应连接器记录）与 `found: true` 但没有清单必须区分：
 * 前者是工具随连接器删除后的残留调用，由工具自身报未知工具；后者是用户自建，按未登记处理。
 */
export type ConnectorAssetLookup =
  | { readonly found: false }
  | {
    readonly found: true;
    readonly bundled: boolean;
    readonly manifest?: ConnectorInstallManifest;
    /**
     * 工具级收窄信息，只在该连接器被白名单限制时出现：
     * - `raw`：由白名单正向推出的原始工具名；不在白名单内时是无损后缀，用于让闸门给出「未授权」；
     * - `untrusted`：白名单推导集合与实际注册工具完全不相交，按映射不可信拒绝。
     */
    readonly tool?: { readonly raw?: string; readonly untrusted?: boolean };
  };

export interface ConnectorSummary {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly serverName: string;
  readonly transport: 'stdio' | 'streamable-http';
  readonly scope: 'shared';
  /** 来源市场条目 id；有值表示由市场安装，无值表示本机自建。 */
  readonly originId?: string;
  /** 安装清单：启用判定只认它（来源 + 后台编号）；旧记录没有时由启动回填补写。 */
  readonly installManifest?: ConnectorInstallManifest;
  /** 市场分类名称（安装时取市场 bizSceneList 文案，多值全部保留）；自建实例为空。 */
  readonly categories: readonly string[];
  /** 市场原始 serviceId：只有本地 serverName 被换算过时才有值，供卸载上报回传后台。 */
  readonly marketServiceId?: string;
  readonly enabled: boolean;
  readonly state: ConnectorState;
  readonly toolNames: readonly string[];
  /** 工具详情（名称、说明、入参）。toolNames 保留为既有消费方的兼容投影。 */
  readonly tools: readonly ConnectorTool[];
  readonly resourceCount: number;
  readonly resourceTemplateCount: number;
  readonly lastCheckedAt: string;
  readonly diagnostic?: string;
  /**
   * 授权状态（仅市场来源且闸门开启时有值）：
   * - `unauthorized`：当前账号未获得授权；
   * - `revoked`：授权已失效，已被闸门自动逻辑禁用（与用户手动停用区分）。
   */
  readonly authState?: 'unauthorized' | 'revoked';
  /** 与 `authState` 配套的中文原因文案，来自闸门 reasons.ts。 */
  readonly authReason?: string;
  /**
   * 工具级授权（仅连接器被白名单收窄时有值）：
   * - `allowed`：后台白名单里的原始工具名；
   * - `total`：当前实际注册的工具数；
   * - `usable`：白名单与实际注册工具的交集数量，用于展示「可用 x/y」；
   * - `denied`：未授权的公共工具名，界面置灰展示并给原因。
   */
  readonly toolAuth?: {
    readonly restricted: true;
    readonly allowed: readonly string[];
    readonly total: number;
    readonly usable: number;
    readonly denied: readonly string[];
  };
}

export interface ConnectorConfigView {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly serverName: string;
  readonly transport: 'stdio' | 'streamable-http';
  readonly command?: string;
  readonly args?: readonly string[];
  readonly url?: string;
  readonly authorizationConfigured: boolean;
  readonly authorizationWritable: boolean;
  readonly editable: true;
}

export interface ConnectorInput {
  readonly title: string;
  readonly description?: string;
  readonly serverName: string;
  readonly transport: 'stdio' | 'streamable-http';
  readonly command?: string;
  readonly args?: readonly string[];
  readonly url?: string;
  /**
   * 建连时要附加的 HTTP 请求头（市场按 `requestHeaders` 下发，可含多个自定义头）。
   * 值属于机密，只写入官方凭据服务，不会出现在列表、详情与诊断里。
   */
  readonly requestHeaders?: readonly ConnectorRequestHeader[];
  /** Transient write-only value. It is stored by ctx.credentials and never returned. */
  readonly authorizationToken?: string;
  /** 来源市场条目 id；仅市场安装流程写入，用于「已安装」判定与卸载。 */
  readonly originId?: string;
  /** 市场原始 serviceId：当它超出官方 serverName 约束时，本地标识会被换算，卸载上报仍需要原始值。 */
  readonly marketServiceId?: string;
  /** 市场分类名称（市场 bizSceneList 文案，多值全部保留）；仅市场安装流程写入，供本地展示与按分类筛选。 */
  readonly categories?: readonly string[];
}

/**
 * 本机包安装任务状态。市场条目里以包管理器（npx/npm/pnpm…）启动的 stdio MCP，
 * 必须先把 npm 包从内网仓库落到本机才能启动，安装耗时无法在一次请求里等完，
 * 因此安装期间对外暴露这个任务态，由界面轮询。
 */
export type ConnectorInstallState = 'installing' | 'ready' | 'failed';

export interface ConnectorInstallTask {
  /** 市场条目 id：安装任务是「条目 → 本机」的过程，按它索引。 */
  readonly originId: string;
  /** 安装成功后写入连接器的服务标识，也是本机安装目录名。 */
  readonly serverName: string;
  readonly title: string;
  readonly state: ConnectorInstallState;
  /** 失败原因（可直接展示的中文文案）；ready 时为空。 */
  readonly message?: string;
  readonly startedAt: string;
  readonly updatedAt: string;
}

/**
 * 市场安装的即时结果：直接执行的条目同步建连并返回 ready；
 * 需要下载依赖的条目返回 installing，界面据此改为轮询安装状态。
 */
export interface MarketInstallResult {
  readonly originId: string;
  readonly title: string;
  readonly state: 'ready' | 'installing';
}

export interface ConnectorManagementService {
  list(signal?: AbortSignal): Promise<readonly ConnectorSummary[]>;
  config(id: string): Promise<ConnectorConfigView>;
  create(input: ConnectorInput): Promise<ConnectorSummary>;
  update(id: string, input: ConnectorInput): Promise<ConnectorSummary>;
  remove(id: string): Promise<void>;
  setEnabled(id: string, enabled: boolean): Promise<ConnectorSummary>;
  /** 一次性回填：为旧记录补写安装清单；幂等、可重复执行。 */
  backfillInstallManifests(): Promise<{ readonly scanned: number; readonly written: number; readonly failed: number }>;
  /**
   * 按 MCP 工具名（`mcp__<serverName>__<tool>`）反查连接器记录的安装清单。
   * 只读内存表，不建连、不探活，供资产闸门在工具调用前同步判定。
   */
  connectorAssetForTool(toolName: string): ConnectorAssetLookup;
  /** 未显式选择过的会话返回全部可用（已连接）连接器；显式保存过则按保存值。 */
  selection(sessionId: string): Promise<readonly string[]>;
  setSelection(sessionId: string, connectorIds: readonly string[]): Promise<readonly string[]>;
  /** 撤权协调：已安装且来源为市场、带后台编号的连接器。 */
  marketAssets?(): readonly { readonly localId: string; readonly assetId: string }[];
  /** 账本变化后按当前账号重算运行态：停用被撤销的、恢复已重新授权的。 */
  applyGateState?(): Promise<void>;
  /**
   * 启用前定义摘要校验：`modified` 表示与清单记录不一致，`unverifiable` 表示旧记录没有摘要。
   */
  verifyDefinitionIntegrity?(id: string): 'ok' | 'unverifiable' | 'modified';
}
