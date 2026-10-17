import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-client-connection';
import type {} from '@deepseek-ai/dsh-credentials';
import { registerModelMarketConnection } from './connection-api.js';
import { ModelMarketService, type ModelMarketOptions } from './service.js';

export * from './shared.js';
export * from './market.js';
export * from './service.js';
export { registerModelMarketConnection } from './connection-api.js';

export const name = 'workdsh-plugin-model-market';
export const inject = ['connection', 'credentials', 'settings'];

/** Host 入口：登记市场服务与本机连接端点，安装/卸载全部在 Host 侧完成。 */
export async function apply(ctx: Context, options: ModelMarketOptions = {}): Promise<void> {
  await ctx.plugin(ModelMarketService, options);
  registerModelMarketConnection(ctx);
}
