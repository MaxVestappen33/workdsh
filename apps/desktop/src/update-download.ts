/** 安装包下载：流式写盘、边下边算 sha256、进度、取消与磁盘检查。 */
import { createHash } from 'node:crypto'
import { mkdir, open, rename, rm, statfs } from 'node:fs/promises'
import { dirname } from 'node:path'

export type DownloadFailure =
  | 'network'
  | 'timeout'
  | 'http-status'
  | 'size-mismatch'
  | 'hash-mismatch'
  | 'disk-insufficient'
  | 'write-failed'
  | 'cancelled'

export interface DownloadInstallerOptions {
  readonly url: string
  readonly destination: string
  readonly size: number
  readonly sha256: string
  /** 连续无数据多久判定超时；默认 60 秒（大文件允许慢，但不应长时间静止）。 */
  readonly idleTimeoutMs?: number
  /** 下载后仍需保留的空闲空间；默认 256 MiB。 */
  readonly reserveBytes?: number
  readonly fetch?: typeof fetch
  readonly signal?: AbortSignal
  /** 测试注入点；默认读取目标目录所在卷的空闲字节数。 */
  readonly freeBytes?: (directory: string) => Promise<number>
  readonly onProgress?: (percent: number) => void
}

export type DownloadInstallerResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly failure: DownloadFailure }

const DEFAULT_IDLE_TIMEOUT_MS = 60_000
const DEFAULT_RESERVE_BYTES = 256 * 1024 * 1024

class DownloadAbort extends Error {
  constructor(readonly failure: 'size-mismatch' | 'hash-mismatch' | 'write-failed') {
    super(failure)
  }
}

async function availableBytes(directory: string): Promise<number> {
  try {
    const info = await statfs(directory)
    return Number(info.bavail) * Number(info.bsize)
  } catch {
    // 无法读取磁盘信息时不阻断下载；最终仍由写入失败兜底。
    return Number.POSITIVE_INFINITY
  }
}

export async function downloadInstaller(options: DownloadInstallerOptions): Promise<DownloadInstallerResult> {
  const fetchImpl = options.fetch ?? fetch
  const reserve = options.reserveBytes ?? DEFAULT_RESERVE_BYTES
  const idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS
  const free = options.freeBytes ?? availableBytes
  const part = `${options.destination}.part`

  if (options.signal?.aborted === true) return { ok: false, failure: 'cancelled' }

  try {
    await mkdir(dirname(options.destination), { recursive: true })
    await rm(part, { force: true })
    const available = await free(dirname(options.destination))
    if (available < options.size + reserve) return { ok: false, failure: 'disk-insufficient' }
  } catch {
    return { ok: false, failure: 'write-failed' }
  }

  const controller = new AbortController()
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  let cancelled = false
  const resetIdle = (): void => {
    if (idleTimer !== undefined) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => controller.abort(), idleTimeoutMs)
  }
  const forwardAbort = (): void => {
    cancelled = true
    controller.abort()
  }
  options.signal?.addEventListener('abort', forwardAbort, { once: true })

  try {
    resetIdle()
    const response = await fetchImpl(options.url, {
      method: 'GET',
      signal: controller.signal,
      redirect: 'follow',
      // 禁止内容压缩，保证 Content-Length 与字节数一致。
      headers: { 'Accept-Encoding': 'identity' },
    })
    if (!response.ok) return { ok: false, failure: 'http-status' }
    const declared = Number(response.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > 0 && declared !== options.size) {
      return { ok: false, failure: 'size-mismatch' }
    }
    if (response.body === null) return { ok: false, failure: 'network' }

    const handle = await open(part, 'w', 0o600)
    const hash = createHash('sha256')
    let received = 0
    let reported = -1
    try {
      const reader = response.body.getReader()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (value === undefined || value.byteLength === 0) continue
        received += value.byteLength
        if (received > options.size) throw new DownloadAbort('size-mismatch')
        try {
          let offset = 0
          while (offset < value.byteLength) {
            const { bytesWritten } = await handle.write(value, offset, value.byteLength - offset)
            if (bytesWritten <= 0) throw new Error('short write')
            offset += bytesWritten
          }
        } catch {
          throw new DownloadAbort('write-failed')
        }
        hash.update(value)
        resetIdle()
        const percent = Math.min(100, Math.floor((received / options.size) * 100))
        if (percent !== reported) {
          reported = percent
          try {
            options.onProgress?.(percent)
          } catch {
            // 进度回调属于界面层，失败不应中断下载。
          }
        }
      }
      await handle.sync()
    } finally {
      await handle.close()
    }

    if (received !== options.size) throw new DownloadAbort('size-mismatch')
    if (hash.digest('hex') !== options.sha256.toLowerCase()) throw new DownloadAbort('hash-mismatch')

    await rm(options.destination, { force: true })
    await rename(part, options.destination)
    return { ok: true }
  } catch (error) {
    await rm(part, { force: true }).catch(() => undefined)
    if (error instanceof DownloadAbort) return { ok: false, failure: error.failure }
    if (controller.signal.aborted) {
      return { ok: false, failure: cancelled ? 'cancelled' : 'timeout' }
    }
    return { ok: false, failure: 'network' }
  } finally {
    if (idleTimer !== undefined) clearTimeout(idleTimer)
    options.signal?.removeEventListener('abort', forwardAbort)
  }
}
