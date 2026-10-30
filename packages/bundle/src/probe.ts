import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-client-connection';
import type {} from '@deepseek-ai/dsh-tools';
import type {} from '@deepseek-ai/dsh-agent';
import type {} from '@deepseek-ai/dsh-attachment';
import type {} from '@deepseek-ai/dsh-system-prompt';
import { registerBrowserView } from './browser-view.js';
import { installFeedbackForwarder } from './feedback.js';
import { debugLogDirectory, installHttpLog } from './http-log.js';

/** Product diagnostics only. Feature packages are installed as separate Profile layers. */
export const name = 'workdsh-installation-probe';
export const inject = ['connection', 'tools', 'agents', 'attachments', 'systemPrompt'];

export function apply(ctx: Context): void {
  registerBrowserView(ctx);
  // 反馈上报：官方弹窗只写会话日志，这里把同一条 feedback/record 转发到后台管理接口。
  installFeedbackForwarder(ctx);
  // 调试日志（仅 workdsh-app.json 的 environment=dev）：出站 HTTP 落到日志目录，
  // 与载体写入的 Host 原始输出放在同一个目录，现场一次性收集即可。
  const logDirectory = debugLogDirectory();
  if (logDirectory) {
    process.stdout.write(`[workdsh:http-log] enabled -> ${logDirectory}\n`);
    ctx.effect(() => installHttpLog(logDirectory), 'workdsh.http-log');
  }
  ctx.effect(() => ctx.systemPrompt.section({
    name: 'workdsh:browser-in-sidebar',
    order: ctx.systemPrompt.getSectionOrder('TOOL_REPORT'),
    text: 'For website browsing and page interaction in WorkDSH, use the available Playwright MCP browser tools. They keep the live Agent Session page visible and operable in the right sidebar. Use native computer control for other desktop apps, or when the user explicitly asks to operate an existing external browser. Do not launch a separate visible system browser for an ordinary website task.',
  }), 'workdsh.browser-view.prompt');
  ctx.effect(() => {
    process.stdout.write('[workdsh:probe] activated\n');
    return () => process.stdout.write('[workdsh:probe] disposed\n');
  });
}
