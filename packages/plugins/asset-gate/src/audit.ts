/**
 * 资产闸门审计上报。
 *
 * 设计约束（与需求逐条对应）：
 * - 判定路径只入队：`record()` 不 await、不发网络请求，异常一律吞掉；
 * - 攒批：3 秒或攒够 20 条触发，单飞，单批上限 100 条；
 * - 失败落盘：整单失败（网络/未登录/超限）整批写 spool，默认上限 500 条，满了丢最旧并告警；
 * - 按结果处理：accepted/duplicated 删除，failed 保留重试，invalid 丢弃并告警；
 * - 闸门关闭：由 Service 停止本对象，不入队、不启动定时器、不读 spool。
 *
 * 聚合去重（同资产同原因码 60 秒合并带计数）本轮不做，接入点见 `record()` 内注释。
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { formatClientTime } from 'workdsh-contracts/asset-operation';

/** 审计层级：与后台枚举一致；`call_skill_inject` 表示技能消息注入阶段被剔除，`call_tool_item` 表示连接器内单个工具被收窄。 */
export const AUDIT_LAYERS = ['call_tool', 'call_tool_item', 'call_skill', 'call_skill_inject', 'call_model', 'call_expert', 'data_layer', 'revocation', 'write_action', 'install_verify'] as const;
export type AuditLayer = typeof AUDIT_LAYERS[number];

export const AUDIT_ACTIONS = ['install', 'enable', 'restore', 'uninstall', 'delete'] as const;
export type AuditAction = typeof AUDIT_ACTIONS[number];

export const AUDIT_EVENT_TYPES = ['denied', 'write'] as const;
export type AuditEventType = typeof AUDIT_EVENT_TYPES[number];

export type AuditResultCode = 'denied' | 'success' | 'failed';

export interface GateAuditEvent {
  readonly eventId: string;
  readonly eventType: AuditEventType;
  readonly layer: AuditLayer;
  readonly reasonCode?: string;
  readonly action?: AuditAction;
  readonly resultCode?: AuditResultCode;
  readonly failReason?: string;
  readonly remark?: string;
  readonly assetType?: string;
  readonly assetId?: string;
  readonly assetName?: string;
  readonly toolName?: string;
  /** 60 秒窗口内的聚合次数，缺省 1；后台列 `repeat_count` 尚在新增，先照常发送。 */
  readonly repeatCount: number;
  readonly clientTime: string;
  readonly clientVersion?: string;
}

/** 队列内部形态：repeatCount 需要原地累加，attempted 标记「已进入发送批次」，spoolAttempts 计重放次数。 */
type QueuedAuditEvent = {
  -readonly [K in keyof GateAuditEvent]: GateAuditEvent[K];
} & { attempted?: boolean; spoolAttempts?: number };

/** 判定拒绝时上报的输入（eventId/clientTime 由记录器补齐）。 */
export interface DeniedAuditInput {
  readonly layer: AuditLayer;
  readonly reasonCode: string;
  readonly assetType?: string;
  readonly assetId?: string;
  readonly assetName?: string;
  readonly toolName?: string;
  /** 写操作被拒时同时带 action。 */
  readonly action?: AuditAction;
}

/** 关键写操作上报的输入。 */
export interface WriteAuditInput {
  readonly action: AuditAction;
  /** 默认 `write_action`；撤权自动恢复用 `revocation`，避免被误读成人工恢复。 */
  readonly layer?: AuditLayer;
  readonly assetType?: string;
  readonly assetId?: string;
  readonly assetName?: string;
  readonly succeeded: boolean;
  readonly reasonCode?: string;
  readonly failReason?: string;
  /** 明确标注事件来源，例如 `auto-restored`。 */
  readonly remark?: string;
}

