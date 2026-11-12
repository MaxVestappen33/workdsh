/**
 * 资产闸门的宿主侧服务。
 *
 * 分层：
 * - 开关：本机收紧项 + 后台策略 → EffectiveGatePolicy；
 * - 快照：登录后拉一次，按 revision 比对，按账号隔离，加密落盘；
 * - 判定：decide() 纯函数；服务层只负责在闸门开启时提供快照。
 *
 * 零开销约定：主闸门关闭时，本服务不解析身份、不请求快照、不读快照、不算哈希；
 * 主闸门关闭期间只按低频周期轮询策略接口，拿到「开」后立即恢复正常同步节奏；
 * 某类子闸门关闭时，该类连判断函数之外的任何数据都不会读取。
 *
 * 策略的失败口径：上次成功拉取的策略会持久化，拉取失败时沿用；从未成功拉取过策略
 * 则按「开」+ 拒绝（fail-closed），避免屏蔽策略接口即可绕过闸门。
 */
import { Service, type Context } from '@deepseek-ai/cordis';
import {
  GateAuditRecorder, type AuditReportResult, type DeniedAuditInput, type WriteAuditInput,
} from './audit.js';
import { AssetGateBackend, DEFAULT_ASSET_GATE_PATHS, type AssetGateChannel, type AssetGatePaths } from './backend.js';
import { decide } from './decider.js';
import { failClosedPolicy, resolveEffectivePolicy, DEFAULT_LOCAL_GATE_CONFIG } from './policy.js';
import { PolicyStore } from './policy-store.js';
import { GATE_REASONS, gateReasonMessage, type GateReasonCode } from './reasons.js';
import { RevocationLedger, reconcileRevocations, type RevocableAssetType } from './revocation.js';
import { snapshotExpired } from './snapshot.js';
import { SnapshotStore } from './snapshot-store.js';
import type {
  AssetUsage, EffectiveGatePolicy, GateAssetType, GateDecision, GatePolicy,
  LocalGateConfig, SnapshotRecord,
} from './types.js';

/** 运行中 revision 比对周期：用户要求授权变更尽快可见，取 60 秒。 */
const REFRESH_INTERVAL_MS = 60_000;
/** 触发式校验的最小间隔：连续切页签/重复刷新时复用上一次校验结果。 */
const TRIGGER_MIN_INTERVAL_MS = 15_000;
/** 快照刷新失败后的退避起点与上限：30s 起，逐次翻倍，封顶一个周期。 */
const RETRY_BASE_MS = 30_000;
/** 成功刷新后最早也要间隔一秒，避免 staleAt 落在过去时形成忙循环。 */
const MIN_DELAY_MS = 1_000;
/** 主闸门关闭期间的策略轮询周期：只查策略，不发快照请求。 */
const POLICY_POLL_INTERVAL_MS = 600_000;

/** 判定请求：调用方只给资产类型、id 与用途。 */
export interface GateRequest {
  readonly assetType: GateAssetType;
  readonly assetId: string;
  readonly usage: AssetUsage;
}

