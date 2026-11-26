/** 模型市场的本机连接端点：设置页通过 /api/workdsh-model-market 调用，不直接接触后台 token。 */
import type { Context } from '@deepseek-ai/cordis';
import type { ConnectionRpcResult, HostConnectionHandle } from '@deepseek-ai/dsh-client-connection';
import { ModelMarketError } from './market.js';
import { AssetGateDenied, type ModelMarketServiceApi } from './service.js';
import type { ModelApplyStatus, ModelAuthorizationQuery } from './shared.js';

export const modelMarketConnectionPath = '/api/workdsh-model-market';

/** 申请状态白名单：与技能/MCP 市场同口径。 */
const APPLY_STATUSES: readonly ModelApplyStatus[] = ['none', 'pending', 'approved', 'rejected'];

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
        // 闸门状态：判定统一在客户端，关闸时把后台 isAuthorized 一律按 Y 处理。
        if (endpoint === 'asset-gate-state') {
          const gate = ctx.reflect.get('workdshAssetGate') as {
            enabled?(assetType: string): boolean;
            signatureEnabled?(): boolean;
            policy?(): { readonly failClosed?: boolean };
          } | undefined;
          return Response.json(ok({
            enforced: gate?.enabled?.('model') === true,
            signatureEnforced: gate?.signatureEnabled?.() === true,
            policyUnavailable: gate?.policy?.()?.failClosed === true,
          }), noStore);
        }
        if (endpoint === 'list') {
          const pageNo = optionalCount(payload.pageNo);
          const pageSize = optionalCount(payload.pageSize);
          const keyword = optionalText(payload.keyword);
          const provider = optionalText(payload.provider);
          const modelType = optionalText(payload.modelType);
          const apiProtocol = optionalText(payload.apiProtocol);
          if (pageNo === null || pageSize === null || keyword === null || provider === null || modelType === null || apiProtocol === null) return invalidRequest();
          const authStatus = payload.authStatus;
          const applyStatus = payload.applyStatus;
          if (authStatus !== undefined && authStatus !== 'Y' && authStatus !== 'N') return invalidRequest();
          if (applyStatus !== undefined && !APPLY_STATUSES.includes(applyStatus as ModelApplyStatus)) return invalidRequest();
          return Response.json(ok(await market().list({
            pageNo, pageSize, keyword, provider, modelType, apiProtocol,
            ...(typeof payload.isDefault === 'boolean' ? { isDefault: payload.isDefault } : {}),
            ...(authStatus === 'Y' || authStatus === 'N' ? { authStatus } : {}),
            ...(applyStatus === undefined ? {} : { applyStatus: applyStatus as ModelApplyStatus }),
          }, request.signal)), noStore);
        }
        // 模型选择器的执行期授权状态：一次批量取回，宿主侧统一缓存与兜底。
        if (endpoint === 'model-authorizations') {
          const rows = payload.models;
          if (!Array.isArray(rows) || rows.length > 200) return invalidRequest();
          const items: ModelAuthorizationQuery[] = [];
          for (const row of rows) {
            const item = record(row);
            const provider = text(item?.provider);
            const model = text(item?.model);
            if (!item || !provider || !model) return invalidRequest();
            items.push({ provider, model });
          }
          return Response.json(ok(await market().authorizationsOf(items, request.signal)), noStore);
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
        // 未授权保留 gate/denied-* 原因码，UI 可据此与后台故障区分。
        if (cause instanceof AssetGateDenied) return Response.json(fail(cause.code, cause.message), noStore);
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
