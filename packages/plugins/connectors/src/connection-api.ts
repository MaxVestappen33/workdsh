import type { Context } from '@deepseek-ai/cordis';
import type { ConnectionRpcResult, HostConnectionHandle } from '@deepseek-ai/dsh-client-connection';
import { MarketRequestError, type ConnectorApplyStatus } from './market.js';
import type { ConnectorMarket, ConnectorMarketUninstall } from './market-entry.js';

const APPLY_STATUSES: readonly ConnectorApplyStatus[] = ['none', 'pending', 'approved', 'rejected'];

export const connectorManagementPath = '/api/workdsh-connectors';
const noStore = { headers: { 'cache-control': 'no-store' } };
const ok = <T>(value: T): ConnectionRpcResult<T> => ({ ok: true, value });
const fail = (code: string, message: string): ConnectionRpcResult<never> => ({ ok: false, error: { code, message, details: {} } });
const record = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
/** 市场分页参数：缺省表示交给后台取默认值，出现非法值则拒绝请求。 */
const optionalCount = (value: unknown): number | undefined | null =>
  value === undefined ? undefined : typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
/** 市场文本参数：缺省表示不过滤，出现非字符串则拒绝请求。 */
const optionalText = (value: unknown): string | undefined | null => value === undefined ? undefined : typeof value === 'string' ? value : null;

/**
 * 资产闸门是可选宿主能力：缺失、关闭或该类型未开启时完全透明。
 * 拒绝时抛出的错误带稳定原因码（gate/denied-*），由下方统一透出，UI 可据此区分未授权与后台失败。
 */
type GateAssetType = 'skill' | 'mcp' | 'expert' | 'expert_group' | 'model' | 'prompt';
/** 审计动作：数据层只上报这五种关键写操作。 */
type GateAuditAction = 'install' | 'enable' | 'restore' | 'uninstall' | 'delete';
interface AssetGateLike {
  enabled(assetType: GateAssetType): boolean;
  /** 触发式校验：进市场页/刷新/写操作完成后做一次 revision 比对；旧版闸门没有该方法时跳过。 */
  refreshNow?(): Promise<void>;
  /** 强制刷新快照（绕过节流）；旧版闸门没有该方法时不做授权变更重试。 */
  refreshSnapshotForced?(signal?: AbortSignal): Promise<boolean>;
  decide(request: { assetType: GateAssetType; assetId: string; usage: 'read' | 'use' | 'write' }): Promise<{ allow: boolean; reason: string; message: string }>;
  /** 拿不到后台编号时的拒绝结果：原因码与文案由闸门统一维护。 */
  unlisted(): { reason: string; message: string };
  /** 摘要校验不通过时的原因码与文案。 */
  integrityMismatch(): { reason: string; message: string };
  /** 拒绝审计只入队；闸门关闭或上报异常都由实现自行吞掉。 */
  auditDenied?(input: {
    readonly layer: 'data_layer';
    readonly reasonCode: string;
    readonly action?: GateAuditAction;
    readonly assetType?: string;
    readonly assetId?: string;
    readonly assetName?: string;
  }): void;
  /** 关键写操作审计；同样只入队、不阻断业务。 */
  auditWrite?(input: {
    readonly action: GateAuditAction;
    readonly assetType?: string;
    readonly assetId?: string;
    readonly assetName?: string;
    readonly succeeded: boolean;
    readonly reasonCode?: string;
    readonly failReason?: string;
  }): void;
}
const assetGate = (ctx: Context): AssetGateLike | undefined => ctx.reflect.get('workdshAssetGate') as AssetGateLike | undefined;

class AssetGateDenied extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'AssetGateDenied';
  }
}

/** 写操作审计的共同元数据。 */
interface WriteAuditMeta {
  readonly action: GateAuditAction;
  readonly assetType?: string;
  readonly assetId?: string;
  readonly assetName?: string;
}

