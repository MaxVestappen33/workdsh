import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-client-connection';
import { registerPromptConnection } from './connection-api.js';
import { PromptService, type PromptOptions } from './service.js';

export * from './shared.js';
export * from './market.js';
export * from './service.js';
export { registerPromptConnection } from './connection-api.js';

export const name = 'workdsh-plugin-prompts';
export const inject = ['connection'];

/** Host 入口：登记提示词服务与本机连接端点，后台请求全部在 Host 侧完成。 */
export async function apply(ctx: Context, options: PromptOptions = {}): Promise<void> {
  await ctx.plugin(PromptService, options);
  registerPromptConnection(ctx);
}
