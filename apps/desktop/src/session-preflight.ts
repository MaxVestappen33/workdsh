import { existsSync, lstatSync, readdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 启动前的会话状态预检。
 *
 * 现场问题：Windows 上长时间使用后，官方 Host 在恢复会话时抛
 * `RangeError: Maximum call stack size exceeded`（cordis 代理 set 陷阱自递归，
 * 见 runtime-diagnostics/runtimeCrashHint），而官方把任何 unhandledRejection 当致命
 * 错误直接退出。这里在拉起 Host 之前做三件互不破坏数据的事：
 *
 * 1. 给 Host 多留一点栈余量（`--stack-size`）：恢复折算是深度优先的，
 *    V8 默认约 984KB，2MB 不改变语义，只在极深链时才用得上。
 * 2. 搬开“病态”的会话投影缓存（`storages/session_projcache*`）：它是可重建的缓存，
 *    超过体积预算就改名留档，官方会按会话日志重新折叠，避免单个超大缓存把启动拖垮。
 * 3. 只告警不改动：超过阈值的会话日志（`sessions/<工作区>/<会话>/session.*.jsonl.zstd`）
 *    原样保留并记一行现场，下次崩溃时能直接把“这台机器上有个几百 MB 的会话”对上号。
 *
 * 所有动作都失败关闭：任何异常只记一行，绝不阻断启动，也绝不删除用户数据。
 */

/** 投影缓存单条记录上限（超过这条记录一次折叠就会吃掉大量内存与栈）。 */
export const MAX_PROJECTION_RECORD_BYTES = 32 * 1024 * 1024
/** 投影缓存整个域的预算（按记录存放时的总量）。 */
export const MAX_PROJECTION_CACHE_BYTES = 256 * 1024 * 1024
/** 旧版单文件投影缓存的上限，与官方 Desktop 既有阈值一致。 */
export const MAX_LEGACY_PROJECTION_CACHE_BYTES = 128 * 1024 * 1024
/** 会话日志告警阈值：超过就记一行现场（不改动文件）。 */
export const MAX_SESSION_LOG_BYTES = 128 * 1024 * 1024
/** Host 栈上限默认值（KB）：V8 默认约 984，翻倍只增加深链余量。 */
export const HOST_STACK_SIZE_KB = 2048

const STORAGE_DIR = 'storages'
const SESSIONS_DIR = 'sessions'
const PROJECTION_DOMAIN = 'session_projcache'
const PROJECTION_RECORDS_DIR = 'sessions'
const LEGACY_PROJECTION_FILE = 'session_projcache.json'
/** 单次预检最多枚举的目录项：异常目录不至于把启动拖住。 */
const MAX_WALK_ENTRIES = 20_000

export interface QuarantinedCache {
  /** 被搬开的位置（原路径）。 */
  readonly path: string
  /** 搬开前的大小。 */
  readonly bytes: number
  /** 留档后的路径，可用于人工恢复。 */
  readonly backupPath: string
}

export interface OversizedSessionLog {
  readonly path: string
  readonly bytes: number
}

export interface SessionPreflightResult {
  /** 已搬开的投影缓存（缓存可重建，原文件被改名留档而不是删除）。 */
  readonly quarantined: readonly QuarantinedCache[]
  /** 超过阈值的会话日志，只作为现场线索上报。 */
  readonly oversizedSessions: readonly OversizedSessionLog[]
  /** 预检本身的异常（不影响启动）。 */
  readonly error?: string
}

export interface SessionPreflightOptions {
  readonly now?: () => Date
  readonly maxProjectionRecordBytes?: number
  readonly maxProjectionCacheBytes?: number
  readonly maxLegacyProjectionCacheBytes?: number
  readonly maxSessionLogBytes?: number
  /** `false` 时只检测不搬（支持现场临时关掉自动搬移）。 */
  readonly relocate?: boolean
}

const stamp = (now: () => Date): string => now().toISOString().replace(/[:.]/gu, '-')

/** 目录/文件大小；拿不到元信息时按 0 计，不参与判断。 */
function sizeOf(path: string): number {
  try {
    const stats = lstatSync(path)
    if (!stats.isDirectory()) return stats.size
    let total = 0
    let seen = 0
    const pending = [path]
    while (pending.length > 0 && seen < MAX_WALK_ENTRIES) {
      const current = pending.pop()!
      let entries: string[]
      try { entries = readdirSync(current) } catch { continue }
      for (const name of entries) {
        seen += 1
        if (seen > MAX_WALK_ENTRIES) break
        const child = join(current, name)
        try {
          const childStats = lstatSync(child)
          if (childStats.isDirectory()) pending.push(child)
          else total += childStats.size
        } catch { /* 拿不到元信息的项不计 */ }
      }
    }
    return total
  } catch { return 0 }
}

/** 改名留档；跨设备等改名失败时记错误并放弃（不做复制+删除，避免半成品）。 */
function quarantine(path: string, bytes: number, now: () => Date, result: { quarantined: QuarantinedCache[], error?: string }): void {
  const backupPath = `${path}.oversized-${stamp(now)}`
  try {
    renameSync(path, backupPath)
    result.quarantined.push({ path, bytes, backupPath })
  } catch (error) {
    result.error = `投影缓存搬移失败：${path}（${error instanceof Error ? error.message : String(error)}）`
  }
}

/** 单个投影缓存记录超限：只搬这两类“病态”记录，不动正常会话的缓存。 */
function quarantineOversizedRecords(recordsDir: string, maxBytes: number, now: () => Date, result: { quarantined: QuarantinedCache[], error?: string }): void {
  let names: string[]
  try { names = readdirSync(recordsDir) } catch { return }
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    const path = join(recordsDir, name)
    const bytes = sizeOf(path)
    if (bytes <= maxBytes) continue
    quarantine(path, bytes, now, result)
  }
}