/**
 * 后台 reportGateAudit 的 result 明细。
 *
 * 真实契约：`accepted` / `duplicated` / `failed` 是**条数**（数字），逐条明细只在
 * `duplicateEventIds` / `failedEventIds` / `invalidEvents` 里。历史误把前三个当 id 数组，
 * 导致 `[...3]` 抛错、整批反复重发；这里两种形态都接受，但只有数组才当明细用。
 */
export interface AuditReportResult {
  readonly accepted?: number | readonly string[];
  readonly duplicated?: number | readonly string[];
  readonly failed?: number | readonly string[];
  readonly duplicateEventIds?: readonly string[];
  readonly failedEventIds?: readonly string[];
  readonly invalidEvents?: readonly { readonly eventId?: string; readonly reason?: string }[];
}

export const AUDIT_FLUSH_INTERVAL_MS = 3_000;
export const AUDIT_FLUSH_THRESHOLD = 20;
export const AUDIT_BATCH_MAX = 100;
export const AUDIT_SPOOL_MAX = 500;
/** 单个事件最多补发次数：超过即丢弃并告警，避免坏事件永久占据 spool。 */
export const AUDIT_SPOOL_MAX_REPLAY = 5;
/** 拒绝事件聚合窗口：同一键在首次事件起 60 秒内合并计数。 */
export const AUDIT_AGGREGATE_WINDOW_MS = 60_000;
/** 聚合表清理阈值：超过后清掉已过窗口的条目，避免长期运行无限增长。 */
const AUDIT_AGGREGATE_MAX_KEYS = 256;

export interface GateAuditOptions {
  /** 发送一批事件；整单失败（未登录/网络/超限）必须 reject。 */
  readonly send: (events: readonly GateAuditEvent[]) => Promise<AuditReportResult>;
  /** 按账号隔离的 spool 目录；缺省时只在内存中重试。 */
  readonly spoolDir?: string;
  readonly clientVersion?: string;
  readonly warn: (message: string) => void;
  /** 便于测试注入时间。 */
  readonly now?: () => number;
}

/** 客户端时间格式与资产操作记录上报共用 workdsh-contracts/asset-operation 的实现。 */

export class GateAuditRecorder {
  private queue: QueuedAuditEvent[] = [];
  private timer?: ReturnType<typeof setTimeout>;
  private running?: Promise<void>;
  private active = false;
  private spool: string[] = [];
  /** 未发出拒绝事件的聚合索引；记录器本身按账号构造，键天然带账号维度。 */
  private readonly aggregation = new Map<string, { event: QueuedAuditEvent; deadline: number }>();
  private readonly spoolPath?: string;
  private readonly now: () => number;

  constructor(private readonly options: GateAuditOptions) {
    this.spoolPath = options.spoolDir === undefined ? undefined : join(options.spoolDir, 'audit-spool.jsonl');
    this.now = options.now ?? Date.now;
  }

  /** 开闸时启动：读 spool 补发，并开始攒批。 */
  start(): void {
    if (this.active) return;
    this.active = true;
    this.loadSpool();
    this.replaySpool();
    if (this.queue.length > 0) this.schedule();
  }

  /** 关闸时停止：清掉内存队列与定时器，不读 spool、不发请求。 */
  stop(): void {
    this.active = false;
    this.clearTimer();
    this.queue = [];
    this.aggregation.clear();
  }

  /**
   * 判定拒绝入队。同步返回，不抛错、不发请求。
   *
   * 聚合：键 = 账号（记录器按账号构造）+ assetType + assetId + reasonCode + layer，
   * 窗口从该键首条事件起 60 秒；窗口内且尚未进入发送批次的同类事件只累加 repeatCount，
   * 保留首条的 eventId 与 clientTime。
   *
   * 限制：已进入发送批次的事件不再回改（后台只有新增接口，没有更新接口），
   * 因此聚合只覆盖「尚未发出」的重复拒绝，不能把已上报的计数补齐。
   */
  recordDenied(input: DeniedAuditInput): void {
    this.enqueue({
      eventType: 'denied',
      layer: input.layer,
      reasonCode: input.reasonCode,
      ...(input.action ? { action: input.action } : {}),
      ...(input.assetType ? { assetType: input.assetType } : {}),
      ...(input.assetId ? { assetId: input.assetId } : {}),
      ...(input.assetName ? { assetName: input.assetName } : {}),
      ...(input.toolName ? { toolName: input.toolName } : {}),
      resultCode: 'denied',
    }, aggregationKey(input));
  }

