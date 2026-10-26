/**
 * 后台“最新版本”接口的响应校验。
 * 对应 GET /desktop-client/queryLatestVersionApp?appId&platform&arch。
 * 只做纯数据判断，不发起请求。
 */
import { compareSemanticVersions, parseSemanticVersion } from './update-version.ts'

/** 更新说明是 Markdown 长文本，按 32 KiB 截断，避免异常响应拖垮界面。 */
export const MAX_RELEASE_NOTES_LENGTH = 32 * 1024
/** 安装包体积上限（2 GiB）：既防误传大文件，也给磁盘检查一个绝对边界。 */
export const MAX_INSTALLER_BYTES = 2 * 1024 * 1024 * 1024
const MAX_URL_LENGTH = 2048
const MAX_TEXT_LENGTH = 64
const MAX_RELEASE_TYPE_LENGTH = 32

export interface ReleaseValidationContext {
  readonly appId: string
  readonly platform: string
  readonly arch: string
  /** 后台返回相对下载路径时用于补全；接口当前返回绝对地址。 */
  readonly baseUrl?: string
}

/** 后台版本表对客户端暴露的最小字段集合；其余字段（部门、创建人等）不进入客户端。 */
export interface ClientRelease {
  readonly appId: string
  readonly version: string
  /** 版本类型标签（stable/beta/alpha…），只用于展示，不参与更新流过滤。 */
  readonly releaseType: string
  readonly platform: string
  readonly arch: string
  readonly downloadUrl: string
  readonly size: number
  readonly sha256: string
  readonly mandatory: boolean
  readonly notes?: string
  readonly publishedAt?: string
  readonly minimumVersion?: string
  readonly sequence?: number
}

/** 真正参与下载与安装的候选信息；由 release 与当前版本共同推导。 */
export interface UpdateCandidate {
  readonly version: string
  readonly releaseType: string
  readonly downloadUrl: string
  readonly size: number
  readonly sha256: string
  /** 强制更新：后台标记 mandatory，或当前版本低于 minimumVersion。 */
  readonly mandatory: boolean
  readonly notes?: string
  readonly publishedAt?: string
}

export type ReleaseRejection =
  | 'not-an-object'
  | 'app-mismatch'
  | 'invalid-version'
  | 'platform-mismatch'
  | 'arch-mismatch'
  | 'invalid-url'
  | 'invalid-size'
  | 'invalid-hash'
  | 'notes-too-long'

export type ReleaseParseResult =
  | { readonly ok: true; readonly release: ClientRelease }
  | { readonly ok: false; readonly reason: ReleaseRejection }

/** 接口信封失败原因：服务端错误与记录非法要区分，便于界面给出不同提示。 */
export type LatestVersionFailureReason = ReleaseRejection | 'invalid-envelope' | 'server-error'

export type LatestVersionParse =
  | { readonly ok: true; readonly release: ClientRelease | null }
  | { readonly ok: false; readonly reason: LatestVersionFailureReason }

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function integer(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : undefined
  if (typeof value === 'string' && /^\d+$/u.test(value)) {
    const parsed = Number(value)
    return Number.isSafeInteger(parsed) ? parsed : undefined
  }
  return undefined
}

/**
 * 后台 `filePath` 目前是 MinIO 绝对地址；同时兼容以 `/` 开头的相对路径，
 * 便于以后改成同域文件服务。
 */
function installerUrl(value: unknown, baseUrl: string | undefined): string | undefined {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_URL_LENGTH) return undefined
  let candidate = value
  if (baseUrl !== undefined && candidate.startsWith('/') && !candidate.startsWith('//')) {
    try {
      candidate = new URL(candidate, baseUrl).href
    } catch {
      return undefined
    }
  }
  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    return undefined
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined
  if (url.username !== '' || url.password !== '') return undefined
  return url.href
}

/** 后台可能给出大写十六进制，统一归一为小写，便于逐字比较。 */
function sha256(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length !== 64 || !/^[0-9a-fA-F]{64}$/u.test(value)) return undefined
  return value.toLowerCase()
}

function releaseSize(value: unknown): number | undefined {
  const parsed = integer(value)
  if (parsed === undefined || parsed <= 0 || parsed > MAX_INSTALLER_BYTES) return undefined
  return parsed
}

function optionalText(value: unknown, limit: number): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string' || value.length > limit) return undefined
  const trimmed = value.trim()
  return trimmed.length === 0 ? undefined : trimmed
}

/** 只接受后台约定的版本类型标签；未知值回退为 stable，避免一条脏标签阻断更新。 */
function releaseType(value: unknown): string {
  if (typeof value !== 'string') return 'stable'
  const normalized = value.trim().toLowerCase()
  if (normalized.length === 0 || normalized.length > MAX_RELEASE_TYPE_LENGTH) return 'stable'
  return /^[a-z][a-z0-9_-]*$/u.test(normalized) ? normalized : 'stable'
}