export interface AssetGateApi {
  /** 后台通道与登录绑定都可用时为 true；个人模式或未登录为 false。 */
  available(): Promise<boolean>;
  /** 当前生效闸门（未拉取策略时等同打包默认全关）。 */
  policy(): EffectiveGatePolicy;
  /** 主闸门与该类子闸门是否同时开启。 */
  enabled(assetType: GateAssetType): boolean;
  /**
   * 主闸门与验签开关是否同时开启。
   * 主闸门关闭时恒为 false：此时完全不验签，安装不取签名，启用跳过验签。
   */
  signatureEnabled(): boolean;
  /** 拉取后台策略并重算生效闸门；失败时沿用上一份策略，从未成功过则 fail-closed。 */
  refreshPolicy(signal?: AbortSignal): Promise<EffectiveGatePolicy>;
  /** 主闸门开启时按 revision 比对并刷新快照；关闭时直接返回 undefined。 */
  refreshSnapshot(signal?: AbortSignal): Promise<SnapshotRecord | undefined>;
  /** 登录后的完整同步：先策略，再按需快照，并按结果安排下一轮。 */
  sync(signal?: AbortSignal): Promise<void>;
  /**
   * 触发式校验：进入市场页签、窗口重新获得焦点、用户点「刷新」、写操作完成后调用。
   *
   * 只做一次 revision 比对（命中 unchanged 直接复用缓存），由内部做单飞与 15 秒节流，
   * 连续触发不会打出一串请求；主闸门关闭时为空操作，不请求接口、不读快照。
   */
  refreshNow(): Promise<void>;
  /** 当前账号的内存快照（不会触发网络或磁盘读取）。 */
  snapshot(): SnapshotRecord | undefined;
  /** 判定单个资产；闸门关闭时同步放行，不触碰身份与快照。 */
  decide(request: GateRequest): Promise<GateDecision>;
  /**
   * 「未上架/未登记」的拒绝结果：数据层拿不到后台资产编号时复用它，
   * 保证原因码与文案只在 reasons.ts 维护一份。
   */
  unlisted(): { readonly reason: GateReasonCode; readonly message: string };
  /** 撤权自动禁用的原因码与文案，供各资产管理器与界面复用。 */
  revocationReason(): { readonly reason: GateReasonCode; readonly message: string };
  /** 启用前摘要校验不通过的原因码与文案。 */
  integrityMismatch(): { readonly reason: GateReasonCode; readonly message: string };
  /** 判定过程抛异常时的原因码与文案：各层一律按它拒绝，界面复用它展示。 */
  evaluationError(): { readonly reason: GateReasonCode; readonly message: string };
  /** 账号切换/退出登录时立即清空缓存。 */
  clearAccount(): void;
  /**
   * 撤权账本查询：该资产是否因授权失效被闸门自动禁用。
   * 对应子闸门关闭时恒为 false，界面据此不展示任何标记。
   */
  revoked(assetType: RevocableAssetType, assetId: string): boolean;
  /** 当前账号账本里该类型的全部标记编号（只读内存）。 */
  revokedAssets(assetType: RevocableAssetType): readonly string[];
  /**
   * 用户手动启用/卸载后清除撤权标记，避免下次同步把它当成「自动禁用」再恢复。
   * 闸门关闭时同样允许清理历史标记。
   */
  clearRevoked(assetType: RevocableAssetType, assetId: string): void;
  /** 判定拒绝入队（同步、不抛错）；闸门关闭时为空操作。 */
  auditDenied(input: DeniedAuditInput): void;
  /** 关键写操作入队（同步、不抛错）；闸门关闭时为空操作。 */
  auditWrite(input: WriteAuditInput): void;
}

declare module '@deepseek-ai/cordis' {
  interface Context { workdshAssetGate: AssetGateApi }
  interface Events {
    /**
     * 生效闸门发生变化后发出（初始化恢复策略、后台刷新策略、fail-closed 切换）。
     *
     * 只服务于「按需注册」：调用期拦截钩子在主闸门关闭时根本不注册，
     * 由监听本事件的一方在开闸时注册、关闸时注销。事件不做判定，也不携带身份信息。
     */
    'workdsh/asset-gate/policy'(this: Context, policy: EffectiveGatePolicy): void;
  }
}

export interface AssetGateOptions {
  /** 接口路径，由 Desktop 从 ServerConfig 注入；未配置时用内置默认值。 */
  readonly paths?: Partial<AssetGatePaths>;
  /** 快照加密落盘目录；未注入时仅保存在内存。 */
  readonly stateDir?: string;
  /** 策略落盘目录（不按账号隔离）；未注入时不持久化策略。 */
  readonly policyDir?: string;
  /** 本机收紧项：只能把「关」改成「开」。 */
  readonly local?: LocalGateConfig;
  /** 登录后是否自动同步一次；默认开启。 */
  readonly autoSync?: boolean;
  /** 首次同步延迟，给身份提供方留出建立绑定的时间。 */
  readonly autoSyncDelayMs?: number;
  /** 运行中 revision 比对周期，默认 60 秒。 */
  readonly refreshIntervalMs?: number;
  /** 主闸门关闭期间的策略轮询周期，默认 600 秒。 */
  readonly policyPollIntervalMs?: number;
  /** 客户端版本号，随审计事件上报；未注入时从宿主环境变量读取。 */
  readonly clientVersion?: string;
}

