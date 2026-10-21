import { createHash } from 'node:crypto';
import { Service } from '@deepseek-ai/cordis';
import type { Context } from '@deepseek-ai/cordis';
import type { BackendChannel } from 'workdsh-provider-backend-channel';
import { ConnectorMarketClient, MarketRequestError, type MarketCategory, type MarketItem, type MarketPage, type MarketPaths, type MarketQuery } from './market.js';
import { installNodePackage, removeNodePackage, type ConnectorInstallOptions } from './install-package.js';
import type { ConnectorInstallState, ConnectorInstallTask, ConnectorSummary, MarketInstallResult } from './shared.js';

/**
 * 市场接口路径缺省值：与 Desktop 随包 workdsh-app.json 的 server 段保持一致。
 * 列表、分类字典与安装/卸载上报都在 desktop-client 命名空间；Desktop 侧可通过插件选项覆盖。
 */
const DEFAULT_MARKET_PATHS: MarketPaths = {
  list: '/desktop-client/mcptool/queryAuthorizedMcpToolList',
  categories: '/desktop-client/mcptool/queryMcpToolBizSceneList',
  install: '/desktop-client/mcptool/installMcpTool',
  uninstall: '/desktop-client/mcptool/unInstallMcpTool',
};

export interface ConnectorMarketOptions {
  /**
   * 市场接口路径。由宿主（Desktop）从 ServerConfig 注入；未配置时回退到内置默认值。
   * connectors 是 Desktop/Web 共用的 Profile 包，因此不从 Desktop 专有模块读取配置。
   */
  readonly paths?: Partial<MarketPaths>;
  /**
   * 本机包安装能力（内网仓库地址 + 随包 Node/pnpm + 安装根目录），同样由宿主注入。
   * 缺失时市场里需要下载依赖的条目会明确报错，直接执行与本机自建的条目不受影响。
   */
  readonly install?: ConnectorInstallOptions;
}

export interface ConnectorMarketUninstall {
  readonly originId?: string;
  readonly id?: string;
}

/** 官方 MCP 客户端与本地连接器定义都要求 serverName 为 `[A-Za-z0-9_-]{1,32}`。 */
const SERVER_NAME_LIMIT = 32;

/**
 * 把市场 serviceId 换算成本机可用的 serverName。
 * 原值就合规时原样使用；超长或含其它字符时清洗后截断并追加 serviceId 的短哈希，
 * 保证同一 serviceId 每次都得到同一个（≤32 且不冲突的）本地标识。
 */
function localServerNameOf(serviceId: string): string {
  const service = serviceId.trim();
  const clean = service.replace(/[^A-Za-z0-9_-]+/gu, '-').replace(/^[-_]+|[-_]+$/gu, '');
  if (clean === service && clean.length <= SERVER_NAME_LIMIT) return clean;
  const digest = createHash('sha256').update(service).digest('hex').slice(0, 8);
  const head = clean.slice(0, SERVER_NAME_LIMIT - digest.length - 1).replace(/[-_]+$/u, '');
  return `${head || 'mcp'}-${digest}`;
}

/** 卸载结果：`reported` 表示后台卸载上报是否成功（上报失败不阻断本地卸载）。 */
export interface ConnectorMarketUninstallResult {
  readonly uninstalled: boolean;
  readonly reported: boolean;
}

export interface ConnectorMarket {
  /** 市场是否可用：通用后台通道缺失或没有绑定时为 false，界面据此隐藏市场入口。 */
  available(): Promise<boolean>;
  list(input?: MarketQuery, signal?: AbortSignal): Promise<MarketPage>;
  categories(signal?: AbortSignal): Promise<readonly MarketCategory[]>;
  /** 安装市场条目：直接执行的条目同步建连；需要下载依赖的条目返回 installing 并转入后台任务。 */
  install(originId: string, signal?: AbortSignal): Promise<MarketInstallResult>;
  /** 查询某条目的本机安装任务；没有任务（未安装过或已清理）时返回 null。 */
  installStatus(originId: string): Promise<ConnectorInstallTask | null>;
  uninstall(target: ConnectorMarketUninstall, signal?: AbortSignal): Promise<ConnectorMarketUninstallResult>;
}

declare module '@deepseek-ai/cordis' { interface Context { workdshConnectorMarket: ConnectorMarket } }

/** 市场是宿主侧能力：绑定缺失时整体降级为不可用，不影响连接器插件加载。 */
export class ConnectorMarketService extends Service implements ConnectorMarket {
  static inject = ['workdshConnectors'];
  private client?: ConnectorMarketClient;
  /**
   * 本机安装任务：只存在于当前 Host 进程。进程重启后未完成的安装随之中断，
   * 界面也随页面重载回到「未安装」，重试时会先清空目标目录再装，不会留下半装状态。
   */
  private readonly tasks = new Map<string, ConnectorInstallTask>();

