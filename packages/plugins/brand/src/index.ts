import type { Context } from '@deepseek-ai/cordis';

/**
 * Host 半没有业务：品牌配置在编译期固化进产物，不存在按账号存储、RPC 或上传。
 * 保留这个入口只是为了让 Loader 的 `workdsh-brand` 条目能被正常激活——
 * Cordis 要求插件要么是函数、要么带 `apply`，只有 `name` 会被判定为非法插件。
 */
export const name = 'workdsh-plugin-brand';

export function apply(_ctx: Context): void {}
