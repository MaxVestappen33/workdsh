/**
 * 调试日志文件（仅 environment=dev 使用）。
 *
 * 打包后的 GUI 应用没有终端，Host 进程的 stdout/stderr 原本直接丢弃：官方插件记录的
 * 「连接失败的真实原因」这类日志在客户机上无法获取。这里把 Host 的原始输出按天追加到
 * userData/logs 下的文件，用于现场排查；不包裹 console、不改动任何输出行为。
 *
 * 写入用同步追加：日志量有限，且异常退出时也要保证已经写下的内容（尤其是最后一条错误）落盘。
 * 写入失败、目录不可写、达到体积上限都不影响应用运行，只静默降级（必要时写 stderr）。
 */
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

/** 单文件上限：超过后停止写入并留一条说明，避免长期运行把磁盘写满。 */
const MAX_FILE_BYTES = 32 * 1024 * 1024

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
    bytes = 0
    try {
      mkdirSync(directory, { recursive: true })
      appendFileSync(file, `===== ${prefix} ${today} =====\n`)
    } catch (error) {
      broken = true
      process.stderr.write(`WorkDSH 调试日志不可用（${directory}）：${String(error)}\n`)
      return undefined
    }
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
