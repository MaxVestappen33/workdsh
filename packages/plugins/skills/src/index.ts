import { fileURLToPath } from 'node:url';
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-skill';
import type {} from '@deepseek-ai/dsh-client-connection';
import type {} from '@deepseek-ai/dsh-tools';
import { professionalAuthoringSkills, skillCreatorContent, skillCreatorMeta } from './authoring/professional.js';
import { SkillManager, type SkillManagerOptions } from './services/manager.js';
import { registerSkillManagementConnection } from './services/connection-api.js';
import { registerSkillLifecycleTools } from './services/lifecycle-tools.js';
import { SkillMarketService, type SkillMarketOptions } from './services/market-entry.js';
import { SkillListingService, type SkillListingServiceOptions } from './services/listing-entry.js';

export * from './services/manager.js';
export * from './services/market-entry.js';
export * from './services/listing-entry.js';
export * from './market.js';
export * from './shared.js';
export { registerSkillManagementConnection } from './services/connection-api.js';
export { registerSkillLifecycleTools } from './services/lifecycle-tools.js';

export const name = 'workdsh-plugin-skills';
export const inject = ['skills', 'connection', 'tools'];

export { skillCreatorContent } from './authoring/professional.js';

/** 宿主可选项：本地技能管理 + 技能市场与上架申请的接口路径（未配置时回退到内置默认值）。 */
export interface SkillPluginOptions extends SkillManagerOptions {
  readonly market?: SkillMarketOptions;
  readonly listing?: SkillListingServiceOptions;
}

export function applySkillsHost(ctx: Context, options: SkillPluginOptions = {}): void {
  new SkillManager(ctx, options);
  // 技能市场依赖宿主提供的通用后台通道（workdshBackend）：通道或绑定缺失时市场整体不可用，
  // 不影响插件加载；接口路径由宿主经插件选项注入。
  new SkillMarketService(ctx, options.market ?? {});
  // 上架申请同样依赖通用后台通道：不可用时只是入口不出现，本地技能管理照常工作。
  new SkillListingService(ctx, options.listing ?? {});
  for (const skill of professionalAuthoringSkills) {
    ctx.effect(() => ctx.skills.register({
      ...skill,
      source: 'bundled',
      resourceBase: { kind: 'directory', path: fileURLToPath(new URL(`../resources/skills/${skill.name}/`, import.meta.url)) },
    }));
  }
  registerSkillManagementConnection(ctx);
  registerSkillLifecycleTools(ctx);
  ctx.effect(() => ctx.skills.register({
    ...skillCreatorMeta,
    source: 'bundled',
    content: skillCreatorContent,
    resourceBase: { kind: 'directory', path: fileURLToPath(new URL('../resources/skills/workdsh-skill-creator', import.meta.url)) },
  }));
}

export const apply = applySkillsHost;