/** 审计异常一律吞掉，绝不影响连接器管理业务。 */
function auditWrite(ctx: Context, meta: WriteAuditMeta, succeeded: boolean, failure?: unknown): void {
  try {
    assetGate(ctx)?.auditWrite?.({
      ...meta,
      succeeded,
      ...(succeeded ? {} : { failReason: failure instanceof Error ? failure.message : String(failure ?? '') }),
    });
  } catch {
    // 审计是可选旁路，失败不向调用方抛出。
  }
}

function auditDenied(ctx: Context, meta: WriteAuditMeta, reasonCode: string): void {
  try {
    assetGate(ctx)?.auditDenied?.({ layer: 'data_layer', reasonCode, ...meta });
  } catch {
    // 同上。
  }
}

/** 成功记 write/success，失败记 write/failed，被闸门拒绝时记 denied（带 action 与原因码）。 */
async function auditedWrite<T>(ctx: Context, meta: WriteAuditMeta, run: () => Promise<T>): Promise<T> {
  try {
    const value = await run();
    auditWrite(ctx, meta, true);
    return value;
  } catch (error) {
    if (error instanceof AssetGateDenied) auditDenied(ctx, meta, error.code);
    else auditWrite(ctx, meta, false, error);
    throw error;
  }
}

/**
 * 可被「刷新快照」修复的拒绝原因：授权刚在后台变更（审批通过 / 撤销恢复）时本地快照还没同步到，
 * 强制刷新一次通常就能放行。签名、完整性、策略类拒绝不在其中，重试无意义。
 */
const REFRESHABLE_GATE_REASONS = new Set<string>([
  'gate/denied-not-entitled',
  'gate/denied-expired',
  'gate/denied-snapshot-stale',
  'gate/denied-no-snapshot',
]);

/**
 * 写操作（安装、启用）前判授权；闸门关闭时直接放行。
 *
 * 命中「快照里没有该资产 / 快照过期」时先强制刷新一次快照再判定，把「审批刚通过就点安装」的失败窗口
 * 消掉（与技能市场同一策略）；刷新失败或刷新后仍无授权时给出区分文案，不把后台同步延迟说成「没有授权」。
 */
async function requireAsset(ctx: Context, assetType: GateAssetType, assetId: string): Promise<void> {
  const gate = assetGate(ctx);
  if (!gate?.enabled(assetType)) return;
  const request = { assetType, assetId, usage: 'write' as const };
  const decision = await gate.decide(request);
  if (decision.allow) return;
  if (!gate.refreshSnapshotForced || !REFRESHABLE_GATE_REASONS.has(decision.reason))
    throw new AssetGateDenied(decision.reason, decision.message);
  const refreshed = await gate.refreshSnapshotForced();
  if (!refreshed) throw new AssetGateDenied(decision.reason, '授权状态刷新失败，请稍后重试。');
  const retried = await gate.decide(request);
  if (retried.allow) return;
  throw new AssetGateDenied(retried.reason, REFRESHABLE_GATE_REASONS.has(retried.reason)
    ? '授权尚未生效，请稍后重试。'
    : retried.message);
}

