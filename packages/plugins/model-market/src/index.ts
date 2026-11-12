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
  });
}
