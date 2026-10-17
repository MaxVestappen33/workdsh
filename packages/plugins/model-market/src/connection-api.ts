/** 模型市场的本机连接端点：设置页通过 /api/workdsh-model-market 调用，不直接接触后台 token。 */
import type { Context } from '@deepseek-ai/cordis';
import type { ConnectionRpcResult, HostConnectionHandle } from '@deepseek-ai/dsh-client-connection';
import { ModelMarketError } from './market.js';
import type { ModelMarketServiceApi } from './service.js';

export const modelMarketConnectionPath = '/api/workdsh-model-market';

const noStore = { headers: { 'cache-control': 'no-store' } };
const ok = <T>(value: T): ConnectionRpcResult<T> => ({ ok: true, value });
const fail = (code: string, message: string): ConnectionRpcResult<never> => ({ ok: false, error: { code, message, details: {} } });
const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

const optionalCount = (value: unknown): number | undefined | null =>
  value === undefined ? undefined : typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;

const optionalText = (value: unknown): string | undefined | null =>
  value === undefined ? undefined : typeof value === 'string' ? value : null;

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

export function registerModelMarketConnection(ctx: Context): void {
  const connection = (ctx as Context & { connection: HostConnectionHandle }).connection;
  // 服务由子 Fiber 注册：不要用 ctx.workdshModelMarket 直接属性访问，否则会因未声明 inject 被拒绝。
  const market = (): ModelMarketServiceApi => {
    const service = ctx.reflect.get('workdshModelMarket') as ModelMarketServiceApi | undefined;
    if (!service) throw new ModelMarketError('model-market/unavailable', '当前环境未接入模型市场。');
    return service;
  };
  const unregister = connection.fetch.register({
    path: modelMarketConnectionPath,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async request => {
      let endpoint: unknown;
      try {
        const body = record(await request.json());
        endpoint = body?.endpoint;
        const payload = record(body?.payload) ?? {};
        if (endpoint === 'available') return Response.json(ok({ available: await market().available() }), noStore);
        if (endpoint === 'list') {
          const pageNo = optionalCount(payload.pageNo);
          const pageSize = optionalCount(payload.pageSize);
          const keyword = optionalText(payload.keyword);
          const provider = optionalText(payload.provider);
          const modelType = optionalText(payload.modelType);
          const apiProtocol = optionalText(payload.apiProtocol);
          if (pageNo === null || pageSize === null || keyword === null || provider === null || modelType === null || apiProtocol === null) return invalidRequest();
          return Response.json(ok(await market().list({
            pageNo, pageSize, keyword, provider, modelType, apiProtocol,
            ...(typeof payload.isDefault === 'boolean' ? { isDefault: payload.isDefault } : {}),
          }, request.signal)), noStore);
        }
        if (endpoint === 'detail') {
          const id = text(payload.id);
          if (!id) return invalidRequest();
          return Response.json(ok(await market().detail(id, request.signal)), noStore);
        }
        if (endpoint === 'install') {
          const id = text(payload.id);
          if (!id) return invalidRequest();
          return Response.json(ok(await market().install(id, request.signal)), noStore);
        }
        if (endpoint === 'uninstall') {
          const id = text(payload.id);
          if (!id) return invalidRequest();
          return Response.json(ok(await market().uninstall(id, request.signal)), noStore);
        }
        if (endpoint === 'custom-list') return Response.json(ok(await market().customList()), noStore);
        if (endpoint === 'custom-install') {
          return Response.json(ok(await market().customInstall(payload)), noStore);
        }
        if (endpoint === 'custom-update') {
          const key = text(payload.key) ?? text(payload.providerId);
          if (!key) return invalidRequest();
          return Response.json(ok(await market().customUpdate(key, payload)), noStore);
        }
        if (endpoint === 'custom-uninstall') {
          const key = text(payload.key) ?? text(payload.providerId);
          if (!key) return invalidRequest();
          return Response.json(ok(await market().customUninstall(key)), noStore);
        }
        if (endpoint === 'custom-discover') {
          return Response.json(ok(await market().customDiscover(payload)), noStore);
        }
        return invalidRequest();
      } catch (cause) {
        if (cause instanceof ModelMarketError) return Response.json(fail(cause.code, cause.message), noStore);
        const detail = cause instanceof Error && cause.message ? cause.message : '模型市场操作失败，请重试。';
        ctx.logger.warn(`模型市场端点 ${endpoint === undefined ? '(未知)' : String(endpoint)} 失败：${detail}`);
        return Response.json(fail('model-market/internal', detail));
      }
    },
  });
  ctx.effect(() => unregister, 'workdsh.modelMarket.fetch');
}

function invalidRequest(): Response {
  return Response.json(fail('model-market/invalid-request', '模型市场请求参数无效。'), { status: 400 });
}