/** 会话日志：只枚举 `sessions/<工作区>/<会话>/` 两层，按大小排序取前几条现场。 */
function inspectSessionLogs(home: string, maxBytes: number): OversizedSessionLog[] {
  const root = join(home, SESSIONS_DIR)
  const oversized: OversizedSessionLog[] = []
  let workspaces: string[]
  try { workspaces = readdirSync(root) } catch { return oversized }
  for (const workspace of workspaces) {
    const workspaceDir = join(root, workspace)
    let sessions: string[]
    try { sessions = readdirSync(workspaceDir) } catch { continue }
    for (const session of sessions) {
      const sessionDir = join(workspaceDir, session)
      let files: string[]
      try { files = readdirSync(sessionDir) } catch { continue }
      for (const file of files) {
        if (!file.startsWith('session.') || file.endsWith('.lock')) continue
        const path = join(sessionDir, file)
        try {
          const stats = lstatSync(path)
          if (stats.isFile() && stats.size > maxBytes) oversized.push({ path, bytes: stats.size })
        } catch { /* 拿不到元信息就跳过 */ }
      }
    }
  }
  return oversized.sort((left, right) => right.bytes - left.bytes).slice(0, 5)
}

/**
 * 执行启动前预检。绝不抛错：返回值里 `error` 只用于记一行诊断，
 * 调用方照常拉起 Host。
 */
export function runSessionPreflight(home: string, options: SessionPreflightOptions = {}): SessionPreflightResult {
  const now = options.now ?? (() => new Date())
  const relocate = options.relocate ?? true
  const result: { quarantined: QuarantinedCache[], error?: string } = { quarantined: [] }
  try {
    const storages = join(home, STORAGE_DIR)
    if (relocate) {
      const legacy = join(storages, LEGACY_PROJECTION_FILE)
      const legacyBytes = sizeOf(legacy)
      if (legacyBytes > (options.maxLegacyProjectionCacheBytes ?? MAX_LEGACY_PROJECTION_CACHE_BYTES)) quarantine(legacy, legacyBytes, now, result)

      const domain = join(storages, PROJECTION_DOMAIN)
      if (existsSync(domain)) {
        const domainBytes = sizeOf(domain)
        if (domainBytes > (options.maxProjectionCacheBytes ?? MAX_PROJECTION_CACHE_BYTES)) quarantine(domain, domainBytes, now, result)
        else quarantineOversizedRecords(join(domain, PROJECTION_RECORDS_DIR), options.maxProjectionRecordBytes ?? MAX_PROJECTION_RECORD_BYTES, now, result)
      }
    }
    return {
      quarantined: result.quarantined,
      oversizedSessions: inspectSessionLogs(home, options.maxSessionLogBytes ?? MAX_SESSION_LOG_BYTES),
      ...(result.error === undefined ? {} : { error: result.error }),
    }
  } catch (error) {
    return {
      quarantined: result.quarantined,
      oversizedSessions: [],
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

const mib = (bytes: number): string => `${(bytes / (1024 * 1024)).toFixed(1)}MB`

/** 一行现场摘要；没有需要说明的情况时返回 undefined，日常启动不产生噪声。 */
export function sessionPreflightSummary(result: SessionPreflightResult): string | undefined {
  const parts: string[] = []
  for (const item of result.quarantined) parts.push(`投影缓存已搬开留档 ${item.path}（${mib(item.bytes)} → ${item.backupPath}）`)
  if (result.oversizedSessions.length > 0) {
    const biggest = result.oversizedSessions[0]!
    parts.push(`超长会话日志 ${result.oversizedSessions.length} 个，最大 ${mib(biggest.bytes)}：${biggest.path}`)
  }
  if (result.error !== undefined) parts.push(`会话预检未完成：${result.error}`)
  return parts.length === 0 ? undefined : parts.join('；')
}

/** 现场开关：`WORKDSH_SESSION_PREFLIGHT=off` 只检测不搬。 */
export function sessionPreflightEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.WORKDSH_SESSION_PREFLIGHT?.trim().toLowerCase() !== 'off'
}

/** Host 栈上限（KB）：`WORKDSH_HOST_STACK_SIZE` 可覆盖，限制在 512–8192 之间避免启动即崩。 */
export function hostStackSizeKb(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.WORKDSH_HOST_STACK_SIZE ?? '')
  if (!Number.isFinite(raw) || raw <= 0) return HOST_STACK_SIZE_KB
  return Math.min(8192, Math.max(512, Math.round(raw)))
}

/**
 * Host 进程的 node 参数。栈参数必须排在启动脚本之前才会被 node 自己消费，
 * 官方 launcher 仍按 `process.argv.slice(2)` 拿到原来的 `--no-open`。
 */
export function hostNodeArguments(launcher: string, extra: readonly string[] = ['--no-open'], env: NodeJS.ProcessEnv = process.env): string[] {
  return [`--stack-size=${hostStackSizeKb(env)}`, launcher, ...extra]
}
