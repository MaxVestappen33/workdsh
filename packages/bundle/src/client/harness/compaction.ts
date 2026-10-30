import type { Context } from '@deepseek-ai/cordis';
import type { SessionIdOf } from '@deepseek-ai/dsh-client-ui-slots';
import type {} from '@deepseek-ai/dsh-client-connection/client';
import type {} from '@deepseek-ai/dsh-api-remotes/client';
import type {} from '@deepseek-ai/dsh-api-session-controller/client';

/** 一次手动压缩请求对界面可见的结果。 */
export type CompactionOutcome =
  | { readonly kind: 'compacted'; readonly items: number; readonly tokens: number }
  | { readonly kind: 'empty' }
  | { readonly kind: 'busy' }
  | { readonly kind: 'failed'; readonly reason: string };

/** 官方 `/compact` 的成功文案：`Compacted 12 history items (~3456 tokens).` */
const COMPACTED = /^Compacted (\d+) history items(?: \(~(\d+) tokens\))?\.$/u;
/** 没有可安全压缩的较早历史时的成功文案。 */
const NOTHING_TO_COMPACT = 'No compactable history yet.';

/**
 * 手动压缩走官方宿主命令，界面不实现第二套压缩逻辑：
 * `command.execute` 的返回值就是 `dsh-command-compact` 给出的结果，
 * 这里只把它折算成按钮可显示的形态。
 */
export async function requestCompaction(ctx: Context, sessionId: SessionIdOf): Promise<CompactionOutcome> {
  let response;
  try {
    response = await ctx.remote.commands.execute(sessionId, '/compact', []);
  } catch (cause) {
    return { kind: 'failed', reason: cause instanceof Error ? cause.message : String(cause) };
  }
  if (!response.ok) return { kind: 'failed', reason: response.error.message };
  const result = (response.value as { result?: { kind?: string; text?: string } } | undefined)?.result;
  // 未匹配到命令：会话没有接受这一行，按失败处理，不谎报已压缩。
  if (result === undefined) return { kind: 'failed', reason: '会话未接受压缩命令' };
  const text = result.text ?? '';
  if (result.kind !== 'success') {
    // 语义固定但文案属于官方实现：压缩进行中或智能体非空闲时报告不可用。
    return /unavailable because/u.test(text) ? { kind: 'busy' } : { kind: 'failed', reason: text };
  }
  if (text.startsWith(NOTHING_TO_COMPACT)) return { kind: 'empty' };
  const matched = COMPACTED.exec(text);
  // 成功但文案结构变化时仍报告已压缩，只是给不出精确数字。
  if (matched === null) return { kind: 'compacted', items: 0, tokens: 0 };
  return { kind: 'compacted', items: Number(matched[1]), tokens: Number(matched[2] ?? 0) };
}
