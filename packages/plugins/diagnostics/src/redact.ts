/**
 * 导出期脱敏：把诊断日志里旧版本遗留的明文凭据在写入 ZIP 前打码。
 *
 * 规则与 `packages/bundle/src/http-log.ts` 的 `redactText` / `redactUrl` 保持一致
 * （同一份敏感词表与字面量正则），并有用例做逐字节对齐校验，避免两边漂移。
 * 与 `createRuntimeOutputRedactor` 不同：这里不丢行——超过 16 KB 的单行照原样保留，
 * 只替换命中的凭据，保证诊断包里的超长行仍可用于排查。
 */
import { createReadStream } from 'node:fs'
import { StringDecoder } from 'node:string_decoder'

/** 名称里出现这些「独立词」就视为敏感；按 `-` `_` `.` 与 camelCase 边界切词，避免误伤 keyword、prompt_tokens。 */
const SECRET_WORDS = new Set([
  'token', 'password', 'passwd', 'pwd', 'secret', 'authorization', 'cookie', 'credential', 'credentials',
  'signature', 'sign', 'apikey', 'key', 'accesskey', 'secretkey', 'privatekey', 'sessionkey', 'appkey',
])
/** 令牌字面量：`sk-` 开头的 key、JWT、Bearer 头。 */
const SECRET_LITERAL = /\b(?:sk-[A-Za-z0-9_-]{8,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b|(Bearer\s+)[^\s,;'"]+/gu
const REDACTED = '[redacted]'
/** URLSearchParams 会把方括号编码掉；输出时还原成可读的 `[redacted]`。 */
const ENCODED_REDACTED = '%5Bredacted%5D'
/** 行内 URL：遇到空白、引号、尖括号、分隔符即结束；保留方括号，否则已打码的 `token=[redacted]` 会被二次拼接。 */
const URL_TOKEN = /\bhttps?:\/\/[^\s"'<>(),;]+/gu
/** 单次产出的字节上限，避免单行极大时构造超大字符串。 */
const EMIT_BYTES = 64 * 1024

/** 切词：`accessToken` → access / token，`api-key` → api / key。 */
const nameWords = (name: string): readonly string[] =>
  name.split(/[-_.]/u).flatMap(part => part.split(/(?<=[a-z0-9])(?=[A-Z])/u)).map(part => part.toLowerCase()).filter(Boolean)

/** 头部名、字段名、查询参数名是否属于敏感项。 */
export function isSecretName(name: string): boolean {
  return nameWords(name).some(word => SECRET_WORDS.has(word))
}

/** 令牌字面量打码。 */
export function redactText(value: string): string {
  return value.replace(SECRET_LITERAL, (match, bearer: string | undefined) => (bearer ? `${bearer}${REDACTED}` : REDACTED))
}

/** URL 里的敏感 query 值打码；解析失败时退化为字面量打码。 */
export function redactUrl(value: string): string {
  try {
    const url = new URL(value)
    for (const [name] of url.searchParams) if (isSecretName(name)) url.searchParams.set(name, REDACTED)
    return redactText(url.toString()).replaceAll(ENCODED_REDACTED, REDACTED)
  } catch {
    return redactText(value)
  }
}

/** 单行脱敏：先按 URL 处理 query，再扫字面量；不改动其它字符。 */
export function redactLogLine(line: string): string {
  return redactText(line.replace(URL_TOKEN, match => redactUrl(match)))
}

/**
 * 逐行流式脱敏一个日志文件。
 *
 * 按 `\n` 切行、跨 chunk 保留残余，`\r\n` 与末尾无换行的情况都原样保留；
 * 中间用 `StringDecoder` 处理跨 chunk 的多字节字符，不做整文件读入。
 */
export async function* redactLogFile(path: string, signal?: AbortSignal): AsyncGenerator<Uint8Array> {
  const decoder = new StringDecoder('utf8')
  let carry = ''
  for await (const chunk of createReadStream(path)) {
    if (signal?.aborted === true) return
    carry += decoder.write(chunk as Buffer)
    const parts = carry.split('\n')
    carry = parts.pop() ?? ''
    let out = ''
    for (const part of parts) {
      out += `${redactLogLine(part)}\n`
      if (out.length >= EMIT_BYTES) {
        yield Buffer.from(out, 'utf8')
        out = ''
      }
    }
    if (out.length > 0) yield Buffer.from(out, 'utf8')
  }
  carry += decoder.end()
  if (carry.length > 0) yield Buffer.from(redactLogLine(carry), 'utf8')
}
