import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client';
import type {} from '@deepseek-ai/dsh-client-ui-slots';
import { BRAND } from './generated/brand.js';
import { HeroBrandMark, SidebarBrandMark, SidebarBrandName, SidebarToggleBadge } from './client/components.js';

export const name = 'workdsh-brand-client';
export const inject = ['slots'];

/**
 * HeroShell 接缝在渲染时读取的全局。
 * Web boot 会先 `await` 完所有 Loader 条目再调用 `uiRenderer.mount`，
 * 因此这里的同步赋值一定发生在首帧渲染之前，官方「探索未至之境」不会先闪一下。
 */
const BRAND_GLOBAL = '__WORKDSH_BRAND__';

export function apply(ctx: Context): void {
  const scope = globalThis as Record<string, unknown>;
  const previous = scope[BRAND_GLOBAL];
  scope[BRAND_GLOBAL] = BRAND;
  ctx.effect(() => () => {
    if (previous === undefined) delete scope[BRAND_GLOBAL];
    else scope[BRAND_GLOBAL] = previous;
  }, 'workdsh.brand.hero-config');

  // `slots.inject` 自身就是一次 `ctx.effect`：槽声明消失或插件卸载时，
  // 它注册的 occupant 会被立刻销毁，官方 fallback 原样回归。
  ctx.slots.inject('sidebar.brand.mark', () => ctx.slots.register(
    { name: 'sidebar.brand.mark', priority: -10 }, SidebarBrandMark));
  ctx.slots.inject('sidebar.brand.name', () => ctx.slots.register(
    { name: 'sidebar.brand.name', priority: -10 }, SidebarBrandName));
  ctx.slots.inject('sidebar.toggle.badge', () => ctx.slots.register(
    { name: 'sidebar.toggle.badge', priority: -10 }, SidebarToggleBadge));
  ctx.slots.inject('conversation.hero.brand.mark', () => ctx.slots.register(
    { name: 'conversation.hero.brand.mark', priority: -10 }, HeroBrandMark));
}