/** Jeecg 风格的后台可能用 "0"/"1" 字符串表示布尔值。 */
function flag(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true'
}

export function parseClientRelease(value: unknown, context: ReleaseValidationContext): ReleaseParseResult {
  const input = record(value)
  if (input === undefined) return { ok: false, reason: 'not-an-object' }

  const appId = optionalText(input.appId, MAX_TEXT_LENGTH) ?? context.appId
  if (appId !== context.appId) return { ok: false, reason: 'app-mismatch' }
  if (input.platform !== context.platform) return { ok: false, reason: 'platform-mismatch' }
  if (input.arch !== context.arch) return { ok: false, reason: 'arch-mismatch' }

  const version = input.version
  if (typeof version !== 'string' || parseSemanticVersion(version) === undefined) {
    return { ok: false, reason: 'invalid-version' }
  }

  const downloadUrl = installerUrl(input.filePath, context.baseUrl)
  if (downloadUrl === undefined) return { ok: false, reason: 'invalid-url' }
  const size = releaseSize(input.fileSize)
  if (size === undefined) return { ok: false, reason: 'invalid-size' }
  const hash = sha256(input.sha256)
  if (hash === undefined) return { ok: false, reason: 'invalid-hash' }

  const notes = optionalText(input.notes, MAX_RELEASE_NOTES_LENGTH)
  if (input.notes !== undefined && input.notes !== null && notes === undefined) {
    return { ok: false, reason: 'notes-too-long' }
  }
  const publishedAt = optionalText(input.publishedTime, MAX_TEXT_LENGTH)
  const sequence = integer(input.sequence)
  // minimumVersion 写错只影响“强制更新”这一个附加效果，不应连带阻断正常升级。
  const minimumVersion = typeof input.minimumVersion === 'string'
    && parseSemanticVersion(input.minimumVersion) !== undefined
    ? input.minimumVersion
    : undefined

  return {
    ok: true,
    release: {
      appId,
      version,
      releaseType: releaseType(input.releaseType),
      platform: context.platform,
      arch: context.arch,
      downloadUrl,
      size,
      sha256: hash,
      mandatory: flag(input.mandatory),
      ...(notes === undefined ? {} : { notes }),
      ...(publishedAt === undefined ? {} : { publishedAt }),
      ...(minimumVersion === undefined ? {} : { minimumVersion }),
      ...(sequence === undefined ? {} : { sequence }),
    },
  }
}

/**
 * 解析 Jeecg 信封：code=200 且 success!==false 才算成功；result 为 null 表示没有发布记录。
 * HTTP 非 2xx 由调用方在传输层判为失败，不会进入这里。
 */
export function parseLatestVersionResponse(value: unknown, context: ReleaseValidationContext): LatestVersionParse {
  const envelope = record(value)
  if (envelope === undefined) return { ok: false, reason: 'invalid-envelope' }
  if (integer(envelope.code) !== 200) return { ok: false, reason: 'server-error' }
  if (envelope.success === false) return { ok: false, reason: 'server-error' }

  const result = envelope.result
  if (result === null || result === undefined) return { ok: true, release: null }

  const parsed = parseClientRelease(result, context)
  if (!parsed.ok) return { ok: false, reason: parsed.reason }
  return { ok: true, release: parsed.release }
}

export interface ResolvedCandidate {
  readonly candidate: UpdateCandidate
  /** 供界面决定是否允许“稍后”：强制更新时不允许只关闭提示。 */
  readonly forced: boolean
}

/**
 * 把后台记录折算成“是否需要更新”。
 * 只有候选版本严格大于当前版本才返回结果；相等、更旧、版本非法一律不提示。
 */
export function resolveCandidate(currentVersion: string, release: ClientRelease): ResolvedCandidate | undefined {
  const current = parseSemanticVersion(currentVersion)
  const target = parseSemanticVersion(release.version)
  if (current === undefined || target === undefined) return undefined
  if (compareSemanticVersions(target, current) <= 0) return undefined

  const minimum = release.minimumVersion === undefined ? undefined : parseSemanticVersion(release.minimumVersion)
  const forced = release.mandatory || (minimum !== undefined && compareSemanticVersions(current, minimum) < 0)

  return {
    candidate: {
      version: release.version,
      releaseType: release.releaseType,
      downloadUrl: release.downloadUrl,
      size: release.size,
      sha256: release.sha256,
      mandatory: forced,
      ...(release.notes === undefined ? {} : { notes: release.notes }),
      ...(release.publishedAt === undefined ? {} : { publishedAt: release.publishedAt }),
    },
    forced,
  }
}
