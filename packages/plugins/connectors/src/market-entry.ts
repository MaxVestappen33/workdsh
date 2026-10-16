import { Service } from '@deepseek-ai/cordis';
import type { Context } from '@deepseek-ai/cordis';
import type { BackendChannel } from 'workdsh-provider-backend-channel';
import { ConnectorMarketClient, MarketRequestError, type MarketCategory, type MarketPage, type MarketPaths, type MarketQuery } from './market.js';
import type { ConnectorSummary } from './shared.js';

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
}

export interface ConnectorMarketUninstall {
  readonly originId?: string;
  readonly id?: string;
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
  install(originId: string, signal?: AbortSignal): Promise<ConnectorSummary>;
  uninstall(target: ConnectorMarketUninstall, signal?: AbortSignal): Promise<ConnectorMarketUninstallResult>;
}

declare module '@deepseek-ai/cordis' { interface Context { workdshConnectorMarket: ConnectorMarket } }

/** 市场是宿主侧能力：绑定缺失时整体降级为不可用，不影响连接器插件加载。 */
export class ConnectorMarketService extends Service implements ConnectorMarket {
  static inject = ['workdshConnectors'];
  private client?: ConnectorMarketClient;

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
   * 从市场安装：先调安装上报接口告知后台（后台只记录，不回传业务字段），
   * 再用列表里已返回的字段在本地创建连接器定义，最后交给既有 ConnectorManager（负责判重与凭据写入）。
   * 不再调用「取连接配置」类接口：连接方式与地址全部来自市场列表。
   */
  async install(originId: string, signal?: AbortSignal): Promise<ConnectorSummary> {
    const client = await this.client_();
    const key = originId.trim();
    const item = key ? client.item(key) : undefined;
    if (!item) throw new MarketRequestError('connector/market-item-unknown', '市场条目信息已失效，请刷新市场后重试。');
    await client.reportInstall(item.originId, item.serverName, signal);
    // 连接器定义对名称与说明有长度上限，超长时截断，避免市场文案过长导致安装失败。
    return this.ctx.workdshConnectors.create({
      title: item.title.slice(0, 80),
      description: item.description.slice(0, 240),
      serverName: item.serverName,
      transport: item.transport,
      ...(item.transport === 'stdio' ? { command: item.command, args: [...(item.args ?? [])] } : { url: item.url }),
      originId: item.originId,
      // 本机实例的分类取后台展开后的 bizSceneList 名称（多值全部保留）：本地卡片、详情与分类筛选
      // 直接用这份文案，不再回查分类字典，也就不会出现「编码没被翻译」的情况。
      ...(item.categoryLabels.length ? { categories: [...item.categoryLabels] } : {}),
    });
  }

  /**
   * 从市场卸载：先调卸载上报接口，再移除本机实例。
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
      await (await this.client_()).reportUninstall(originId, matched?.serverName, signal);
    } catch {
      reported = false;
    }
    if (matched?.id) await manager.remove(matched.id);
    return { uninstalled: true, reported };
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