interface AccountRef {
  readonly key: string;
}

/** 各资产管理器暴露给撤权协调器的最小面：只读「已安装的 market 资产」与运行态重算。 */
interface GateAssetRow {
  /** 本机标识（技能名 / 连接器 id / 专家 id），仅用于回传管理器，不参与来源判断。 */
  readonly localId: string;
  readonly assetId: string;
}

interface GateAssetDirectory {
  marketAssets(): Promise<readonly GateAssetRow[]> | readonly GateAssetRow[];
}

interface ConnectorGateDirectory extends GateAssetDirectory {
  /** 账本变化后按当前账号重算运行态：停用被撤销的、恢复已重新授权的。 */
  applyGateState?(): Promise<void> | void;
}

interface ExpertGateDirectory {
  /** 专家与专家团共用一张表，一次返回并按各自 assetType 归类。 */
  gateAssets?(): readonly (GateAssetRow & { readonly assetType: 'expert' | 'expert_group' })[];
}

/** 身份提供方（Desktop 账号/企业身份）按需下发的绑定；个人模式不实现。 */
interface BindingIdentity {
  profile?(): { readonly principalId?: unknown; readonly organization?: { readonly id?: unknown } };
  backendBinding?(signal?: AbortSignal): Promise<{ readonly authorization?: unknown } | undefined>;
}

export class AssetGateService extends Service implements AssetGateApi {
  private readonly backend: AssetGateBackend;
  private readonly store: SnapshotStore;
  private readonly policyStore: PolicyStore;
  private readonly local: LocalGateConfig;
  private readonly ledger: RevocationLedger;
  private readonly audit: GateAuditRecorder;
  private readonly auditVersion?: string;
  private effective: EffectiveGatePolicy;
  private remote?: GatePolicy;
  private persisted?: string;
  private timer?: ReturnType<typeof setTimeout>;
  private running?: Promise<void>;
  private failures = 0;
  /** 最近一次快照尝试的发起时间：触发式刷新的节流基准。 */
  private lastSyncAt = 0;
  /** 已完成撤权重算的「账号 + revision」标记，避免同一份快照重复执行。 */
  private reconciled?: string;
  private disposed = false;

  constructor(ctx: Context, private readonly options: AssetGateOptions = {}) {
    super(ctx, 'workdshAssetGate');
    const paths = { ...DEFAULT_ASSET_GATE_PATHS, ...definedPaths(options.paths) };
    this.backend = new AssetGateBackend(() => channel(ctx), paths);
    this.store = new SnapshotStore(options.stateDir, message => ctx.logger.warn(message));
    this.policyStore = new PolicyStore(options.policyDir, message => ctx.logger.warn(message));
    this.local = options.local ?? DEFAULT_LOCAL_GATE_CONFIG;
    this.ledger = new RevocationLedger(options.stateDir);
    const version = (options.clientVersion ?? process.env.WORKDSH_APP_VERSION)?.trim();
    this.auditVersion = version || undefined;
    this.audit = new GateAuditRecorder({
      send: events => this.sendAudit(events),
      ...(options.stateDir === undefined ? {} : { spoolDir: options.stateDir }),
      ...(this.auditVersion ? { clientVersion: this.auditVersion } : {}),
      warn: message => ctx.logger.warn(message),
    });
    this.effective = resolveEffectivePolicy(undefined, this.local);
  }

  [Service.init](): void {
    this.disposed = false;
    // 账本是按账号目录落盘的，初始化时先把上一轮自动禁用的结果恢复进内存。
    this.ledger.load();
    // 先恢复上次成功拉取的策略，保证初始化完成后的首次判定就按真实策略执行。
    const restored = this.policyStore.load();
    if (restored) {
      this.remote = restored;
      this.persisted = JSON.stringify(restored);
      this.applyEffective(resolveEffectivePolicy(restored, this.local));
    }
    this.ctx.effect(() => () => {
      this.disposed = true;
      this.clearTimer();
      this.audit.stop();
    }, 'workdsh.assetGate.sync');
    // 给身份提供方留出建立绑定的时间；失败后按退避重试。
    if (this.options.autoSync !== false) this.schedule(this.options.autoSyncDelayMs ?? 2_000);
  }

