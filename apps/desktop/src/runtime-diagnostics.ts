import { StringDecoder } from 'node:string_decoder';

/** Bounded, credential-redacted diagnostics for GUI-only runtime startup failures. */
export function redactRuntimeOutput(text: string): string {
  return text
    .replace(/([?&](?:token|key|api_key|access_token)=)[^\s&]+/giu, '$1[redacted]')
    .replace(/\bsk-[a-z0-9_-]+/giu, '[redacted]')
    .replace(/(Bearer\s+)\S+/giu, '$1[redacted]')
    .replace(/((?:["']?)(?:bootstrapToken|apiKey|password|accessToken|authorization)(?:["']?)\s*[:=]\s*)["']?[^\s,"'}]+["']?/giu, '$1[redacted]');
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
  const diagnostic = redactRuntimeOutput(output).trim().slice(-4000);
  return [cause, diagnostic ? `最近的运行输出：\n${diagnostic}` : '没有取得运行输出，请检查插件版本和 Profile 配置。',
    ...(cleanupFailed ? ['另外，本机工具进程停止尚未确认，请退出后检查。'] : [])].join('\n\n');
}
