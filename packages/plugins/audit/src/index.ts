import { Context, Service } from '@deepseek-ai/cordis';
import { defineDomain, domainTable, type Domain, type KvTable } from '@deepseek-ai/dsh-storage-domain';
import { z } from 'zod';
import type { AuditEvent, AuditService } from 'workdsh-contracts';
import { GovernanceContractError } from './governance.js';

const bounded = z.string().min(1).max(256).refine((value) => !/[\u0000-\u001f]/.test(value));
const resourceRefSchema = z.object({ domain: bounded, id: bounded, revision: bounded.optional() });
const auditEventSchema: z.ZodType<AuditEvent> = z.object({
  id: bounded,
  occurredAt: z.iso.datetime(),
  requestId: bounded,
  principalId: bounded,
  organizationId: bounded,
  action: bounded,
  target: resourceRefSchema.optional(),
  outcome: z.enum(['succeeded', 'denied', 'failed', 'cancelled', 'unknown']),
  code: bounded,
  sessionId: bounded.optional(),
  runId: bounded.optional(),
  references: z.record(z.string(), z.string()).optional(),
});

const auditEventTable = domainTable<string, AuditEvent>(auditEventSchema);

/**
 * 单月审计域。按月分域而不是全部写进 `workdsh_audit` 单表：
 * 官方 per-record 存储层在打开域时用 Promise.all 并发读取整表文件，
 * 单表无上限增长会超过进程 fd 上限（启动即 EMFILE），因此每个月独立成域。
 */
function monthDomainSpec(month: string) {
  return defineDomain({
    name: `workdsh_audit_${month}`,
    version: 1,
    layout: 'per-record',
    tables: { events: auditEventTable },
  });
}

const monthIndexSchema = z.object({ lastEventAt: z.iso.datetime() });
const monthsDomainSpec = defineDomain({
  name: 'workdsh_audit_months',
  version: 1,
  layout: 'per-record',
  tables: { months: domainTable<string, z.infer<typeof monthIndexSchema>>(monthIndexSchema) },
});

/** 保留月数：只保留上个月与本月，更早的月份域整月裁剪，避免本地磁盘无限增长。 */
const RETENTION_MONTHS = 1;

/** `occurredAt` 的 UTC 月份键，`2026-11-19T...` → `202611`；字典序即时间序。 */
function monthKey(iso: string): string {
  return iso.slice(0, 7).replace('-', '');
}

function monthsAgoKey(count: number): string {
  const now = new Date();
  return monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - count, 1)).toISOString());
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    workdshAudit: AuditService;
  }
}

const sensitiveReference = /(credential|password|prompt|secret|token)/i;

function validateEvent(event: AuditEvent): void {
  const parsed = auditEventSchema.safeParse(event);
  if (!parsed.success) {
    throw new GovernanceContractError('audit/invalid-event', 'Audit event does not satisfy the durable schema.');
  }
  for (const [key, value] of Object.entries(event.references ?? {})) {
    if (sensitiveReference.test(key)) {
      throw new GovernanceContractError('audit/sensitive-reference', `Audit reference '${key}' is forbidden.`);
    }
    if (key.length > 128 || value.length > 1024 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) {
      throw new GovernanceContractError('audit/invalid-reference', `Audit reference '${key}' is invalid.`);
    }
  }
}

interface ActiveMonth {
  month: string;
  domain: Domain<ReturnType<typeof monthDomainSpec>>;
  events: KvTable<string, AuditEvent>;
}

export class AuditJournal extends Service implements AuditService {
  static inject = ['storageDomain'];
  private months?: KvTable<string, { lastEventAt: string }>;
  private active?: ActiveMonth;
  private appendTail: Promise<void> = Promise.resolve();

  constructor(ctx: Context) {
    super(ctx, 'workdshAudit');
  }

  async [Service.init](): Promise<void> {
    const monthsDomain = await this.ctx.storageDomain.open(monthsDomainSpec);
    this.ctx.effect(() => () => monthsDomain.close(), 'workdshAudit.monthsClose');
    this.months = monthsDomain.table('months');
    await this.activate(monthKey(new Date().toISOString()));
    this.ctx.effect(() => async () => {
      await this.flush();
      await this.closeActive();
    }, 'workdshAudit.flush');
    // 过期月份裁剪放在后台，不阻塞启动。
    void this.pruneExpired().catch((error: unknown) => {
      this.ctx.logger.warn(`审计：过期月份裁剪失败（${error instanceof Error ? error.message : String(error)}）。`);
    });
  }

  append(event: AuditEvent, signal?: AbortSignal): Promise<void> {
    const result = this.appendTail.then(async () => {
      signal?.throwIfAborted();
      validateEvent(event);
      await this.activate(monthKey(event.occurredAt));
      const events = this.requireActive().events;
      if (events.get(event.id)) throw new GovernanceContractError('audit/duplicate-event', `Audit event '${event.id}' already exists.`);
      await events.put(event.id, Object.freeze({ ...event, references: event.references && Object.freeze({ ...event.references }) }));
    });
    this.appendTail = result.then(() => undefined, () => undefined);
    return result;
  }

  /** 当前已加载月份的事件快照（跨月历史不会为查询而整体载入，需按月份单独打开）。 */
  snapshot(): readonly AuditEvent[] {
    return Object.freeze([...this.requireActive().events.entries()]
      .map(([, event]) => event)
      .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt) || left.id.localeCompare(right.id)));
  }

  async flush(): Promise<void> {
    await this.appendTail;
  }

  /** 切到目标月份域；旧月份域随即关闭，避免长期占用内存与文件句柄。 */
  private async activate(month: string): Promise<void> {
    if (this.active?.month === month) return;
    await this.closeActive();
    const domain = await this.ctx.storageDomain.open(monthDomainSpec(month));
    this.active = { month, domain, events: domain.table('events') };
    const months = this.requireMonths();
    if (!months.get(month)) await months.put(month, { lastEventAt: new Date().toISOString() });
  }

  private async closeActive(): Promise<void> {
    const active = this.active;
    this.active = undefined;
    if (active) await active.domain.close();
  }

  private async pruneExpired(): Promise<void> {
    const cutoff = monthsAgoKey(RETENTION_MONTHS);
    const expired = [...this.requireMonths().entries()]
      .map(([month]) => month)
      .filter((month) => month < cutoff)
      .sort();
    for (const month of expired) {
      if (this.active?.month === month) continue;
      let domain: Domain<ReturnType<typeof monthDomainSpec>> | undefined;
      try {
        domain = await this.ctx.storageDomain.open(monthDomainSpec(month));
        const events = domain.table('events');
        for (const key of [...events.keys()]) await events.delete(key);
        await this.requireMonths().delete(month);
      } catch (error) {
        this.ctx.logger.warn(`审计：${month} 月记录裁剪失败，保留待下次重试（${error instanceof Error ? error.message : String(error)}）。`);
      } finally {
        await domain?.close();
      }
    }
  }

  private requireMonths(): KvTable<string, { lastEventAt: string }> {
    if (!this.months) throw new GovernanceContractError('audit/not-ready', 'Audit journal is not ready.');
    return this.months;
  }

  private requireActive(): ActiveMonth {
    if (!this.active) throw new GovernanceContractError('audit/not-ready', 'Audit journal is not ready.');
    return this.active;
  }
}

export default AuditJournal;