  async available(): Promise<boolean> {
    return this.backend.available();
  }

  policy(): EffectiveGatePolicy {
    return this.effective;
  }

  enabled(assetType: GateAssetType): boolean {
    return this.effective.masterEnabled && this.effective.assetGates[assetType] === true;
  }

  signatureEnabled(): boolean {
    return this.effective.masterEnabled && this.effective.assetSignature === true;
  }

  async refreshPolicy(signal?: AbortSignal): Promise<EffectiveGatePolicy> {
    if (!(await this.backend.available())) {
      // 没有后台绑定（个人模式/未登录）：不改变策略，也不主动请求。
      return this.effective;
    }
    try {
      const policy = await this.backend.policy(signal);
      this.remote = policy;
      // 只有内容变化时才写盘，避免每次周期校验都产生一次写入。
      const serialized = JSON.stringify(policy);
      if (serialized !== this.persisted) {
        this.policyStore.save(policy);
        this.persisted = serialized;
      }
      this.applyEffective(resolveEffectivePolicy(policy, this.local));
    } catch (error) {
      this.ctx.logger.warn(`资产闸门：策略获取失败（${detail(error)}）。`);
      // 有历史策略就沿用；从未成功拉取过则按「开」+ 拒绝，不能退回全关放行。
      this.applyEffective(this.remote ? resolveEffectivePolicy(this.remote, this.local) : failClosedPolicy());
    }
    return this.effective;
  }

  async refreshSnapshot(signal?: AbortSignal): Promise<SnapshotRecord | undefined> {
    return (await this.pull(signal)).record;
  }

  sync(signal?: AbortSignal): Promise<void> {
    if (this.running) return this.running;
    this.running = this.runSync(signal).finally(() => { this.running = undefined; });
    return this.running;
  }

  async refreshNow(): Promise<void> {
    // 零开销：主闸门关闭时不解析身份、不请求接口、不读快照。
    if (!this.effective.masterEnabled || this.disposed) return;
    // 单飞：已有同步在跑就等它，不叠加请求。
    if (this.running) return this.running;
    // 节流：刚校验过就跳过，避免连续切页签/重复刷新打出一串 revision 请求。
    if (Date.now() - this.lastSyncAt < TRIGGER_MIN_INTERVAL_MS) return;
    await this.sync();
  }

  snapshot(): SnapshotRecord | undefined {
    // 只读内存，不触发身份解析、磁盘读取或网络请求。
    if (!this.effective.masterEnabled) return undefined;
    const account = this.account();
    return account ? this.store.peek(account.key) : undefined;
  }

  decide(request: GateRequest): Promise<GateDecision> {
    const policy = this.effective;
    // 主闸门或该类子闸门关闭：同步放行，不解析身份、不读快照。
    if (!policy.masterEnabled || policy.assetGates[request.assetType] !== true) {
      return Promise.resolve(decide({ policy, ...request }));
    }
    const account = this.account();
    const snapshot = account ? this.store.peek(account.key) : undefined;
    return Promise.resolve(decide({ policy, snapshot, ...request }));
  }

  unlisted(): { readonly reason: GateReasonCode; readonly message: string } {
    return { reason: GATE_REASONS.deniedNotListed, message: gateReasonMessage(GATE_REASONS.deniedNotListed) };
  }

  /** 撤权自动禁用的原因码与文案；界面直接复用，避免各插件各写一份。 */
  revocationReason(): { readonly reason: GateReasonCode; readonly message: string } {
    return { reason: GATE_REASONS.revokedAuthorization, message: gateReasonMessage(GATE_REASONS.revokedAuthorization) };
  }

  /** 启用前摘要校验不通过的原因码与文案。 */
  integrityMismatch(): { readonly reason: GateReasonCode; readonly message: string } {
    return { reason: GATE_REASONS.deniedContentModified, message: gateReasonMessage(GATE_REASONS.deniedContentModified) };
  }

  /** 判定过程抛异常时的原因码与文案：统一按最小权限拒绝，界面也复用它。 */
  evaluationError(): { readonly reason: GateReasonCode; readonly message: string } {
    return { reason: GATE_REASONS.deniedEvaluationError, message: gateReasonMessage(GATE_REASONS.deniedEvaluationError) };
  }

