/** 提示词的本机连接端点：界面通过 /api/workdsh-prompts 取列表，不直接接触后台 token。 */
import type { Context } from '@deepseek-ai/cordis';
import type { ConnectionRpcResult, HostConnectionHandle } from '@deepseek-ai/dsh-client-connection';
import { PromptRequestError } from './shared.js';
import type { PromptApi } from './service.js';

export const promptConnectionPath = '/api/workdsh-prompts';

const noStore = { headers: { 'cache-control': 'no-store' } };
const ok = <T>(value: T): ConnectionRpcResult<T> => ({ ok: true, value });
const fail = (code: string, message: string): ConnectionRpcResult<never> => ({ ok: false, error: { code, message, details: {} } });
const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const optionalCount = (value: unknown): number | undefined | null =>
  value === undefined ? undefined : typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
const optionalText = (value: unknown): string | undefined | null =>
  value === undefined ? undefined : typeof value === 'string' ? value : null;

function invalidRequest(): Response {
  return Response.json(fail('prompt/invalid-request', '提示词查询参数无效。'), { status: 400 });
}

export function registerPromptConnection(ctx: Context): void {
  const connection = (ctx as Context & { connection: HostConnectionHandle }).connection;
  // 服务由子 Fiber 注册：用 reflect 读取，避免未声明 inject 时直接属性访问被拒绝。
  const prompts = (): PromptApi => {
    const service = ctx.reflect.get('workdshPrompts') as PromptApi | undefined;
    if (!service) throw new PromptRequestError('prompt/unavailable', '当前环境未接入提示词服务。');
    return service;
  };
  const unregister = connection.fetch.register({
    path: promptConnectionPath,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async request => {
      let endpoint: unknown;
      try {
        const body = record(await request.json());
        endpoint = body?.endpoint;
        const payload = record(body?.payload) ?? {};
        if (endpoint === 'available') return Response.json(ok({ available: await prompts().available() }), noStore);
        if (endpoint === 'list') {
          const page = optionalCount(payload.page);
          const pageSize = optionalCount(payload.pageSize);
          const keyword = optionalText(payload.keyword);
          if (page === null || pageSize === null || keyword === null) return invalidRequest();
          return Response.json(ok(await prompts().list({ page, pageSize, keyword }, request.signal)), noStore);
        }
        return invalidRequest();
      } catch (cause) {
        if (cause instanceof PromptRequestError) return Response.json(fail(cause.code, cause.message), noStore);
        const detail = cause instanceof Error && cause.message ? cause.message : '提示词查询失败，请重试。';
        ctx.logger.warn(`提示词端点 ${endpoint === undefined ? '(未知)' : String(endpoint)} 失败：${detail}`);
        return Response.json(fail('prompt/internal', detail));
      }
    },
  });
  ctx.effect(() => unregister, 'workdsh.prompts.fetch');
}
