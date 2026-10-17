import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import type {} from '@deepseek-ai/dsh-client-ui-settings/client';
import type {} from '@deepseek-ai/dsh-client-ui-slots';
import { ModelMarketPanel } from './client/ModelMarketPanel.js';

export const name = 'workdsh-model-market-client';
export const inject = ['slots'];

/** Client 入口：在设置导航中紧跟「模型」注册独立市场页。 */
export function apply(ctx: Context): void {
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'workdsh-model-market',
    label: '模型市场',
    order: 11,
  }, ModelMarketPanel));
}
