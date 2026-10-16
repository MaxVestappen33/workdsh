import { Service } from '@deepseek-ai/cordis';
import type { Context } from '@deepseek-ai/cordis';
import {
  SkillMarketClient, SkillMarketRequestError,
  type SkillMarketAuthorized, type SkillMarketBackend, type SkillMarketPage, type SkillMarketPaths, type SkillMarketQuery, type SkillScene,
} from '../market.js';

/**
 * 市场接口路径缺省值：与 Desktop 随包 workdsh-app.json 的 server 段保持一致。
 * 四个接口都在 desktop-client 命名空间；Desktop 侧可通过插件选项覆盖。
 * 安装与卸载后台当前是预留实现（只记录行为），本机安装/卸载在下一轮接入。
 */
const DEFAULT_MARKET_PATHS: SkillMarketPaths = {
  list: '/desktop-client/skill/queryAuthorizedSkillList',
  categories: '/desktop-client/skill/querySkillBizSceneList',
  install: '/desktop-client/skill/installSkill',
  uninstall: '/desktop-client/skill/unInstallSkill',
};

/** 授权技能索引的缓存时长：本地技能每次刷新都会读它，短 TTL 足够且避免反复翻页。 */
const INDEX_TTL_MS = 60_000;

/**
 * 本机安装/卸载（把技能包落到 DSH 技能目录、以及反向移除）在下一轮接入：
 * 本轮已经把后台的安装/卸载接口接通并上报行为，落盘部分确定后再替换这两条提示。
 */
const INSTALL_PENDING_MESSAGE = '已上报技能安装，本机安装将在下一轮接入。';
const UNINSTALL_PENDING_MESSAGE = '已上报技能卸载，本机卸载将在下一轮接入。';

export interface SkillMarketOptions {
  /**
   * 市场接口路径。由宿主（Desktop）从 ServerConfig 注入；未配置时回退到内置默认值。
   * skills 是 Desktop/Web 共用的 Profile 包，因此不从 Desktop 专有模块读取配置。
   */
  readonly paths?: Partial<SkillMarketPaths>;
}

export interface SkillMarketUninstall {
  readonly id?: string;
  readonly slug?: string;
}

export interface SkillMarket {
  /** 市场是否可用：通用后台通道缺失或没有绑定时为 false，界面据此隐藏市场入口。 */
  available(): Promise<boolean>;
  list(input?: SkillMarketQuery, signal?: AbortSignal): Promise<SkillMarketPage>;
  categories(signal?: AbortSignal): Promise<readonly SkillScene[]>;
  /** 全量授权技能索引：本地技能按标识匹配业务场景用（带短 TTL 缓存）。 */
  index(signal?: AbortSignal): Promise<readonly SkillMarketAuthorized[]>;
  /** 安装：先调用后台安装接口上报行为（后台当前为预留实现），本机安装待下一轮接入。 */
  install(id: string, signal?: AbortSignal): Promise<never>;
  /** 卸载：先调用后台卸载接口上报行为（后台当前为预留实现），本机卸载待下一轮接入。 */
  uninstall(target: SkillMarketUninstall, signal?: AbortSignal): Promise<never>;
}

declare module '@deepseek-ai/cordis' { interface Context { workdshSkillMarket: SkillMarket } }

/** 市场是宿主侧能力：绑定缺失时整体降级为不可用，不影响技能插件加载。 */
export class SkillMarketService extends Service implements SkillMarket {
  private client?: SkillMarketClient;
  /** 授权技能索引缓存：进程内缓存，TTL 过后重新翻页取全。 */
  private cachedIndex?: { readonly at: number; readonly rows: readonly SkillMarketAuthorized[] };

  constructor(ctx: Context, private readonly options: SkillMarketOptions = {}) { super(ctx, 'workdshSkillMarket'); }

  async available(): Promise<boolean> {
    const channel = this.channel();
    if (!channel) return false;
    try { return await channel.available(); } catch { return false; }
  }

  async list(input: SkillMarketQuery = {}, signal?: AbortSignal): Promise<SkillMarketPage> {
    return (await this.client_()).list(input, signal);
  }

  async categories(signal?: AbortSignal): Promise<readonly SkillScene[]> {
    return (await this.client_()).categories(signal);
  }

  async index(signal?: AbortSignal): Promise<readonly SkillMarketAuthorized[]> {
    const now = Date.now();
    if (this.cachedIndex && now - this.cachedIndex.at < INDEX_TTL_MS) return this.cachedIndex.rows;
    const rows = await (await this.client_()).index(signal);
    this.cachedIndex = { at: now, rows };
    return rows;
  }

  async install(id: string, signal?: AbortSignal): Promise<never> {
    const key = id.trim();
    if (!key) throw new SkillMarketRequestError('skill/market-rejected', '缺少技能标识，无法安装。');
    const client = await this.client_();
    // 后台接口（/skill/installSkill）本轮已接通：先上报安装行为，落盘到本机 DSH 技能目录的部分待下一轮。
    await client.reportInstall(key, client.item(key)?.slug, signal);
    throw new SkillMarketRequestError('skill/market-install-pending', INSTALL_PENDING_MESSAGE);
  }

  async uninstall(target: SkillMarketUninstall, signal?: AbortSignal): Promise<never> {
    const id = target.id?.trim(); const slug = target.slug?.trim();
    if (!id && !slug) throw new SkillMarketRequestError('skill/market-rejected', '缺少技能标识，无法卸载。');
    const client = await this.client_();
    // 上报优先带市场条目 id，同时补上技能标识：列表里见过该条目时能拿到，后台实现时两种口径都能对应。
    const nameEn = slug ?? (id ? client.item(id)?.slug : undefined);
    await client.reportUninstall({ ...(id ? { id } : {}), ...(nameEn ? { slug: nameEn } : {}) }, signal);
    throw new SkillMarketRequestError('skill/market-uninstall-pending', UNINSTALL_PENDING_MESSAGE);
  }

  private async client_(): Promise<SkillMarketClient> {
    if (this.client) return this.client;
    const channel = this.channel();
    if (!channel) throw new SkillMarketRequestError('skill/market-unavailable', '当前环境未接入技能市场。');
    // 地址、授权头、信封与超时都由通用后台通道负责；市场只提供路径，绑定由通道按需获取。
    const paths = this.options.paths ?? {};
    this.client = new SkillMarketClient({
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

  /** 通用后台通道是可选注入的宿主能力：缺失时市场整体不可用，技能插件本身照常加载。 */
  private channel(): SkillMarketBackend | undefined {
    return this.ctx.reflect.get('workdshBackend') as SkillMarketBackend | undefined;
  }
}