  constructor(ctx: Context, private readonly options: ConnectorMarketOptions = {}) { super(ctx, 'workdshConnectorMarket'); }

  async available(): Promise<boolean> {
    const channel = this.channel();
    if (!channel) return false;
    try { return await channel.available(); } catch { return false; }
  }

  async list(input: MarketQuery = {}, signal?: AbortSignal): Promise<MarketPage> {
    return (await this.client_()).list(input, signal);
  }

  async categories(signal?: AbortSignal): Promise<readonly MarketCategory[]> {
    return (await this.client_()).categories(signal);
  }

  /**
   * 从市场安装：先调安装上报接口告知后台（后台只记录，不回传业务字段），再按条目描述的启动方式在本机建连。
   * 启动方式有两种：直接执行（node/python/绝对路径，本机自备）同步完成；
   * 依赖 npm 包（command 是 npx/npm/pnpm…）则先从内网仓库装包，安装期间返回 installing 由界面轮询。
   */
  async install(originId: string, signal?: AbortSignal): Promise<MarketInstallResult> {
    const client = await this.client_();
    const key = originId.trim();
    const item = key ? client.item(key) : undefined;
    if (!item) throw new MarketRequestError('connector/market-item-unknown', '市场条目信息已失效，请刷新市场后重试。');
    // 同一条目重复点击时复用正在跑的安装任务：不能让两份 pnpm 同时装同一个目录。
    if (this.tasks.get(item.originId)?.state === 'installing')
      return { originId: item.originId, title: item.title, state: 'installing' };
    await client.reportInstall(item.originId, item.serverName, signal);
    // 市场 serviceId 可能超出官方 serverName 约束，这里换算成本机标识后再落盘；上报仍用原始 serviceId。
    const serverName = localServerNameOf(item.serverName);
    if (item.launch === 'direct') {
      await this.createFrom(item, item.transport === 'stdio'
        ? { kind: 'stdio', command: item.command, args: item.args }
        : { kind: 'http', url: item.url }, serverName);
      this.record(item, 'ready');
      return { originId: item.originId, title: item.title, state: 'ready' };
    }
    // 装包耗时无法在一次请求里等完：先落任务态再进后台，超时/失败都留在任务里可见、可重试。
    this.record(item, 'installing');
    void this.installPackage(item, serverName);
    return { originId: item.originId, title: item.title, state: 'installing' };
  }

  async installStatus(originId: string): Promise<ConnectorInstallTask | null> {
    return this.tasks.get(originId.trim()) ?? null;
  }

  /**
   * 从市场卸载：先调卸载上报接口，再移除本机实例，最后清理该条目的本机安装目录。
   * 上报失败不阻断本地卸载：后台异常或网络问题时若先报错，用户会卡在「卸载不了、也删不掉」的状态；
   * 这里优先保证本机可清理，上报结果通过返回值暴露，界面据此提示后台记录可能未同步。
   */
  async uninstall(target: ConnectorMarketUninstall, signal?: AbortSignal): Promise<ConnectorMarketUninstallResult> {
    const manager = this.ctx.workdshConnectors;
    const rows = await manager.list(signal);
    const id = target.id?.trim(); const local = id ? rows.find(row => row.id === id) : undefined;
    if (id && !local) throw new Error('connector/not-found');
    const originId = target.originId?.trim() || local?.originId;
    if (!originId) throw new MarketRequestError('connector/market-origin-required', '该 MCP 不是从市场安装的，无法从市场卸载。');
    const matched = local ?? rows.find(row => row.originId === originId);
    let reported = true;
    try {
      await (await this.client_()).reportUninstall(originId, matched?.marketServiceId ?? matched?.serverName, signal);
    } catch {
      reported = false;
    }
    if (matched?.id) await manager.remove(matched.id);
    // 安装目录是市场安装的产物：卸载条目时一并清掉，避免留下没人引用的包树。
    const install = this.options.install;
    if (install && matched?.serverName) {
      await removeNodePackage(install.root, matched.serverName).catch(cause => {
        this.ctx.logger.warn(`连接器：清理 ${matched.serverName} 的安装目录失败（${cause instanceof Error ? cause.message : String(cause)}）。`);
      });
    }
    this.tasks.delete(originId);
    return { uninstalled: true, reported };
  }

