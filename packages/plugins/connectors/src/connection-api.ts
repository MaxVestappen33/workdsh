import type { Context } from '@deepseek-ai/cordis';
import type { ConnectionRpcResult, HostConnectionHandle } from '@deepseek-ai/dsh-client-connection';
import { MarketRequestError } from './market.js';
import type { ConnectorMarket, ConnectorMarketUninstall } from './market-entry.js';

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
        if (endpoint === 'create') return Response.json(ok(await manager.create(payload as never)), noStore);
        if (endpoint === 'update' && typeof payload.id === 'string' && record(payload.input)) return Response.json(ok(await manager.update(payload.id, payload.input as never)), noStore);
        if (endpoint === 'remove' && typeof payload.id === 'string') { await manager.remove(payload.id); return Response.json(ok({ removed: true }), noStore); }
        if (endpoint === 'set-enabled' && typeof payload.id === 'string' && typeof payload.enabled === 'boolean') {
          return Response.json(ok(await manager.setEnabled(payload.id, payload.enabled)), noStore);
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
          if (page === null || pageSize === null || scene === null || keyword === null) return invalidRequest();
          return Response.json(ok(await market().list({ page, pageSize, scene, keyword }, request.signal)), noStore);
        }
        if (endpoint === 'market-categories') return Response.json(ok(await market().categories(request.signal)), noStore);
        if (endpoint === 'market-install' && typeof payload.originId === 'string' && payload.originId.trim()) {
          return Response.json(ok(await market().install(payload.originId, request.signal)), noStore);
        }
        if (endpoint === 'market-uninstall' && (typeof payload.originId === 'string' || typeof payload.id === 'string')) {
          const target: ConnectorMarketUninstall = {
            ...(typeof payload.originId === 'string' ? { originId: payload.originId } : {}),
            ...(typeof payload.id === 'string' ? { id: payload.id } : {}),
          };
          return Response.json(ok(await market().uninstall(target, request.signal)), noStore);
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
