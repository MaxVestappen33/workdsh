/** “最新版本”接口的传输层：一次 GET + 信封解包，不持有状态。 */
import { APP_CONFIG_DEFAULTS } from './app-config.ts'
import {
  parseLatestVersionResponse,
  type ClientRelease,
  type ReleaseRejection,
  type ReleaseValidationContext,
} from './update-release.ts'

/** 接口路径与 server.latestVersionPath 同源，避免在传输层再写一份。 */
export const LATEST_VERSION_PATH = APP_CONFIG_DEFAULTS.server.latestVersionPath
export const DEFAULT_LATEST_VERSION_TIMEOUT_MS = 15_000
/** 版本记录只含短文本，超过 512 KiB 视为异常响应。 */
const MAX_RESPONSE_CHARS = 512 * 1024

export type LatestVersionQueryFailure =
  | ReleaseRejection
  | 'invalid-envelope'
  | 'server-error'
  | 'network'
  | 'timeout'

export type LatestVersionQueryResult =
  | { readonly ok: true; readonly release: ClientRelease | null }
  | { readonly ok: false; readonly reason: LatestVersionQueryFailure }

export interface LatestVersionQuery {
  /** 后台根地址，例如 http://56.82.4.232:3100/ytsj-ai */
  readonly baseUrl: string
  readonly appId: string
  readonly platform: string
  readonly arch: string
  /** 接口路径；默认使用后台约定的 queryLatestVersionApp。 */
  readonly path?: string
  /** 单次请求超时；默认 15 秒。 */
  readonly timeoutMs?: number
  /** 测试注入点；Electron 主进程应传入 net.fetch 以复用系统代理与证书。 */
  readonly fetch?: typeof fetch
}

/** 在后台根路径后追加接口路径，兼容 baseUrl 末尾带不带 `/`。 */
export function latestVersionUrl(query: LatestVersionQuery): URL {
  const base = query.baseUrl.replace(/\/+$/u, '')
  const path = query.path ?? LATEST_VERSION_PATH
  const url = new URL(`${base}${path.startsWith('/') ? path : `/${path}`}`)
  url.searchParams.set('appId', query.appId)
  url.searchParams.set('platform', query.platform)
  url.searchParams.set('arch', query.arch)
  return url
}

function timeoutOrNetwork(error: unknown): 'timeout' | 'network' {
  const name = error instanceof Error ? error.name : ''
  return name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network'
}

export async function queryLatestVersion(query: LatestVersionQuery): Promise<LatestVersionQueryResult> {
  const fetchImpl = query.fetch ?? fetch
  let response: Response
  try {
    response = await fetchImpl(latestVersionUrl(query), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        // 让代理与中间层不要缓存“没有新版本”的结果。
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
      },
      // 检查接口匿名，不携带任何登录态。
      credentials: 'omit',
      redirect: 'follow',
      signal: AbortSignal.timeout(query.timeoutMs ?? DEFAULT_LATEST_VERSION_TIMEOUT_MS),
    })
  } catch (error) {
    return { ok: false, reason: timeoutOrNetwork(error) }
  }

  if (!response.ok) return { ok: false, reason: 'server-error' }

  let text: string
  try {
    text = await response.text()
  } catch {
    return { ok: false, reason: 'network' }
  }
  if (text.length === 0 || text.length > MAX_RESPONSE_CHARS) return { ok: false, reason: 'invalid-envelope' }

  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return { ok: false, reason: 'invalid-envelope' }
  }

  const context: ReleaseValidationContext = {
    appId: query.appId,
    platform: query.platform,
    arch: query.arch,
    baseUrl: query.baseUrl,
  }
  return parseLatestVersionResponse(body, context)
}