  recordWrite(input: WriteAuditInput): void {
    this.enqueue({
      eventType: 'write',
      layer: input.layer ?? 'write_action',
      action: input.action,
      resultCode: input.succeeded ? 'success' : 'failed',
      ...(input.reasonCode ? { reasonCode: input.reasonCode } : {}),
      ...(input.failReason ? { failReason: input.failReason } : {}),
      ...(input.remark ? { remark: input.remark } : {}),
      ...(input.assetType ? { assetType: input.assetType } : {}),
      ...(input.assetId ? { assetId: input.assetId } : {}),
      ...(input.assetName ? { assetName: input.assetName } : {}),
    });
  }

  /** 立即发送一批（测试与关停前使用）；单飞，异常由内部吞掉。 */
  flush(): Promise<void> {
    if (this.running) return this.running;
    if (!this.active || this.queue.length === 0) return Promise.resolve();
    this.clearTimer();
    const batch = this.queue.slice(0, AUDIT_BATCH_MAX);
    this.queue = this.queue.slice(batch.length);
    // 进入发送批次即视为「已发出」：即使稍后失败转入 spool 或回队重试，
    // 也不再参与聚合（后台没有更新接口，回改无法送达）。
    for (const event of batch) event.attempted = true;
    this.running = this.sendBatch(batch).finally(() => {
      this.running = undefined;
      if (this.active && this.queue.length > 0) this.schedule();
    });
    return this.running;
  }

  private enqueue(
    event: Omit<GateAuditEvent, 'eventId' | 'clientTime' | 'clientVersion' | 'repeatCount'>,
    key?: string,
  ): void {
    if (!this.active) return;
    try {
      const now = this.now();
      if (key !== undefined) {
        this.pruneAggregation(now);
        const hit = this.aggregation.get(key);
        // 只合并仍在队列、且尚未进入发送批次的首条事件；窗口从首条事件时间起算。
        if (hit && now < hit.deadline && hit.event.attempted !== true && this.queue.includes(hit.event)) {
          hit.event.repeatCount += 1;
          return;
        }
      }
      const full: QueuedAuditEvent = {
        ...event,
        eventId: randomUUID(),
        clientTime: formatClientTime(new Date(now)),
        repeatCount: 1,
        ...(this.options.clientVersion ? { clientVersion: this.options.clientVersion } : {}),
      };
      this.queue.push(full);
      if (key !== undefined) this.aggregation.set(key, { event: full, deadline: now + AUDIT_AGGREGATE_WINDOW_MS });
      if (this.queue.length >= AUDIT_FLUSH_THRESHOLD) {
        void this.flush();
        return;
      }
      this.schedule();
    } catch (error) {
      this.options.warn(`资产闸门：审计事件入队失败（${detail(error)}）。`);
    }
  }

  /** 聚合表只在超过阈值时清理已过窗口的条目，平时保持 O(1) 入队。 */
  private pruneAggregation(now: number): void {
    if (this.aggregation.size < AUDIT_AGGREGATE_MAX_KEYS) return;
    for (const [key, entry] of this.aggregation) {
      if (now >= entry.deadline) this.aggregation.delete(key);
    }
  }

