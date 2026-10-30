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

/** 单个 MCP 工具的展示信息，供连接器详情页渲染工具清单。 */
export interface ConnectorTool {
  readonly name: string;
  readonly description?: string;
  readonly parameters: readonly ConnectorToolParameter[];
}

export interface ConnectorSummary {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly serverName: string;
  readonly transport: 'stdio' | 'streamable-http';
  readonly scope: 'shared';
  /** 来源市场条目 id；有值表示由市场安装，无值表示本机自建。 */
  readonly originId?: string;
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

export interface ConnectorManagementService {
  list(signal?: AbortSignal): Promise<readonly ConnectorSummary[]>;
  config(id: string): Promise<ConnectorConfigView>;
  create(input: ConnectorInput): Promise<ConnectorSummary>;
  update(id: string, input: ConnectorInput): Promise<ConnectorSummary>;
  remove(id: string): Promise<void>;
  setEnabled(id: string, enabled: boolean): Promise<ConnectorSummary>;
  /** Defaults to every ready connector until the session saves an explicit choice. */
  selection(sessionId: string): Promise<readonly string[]>;
  setSelection(sessionId: string, connectorIds: readonly string[]): Promise<readonly string[]>;
}
