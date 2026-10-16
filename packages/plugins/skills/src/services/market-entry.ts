import { homedir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { Service } from '@deepseek-ai/cordis';
import type { Context } from '@deepseek-ai/cordis';
import {
  SkillMarketClient, SkillMarketRequestError, readSkillFile, skillDocumentText, stagedNameOf, streamSkillFile,
  type SkillMarketAuthorized, type SkillMarketBackend, type SkillMarketDocument, type SkillMarketInstallResult,
  type SkillMarketItem, type SkillMarketPage, type SkillMarketPaths, type SkillMarketQuery, type SkillScene,
} from '../market.js';
import type { SkillInstallScope } from '../shared.js';

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
 * 市场安装的落地范围：统一写进「所有 WorkDSH 任务共享」的官方技能目录，
 * 与「上传技能」的默认范围保持一致，不再让用户在安装时选择。
 */
const MARKET_INSTALL_SCOPE: SkillInstallScope = 'shared-agents';

/** 后台判定的「同名技能已存在」错误码：市场安装遇到它说明这条技能其实已经在本机了。 */
const ALREADY_INSTALLED = 'skill/target-exists';

/**
 * 市场安装记录文件：记住「哪个市场条目装成了本机哪个技能」。
 * 放在 SkillManager 同一个状态根下（DSH_HOME/agents/.workdsh-state），内容是一份 条目 id → 技能名 的映射。
 */
function installRecordFile(): string {
  const dshHome = resolve(process.env.DSH_HOME ?? join(homedir(), '.dsh'));
  const agentsHome = resolve(process.env.DSH_AGENTS_HOME ?? join(dshHome, 'agents'));
  return join(agentsHome, '.workdsh-state', 'skills', 'market-installs.json');
}

const describe = (error: unknown): string => error instanceof Error ? error.message : String(error);

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

/** 卸载结果：`reported` 表示后台卸载上报是否成功（上报失败不阻断本机卸载）。 */
export interface SkillMarketUninstallResult {
  readonly reported: boolean;
}

export interface SkillMarket {
  /** 市场是否可用：通用后台通道缺失或没有绑定时为 false，界面据此隐藏市场入口。 */
  available(): Promise<boolean>;
  list(input?: SkillMarketQuery, signal?: AbortSignal): Promise<SkillMarketPage>;
  categories(signal?: AbortSignal): Promise<readonly SkillScene[]>;
  /** 全量授权技能索引：本地技能按标识匹配业务场景用（带短 TTL 缓存）。 */
  index(signal?: AbortSignal): Promise<readonly SkillMarketAuthorized[]>;
  /**
   * 安装到本机：先调用后台安装接口上报行为，再下载条目附件（fjxxList 第一条），
   * 之后复用官方导入链路（暂存预检 → 确认写入共享技能目录）。缺少附件时直接拒绝安装。
   * 返回技能包内声明的技能名与实际落地状态。
   */
  install(id: string, signal?: AbortSignal): Promise<SkillMarketInstallResult>;
  /** 卸载上报：后台记账失败不阻断本机卸载，结果通过 reported 暴露。 */
  uninstall(target: SkillMarketUninstall, signal?: AbortSignal): Promise<SkillMarketUninstallResult>;
  /** 详情页展示用的附件信息与正文（md 全文，zip 解出其中的 SKILL.md）。 */
  document(id: string, signal?: AbortSignal): Promise<SkillMarketDocument>;
}

declare module '@deepseek-ai/cordis' { interface Context { workdshSkillMarket: SkillMarket } }

/** 市场是宿主侧能力：绑定缺失时整体降级为不可用，不影响技能插件加载。 */
export class SkillMarketService extends Service implements SkillMarket {
  private client?: SkillMarketClient;
  /** 授权技能索引缓存：进程内缓存，TTL 过后重新翻页取全。 */
  private cachedIndex?: { readonly at: number; readonly rows: readonly SkillMarketAuthorized[] };
  /** 市场安装记录文件（条目 id → 本机技能名），用于列表里的「已安装」判定。 */
  private readonly recordFile = installRecordFile();

  constructor(ctx: Context, private readonly options: SkillMarketOptions = {}) { super(ctx, 'workdshSkillMarket'); }

  async available(): Promise<boolean> {
    const channel = this.channel();
    if (!channel) return false;
    try { return await channel.available(); } catch { return false; }
  }

  async list(input: SkillMarketQuery = {}, signal?: AbortSignal): Promise<SkillMarketPage> {
    return this.decorate(await (await this.client_()).list(input, signal), signal);
  }

  /**
   * 给市场条目补上本机安装状态（后台不下发安装状态）。判定顺序：
   * 1）安装记录里的「条目 id → 技能名」，且该技能现在仍在本机（记录指向的技能被卸载后自动失效）；
   * 2）条目标识 skillNameEn，它与本机技能标识同口径；
   * 3）条目名称 skillName。
   * 命中时给出 installedName，界面据此显示「已安装」，卸载也按它定位本机技能。
   */
  private async decorate(page: SkillMarketPage, signal?: AbortSignal): Promise<SkillMarketPage> {
    const records = await this.records();
    // 本机技能：键为小写标识（用于比较），值为原始名称（用于卸载定位）。
    const local = new Map((await this.ctx.workdshSkills.list(signal)).map(row => [row.name.trim().toLowerCase(), row.name]));
    const findLocal = (value: string | undefined): string | undefined => {
      const key = value?.trim().toLowerCase();
      return key ? local.get(key) : undefined;
    };
    const items: readonly SkillMarketItem[] = page.items.map(item => {
      const name = findLocal(records.get(item.id)) ?? findLocal(item.slug) ?? findLocal(item.title);
      return name ? { ...item, installed: true, installedName: name } : { ...item, installed: false };
    });
    return { ...page, items };
  }

  /** 市场安装记录：文件不存在或格式损坏都按空处理，不影响列表与安装。 */
  private async records(): Promise<ReadonlyMap<string, string>> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.recordFile, 'utf8'));
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return new Map();
      return new Map(Object.entries(parsed as Record<string, unknown>)
        .flatMap(([id, name]) => (typeof name === 'string' && name.trim() ? [[id, name.trim()] as const] : [])));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.ctx.logger.warn(`技能：读取市场安装记录失败（${describe(error)}）。`);
      return new Map();
    }
  }

  /** 记下「市场条目 → 本机技能名」。写失败只影响下次的已安装标记（还有名称匹配兜底），不阻断安装。 */
  private async rememberInstall(id: string, name: string): Promise<void> {
    const records = new Map(await this.records());
    records.set(id, name);
    try {
      await mkdir(dirname(this.recordFile), { recursive: true, mode: 0o700 });
      await writeFile(this.recordFile, `${JSON.stringify(Object.fromEntries(records), null, 2)}\n`, { mode: 0o600 });
    } catch (error) {
      this.ctx.logger.warn(`技能：写入市场安装记录失败（${describe(error)}）。`);
    }
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

  /**
   * 安装到本机：
   * 1）先调用后台安装接口上报安装行为，上报失败即中止，避免后台与本机状态不一致；
   * 2）取条目附件（fjxxList 第一条）并下载，缺少附件时按约定拒绝安装；
   * 3）交给官方导入链路：暂存预检（stage）→ 确认写入共享技能目录（commit），
   *    与「上传技能」用的是同一条实现，因此重名冲突、体积上限、SKILL.md 校验等规则完全一致；
   * 4）成功后记下「条目 id → 本机技能名」，列表据此显示已安装；本机已有同名技能时按已安装处理。
   */
  async install(id: string, signal?: AbortSignal): Promise<SkillMarketInstallResult> {
    const key = id.trim();
    if (!key) throw new SkillMarketRequestError('skill/market-rejected', '缺少技能标识，无法安装。');
    const client = await this.client_();
    const item = client.item(key);
    if (!item) throw new SkillMarketRequestError('skill/market-item-unknown', '市场条目信息已失效，请刷新技能市场后重试。');
    const file = item.file;
    if (!file) throw new SkillMarketRequestError('skill/market-file-missing', '该技能缺少技能说明文件，不能安装。');
    await client.reportInstall(item.id, item.slug, signal);
    const manager = this.ctx.workdshSkills;
    const staged = await manager.imports.stage(stagedNameOf(file), await streamSkillFile(file, signal), signal ?? new AbortController().signal);
    // 技能包内声明的名称才是本机技能标识（市场条目标识 skillNameEn 可能与它不同）。
    const name = staged.inspection.name;
    try {
      await manager.imports.commit(staged.id, MARKET_INSTALL_SCOPE, signal);
    } catch (cause) {
      await manager.imports.discard(staged.id).catch(() => {});
      // 本机已有同名技能：这条市场技能实际上已经装在本机了，按「已安装」处理并记录下来，
      // 界面显示已安装 / 卸载，而不是把用户卡在一个永远装不上的按钮上。
      if (cause instanceof Error && cause.message === ALREADY_INSTALLED) {
        await this.rememberInstall(item.id, name);
        return { name, state: 'existing' };
      }
      throw cause;
    }
    await this.rememberInstall(item.id, name);
    return { name, state: 'installed' };
  }

  /**
   * 卸载上报：调用后台的卸载接口（`/skill/unInstallSkill`）。
   * 上报失败不阻断本机卸载（与 MCP 市场同口径）：后台异常时优先保证用户能清理本机技能，
   * 真实结果通过 reported 暴露给界面提示「后台记录可能未同步」。
   */
  async uninstall(target: SkillMarketUninstall, signal?: AbortSignal): Promise<SkillMarketUninstallResult> {
    const id = target.id?.trim(); const slug = target.slug?.trim();
    if (!id && !slug) throw new SkillMarketRequestError('skill/market-rejected', '缺少技能标识，无法卸载。');
    const client = await this.client_();
    // 上报优先带市场条目 id，同时补上技能标识：列表里见过该条目时能拿到，后台两种口径都能对应。
    const nameEn = slug ?? (id ? client.item(id)?.slug : undefined);
    try {
      await client.reportUninstall({ ...(id ? { id } : {}), ...(nameEn ? { slug: nameEn } : {}) }, signal);
      return { reported: true };
    } catch (cause) {
      // 用户主动取消说明这次卸载没有被继续执行，不能当成「已尝试上报」吞掉。
      if (cause instanceof SkillMarketRequestError && cause.code === 'skill/request-cancelled') throw cause;
      this.ctx.logger.warn(`技能：市场卸载上报失败（${cause instanceof Error ? cause.message : String(cause)}）。`);
      return { reported: false };
    }
  }

  /** 详情页说明：下载条目附件并取出正文；正文取不到时只返回文件信息，由界面降级展示。 */
  async document(id: string, signal?: AbortSignal): Promise<SkillMarketDocument> {
    const key = id.trim();
    if (!key) throw new SkillMarketRequestError('skill/market-rejected', '缺少技能标识。');
    const client = await this.client_();
    const item = client.item(key);
    if (!item) throw new SkillMarketRequestError('skill/market-item-unknown', '市场条目信息已失效，请刷新技能市场后重试。');
    const file = item.file;
    if (!file) throw new SkillMarketRequestError('skill/market-file-missing', '该技能没有上传技能说明文件。');
    const text = skillDocumentText(file, await readSkillFile(file, signal));
    return { fileName: file.fileName, filePath: file.filePath, ...(file.size ? { size: file.size } : {}), ...(text ? { text } : {}) };
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