  private async sendBatch(batch: QueuedAuditEvent[]): Promise<void> {
    let result: AuditReportResult;
    try {
      // 只发纯事件结构：attempted / spoolAttempts 是本地队列状态，不应进入请求体。
      result = await this.options.send(batch.map(toWireEvent));
    } catch (error) {
      // 整单失败：保留这批，稍后重试（落盘保证重启后也能补发）。
      this.options.warn(`资产闸门：审计上报失败，${batch.length} 条转入 spool（${detail(error)}）。`);
      this.spoolBatch(batch);
      return;
    }
    try {
      const settled = settle(batch, result);
      if (settled.invalid.length > 0) {
        for (const item of settled.invalid) {
          this.options.warn(`资产闸门：审计事件被后台判为非法，已丢弃（eventId=${item.eventId ?? '未知'}，原因=${item.reason ?? '未提供'}）。`);
        }
      }
      if (settled.retry.length > 0) {
        this.queue = [...settled.retry, ...this.queue];
        this.options.warn(`资产闸门：审计上报有 ${settled.retry.length} 条未入库，已保留重试。`);
      }
    } catch (error) {
      // 已经发出去了：回执解析异常按终结处理，丢弃本批。
      // 回队会让同一批 eventId 每 3 秒重发一次，后台只能不断报唯一键冲突。
      this.options.warn(`资产闸门：审计回执解析失败，已丢弃本批 ${batch.length} 条（${detail(error)}）。`);
    }
  }

  private schedule(): void {
    if (!this.active || this.timer !== undefined || this.queue.length === 0) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, AUDIT_FLUSH_INTERVAL_MS);
  }

  private clearTimer(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  /** 读 spool；损坏行按丢弃处理，不让一条坏行阻断补发。 */
  private loadSpool(): void {
    if (this.spoolPath === undefined) return;
    let text: string;
    try {
      text = readFileSync(this.spoolPath, 'utf8');
    } catch {
      return;
    }
    this.spool = text.split('\n').filter(line => line.trim().length > 0);
    if (this.spool.length > AUDIT_SPOOL_MAX) {
      const dropped = this.spool.length - AUDIT_SPOOL_MAX;
      this.spool = this.spool.slice(dropped);
      this.options.warn(`资产闸门：审计 spool 超过 ${AUDIT_SPOOL_MAX} 条，已丢弃最旧 ${dropped} 条。`);
    }
  }

  /** 启动补发：spool 事件按入队顺序补进内存队列，随后统一攒批发送。 */
  private replaySpool(): void {
    if (this.spool.length === 0) return;
    const pending: QueuedAuditEvent[] = [];
    let exhausted = 0;
    for (const line of this.spool) {
      try {
        const parsed = JSON.parse(line) as QueuedAuditEvent;
        // 同一事件反复失败会一直留在 spool：超过上限直接丢弃，避免永久重放占满队列。
        const attempts = typeof parsed.spoolAttempts === 'number' && parsed.spoolAttempts > 0 ? parsed.spoolAttempts : 0;
        if (attempts >= AUDIT_SPOOL_MAX_REPLAY) {
          exhausted += 1;
          continue;
        }
        // 旧版本 spool 没有 repeatCount；补发事件都曾进入发送批次，标记为已发出，不再参与聚合。
        pending.push({
          ...parsed,
          repeatCount: typeof parsed.repeatCount === 'number' && parsed.repeatCount > 0 ? parsed.repeatCount : 1,
          attempted: true,
        });
      } catch {
        this.options.warn('资产闸门：审计 spool 中存在无法解析的行，已丢弃。');
      }
    }
    if (exhausted > 0) {
      this.options.warn(`资产闸门：审计 spool 中有 ${exhausted} 条已补发 ${AUDIT_SPOOL_MAX_REPLAY} 次仍未成功，已丢弃。`);
    }
    this.spool = [];
    this.writeSpool();
    // spool 里的事件带原 eventId 与 clientTime，后台按 eventId 幂等去重。
    this.queue = [...pending, ...this.queue];
  }

  /** 整批写 spool；超过上限时丢最旧并告警。 */
  private spoolBatch(batch: readonly QueuedAuditEvent[]): void {
    if (this.spoolPath === undefined) {
      // 没有可写目录时只能在内存里保留：直接放回队列头部，等同稍后重试。
      this.queue = [...batch, ...this.queue];
      return;
    }
    try {
      this.spool.push(...batch.map(event => JSON.stringify({
        ...toWireEvent(event),
        spoolAttempts: (event.spoolAttempts ?? 0) + 1,
      })));
      if (this.spool.length > AUDIT_SPOOL_MAX) {
        const dropped = this.spool.length - AUDIT_SPOOL_MAX;
        this.spool = this.spool.slice(dropped);
        this.options.warn(`资产闸门：审计 spool 超过 ${AUDIT_SPOOL_MAX} 条，已丢弃最旧 ${dropped} 条。`);
      }
      this.writeSpool();
    } catch (error) {
      this.options.warn(`资产闸门：审计 spool 写入失败（${detail(error)}）。`);
    }
  }

  private writeSpool(): void {
    if (this.spoolPath === undefined) return;
    try {
      mkdirSync(dirname(this.spoolPath), { recursive: true, mode: 0o700 });
      writeFileSync(this.spoolPath, this.spool.join('\n'), { mode: 0o600 });
    } catch (error) {
      this.options.warn(`资产闸门：审计 spool 落盘失败（${detail(error)}）。`);
    }
  }
}

