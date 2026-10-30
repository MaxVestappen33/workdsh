import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import type {} from '@deepseek-ai/dsh-client-ui-slots';
import { createPromptClient } from './client/management.js';
import { PromptPicker } from './client/PromptPicker.js';

export const name = 'workdsh-prompts-client';
export const inject = ['slots'];

/**
 * Client 入口：在会话输入框工具行注册「提示词」入口。
 * 位置沿用原技能弹层的 order 40，插入复用官方 inputActions，保留用户已有草稿。
 */
export function apply(ctx: Context): void {
  const lifetime = new AbortController();
  ctx.effect(() => () => lifetime.abort(), 'workdsh.prompts.client');
  const prompts = createPromptClient(lifetime.signal);
  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left', id: 'workdsh-prompt-picker', order: 40,
    inject: () => ({ prompts }),
  }, PromptPicker));
}
