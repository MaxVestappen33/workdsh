import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-client-connection';
import type {} from '@deepseek-ai/dsh-credentials';
import { registerModelMarketConnection } from './connection-api.js';
import { ModelMarketService, type ModelMarketOptions } from './service.js';
import type { ModelAuthorizationState } from './shared.js';

export * from './shared.js';
export * from './market.js';
export * from './service.js';
export { registerModelMarketConnection } from './connection-api.js';

export const name = 'workdsh-plugin-model-market';
export const inject = ['connection', 'credentials', 'settings'];

/** 调用期拒绝文案：与用户确认的口径一致，不做二次拼接。 */
const MODEL_AUTH_DENIED_MESSAGE = '授权已失效，请重新申请。';

/** `agent/request` 的最小结构面：只用到最终 provider/model 与中断信号。 */
interface RequestConfigLike {
  readonly provider?: unknown;
  readonly model?: unknown;
}
interface RequestEventHost {
  on(
    name: 'agent/request',
    handler: (payload: { readonly signal: AbortSignal }, next: () => Promise<RequestConfigLike>) => Promise<RequestConfigLike>,
  ): () => void;
}

/** 调用期判定需要的最小服务面：单测据此注入桩，不依赖完整宿主。 */
interface AuthorizationLookup {
  authorizationOf(provider: string, model: string, signal?: AbortSignal): Promise<ModelAuthorizationState>;
}

/**
 * 构造 `agent/request` 监听：最终 provider/model 确定后判定授权，
 * 明确未授权即抛错拦截；unknown（取不到状态）与自建模型一律放行。
 */
export function modelRequestGuard(
  market: AuthorizationLookup,
  warn: (message: string) => void = () => {},
): (payload: { readonly signal: AbortSignal }, next: () => Promise<RequestConfigLike>) => Promise<RequestConfigLike> {
  return async (payload, next) => {
    const config = await next();
    if (payload.signal.aborted) return config;
    const provider = typeof config.provider === 'string' ? config.provider : '';
    const model = typeof config.model === 'string' ? config.model : '';
    if (!provider || !model) return config;
    let state: ModelAuthorizationState = 'unknown';
    try {
      state = await market.authorizationOf(provider, model, payload.signal);
    } catch (error) {
      // 判定异常同样是「取不到授权状态」：放行，只记日志。
      warn(`模型：授权状态判定失败（${provider}/${model}）：${error instanceof Error ? error.message : String(error)}。`);
    }
    if (state !== 'unauthorized') return config;
    throw new Error(MODEL_AUTH_DENIED_MESSAGE);
  };
}

/** Host 入口：登记市场服务与本机连接端点，安装/卸载全部在 Host 侧完成。 */
export async function apply(ctx: Context, options: ModelMarketOptions = {}): Promise<void> {
  await ctx.plugin(ModelMarketService, options);
  registerModelMarketConnection(ctx);
  // 一次性回填：为旧安装记录补写安装清单。幂等、失败不阻断启动，只记日志与条数。
  // 服务由子 Fiber 注册，父 Fiber 未声明 inject，用 ctx.inject 等它就绪后再读。
  ctx.inject(['workdshModelMarket'], host => {
    void host.workdshModelMarket.backfillInstallManifests().then(result => {
      if (result.written || result.failed) {
        host.logger.info(`模型：安装清单回填完成（扫描 ${result.scanned}，写入 ${result.written}，失败 ${result.failed}）。`);
      }
    }).catch(error => {
      host.logger.warn(`模型：安装清单回填中断：${error instanceof Error ? error.message : String(error)}。`);
    });

    // 调用期拦截：模型请求发出前校验市场模型的授权，撤销后立即拒绝。
    // 用户自建/导入模型由服务返回 authorized，完全不受影响；
    // 取不到授权状态（后台不可用）时按上次已知结论或放行处理，不因网络抖动挡人。
    host.effect(() => {
      const events = host as unknown as RequestEventHost;
      return events.on('agent/request', modelRequestGuard(
        host.workdshModelMarket,
        message => host.logger.warn(message),
      ));
    }, 'workdsh.modelMarket.requestGuard');
  });
}