  clearAccount(): void {
    this.store.clear();
    this.ledger.clearAccount();
    this.reconciled = undefined;
    this.clearTimer();
    this.failures = 0;
  }

  revoked(assetType: RevocableAssetType, assetId: string): boolean {
    // 子闸门关闭时不展示、也不使用撤权标记；账本内容保持原样，交给下次开闸重算。
    if (!this.enabled(assetType)) return false;
    return this.ledger.isRevoked(assetType, assetId);
  }

  revokedAssets(assetType: RevocableAssetType): readonly string[] {
    if (!this.enabled(assetType)) return [];
    return this.ledger.revoked(assetType);
  }

  clearRevoked(assetType: RevocableAssetType, assetId: string): void {
    if (!this.ledger.clear(assetType, assetId)) return;
    void this.ledger.save();
  }

  /**
   * 撤权协调：按当前账号快照标记/恢复由市场来源且已安装的资产。
   *
   * - 触发条件：主闸门与对应子闸门同时开启，且「账号 + revision」尚未处理过；
   * - 只动账本，不搬文件、不删文件、不改各资产自身的用户启用位；
   * - 账本按账号目录落盘，切号后由新账号的首次同步重算；
   * - 主闸门关闭时首行直接返回，不读管理器、不读清单。
   */
  private async reconcileRevocations(record: SnapshotRecord): Promise<void> {
    if (!this.effective.masterEnabled) return;
    const stamp = `${record.accountKey}\u0000${record.revision}`;
    if (this.reconciled === stamp) return;
    this.reconciled = stamp;

    let changed = false;
    const reconcileType = (
      assetType: RevocableAssetType,
      rows: readonly GateAssetRow[],
    ): boolean => {
      const before = new Set(this.ledger.revoked(assetType));
      const result = reconcileRevocations(
        this.ledger,
        assetType,
        record.assets[assetType] ?? [],
        rows.map(row => row.assetId),
      );
      // 只有「本次新标记」才记审计，避免同一份账本在每次 revision 变化时重复上报。
      for (const assetId of result.revoked) {
        if (!before.has(assetId)) {
          this.auditDenied({ layer: 'revocation', assetType, assetId, reasonCode: GATE_REASONS.revokedAuthorization });
        }
      }
      for (const assetId of result.restored) {
        // 自动恢复不是执行人的手动动作：记在 revocation 层并明确标注来源，避免被误读成人工恢复。
        this.auditWrite({ layer: 'revocation', action: 'restore', assetType, assetId, succeeded: true, remark: 'auto-restored' });
      }
      if (result.changed) changed = true;
      return result.changed;
    };

    try {
      const skills = this.ctx.reflect.get('workdshSkills') as GateAssetDirectory | undefined;
      if (this.enabled('skill') && typeof skills?.marketAssets === 'function') {
        reconcileType('skill', await skills.marketAssets());
      }

      const experts = this.ctx.reflect.get('workdshExperts') as ExpertGateDirectory | undefined;
      if (typeof experts?.gateAssets === 'function') {
        const rows = experts.gateAssets();
        // 专家与专家团按各自子闸门过滤；成员不回落到团记录（团记录本身已含全部成员）。
        for (const assetType of ['expert', 'expert_group'] as const) {
          if (!this.enabled(assetType)) continue;
          reconcileType(assetType, rows.filter(row => row.assetType === assetType));
        }
      }

      const connectors = this.ctx.reflect.get('workdshConnectors') as ConnectorGateDirectory | undefined;
      if (this.enabled('mcp')) {
        if (typeof connectors?.marketAssets === 'function') {
          reconcileType('mcp', await connectors.marketAssets());
        }
        // 启动时账本已从磁盘恢复但运行时可能仍按用户设置启动，因此这里总是重算一次；
        // applyGateState 内部只在目标状态与当前状态不同时才停/启进程。
        await connectors?.applyGateState?.();
      }
    } catch (error) {
      this.ctx.logger.warn(`资产闸门：撤权状态重算失败（${detail(error)}）。`);
    }

    if (changed) await this.ledger.save();
  }

