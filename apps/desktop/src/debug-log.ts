/**
 * Host 原始输出日志（dev 与 prod 都会写）。
 *
 * 打包后的 GUI 应用没有终端，Host 进程的 stdout/stderr 原本直接丢弃：官方插件记录的
 * 「连接失败的真实原因」这类日志在客户机上无法获取。这里把 Host 的原始输出按天追加到
 * userData/logs 下的 `host-output-YYYY-MM-DD.log`，用于现场排查；不包裹 console、不改动任何输出行为。
 *
 * 写入用同步追加：日志量有限，且异常退出时也要保证已经写下的内容（尤其是最后一条错误）落盘。
 * 单文件上限 8 MB：按天滚动，超限后本次运行不再写入并留一行说明；上限按文件实际大小判断，
 * 因此同一天多次启动也不会把单个文件写超。写入失败、目录不可写都不影响应用运行，只静默降级。
 * 落盘内容由调用方脱敏（Host 原始输出先过 `redactRuntimeOutput`）。
 * 保留期：`pruneDebugLogs` 按 mtime 删除超过 24 小时的文件，避免客户机上无限累积。
 */
import { appendFileSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

/** 单文件上限：超过后停止写入并留一条说明，避免长期运行把磁盘写满。 */
const MAX_FILE_BYTES = 8 * 1024 * 1024
/** 默认保留时长：只留最近 24 小时，超出即从客户机删除，避免历史日志无限累积。 */
const MAX_AGE_MS = 24 * 60 * 60 * 1000
/** 日志目录总量兜底：过期清理后仍超这个体积，就从最旧的受管日志继续删。 */
const MAX_TOTAL_BYTES = 32 * 1024 * 1024

export interface DebugLog {
  /** 追加一段文本；内部按天切换文件。 */
  write(chunk: string): void
}

/** 本地日期与时间；文件名用日期。 */
function localDate(): string {
  const now = new Date()
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/** 当天文件已有字节数；读不到按 0 处理，不让上限判断阻断正常写入。 */
function existingBytes(file: string): number {
  try {
    return statSync(file).size
  } catch {
    return 0
  }
}

/**
 * 按天滚动、写失败不外抛的追加式文件日志，文件名 `<prefix>-YYYY-MM-DD.log`。
 */
export function createDebugLog(directory: string, prefix: string): DebugLog {
  let date = ''
  let file = ''
  let bytes = 0
  let capped = false
  let broken = false

  /** 确保当天的文件可用；日期变化时切换到新文件。 */
  const prepare = (): string | undefined => {
    if (broken || capped) return undefined
    const today = localDate()
    if (date === today) return file
    date = today
    file = join(directory, `${prefix}-${today}.log`)
    bytes = existingBytes(file)
    if (bytes >= MAX_FILE_BYTES) {
      capped = true
      try { appendFileSync(file, `[debug-log] 单文件已达上限 ${MAX_FILE_BYTES} 字节，本次运行不再写入 ${prefix} 日志\n`) } catch { /* 已降级 */ }
      return undefined
    }
    const header = `===== ${prefix} ${today} =====\n`
    try {
      mkdirSync(directory, { recursive: true })
      appendFileSync(file, header)
    } catch (error) {
      broken = true
      process.stderr.write(`WorkDSH 调试日志不可用（${directory}）：${String(error)}\n`)
      return undefined
    }
    bytes += Buffer.byteLength(header)
    return file
  }

  return {
    write(chunk: string): void {
      const target = prepare()
      if (!target) return
      try {
        appendFileSync(target, chunk)
      } catch (error) {
        broken = true
        process.stderr.write(`WorkDSH 调试日志写入失败，已停止记录：${String(error)}\n`)
        return
      }
      bytes += Buffer.byteLength(chunk)
      if (bytes > MAX_FILE_BYTES) {
        capped = true
        try { appendFileSync(target, `[debug-log] 单文件已达上限 ${MAX_FILE_BYTES} 字节，本次运行不再写入 ${prefix} 日志\n`) } catch { /* 已降级 */ }
      }
    },
  }
}

/** 过期删除结果：成功的文件名与失败项（失败只记录，不外抛，不阻断启动）。 */
export interface PruneResult {
  /** 被删除的文件名（先过期清理，再总量兜底）。 */
  removed: string[]
  failed: { file: string; error: string }[]
  /** 清理后日志目录的顶层文件总字节数。 */
  remainingBytes: number
  /** 兜底删完受管日志后仍超预算（此时只剩非受管文件）。 */
  budgetExceeded: boolean
}

/** 由本应用写出的按天轮转日志前缀；新增同类日志只在这里加一项。 */
export const DAILY_LOG_PREFIXES = ['host-output', 'host-http', 'process-cleanup', 'update'] as const

/** runtime-failure* 文件名形态（与诊断包采集同一正则）。 */
const RUNTIME_FAILURE_NAME = /^runtime-failure(?:-retry-\d+)?\.log$/u
/** runtime-failure* 数量上限：失败证据只留最近这么多份，多出的按最旧优先删。 */
const MAX_RUNTIME_FAILURE_FILES = 20

/**
 * 清理按天轮转的日志，三档策略：
 *
 * 1. 过期：`<prefix>-YYYY-MM-DD.log` 按 mtime 早于 `now - maxAgeMs`（默认 24 小时）即删除，
 *    与「诊断包只取最近 24 小时」同一口径。
 * 2. 总量兜底：清理后目录总量仍超过 `maxTotalBytes`（默认 32 MB）时，从最旧的受管日志继续删，
 *    直到回到预算内；非受管文件（`runtime-failure*.log`、`startup-timing.log`、`update-install.log` 等）不参与删除。
 * 3. 失败证据限额：`runtime-failure*.log` 不属于按天轮转，按 mtime 只留最近 `maxRuntimeFailures`（默认 20）份，
 *    多出的最旧优先删除；mtime 最新的那份永不删，避免误删本次刚写入、正要被诊断包采集的文件。
 *
 * 目录不存在、单个文件被占用/无权限都只记录失败项，绝不抛出，因此可在启动路径里直接调用。
 */
export function pruneDebugLogs(
  directory: string,
  {
    prefixes = DAILY_LOG_PREFIXES,
    maxAgeMs = MAX_AGE_MS,
    maxTotalBytes = MAX_TOTAL_BYTES,
    maxRuntimeFailures = MAX_RUNTIME_FAILURE_FILES,
    now = Date.now(),
  }: {
    prefixes?: readonly string[]
    maxAgeMs?: number
    maxTotalBytes?: number
    maxRuntimeFailures?: number
    now?: number
  } = {},
): PruneResult {
  const removed: string[] = []
  const failed: PruneResult['failed'] = []
  let names: string[]
  try {
    names = readdirSync(directory)
  } catch {
    return { removed, failed, remainingBytes: 0, budgetExceeded: false }
  }

  const pattern = /^(.+)-(\d{4}-\d{2}-\d{2})\.log$/u
  /** 受管的按天日志（带大小与 mtime），用于过期与兜底两轮删除。 */
  const managed: { name: string; file: string; size: number; mtime: number }[] = []
  /** 失败证据文件，只做数量限制。 */
  const failures: { name: string; file: string; size: number; mtime: number }[] = []
  let total = 0
  for (const name of names) {
    const file = join(directory, name)
    try {
      const stats = statSync(file)
      if (!stats.isFile()) continue
      total += stats.size
      const match = pattern.exec(name)
      if (match && prefixes.includes(match[1]!)) {
        managed.push({ name, file, size: stats.size, mtime: stats.mtimeMs })
      } else if (RUNTIME_FAILURE_NAME.test(name)) {
        failures.push({ name, file, size: stats.size, mtime: stats.mtimeMs })
      }
    } catch { /* 拿不到元信息的文件不参与清理 */ }
  }

  const drop = (entry: { name: string; file: string; size: number }): boolean => {
    try {
      unlinkSync(entry.file)
      removed.push(entry.name)
      total -= entry.size
      return true
    } catch (error) {
      failed.push({ file: entry.name, error: error instanceof Error ? error.message : String(error) })
      return false
    }
  }

  // 1) 过期清理
  for (const entry of managed) {
    if (now - entry.mtime > maxAgeMs) drop(entry)
  }

  // 2) 失败证据限额：按 mtime 只留最近 N 份；最新一份永不删（可能是本次刚写入、诊断包正要采集的）
  if (failures.length > maxRuntimeFailures) {
    const sorted = failures.slice().sort((a, b) => a.mtime - b.mtime || a.name.localeCompare(b.name))
    const newest = sorted[sorted.length - 1]
    let excess = failures.length - maxRuntimeFailures
    for (const entry of sorted) {
      if (excess <= 0) break
      if (entry === newest) continue
      if (drop(entry)) excess -= 1
    }
  }

  // 3) 总量兜底：只动受管日志，按最旧优先
  let budgetExceeded = false
  if (total > maxTotalBytes) {
    const alive = managed.filter(entry => !removed.includes(entry.name)).sort((a, b) => a.mtime - b.mtime)
    for (const entry of alive) {
      if (total <= maxTotalBytes) break
      drop(entry)
    }
    budgetExceeded = total > maxTotalBytes
  }

  return { removed, failed, remainingBytes: total, budgetExceeded }
}