/**
 * 聚合键：账号维度由「每个账号一个记录器」保证，这里只拼资产与原因。
 * 同一资产同一原因但层级不同（如 call_tool 与 data_layer）不合并。
 */
function aggregationKey(input: DeniedAuditInput): string {
  return [input.layer, input.assetType ?? '', input.assetId ?? '', input.reasonCode].join('\u0001');
}

/** 回执字段里的 id 明细：只有数组才可用，数字/缺失一律当空。 */
function idList(value: number | readonly string[] | undefined): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((id): id is string => typeof id === 'string');
}

/** 回执字段里的条数：数字直接用，数组取其长度，缺失当 0。 */
function countOf(value: number | readonly string[] | undefined): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return Array.isArray(value) ? value.length : 0;
}

/** 发送前剔除本地队列状态字段，避免 `attempted` / `spoolAttempts` 被后台判为非法字段。 */
function toWireEvent(event: QueuedAuditEvent): GateAuditEvent {
  const wire: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(event)) {
    if (key === 'attempted' || key === 'spoolAttempts' || value === undefined) continue;
    wire[key] = value;
  }
  return wire as unknown as GateAuditEvent;
}

/** 按回执把一批事件分为「删除 / 保留重试 / 丢弃告警」。 */
function settle(batch: readonly GateAuditEvent[], result: AuditReportResult): {
  retry: GateAuditEvent[];
  invalid: readonly { eventId?: string; reason?: string }[];
} {
  // 已入库（成功或幂等命中）都算终结；后台的 duplicated 命中必须清理，不能留着重放。
  const accepted = new Set([
    ...idList(result.accepted),
    ...idList(result.duplicateEventIds),
    ...idList(result.duplicated),
  ]);
  const failed = new Set([...idList(result.failed), ...idList(result.failedEventIds)]);
  const invalid = Array.isArray(result.invalidEvents) ? result.invalidEvents : [];
  const invalidIds = new Set(invalid.map(item => item.eventId).filter((id): id is string => typeof id === 'string'));

  // 后台可能只给条数不给 id：没有任何失败迹象时整批视为已终结，避免把已入库的再发一遍。
  const failedCount = Math.max(countOf(result.failed), failed.size);
  const retry = (failedCount === 0 && invalid.length === 0)
    ? []
    : batch.filter(event => !accepted.has(event.eventId) && !invalidIds.has(event.eventId));
  return { retry, invalid };
}

function detail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