  /**
   * 写出生效闸门，只在内容变化时通知。
   *
   * 调用期拦截钩子订阅该通知做「开则注册、关则注销」；周期性策略校验常常拿回同一份策略，
   * 这里比对后不发事件，避免反复注册/注销监听器。
   */
  private applyEffective(next: EffectiveGatePolicy): void {
    const changed = JSON.stringify(next) !== JSON.stringify(this.effective);
    const wasOn = this.effective.masterEnabled;
    this.effective = next;
    // 审计随主闸门启停：关闸后不入队、不启动定时器、不读 spool 补发。
    try {
      if (next.masterEnabled && !wasOn) this.audit.start();
      else if (!next.masterEnabled && wasOn) this.audit.stop();
    } catch (error) {
      this.ctx.logger.warn(`资产闸门：审计启动/停止失败（${detail(error)}）。`);
    }
    if (changed) this.ctx.emit('workdsh/asset-gate/policy', next);
  }

  /** 判定拒绝的审计入口：闸门关闭或上报异常都静默跳过，绝不影响业务调用。 */
  auditDenied(input: DeniedAuditInput): void {
    if (!this.effective.masterEnabled) return;
    try {
      this.audit.recordDenied(input);
    } catch (error) {
      this.ctx.logger.warn(`资产闸门：拒绝审计入队失败（${detail(error)}）。`);
    }
  }

  /** 关键写操作的审计入口：无论成功失败都记，异常同样吞掉。 */
  auditWrite(input: WriteAuditInput): void {
    if (!this.effective.masterEnabled) return;
    try {
      this.audit.recordWrite(input);
    } catch (error) {
      this.ctx.logger.warn(`资产闸门：写操作审计入队失败（${detail(error)}）。`);
    }
  }

  /** 真正发出上报；整单失败由记录器转入 spool，不在这里捕获。 */
  private async sendAudit(events: readonly unknown[]): Promise<AuditReportResult> {
    const body = {
      ...(this.auditVersion ? { clientVersion: this.auditVersion } : {}),
      events,
    };
    const value = await this.backend.reportGateAudit(body);
    return (value ?? {}) as AuditReportResult;
  }

  /**
   * 一次完整同步：策略 → 按需快照 → 安排下一轮。
   *
   * 下一轮的间隔取「方案周期」与「快照 staleAt 距离现在」的较小值：到 staleAt 先重拉，
   * 成功就用新的 staleAt 续上；失败或拉到的仍是过期快照则按退避重试。
   */
  private async runSync(signal?: AbortSignal): Promise<void> {
    this.clearTimer();
    if (this.disposed) return;
    try {
      if (!(await this.backend.available())) {
        // 登录绑定尚未建立：此时不请求任何接口，但要按退避重试。
        // 启动瞬间绑定往往还没就绪，若直接返回，本进程内的闸门就再也不会同步，
        // 表现为快照为空、市场与列表被授权过滤全部清空。
        this.retryLater();
        return;
      }
      await this.refreshPolicy(signal);
      if (!this.effective.masterEnabled) {
        // 主闸门关闭：不请求快照，只保留低频策略轮询，后台开闸后无需重启即可生效。
        this.failures = 0;
        this.schedule(this.options.policyPollIntervalMs ?? POLICY_POLL_INTERVAL_MS);
        return;
      }
      if (this.effective.failClosed) {
        this.retryLater();
        return;
      }
      this.lastSyncAt = Date.now();
      const { ok, record } = await this.pull(signal);
      const now = Date.now();
      if (ok && record && !snapshotExpired(record.staleAt, now)) {
        this.failures = 0;
        this.schedule(this.nextDelay(record, now));
      } else {
        this.retryLater();
      }
    } catch (error) {
      this.ctx.logger.warn(`资产闸门：同步失败（${detail(error)}）。`);
      this.retryLater();
    }
  }