  /**
   * 需要依赖的条目：先用随包 pnpm 从内网仓库把包（含全部依赖）装到本机目录，
   * 再用「随包 Node + 包内入口」建连。整个过程在后台跑，状态写进安装任务供界面轮询。
   */
  private async installPackage(item: MarketItem, serverName: string): Promise<void> {
    try {
      const install = this.options.install;
      if (!install) throw new MarketRequestError('connector/package-install-unsupported', '当前环境未配置内网包仓库，无法安装依赖 npm 包的 MCP。');
      if (!item.packageSpec) throw new MarketRequestError('connector/package-spec-missing', '市场条目没有提供要安装的包名。');
      const installed = await installNodePackage({ ...install, serverName, spec: item.packageSpec });
      await this.createFrom(item, { kind: 'stdio', command: install.node, args: [installed.entry, ...(item.packageArgs ?? [])] }, serverName);
      this.record(item, 'ready');
      this.ctx.logger.info(`连接器：已从内网仓库安装 ${installed.packageName}@${installed.version}（${installed.directory}）。`);
    } catch (cause) {
      const message = cause instanceof Error && cause.message ? cause.message : '依赖安装失败，请重试。';
      this.record(item, 'failed', message);
      this.ctx.logger.warn(`连接器：市场条目 ${item.serverName} 安装失败（${message}）。`);
    }
  }

  /** 记录安装任务状态：startedAt 保留首次安装时间，便于界面提示「已等待多久」。 */
  private record(item: MarketItem, state: ConnectorInstallState, message?: string): void {
    const now = new Date().toISOString();
    this.tasks.set(item.originId, {
      originId: item.originId, serverName: item.serverName, title: item.title, state,
      ...(message ? { message } : {}), startedAt: this.tasks.get(item.originId)?.startedAt ?? now, updatedAt: now,
    });
  }

  /**
   * 用最终启动方式在本机建连。同一市场条目重复安装时改现有实例的启动配置，
   * 而不是新建同名连接器（serverName 唯一，重复 create 会被拒）；
   * 只有同来源（originId 相同）的实例才会被改写，避免覆盖用户自建的连接器。
   */
  private async createFrom(item: MarketItem, launch: { kind: 'stdio'; command?: string; args?: readonly string[] } | { kind: 'http'; url?: string }, serverName: string): Promise<ConnectorSummary> {
    const manager = this.ctx.workdshConnectors;
    // 连接器定义对名称与说明有长度上限，超长时截断，避免市场文案过长导致安装失败。
    const input = {
      title: item.title.slice(0, 80),
      description: item.description.slice(0, 240),
      serverName,
      transport: item.transport,
      ...(launch.kind === 'stdio' ? { command: launch.command, args: [...(launch.args ?? [])] } : { url: launch.url }),
      // 市场条目自带的令牌原样作为 Authorization 头：由连接器管理器写入官方凭据服务，
      // 定义里只落引用，界面的列表与详情都不会回传明文。
      ...(item.authorization ? { authorizationToken: item.authorization } : {}),
      originId: item.originId,
      // 本地标识被换算过时保留原始 serviceId，卸载上报仍回传后台的原值。
      ...(serverName === item.serverName ? {} : { marketServiceId: item.serverName }),
      // 本机实例的分类取后台展开后的 bizSceneList 名称（多值全部保留）：本地卡片、详情与分类筛选
      // 直接用这份文案，不再回查分类字典，也就不会出现「编码没被翻译」的情况。
      ...(item.categoryLabels.length ? { categories: [...item.categoryLabels] } : {}),
    };
    const existing = (await manager.list()).find(row => row.originId === item.originId);
    return existing ? manager.update(existing.id, input) : manager.create(input);
  }

  private async client_(): Promise<ConnectorMarketClient> {
    if (this.client) return this.client;
    const channel = this.channel();
    if (!channel) throw new MarketRequestError('connector/market-unavailable', '当前环境未接入 MCP 市场。');
    // 地址、授权头、信封与超时都由通用后台通道负责；市场只提供路径，绑定由通道按需获取。
    const paths = this.options.paths ?? {};
    this.client = new ConnectorMarketClient({
      paths: {
        list: paths.list?.trim() || DEFAULT_MARKET_PATHS.list,
        categories: paths.categories?.trim() || DEFAULT_MARKET_PATHS.categories,
        install: paths.install?.trim() || DEFAULT_MARKET_PATHS.install,
        uninstall: paths.uninstall?.trim() || DEFAULT_MARKET_PATHS.uninstall,
      },
      backend: channel,
    });
    return this.client;
  }

  /** 通用后台通道是可选注入的宿主能力：缺失时市场整体不可用，连接器插件本身照常加载。 */
  private channel(): BackendChannel | undefined {
    return this.ctx.reflect.get('workdshBackend') as BackendChannel | undefined;
  }
}
