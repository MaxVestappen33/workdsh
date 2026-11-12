import { homedir } from 'node:os';
import { rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Service } from '@deepseek-ai/cordis';
import type { Context } from '@deepseek-ai/cordis';
import {
  SkillMarketClient, SkillMarketRequestError, readSkillFile, skillDocumentText, stagedNameOf, streamSkillFile,
  type SkillMarketAuthorized, type SkillMarketBackend, type SkillMarketDocument, type SkillMarketInstallResult,
  type SkillMarketItem, type SkillMarketPage, type SkillMarketPaths, type SkillMarketQuery, type SkillScene,
} from '../market.js';
import type { SkillInstallScope } from '../shared.js';
import { ASSET_SIGNATURE_REASONS, verifyAssetSignature, type AssetSignatureEnvelope } from 'workdsh-asset-signature';
import { snapshotAssetFiles, writeAssetFileManifest, writeAssetManifest } from 'workdsh-asset-manifest';
import {
  ASSET_OPERATION_REPORT_PATH, AssetOperationReporter, assetOperationEventId, clientIdOf, isPermissionFailure,
  type AssetOperationFailReason, type AssetOperationResult,
} from 'workdsh-contracts/asset-operation';
import { signatureCachePath, snapshotAssetFile, writeSignatureCache } from './asset-signatures.js';
import { marketInstallFile, readMarketInstalls, writeMarketInstalls, type MarketInstallRecord } from './market-installs.js';

/**
 * 市场接口路径缺省值：与 Desktop 随包 workdsh-app.json 的 server 段保持一致。
 * 接口都在 desktop-client 命名空间；Desktop 侧可通过插件选项覆盖。
 */
