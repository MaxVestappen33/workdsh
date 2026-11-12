/** 资产闸门插件入口：只登记宿主服务，判定逻辑全部在纯函数与独立模块中。 */
import type { Context } from '@deepseek-ai/cordis';
import { installAssetGateEnforcement } from './enforcement.js';
import { AssetGateService, type AssetGateOptions } from './service.js';

export * from './audit.js';
export * from './backend.js';
export * from './decider.js';
export * from './enforcement.js';
export * from './errors.js';
export * from './policy.js';
export * from './policy-store.js';
export * from './reasons.js';
export * from './revocation.js';
export * from './service.js';
export * from './snapshot.js';
export * from './snapshot-store.js';
export * from './types.js';

export const name = 'workdsh-plugin-asset-gate';

/**
 * Host 入口。
 *
 * 调用期拦截（工具 + 技能消息）在这里安装，但注册与否由生效闸门决定：
 * 闸门关闭时不注册任何监听器，开闸由 `workdsh/asset-gate/policy` 事件即时拉起。
 */
export function apply(ctx: Context, options: AssetGateOptions = {}): void {
  ctx.plugin(AssetGateService, options);
  // 等服务就绪后再安装执行层：此时能读到本地强制策略，服务重载时也会自动重装。
  ctx.inject(['workdshAssetGate'], (inner) => {
    inner.effect(() => installAssetGateEnforcement(inner), 'workdsh.assetGate.enforcement');
  });
}