  /** 拉取快照；ok 表示后台请求成功（即便返回 unchanged）。 */
  private async pull(signal?: AbortSignal): Promise<{ ok: boolean; record?: SnapshotRecord }> {
    // 零开销：主闸门关闭时到此为止——不解析身份、不请求接口、不读快照、不算哈希。
    if (!this.effective.masterEnabled) return { ok: true };

    const account = this.account();
    if (!account) {
      this.store.clear();
      return { ok: false };
    }
    // 跨账号时先丢弃旧缓存，再决定是否复用磁盘快照。
    this.store.peek(account.key);
    const secret = await this.sealSecret(signal);
    if (!secret) return { ok: false };
    if (!this.store.peek(account.key)) await this.store.load(account.key, secret);
    const cached = this.store.peek(account.key);

    try {
      let result = await this.backend.snapshot(cached?.revision, signal);
      if (result.unchanged && !cached) result = await this.backend.snapshot(undefined, signal);
      if (result.unchanged) {
        if (cached) {
          // 服务端确认修订未变也是一次成功拉取：刷新新鲜期，否则长期在线也会在 24 小时后被误判离线。
          const refreshed: SnapshotRecord = { ...cached, fetchedAt: new Date().toISOString() };
          await this.store.save(refreshed, secret);
          await this.reconcileRevocations(refreshed);
          return { ok: true, record: refreshed };
        }
        return { ok: true, record: cached };
      }
      const record: SnapshotRecord = {
        accountKey: account.key,
        revision: result.revision,
        ...(result.generatedAt ? { generatedAt: result.generatedAt } : {}),
        staleAt: result.staleAt ?? null,
        assets: result.assets,
        fetchedAt: new Date().toISOString(),
      };
      await this.store.save(record, secret);
      await this.reconcileRevocations(record);
      return { ok: true, record };
    } catch (error) {
      this.ctx.logger.warn(`资产闸门：授权快照获取失败（${detail(error)}）。`);
      return { ok: false, record: cached };
    }
  }

  /** 下一次同步间隔：不晚于方案周期，也不晚于快照到期时间。 */
  private nextDelay(record: SnapshotRecord, now: number): number {
    const interval = this.options.refreshIntervalMs ?? REFRESH_INTERVAL_MS;
    const deadline = record.staleAt ? Date.parse(record.staleAt) : Number.NaN;
    if (Number.isNaN(deadline)) return interval;
    // 只认「未来」的到期时间；已成过去则按最短间隔重试一次，避免忙循环。
    return Math.min(interval, Math.max(deadline - now, MIN_DELAY_MS));
  }

  private retryLater(): void {
    this.failures += 1;
    const delay = Math.min(REFRESH_INTERVAL_MS, RETRY_BASE_MS * 2 ** (this.failures - 1));
    this.schedule(delay);
  }

  private schedule(delay: number): void {
    this.clearTimer();
    if (this.disposed) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.sync();
    }, delay);
    this.timer.unref?.();
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  /** 账号键 = 组织 + 主体；个人模式或未登录时返回 undefined。 */
  private account(): AccountRef | undefined {
    const identity = this.ctx.reflect.get('workdshIdentity') as BindingIdentity | undefined;
    try {
      const profile = identity?.profile?.();
      const principalId = typeof profile?.principalId === 'string' ? profile.principalId.trim() : '';
      const organizationId = typeof profile?.organization?.id === 'string' ? profile.organization.id.trim() : '';
      return principalId ? { key: `${organizationId}:${principalId}` } : undefined;
    } catch {
      return undefined;
    }
  }

  /** 加密密钥材料：来自当前登录令牌，只在内存中短暂使用，不落盘、不记录。 */
  private async sealSecret(signal?: AbortSignal): Promise<string | undefined> {
    const identity = this.ctx.reflect.get('workdshIdentity') as BindingIdentity | undefined;
    if (typeof identity?.backendBinding !== 'function') return undefined;
    try {
      const binding = await identity.backendBinding(signal);
      return typeof binding?.authorization === 'string' && binding.authorization ? binding.authorization : undefined;
    } catch {
      return undefined;
    }
  }
}

function channel(ctx: Context): AssetGateChannel | undefined {
  return ctx.reflect.get('workdshBackend') as AssetGateChannel | undefined;
}

function definedPaths(paths: Partial<AssetGatePaths> | undefined): Partial<AssetGatePaths> {
  if (!paths) return {};
  return Object.fromEntries(
    Object.entries(paths).filter(([, value]) => typeof value === 'string' && value.trim() !== ''),
  ) as Partial<AssetGatePaths>;
}

function detail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