export function registerConnectorManagementConnection(ctx: Context): void {
  const connection = (ctx as Context & { connection: HostConnectionHandle }).connection;
  const manager = ctx.workdshConnectors;
  const marketService = (): ConnectorMarket | undefined => ctx.reflect.get('workdshConnectorMarket') as ConnectorMarket | undefined;
  const market = (): ConnectorMarket => {
    const service = marketService();
    if (!service) throw new MarketRequestError('connector/market-unavailable', '当前环境未接入 MCP 市场。');
    return service;
  };
  const unregister = connection.fetch.register({
    path: connectorManagementPath,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async request => {
      let endpoint: unknown;
      try {
        const body = record(await request.json());
        endpoint = body?.endpoint;
        const payload = record(body?.payload) ?? {};
        if (endpoint === 'list') return Response.json(ok(await manager.list(request.signal)), noStore);
        if (endpoint === 'config' && typeof payload.id === 'string') return Response.json(ok(await manager.config(payload.id)), noStore);
        if (endpoint === 'create') {
          const meta = { action: 'install', assetType: 'mcp', ...(typeof payload.name === 'string' ? { assetName: payload.name } : {}) } as const;
          return Response.json(ok(await auditedWrite(ctx, meta, () => manager.create(payload as never))), noStore);
        }
        if (endpoint === 'update' && typeof payload.id === 'string' && record(payload.input)) return Response.json(ok(await manager.update(payload.id, payload.input as never)), noStore);
        if (endpoint === 'remove' && typeof payload.id === 'string') {
          // 删除属于关键写操作：无论成功失败都记一条 write。
          const id = payload.id;
          await auditedWrite(ctx, { action: 'delete', assetType: 'mcp', assetId: id }, () => manager.remove(id));
          return Response.json(ok({ removed: true }), noStore);
        }
        if (endpoint === 'set-enabled' && typeof payload.id === 'string' && typeof payload.enabled === 'boolean') {
          const id = payload.id;
          // 启用判授权并记关键写操作；禁用始终放行且不属于审计动作。
          if (!payload.enabled) return Response.json(ok(await manager.setEnabled(id, false)), noStore);
          const meta = { action: 'enable', assetType: 'mcp', assetId: id } as const;
          return Response.json(ok(await auditedWrite(ctx, meta, async () => {
            const gate = assetGate(ctx);
            if (gate?.enabled('mcp') === true) {
              const row = (await manager.list(request.signal)).find(item => item.id === id);
              // 只认记录里的安装清单：清单里有后台编号就判授权；内置放行；无清单或自建按「未上架/未登记」拒绝。
              if (row?.installManifest?.assetId) {
                // 连接器没有文件清单，只能校验定义摘要；旧记录无摘要时如实按「无法校验」放行，不假装校验过。
                if (manager.verifyDefinitionIntegrity?.(id) === 'modified') {
                  const denial = gate.integrityMismatch();
                  throw new AssetGateDenied(denial.reason, denial.message);
                }
                await requireAsset(ctx, 'mcp', row.installManifest.assetId);
              } else if (row && row.installManifest?.source !== 'builtin') {
                const denial = gate.unlisted();
                throw new AssetGateDenied(denial.reason, denial.message);
              }
            }
            return manager.setEnabled(id, true);
          })), noStore);
        }
        if (endpoint === 'selection' && typeof payload.sessionId === 'string') {
          return Response.json(ok(await manager.selection(payload.sessionId)), noStore);
        }
        if (endpoint === 'set-selection' && typeof payload.sessionId === 'string' && Array.isArray(payload.connectorIds) && payload.connectorIds.every(id => typeof id === 'string')) {
          return Response.json(ok(await manager.setSelection(payload.sessionId, payload.connectorIds)), noStore);
        }
        if (endpoint === 'market-available') {
          const service = marketService();
          return Response.json(ok({ available: service ? await service.available() : false }), noStore);
        }
        if (endpoint === 'market-list') {
          const page = optionalCount(payload.page); const pageSize = optionalCount(payload.pageSize);
          const scene = optionalText(payload.scene); const keyword = optionalText(payload.keyword);
          const authStatus = payload.authStatus;
          const applyStatus = payload.applyStatus;
          if (page === null || pageSize === null || scene === null || keyword === null
            || (authStatus !== undefined && authStatus !== 'Y' && authStatus !== 'N')
            || (applyStatus !== undefined && !APPLY_STATUSES.includes(applyStatus as ConnectorApplyStatus))) {
            return invalidRequest();
          }
          // 市场列表不再按闸门过滤：授权状态由后台 isAuthorized 下发并由界面展示，
          // 未授权条目必须留在列表里，才能筛出「未授权」并给出申请入口；安装仍由闸门拦截。
          const result = await market().list({
            page, pageSize, scene, keyword,
            ...(authStatus === 'Y' || authStatus === 'N' ? { authStatus } : {}),
            ...(applyStatus === undefined ? {} : { applyStatus: applyStatus as ConnectorApplyStatus }),
          }, request.signal);
          return Response.json(ok(result), noStore);
        }
        if (endpoint === 'market-categories') return Response.json(ok(await market().categories(request.signal)), noStore);
        if (endpoint === 'market-index') {
          const refresh = payload.refresh;
          if (refresh !== undefined && typeof refresh !== 'boolean') return invalidRequest();
          return Response.json(ok(await market().index(request.signal, refresh === true)), noStore);
        }
        // 授权申请/取消申请的单点地址：菜单与业务参数由界面给出，宿主只负责生成参数。
        if (endpoint === 'market-sso') {
          const menuId = payload.menuId;
          const box = record(payload.bizParams);
          if (typeof menuId !== 'string' || !/^\d{10,25}$/u.test(menuId) || !box) return invalidRequest();
          const bizParams: Record<string, string> = {};
          for (const [key, value] of Object.entries(box)) {
            if (typeof value !== 'string') return invalidRequest();
            bizParams[key] = value;
          }
          return Response.json(ok(await market().adminSsoTarget(menuId, bizParams, request.signal)), noStore);
        }
        if (endpoint === 'market-install' && typeof payload.originId === 'string' && payload.originId.trim()) {
          const originId = payload.originId;
          const meta = { action: 'install', assetType: 'mcp', assetId: originId.trim() } as const;
          return Response.json(ok(await auditedWrite(ctx, meta, async () => {
            await requireAsset(ctx, 'mcp', originId);
            return market().install(originId, request.signal);
          })), noStore);
        }
        // 安装任务状态：需要下载依赖的条目在安装期间由界面轮询这里，避免把一次安装压在一个 HTTP 请求上。
        if (endpoint === 'market-install-status' && typeof payload.originId === 'string' && payload.originId.trim()) {
          const service = marketService();
          return Response.json(ok(service ? await service.installStatus(payload.originId) : null), noStore);
        }
        if (endpoint === 'market-uninstall' && (typeof payload.originId === 'string' || typeof payload.id === 'string')) {
          const target: ConnectorMarketUninstall = {
            ...(typeof payload.originId === 'string' ? { originId: payload.originId } : {}),
            ...(typeof payload.id === 'string' ? { id: payload.id } : {}),
          };
          const meta = {
            action: 'uninstall',
            assetType: 'mcp',
            ...(typeof payload.originId === 'string' ? { assetId: payload.originId } : {}),
            ...(typeof payload.id === 'string' ? { assetName: payload.id } : {}),
          } as const;
          return Response.json(ok(await auditedWrite(ctx, meta, () => market().uninstall(target, request.signal))), noStore);
        }
        return invalidRequest();
      } catch (cause) {
        if (cause instanceof MarketRequestError) return Response.json(fail(cause.code, cause.message), noStore);
        const known = new Set(['connector/not-found', 'connector/not-ready', 'connector/command-required', 'connector/url-required', 'connector/server-name-conflict']);
        // 治理/会话类错误自带 code（例如 access/not-ready、session/not-found）：原样透出并记录日志，
        // 否则界面上只剩一句「连接器操作失败，请重试」，真实原因在客户机上完全不可见。
        const declared = cause !== null && typeof cause === 'object' && 'code' in cause && typeof (cause as { code?: unknown }).code === 'string'
          ? (cause as { code: string }).code
          : undefined;
        const code = declared ?? (cause instanceof Error && known.has(cause.message) ? cause.message : 'connector/internal');
        const messages: Record<string, string> = { 'connector/not-found': '未找到该连接器。', 'connector/command-required': 'stdio 连接需要填写启动命令。', 'connector/url-required': 'HTTP 连接需要填写 MCP URL。', 'connector/server-name-conflict': '服务标识已被其他 MCP 使用。' };
        const detail = cause instanceof Error && cause.message ? cause.message : '连接器操作失败，请重试。';
        const message = code === 'connector/not-ready' ? '所选 MCP 尚未连接，请在连接器中检查运行状态后重试。' : messages[code] ?? detail;
        ctx.logger.warn(`连接器端点 ${endpoint === undefined ? '(未知)' : String(endpoint)} 失败（${code}）：${detail}`);
        return Response.json(fail(code, message));
      }
    },
  });
  ctx.effect(() => unregister, 'workdsh.connectors.fetch');
}

function invalidRequest(): Response {
  return Response.json(fail('connector/invalid-request', '连接器管理请求无效。'), { status: 400 });
}
