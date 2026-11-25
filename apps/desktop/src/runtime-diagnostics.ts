import { StringDecoder } from 'node:string_decoder';

/** Bounded, credential-redacted diagnostics for GUI-only runtime startup failures. */
export function redactRuntimeOutput(text: string): string {
  return text
    .replace(/([?&](?:token|key|api_key|access_token)=)[^\s&]+/giu, '$1[redacted]')
    .replace(/\bsk-[a-z0-9_-]+/giu, '[redacted]')
    .replace(/(Bearer\s+)\S+/giu, '$1[redacted]')
    .replace(/((?:["']?)(?:bootstrapToken|apiKey|password|accessToken|authorization)(?:["']?)\s*[:=]\s*)["']?[^\s,"'}]+["']?/giu, '$1[redacted]');
}

/**
 * 运行日志导出用：在 `redactRuntimeOutput` 之上再覆盖不带 `?`/`&` 的 key=value 形式。
 * 导出的是客户机文件，宁可多脱敏，也不能把凭据带出去。
 */
export function redactRuntimeLogText(text: string): string {
  return redactRuntimeOutput(text)
    .replace(/((?:^|[\s"'`([{,;])(?:token|key|api_key|apiKey|access_token|accessToken|password|passwd|secret|authorization)\s*[=:]\s*)["']?[^\s,"'}]+/gimu, '$1[redacted]');
}

/** Child-process chunks are not credential boundaries. Buffer complete lines
 * before redacting; discard oversized lines instead of emitting a secret prefix. */
export function createRuntimeOutputRedactor(write: (text: string) => void) {
  const decoder = new StringDecoder('utf8');
  let pending = '', oversized = false;
  const consume = (text: string) => {
    for (const part of text.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
      const complete = part.endsWith('\n');
      if (!oversized) {
        if (pending.length + part.length > 16_384) { pending = ''; oversized = true; }
        else pending += part;
      }
      if (complete) {
        write(oversized ? '[runtime output line omitted: size limit]\n' : redactRuntimeOutput(pending));
        pending = ''; oversized = false;
      }
    }
  };
  return {
    push(chunk: Buffer) { consume(decoder.write(chunk)); },
    end() {
      consume(decoder.end());
      if (oversized) write('[runtime output line omitted: size limit]\n');
      else if (pending) write(redactRuntimeOutput(pending));
      pending = ''; oversized = false;
    },
  };
}

export function runtimeFailureDetail(ready: boolean, code: number | null, output: string, cleanupFailed = false): string {
  const cause = ready ? `官方 DSH 进程已退出 (${code})` : `官方 DSH 未能完成启动 (${code})`;
  const diagnostic = redactRuntimeOutput(output).trim();
  const reasons: string[] = [];
  if (/EADDRINUSE/u.test(diagnostic)) {
    const port = diagnostic.match(/(?:127\.0\.0\.1|localhost|\[::1\]):(\d+)/u)?.[1]
      ?? diagnostic.match(/\bport:\s*(\d+)/u)?.[1];
    reasons.push(`本机服务端口${port ? ` ${port}` : ''}已被占用。请关闭此前的 WorkDSH 工作区后重试。`);
  }
  for (const match of diagnostic.matchAll(/Cannot find (?:module|package) ['"]([^'"\n]+)['"]/gu)) {
    if (/^(?:@[\w.-]+\/)?[\w.-]+(?:\/[\w.-]+)*$/u.test(match[1]!)) reasons.push(`缺少运行依赖：${match[1]}。请使用包含完整依赖的安装包。`);
  }
  if (!reasons.length && /\b(?:EACCES|EPERM)\b/u.test(diagnostic)) reasons.push('无法访问运行所需的文件或目录，请检查运行目录的权限。');
  if (!reasons.length && diagnostic) {
    const lines = diagnostic.split('\n').map(line => line.trim()).filter(line => line && !/^(?:at\s|file:\/\/|\[errors\]|[{}[\]])/u.test(line));
    const relevant = lines.filter(line => /\b(?:Error|failed|missing|ENOENT)\b/iu.test(line));
    reasons.push(...(relevant.length ? relevant : lines).slice(0, 3).map(line => line.slice(0, 200)));
  }
  return [cause, reasons.length ? [...new Set(reasons)].slice(0, 3).join('\n') : '没有取得运行输出，请检查插件版本和 Profile 配置。',
    ...(cleanupFailed ? ['另外，本机工具进程停止尚未确认，请退出后检查。'] : [])].join('\n\n');
}

/**
 * Host 就绪之后的异常退出与“启动失败”是两类事件：用户已经看到过界面，
 * 现场需要的是崩溃前的运行输出，而不是启动原因。文件沿用 runtime-failure 前缀，
 * 诊断包采集与按份数清理都能一并覆盖。
 */
export function runtimeCrashLogName(restart: number, now = new Date()): string {
  return `runtime-failure-crash-${logTimestamp(now)}-${restart}.log`
}

/** 文件名用的本地时间戳（精确到毫秒），保证跨启动、同一秒内的多次事件都不会互相覆盖。 */
function logTimestamp(now: Date): string {
  const pad = (value: number, width = 2): string => String(value).padStart(width, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
    + `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}-${pad(now.getMilliseconds(), 3)}`
}

/**
 * 栈溢出（RangeError）在长会话/长运行现场最典型：官方 Host 的调用链或代理链在
 * 恢复历史时增长到超出 V8 栈上限。它可重试（重启后通常能继续工作），
 * 所以提示要指向“重试 + 反馈日志”，而不是让用户以为数据坏了。
 */
export function isStackOverflow(output: string): boolean {
  return /Maximum call stack size exceeded/u.test(output);
}

/** 崩溃提示：只在确实是栈溢出时补一句可执行的说明。 */
export function runtimeCrashHint(output: string): string | undefined {
  if (!isStackOverflow(output)) return undefined;
  return '本机引擎在处理很长的会话或调用链时调用栈溢出（RangeError: Maximum call stack size exceeded）。'
    + '这类退出可自动重启恢复；若反复出现，请把 logs 目录下的 runtime-failure-crash-*.log 与 host-output-*.log 一并反馈。';
}

/** 运行中崩溃的本地记录：保留脱敏后的尾部运行输出，供现场一次性收集。 */
export function runtimeCrashLog(code: number | null, output: string, record: number, restart: number, limit: number): string {
  return [
    new Date().toISOString(),
    `[运行中异常退出] 本机第 ${record} 份崩溃记录`,
    `官方 DSH 进程已退出 (${code})`,
    `自动重启：第 ${restart} / ${limit} 次`,
    ...(runtimeCrashHint(output) ? ['', runtimeCrashHint(output)!] : []),
    '',
    '最近的运行输出：',
    redactRuntimeOutput(output).trim().slice(-16_384),
    '',
  ].join('\n');
}

/**
 * 崩溃后的弹窗文案：保留原有原因归纳，再追加栈溢出说明与本机记录路径。
 * 自动重启全部失败时才会用到它，提示必须能直接交给运维/客服。
 */
export function runtimeCrashDetail(code: number | null, output: string, logPath?: string): string {
  return [
    runtimeFailureDetail(true, code, output),
    ...(runtimeCrashHint(output) ? [runtimeCrashHint(output)!] : []),
    ...(logPath ? [`错误记录：${logPath}`] : []),
  ].join('\n\n');
}

/** 运行中崩溃的自动重启预算：一次异步异常不该让整个软件停用，连续失败才交回用户。 */
export const RUNTIME_RESTART_LIMIT = 3
/** 撑过这段时间就说明上一次重启已经稳定，重启预算重新计数（长运行现场会反复用到）。 */
export const RUNTIME_RESTART_STABLE_MS = 5 * 60_000
const RUNTIME_RESTART_DELAYS_MS = [1_500, 3_000, 6_000] as const

export type RuntimeRestartDecision =
  | { readonly restart: number, readonly delayMs: number }
  | 'give-up'

/**
 * 决定崩溃后是否自动重启。`uptimeMs` 是刚退出的 Host 存活时长：
 * 已经稳定运行过的进程只算一次意外，预算清零后再重启；连续崩溃才逐次加倍等待并最终放弃。
 */
export function planRuntimeRestart(
  uptimeMs: number,
  used: number,
  options: { limit?: number, stableMs?: number, delaysMs?: readonly number[] } = {},
): RuntimeRestartDecision {
  const limit = options.limit ?? RUNTIME_RESTART_LIMIT
  const stableMs = options.stableMs ?? RUNTIME_RESTART_STABLE_MS
  const delays = options.delaysMs ?? RUNTIME_RESTART_DELAYS_MS
  const effective = uptimeMs >= stableMs ? 0 : used
  if (effective >= limit) return 'give-up'
  const restart = effective + 1
  return { restart, delayMs: delays[Math.min(restart - 1, delays.length - 1)] ?? 0 }
}

/** Preserve the bounded redacted trace in the local record, not in a giant alert. */
export function runtimeFailureLog(ready: boolean, code: number | null, output: string, cleanupFailed = false, attempt = 0): string {
  const label = attempt === 0 ? '首次启动' : `第 ${attempt + 1} 次启动（句柄耗尽后重试）`
  return `${new Date().toISOString()}\n[${label}]\n${runtimeFailureDetail(ready, code, output, cleanupFailed)}\n\n最近的运行输出：\n${redactRuntimeOutput(output).trim().slice(-16_384)}\n`;
}

/**
 * 句柄/文件描述符耗尽。Windows 上多为系统级句柄压力（安全软件、大量子进程同时启动），
 * 进程重启通常即可恢复，因此只对这一种失败做一次兜底重试。
 */
const HANDLE_EXHAUSTION = /\b(?:EMFILE|ENFILE)\b/u;

/** 失败输出是否属于句柄耗尽。 */
export function isHandleExhaustion(output: string): boolean {
  return HANDLE_EXHAUSTION.test(output)
}

/** 只对“首次启动 + 句柄耗尽”放行重试；其它失败、以及重试后的再次失败都不再重试。 */
export function shouldRetryStartup(output: string, attempt: number): boolean {
  return attempt === 0 && isHandleExhaustion(output)
}

/** 每次尝试写独立记录：首次失败与重试结果不会互相覆盖。 */
export function startupFailureLogName(attempt: number, now = new Date()): string {
  const stamp = logTimestamp(now)
  return attempt === 0 ? `runtime-failure-${stamp}.log` : `runtime-failure-retry-${stamp}-${attempt}.log`
}

/**
 * 句柄耗尽兜底：先等待一小段时间让回收的子进程释放句柄，再发起一次启动。
 * @param output - 上一次启动的原始输出（未脱敏，仅在本机判断）。
 * @param attempt - 上一次是第几次尝试（从 0 开始）。
 * @param retry - 重新拉起 Host 的动作；调用方负责在里面处理自身的失败。
 * @returns `retried` 表示已发起重试；`stop` 表示交给原有失败弹窗处理。
 */
export async function retryStartupAfterHandleExhaustion(
  output: string,
  attempt: number,
  retry: () => Promise<void>,
  options: { delayMs?: number, log?: (line: string) => void } = {},
): Promise<'retried' | 'stop'> {
  if (!shouldRetryStartup(output, attempt)) return 'stop'
  const delay = options.delayMs ?? 800
  options.log?.(`[startup] 首次启动因句柄耗尽失败（EMFILE/ENFILE），${delay}ms 后重试一次`)
  await new Promise(resolve => setTimeout(resolve, delay))
  await retry()
  return 'retried'
}

export function officialCommandFailureDetail(code: number | null, output: string, cause?: string): string {
  const incompatible = /Plugin (\S+) is incompatible with dsh ([\w.+-]+)/u.exec(output);
  if (incompatible && !cause) {
    return `插件 ${incompatible[1]} 与当前 DSH ${incompatible[2]} 不兼容。\n\n请安装适配当前底座的插件版本。${/restored package\.json, pnpm-lock\.yaml, and node_modules/u.test(output) ? '原有插件清单和依赖已恢复。' : '本次插件更新未完成。'}`;
  }
  const lines = redactRuntimeOutput(output).replace(/\u001b\[[0-9;]*m/gu, '').split('\n')
    .map(line => line.trim()).filter(line => line && !/^(?:at\s|file:\/\/)/u.test(line));
  const errors = lines.filter(line => /(?:ERR_|\bError\b|\bfailed\b|EACCES|EPERM|ENOENT|ENOTFOUND|EAI_AGAIN)/iu.test(line));
  const reasons = (errors.length ? errors : lines).slice(-3).map(line => line.slice(0, 240));
  return [cause ?? `插件依赖更新失败 (${code})`, reasons.length ? reasons.join('\n') : '未取得工具输出，请查看本机错误记录后重试。'].join('\n\n');
}
