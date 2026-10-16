/**
 * 调试用 HTTP 日志（仅 `environment=dev`）。
 *
 * 把 Host 进程的全部出站请求与响应写入 `<目录>/host-http-YYYY-MM-DD.log`，用于现场排查
 * （MCP 握手、市场/后台接口、模型调用都在这一层）。默认关闭：prod 下本模块不会被安装，
 * 一个字节都不落盘。正文一律截断，令牌类字段与头部打码，避免把凭据写进磁盘。
 *
 * 形态：一行请求、一行响应（同一个 `#序号` 便于并发请求配对），正文为原始 JSON-RPC / JSON。
 * 写文件失败、目录不可写、达到体积上限都静默降级，绝不影响请求本身。
 */
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

/** 单条正文的截断长度（字符）：协议问题看头部与结构足够，完整提示词/大响应不进日志。 */
const MAX_BODY_CHARS = 4 * 1024
/** 响应体超过这个字节数就不读正文（下载类响应不把内存与磁盘撑爆）。 */
const MAX_RESPONSE_BODY_BYTES = 512 * 1024
/** 单个日志文件上限（字节），超过后本次运行不再写入。 */
const MAX_FILE_BYTES = 32 * 1024 * 1024
/** 名称里出现这些「独立词」就视为敏感：按 `-` `_` `.` 与 camelCase 边界切词，避免误伤 keyword、prompt_tokens 这类普通字段。 */
const SECRET_WORDS = new Set([
  'token', 'password', 'passwd', 'pwd', 'secret', 'authorization', 'cookie', 'credential', 'credentials',
  'signature', 'sign', 'apikey', 'key', 'accesskey', 'secretkey', 'privatekey', 'sessionkey', 'appkey',
])
/** 令牌字面量：`sk-` 开头的 key、JWT、Bearer 头。 */
const SECRET_LITERAL = /\b(?:sk-[A-Za-z0-9_-]{8,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b|(Bearer\s+)[^\s,;'"]+/gu
const REDACTED = '***'
/** 进程级安装标记。 */
const INSTALLED = Symbol.for('workdsh.httpLog')

type LogScope = typeof globalThis & { [INSTALLED]?: () => void }
type Writer = (text: string) => void

/** 切词：`accessToken` → access / token，`api-key` → api / key。 */
const nameWords = (name: string): readonly string[] =>
  name.split(/[-_.]/u).flatMap(part => part.split(/(?<=[a-z0-9])(?=[A-Z])/u)).map(part => part.toLowerCase()).filter(Boolean)

/** 头部名、正文字段名、查询参数名是否属于敏感项。 */
export function isSecretName(name: string): boolean {
  return nameWords(name).some(word => SECRET_WORDS.has(word))
}

const stamp = (): string => {
  const now = new Date()
  const pad = (value: number, width = 2): string => String(value).padStart(width, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${pad(now.getMilliseconds(), 3)}`
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
    return redactText(url.toString())
  } catch {
    return redactText(value)
  }
}

/** 头部逐项输出：敏感头部只留名字。 */
export function redactHeaders(headers: Headers): string {
  const rows: string[] = []
  headers.forEach((value, name) => { rows.push(`${name}=${isSecretName(name) ? REDACTED : redactText(value)}`) })
  return rows.length ? rows.join(', ') : '(无)'
}

/**
 * 正文脱敏：JSON 按字段名打码（含嵌套对象）；非 JSON 只做字面量打码。
 * 解析失败、循环引用等情况直接退回文本处理，绝不抛错。
 */
export function redactBody(body: string): string {
  const trimmed = body.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return redactText(body)
  try {
    return JSON.stringify(JSON.parse(body), (key, value: unknown) => {
      if (isSecretName(key)) return REDACTED
      return typeof value === 'string' ? redactText(value) : value
    }) ?? redactText(body)
  } catch {
    return redactText(body)
  }
}

/** 截断到上限并标注原始长度。 */
export function truncateBody(body: string): string {
  if (body.length <= MAX_BODY_CHARS) return body
  return `${body.slice(0, MAX_BODY_CHARS)}…[已截断，原始 ${body.length} 字符]`
}

/** 归一化请求头：fetch 允许 Headers / 记录 / 数组三种形态。 */
function requestHeaders(init: RequestInit | undefined): Headers {
  const headers = new Headers()
  const raw = init?.headers
  if (!raw) return headers
  if (raw instanceof Headers) return new Headers(raw)
  if (Array.isArray(raw)) for (const [name, value] of raw) headers.set(name, value)
  else for (const [name, value] of Object.entries(raw)) if (typeof value === 'string') headers.set(name, value)
  return headers
}

const requestUrl = (input: RequestInfo | URL): string =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url

/** 错误链：`fetch failed` 这类外层信息没有价值，把 cause 一起打出来。 */
function errorLines(error: unknown): string[] {
  const lines: string[] = []
  const seen = new Set<string>()
  let current: unknown = error
  while (current instanceof Error && lines.length < 8) {
    const text = `${current.name}: ${current.message}`
    if (!seen.has(text)) { seen.add(text); lines.push(`  ${lines.length ? 'cause: ' : 'error: '}${redactText(text)}`) }
    current = current.cause
  }
  return lines.length ? lines : [`  error: ${redactText(String(error))}`]
}

/** 按天滚动、带上限、写失败不外抛的追加器。 */
function createWriter(directory: string): Writer {
  let date = ''
  let bytes = 0
  let capped = false
  let broken = false
  let file = ''
  return (text: string): void => {
    if (broken || capped) return
    const today = stamp().slice(0, 10)
    if (date !== today) {
      date = today
      file = join(directory, `host-http-${today}.log`)
      bytes = 0
    }
    try {
      mkdirSync(directory, { recursive: true })
      appendFileSync(file, text)
    } catch (error) {
      broken = true
      process.stderr.write(`[workdsh:http-log] 写入失败，已停止记录：${String(error)}\n`)
      return
    }
    bytes += Buffer.byteLength(text)
    if (bytes > MAX_FILE_BYTES) {
      capped = true
      try { appendFileSync(file, `[workdsh:http-log] 单文件已达上限 ${MAX_FILE_BYTES} 字节，本次运行不再写入\n`) } catch { /* 已降级 */ }
    }
  }
}

/** 响应详情按原样补记（异步读 clone，不阻塞调用方）。 */
async function describeResponse(id: number, response: Response, startedAt: number, write: Writer): Promise<void> {
  const contentType = response.headers.get('content-type') ?? ''
  const media = contentType.split(';')[0]?.trim().toLowerCase() ?? ''
  const contentLength = Number(response.headers.get('content-length') ?? '')
  const lines = [
    `[${stamp()}] #${id} <- ${response.status}${media ? ` ${media}` : ''} · ${Date.now() - startedAt}ms`,
    `  headers: ${redactHeaders(response.headers)}`,
  ]
  if (media === 'text/event-stream') lines.push('  body: (text/event-stream 流式响应，不记录正文)')
  else if (media && !media.startsWith('text/') && media !== 'application/json' && !media.endsWith('+json'))
    lines.push('  body: (非文本响应，不记录正文)')
  else if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BODY_BYTES)
    lines.push(`  body: (响应体 ${contentLength} 字节，超过 ${MAX_RESPONSE_BODY_BYTES}，不记录正文)`)
  else lines.push(`  body: ${truncateBody(redactBody(await response.clone().text()))}`)
  write(`${lines.join('\n')}\n`)
}

/**
 * 安装出站 HTTP 日志并返回卸载函数。`directory` 不存在时会被创建。
 * 已经安装过时返回空卸载函数：包装归第一个安装方所有。
 */
export function installHttpLog(directory: string): () => void {
  const scope = globalThis as LogScope
  if (scope[INSTALLED]) return () => undefined
  const original = globalThis.fetch
  const write = createWriter(directory)
  let serial = 0
  const patched: typeof fetch = async (input, init) => {
    const id = ++serial
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
    const url = requestUrl(input)
    const startedAt = Date.now()
    const lines = [`[${stamp()}] #${id} -> ${method} ${redactUrl(url)}`, `  headers: ${redactHeaders(requestHeaders(init))}`]
    if (typeof init?.body === 'string' && init.body) lines.push(`  body: ${truncateBody(redactBody(init.body))}`)
    write(`${lines.join('\n')}\n`)
    try {
      const response = await original(input, init)
      // 不 await：响应体读取在后台上补记，不延迟调用方（尤其流式响应）。
      void describeResponse(id, response, startedAt, write).catch(() => undefined)
      return response
    } catch (error) {
      write([`[${stamp()}] #${id} !! ${method} ${redactUrl(url)} · ${Date.now() - startedAt}ms`, ...errorLines(error)].join('\n') + '\n')
      throw error
    }
  }
  scope.fetch = patched
  const uninstall = () => {
    if (scope.fetch === patched) scope.fetch = original
    delete scope[INSTALLED]
  }
  scope[INSTALLED] = uninstall
  return uninstall
}

/**
 * 从 Host 进程环境读取调试日志目录：只有 carrier 明确下发 `WORKDSH_ENVIRONMENT=dev`
 * 时才启用；缺日志目录时退回 `$DSH_HOME/logs`。
 */
export function debugLogDirectory(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env.WORKDSH_ENVIRONMENT !== 'dev') return undefined
  const directory = env.WORKDSH_LOG_DIR?.trim()
  if (directory) return directory
  const home = env.DSH_HOME?.trim()
  return home ? join(home, 'logs') : undefined
}