const DEFAULT_MARKET_PATHS: SkillMarketPaths = {
  list: '/desktop-client/skill/queryAuthorizedSkillList',
  categories: '/desktop-client/skill/querySkillBizSceneList',
  report: ASSET_OPERATION_REPORT_PATH,
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
 * 市场安装记录文件：记住「哪个市场条目装成了本机哪个技能」以及最后一次同步的「是否内置」。
 * 放在 SkillManager 同一个状态根下（DSH_HOME/agents/.workdsh-state）。
 */
function installRecordFile(): string {
  const dshHome = resolve(process.env.DSH_HOME ?? join(homedir(), '.dsh'));
  const agentsHome = resolve(process.env.DSH_AGENTS_HOME ?? join(dshHome, 'agents'));
  return marketInstallFile(join(agentsHome, '.workdsh-state', 'skills'));
}

const describe = (error: unknown): string => error instanceof Error ? error.message : String(error);

export interface SkillMarketOptions {
  /**
   * 市场接口路径。由宿主（Desktop）从 ServerConfig 注入；未配置时回退到内置默认值。
   * skills 是 Desktop/Web 共用的 Profile 包，因此不从 Desktop 专有模块读取配置。
   */
  readonly paths?: Partial<SkillMarketPaths>;
  /** 客户端应用标识：由宿主（Desktop）从 ServerConfig.appId 注入，用于资产操作记录。 */
  readonly clientId?: string;
}

export interface SkillMarketUninstall {
  readonly id?: string;
  readonly slug?: string;
  /** 资产名称快照：优先用市场条目名称，缺失时回退到技能标识。 */
  readonly name?: string;
  /** 上报口径：本机卸载成功后为 success（缺省）；本机卸载失败时传 failed。 */
  readonly result?: 'success' | 'failed';
  readonly failReason?: AssetOperationFailReason;
  readonly detail?: string;
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
  index(signal?: AbortSignal, refresh?: boolean): Promise<readonly SkillMarketAuthorized[]>;
  /**
   * 安装到本机：下载条目附件（fjxxList 第一条）→ 验签 → 官方导入链路写入共享技能目录 →
   * 写清单，全部完成后再上报一次 install；缺少附件时直接拒绝安装。
   * 返回技能包内声明的技能名与实际落地状态。
   */
  install(id: string, signal?: AbortSignal): Promise<SkillMarketInstallResult>;
  /** 卸载上报：本机卸载完成后调用，上报失败不阻断卸载，结果通过 reported 暴露。 */
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
      const name = findLocal(records.get(item.id)?.name) ?? findLocal(item.slug) ?? findLocal(item.title);
      return name ? { ...item, installed: true, installedName: name } : { ...item, installed: false };
    });
    return { ...page, items };
  }

  /** 市场安装记录：文件不存在或格式损坏都按空处理，不影响列表与安装。 */
  private async records(): Promise<Map<string, MarketInstallRecord>> {
    return readMarketInstalls(this.recordFile, message => this.ctx.logger.warn(message));
  }

  /** 记下「市场条目 → 本机技能名 + 当前内置属性」。写失败只影响下次的兜底展示，不阻断安装。 */
  private async rememberInstall(id: string, name: string, builtin?: boolean): Promise<void> {
    const records = await this.records();
    records.set(id, { name, ...(builtin === undefined ? {} : { builtin }) });
    await writeMarketInstalls(this.recordFile, records, message => this.ctx.logger.warn(message));
  }

  /**
   * 内置属性以技能市场为准：每次真正取到授权索引（非缓存命中）后把最新值写回安装记录，
   * 供市场不可用或索引取不到时，本地列表按快照兜底展示与筛选。
   */
  private async syncBuiltin(rows: readonly SkillMarketAuthorized[]): Promise<void> {
    const records = await this.records();
    let changed = false;
    for (const row of rows) {
      const record = records.get(row.id);
      if (!record || row.builtin === undefined || record.builtin === row.builtin) continue;
      records.set(row.id, { ...record, builtin: row.builtin });
      changed = true;
    }
    if (changed) await writeMarketInstalls(this.recordFile, records, message => this.ctx.logger.warn(message));
  }

  async categories(signal?: AbortSignal): Promise<readonly SkillScene[]> {
    return (await this.client_()).categories(signal);
  }

  /** `refresh` 为真时跳过短 TTL 缓存：用户点「刷新」后内置属性必须立即反映后台最新值。 */
  async index(signal?: AbortSignal, refresh?: boolean): Promise<readonly SkillMarketAuthorized[]> {
    const now = Date.now();
    if (!refresh && this.cachedIndex && now - this.cachedIndex.at < INDEX_TTL_MS) return this.cachedIndex.rows;
    const rows = await (await this.client_()).index(signal);
    this.cachedIndex = { at: now, rows };
    await this.syncBuiltin(rows);
    return rows;
  }

  /**
   * 安装到本机：
   * 1）取条目附件（fjxxList 第一条）并下载到暂存区，缺少附件时按约定拒绝安装；
   * 2）验签开关开启时取后台资产签名，用服务端 files 重建载荷，与暂存区逐文件比对并做
   *    Ed25519 验签；任一步失败都拒绝安装并上报审计，磁盘上不会留下资产。开关关闭时
   *    完全不取签名（主闸门关闭同样如此）；
   * 3）交给官方导入链路确认写入共享技能目录（commit），验签生效时落盘后再用签名载荷复核，
   *    复核不过则回滚；与「上传技能」共用同一条实现，重名冲突、体积上限、SKILL.md 校验规则一致；
   * 4）写入清单（验签生效时含签名块与 envelope 缓存），并记下「条目 id → 本机技能名」；
   * 5）安装清单写完后上报「资产操作记录」：成功与失败复用同一个 eventId，上报失败只记日志。
   *    本机已有同名技能时按已安装处理（不覆盖其清单），也不上报 install，避免后台重复计数。
   */
  async install(id: string, signal?: AbortSignal): Promise<SkillMarketInstallResult> {
    const key = id.trim();
    if (!key) throw new SkillMarketRequestError('skill/market-rejected', '缺少技能标识，无法安装。');
    const client = await this.client_();
    const item = client.item(key);
    if (!item) throw new SkillMarketRequestError('skill/market-item-unknown', '市场条目信息已失效，请刷新技能市场后重试。');
    // 事件标识在流程开始时生成一次：这条流程的成功与失败上报共用它，后台据此幂等。
    const eventId = assetOperationEventId();
    // 失败归类随步骤推进：签名、权限等可识别的错误会覆盖当前步骤的默认值。
    let stage: AssetOperationFailReason = 'download_failed';
    try {
      const file = item.file;
      if (!file) throw new SkillMarketRequestError('skill/market-file-missing', '该技能缺少技能说明文件，不能安装。');
      const manager = this.ctx.workdshSkills;
      // 下载到暂存区（不是最终安装目录）：先验签，验不过就丢弃，磁盘上不会留下任何技能。
      const staged = await manager.imports.stage(stagedNameOf(file), await streamSkillFile(file, signal), signal ?? new AbortController().signal);
      // 技能包内声明的名称才是本机技能标识（市场条目标识 skillNameEn 可能与它不同）。
      const name = staged.inspection.name;

      let envelope: AssetSignatureEnvelope | undefined;
      // 验签开关关闭（含主闸门关闭）时完全不取签名：不验签、清单不写签名块，
      // 重开后会自然落到「缺少签名，需重新安装」。
      const enforcing = this.signatureEnabled();
      if (enforcing) {
        stage = 'signature_missing';
        try {
          envelope = await client.signature(item.id, signal);
        } catch (cause) {
          await manager.imports.discard(staged.id).catch(() => {});
          // 用户主动取消不算签名失败；其余取签名失败一律按「签名缺失」记录并拒绝。
          if (!(cause instanceof SkillMarketRequestError && cause.code === 'skill/request-cancelled'))
            this.auditSignatureDenied(item.id, name, ASSET_SIGNATURE_REASONS.missing);
          throw cause;
        }
      }
      if (enforcing && envelope) {
        stage = 'verify_failed';
        // 用服务端 files 重建载荷，与暂存区的实际文件逐项比对；本地扫描结果不参与判定。
        let stagedFiles;
        try {
          stagedFiles = await manager.imports.snapshot(staged.id, signal);
        } catch (cause) {
          await manager.imports.discard(staged.id).catch(() => {});
          this.auditSignatureDenied(item.id, name, ASSET_SIGNATURE_REASONS.invalid);
          throw cause instanceof Error ? cause : new SkillMarketRequestError(ASSET_SIGNATURE_REASONS.invalid, '无法读取已下载的技能文件，已拒绝安装。');
        }
        const stagedVerdict = verifyAssetSignature({
          envelope, expectedAssetType: 'skill', expectedAssetId: item.id, files: stagedFiles,
        });
        if (!stagedVerdict.ok) {
          await manager.imports.discard(staged.id).catch(() => {});
          this.auditSignatureDenied(item.id, name, stagedVerdict.code);
          throw new SkillMarketRequestError(stagedVerdict.code, stagedVerdict.message);
        }
      }

      let installed: { readonly path: string };
      try {
        stage = 'write_failed';
        installed = await manager.imports.commit(staged.id, MARKET_INSTALL_SCOPE, signal);
      } catch (cause) {
        await manager.imports.discard(staged.id).catch(() => {});
        // 本机已有同名技能：这条市场技能实际上已经装在本机了，按「已安装」处理并记录下来，
        // 界面显示已安装 / 卸载，而不是把用户卡在一个永远装不上的按钮上。
        // 不覆盖该技能的安装清单：同名技能可能是用户自建，不能因此被标成市场安装。
        // 这种情况不算一次新的安装，不上报 install，避免后台重复计数。
        if (cause instanceof Error && cause.message === ALREADY_INSTALLED) {
          await this.rememberInstall(item.id, name, item.builtin);
          return { name, state: 'existing' };
        }
        throw cause;
      }

      // 落盘后复核：复制/改名可能引入差异，签名载荷是唯一准绳；复核不过就回滚本次安装。
      stage = 'disk_check_failed';
      let directory: boolean;
      try {
        directory = (await stat(installed.path)).isDirectory();
        if (enforcing && envelope) {
          const files = directory ? await snapshotAssetFiles(installed.path, signal) : [await snapshotAssetFile(installed.path, signal)];
          const verdict = verifyAssetSignature({ envelope, expectedAssetType: 'skill', expectedAssetId: item.id, files });
          if (!verdict.ok) throw new SkillMarketRequestError(verdict.code, verdict.message);
        }
      } catch (cause) {
        await rm(installed.path, { recursive: true, force: true }).catch(() => {});
        if (cause instanceof SkillMarketRequestError) {
          this.auditSignatureDenied(item.id, name, cause.code);
          throw cause;
        }
        const failure = new SkillMarketRequestError(ASSET_SIGNATURE_REASONS.invalid, '落盘后的技能文件无法完成签名复核，已回滚安装。');
        this.auditSignatureDenied(item.id, name, failure.code);
        throw failure;
      }

      // 市场安装成功后写入清单：验签生效时写 schema 2 + 签名块与 24 小时离线缓存；
      // 关闭期间只写常规清单（无签名块），重开后按「需重新安装」处理。
      // 落点按资产形态定：目录写目录内隐藏清单与缓存，单文件写同目录旁挂文件。
      let manifestFailure: unknown;
      try {
        const input = {
          assetType: 'skill' as const, name, source: 'market' as const, assetId: item.id,
          ...(item.version ? { version: item.version } : {}),
          ...(envelope ? {
            signature: {
              payloadVersion: envelope.payloadVersion,
              algo: envelope.algo,
              keyId: envelope.keyId,
              digest: envelope.digest,
              signature: envelope.signature,
            },
          } : {}),
        };
        if (directory) await writeAssetManifest(installed.path, input);
        else await writeAssetFileManifest(installed.path, input);
        if (envelope) await writeSignatureCache(signatureCachePath(installed.path, directory), envelope);
      } catch (cause) {
        manifestFailure = cause;
        this.ctx.logger.warn(`技能：写入市场安装清单失败（${name}）：${describe(cause)}。`);
      }
      await this.rememberInstall(item.id, name, item.builtin);
      // 技能已可用，清单写入失败不回滚；但按后台约定如实上报 failed/manifest_failed 暴露该异常。
      if (manifestFailure) {
        await this.reportOperation(item, eventId, 'install', {
          result: 'failed', failReason: 'manifest_failed', detail: describe(manifestFailure),
        });
      } else {
        await this.reportOperation(item, eventId, 'install', { result: 'success' });
      }
      return { name, state: 'installed' };
    } catch (cause) {
      await this.reportFailure(item, eventId, 'install', cause, stage);
      throw cause;
    }
  }

  /**
   * 当前是否执行验签：主闸门与验签开关同时开启。
   * 闸门服务缺失（个人模式/测试）或旧版闸门没有该方法时按关闭处理。
   */
  private signatureEnabled(): boolean {
    try {
      const gate = this.ctx.reflect.get('workdshAssetGate') as { signatureEnabled?: () => boolean } | undefined;
      return gate?.signatureEnabled?.() === true;
    } catch {
      return false;
    }
  }

  /**
   * 签名校验失败的审计：按 denied + install_verify 上报，走现有 GateAuditRecorder。
   * 闸门未安装或已关闭时上游会静默丢弃，这里也吞掉异常，审计旁路不能影响拒绝本身。
   */
  private auditSignatureDenied(assetId: string, assetName: string, reasonCode: string): void {
    try {
      const gate = this.ctx.reflect.get('workdshAssetGate') as {
        auditDenied?: (input: {
          readonly layer: 'install_verify';
          readonly action: 'install';
          readonly assetType?: string;
          readonly assetId?: string;
          readonly assetName?: string;
          readonly reasonCode: string;
        }) => void;
      } | undefined;
      gate?.auditDenied?.({
        layer: 'install_verify', action: 'install',
        assetType: 'skill', assetId, assetName, reasonCode,
      });
    } catch (cause) {
      this.ctx.logger.warn(`技能：签名失败审计上报失败（${describe(cause)}）。`);
    }
  }

  /**
   * 卸载上报：本机卸载完成后调用，只对「从市场安装过」的技能上报（按安装记录反查市场条目 id），
   * 非市场技能直接跳过。上报失败不阻断本机卸载（与 MCP 市场同口径），真实结果通过 reported 暴露。
   */
  async uninstall(target: SkillMarketUninstall, _signal?: AbortSignal): Promise<SkillMarketUninstallResult> {
    const name = target.name?.trim();
    const records = await this.records();
    // 市场条目 id：市场列表卸载时界面直接给；本机技能页卸载时只能按技能名反查安装记录。
    const id = target.id?.trim() || (name
      ? [...records.entries()].find(([, record]) => record.name.trim().toLowerCase() === name.toLowerCase())?.[0]
      : undefined);
    const slug = target.slug?.trim();
    // 没有安装记录说明该技能不是从市场安装的：不上报，避免把本机自建技能计入市场记录。
    if (!id && !slug) return { reported: false };
    // 上报优先带市场条目 id，同时补上技能标识：列表里见过该条目时能拿到，后台两种口径都能对应。
    let nameEn = slug;
    if (!nameEn && id) {
      try { nameEn = (await this.client_()).item(id)?.slug; } catch { /* 市场不可用时只按条目 id 上报 */ }
    }
    const eventId = assetOperationEventId();
    // 市场条目 id 是后台的资产主键；界面拿不到它时退回技能标识，至少保证事件可对应到资产。
    const assetId = id ?? (slug as string);
    const outcome = await this.reportOperation(
      { id: assetId, slug: nameEn, title: name ?? nameEn },
      eventId,
      'uninstall',
      target.result === 'failed'
        ? { result: 'failed', failReason: target.failReason ?? 'other', detail: target.detail }
        : { result: 'success' },
    );
    // 卸载成功后清掉安装记录：市场条目回到「可安装」，记录也不会无限增长。
    if (target.result !== 'failed' && id) {
      records.delete(id);
      await writeMarketInstalls(this.recordFile, records, message => this.ctx.logger.warn(message));
    }
    return { reported: outcome.reported };
  }

  /** 资产操作记录：一次一条实时上报；上报失败只记日志，不阻断本机安装/卸载。 */
  private async reportOperation(
    item: { readonly id: string; readonly slug?: string; readonly title?: string },
    eventId: string,
    operationType: 'install' | 'uninstall',
    outcome: { readonly result: AssetOperationResult; readonly failReason?: AssetOperationFailReason; readonly detail?: string },
  ): Promise<{ readonly reported: boolean }> {
    const channel = this.channel();
    if (!channel) return { reported: false };
    const reporter = new AssetOperationReporter({
      backend: channel,
      // 客户端应用标识来自载体配置 server.appId；缺失时上报器会跳过并记日志。
      clientId: () => clientIdOf(this.options.clientId),
      ...(this.options.paths?.report?.trim() ? { path: this.options.paths.report.trim() } : {}),
      warn: message => this.ctx.logger.warn(message),
    });
    return reporter.report({
      eventId,
      assetType: 'skill',
      assetId: item.id,
      assetName: item.title ?? item.slug ?? item.id,
      operationType,
      operationResult: outcome.result,
      ...(outcome.failReason ? { failReason: outcome.failReason } : {}),
      ...(outcome.detail ? { failDetail: outcome.detail } : {}),
    });
  }

  /** 失败上报：用户取消按 canceled，其余结合当前步骤与错误码归类。 */
  private async reportFailure(
    item: { readonly id: string; readonly slug?: string; readonly title?: string },
    eventId: string,
    operationType: 'install' | 'uninstall',
    cause: unknown,
    stage: AssetOperationFailReason,
  ): Promise<void> {
    const canceled = cause instanceof SkillMarketRequestError && cause.code === 'skill/request-cancelled';
    await this.reportOperation(item, eventId, operationType, {
      result: canceled ? 'canceled' : 'failed',
      failReason: this.failReasonOf(cause, canceled, stage),
      detail: describe(cause),
    });
  }

  /** 失败大类：签名类错误与下载类错误按后台码归类，权限类错误优先于步骤默认值。 */
  private failReasonOf(cause: unknown, canceled: boolean, stage: AssetOperationFailReason): AssetOperationFailReason {
    if (canceled) return 'canceled_by_user';
    if (cause instanceof SkillMarketRequestError) {
      switch (cause.code) {
        case ASSET_SIGNATURE_REASONS.missing: return 'signature_missing';
        case ASSET_SIGNATURE_REASONS.invalid:
        case ASSET_SIGNATURE_REASONS.assetMismatch:
        case ASSET_SIGNATURE_REASONS.manifestMismatch:
        case ASSET_SIGNATURE_REASONS.manifestExtraFile: return 'verify_failed';
        case 'skill/market-file-missing':
        case 'skill/market-file-unavailable':
        case 'skill/market-file-too-large': return 'download_failed';
        case 'skill/market-unavailable': return 'network_failed';
        default: break;
      }
    }
    if (isPermissionFailure(cause)) return 'permission_denied';
    return stage;
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
    const signature = paths.signature?.trim() || undefined;
    this.client = new SkillMarketClient({
      paths: {
        list: paths.list?.trim() || DEFAULT_MARKET_PATHS.list,
        categories: paths.categories?.trim() || DEFAULT_MARKET_PATHS.categories,
        // 资产操作记录有内置缺省路径；宿主注入时以注入值为准。
        report: paths.report?.trim() || DEFAULT_MARKET_PATHS.report,
        // 签名接口没有内置缺省值：只有宿主明确注入才可用，否则安装 fail closed。
        ...(signature ? { signature } : {}),
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
