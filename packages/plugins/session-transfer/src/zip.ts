/**
 * ZIP 流式打包与解包。
 *
 * - 打包：沿用 packages/plugins/diagnostics/src/zip.ts 的 fflate 流式实现
 *   （Zip + ZipDeflate + desiredSize 背压），Host 不把整包堆进内存。
 * - 解包：把上传字节先落到临时 .zip 文件，再用 Unzip 分块 push；每个成员
 *   的 ondata 直接同步写盘（fd），内存占用恒等于单个 chunk。
 *
 * 只允许 deflate(8) 与 store(0)，拒绝加密/未知压缩方式；含 zip-slip 与
 * 解压后总字节上限（压缩炸弹）校验。
 */

import {
  closeSync, createReadStream, createWriteStream, mkdirSync, openSync, rmSync, writeSync,
} from 'node:fs'
import { once } from 'node:events'
import { join } from 'node:path'
import type { WriteStream } from 'node:fs'
import {
  Unzip, UnzipInflate, UnzipPassThrough, Zip, ZipDeflate, strToU8,
  type UnzipFile,
} from 'fflate'
import { LIMITS } from './constants.js'
import { checkMember, stripCommonWrapper } from './paths.js'

// ---------------------------------------------------------------------------
// 打包
// ---------------------------------------------------------------------------

export interface ZipEntry {
  path: string
  content?: string
  data?: Uint8Array
  chunks?: AsyncIterable<Uint8Array>
}

/** 把条目序列写成 ZIP 流，只在消费端拉取时继续产出。 */
export function zipStream(
  entries: AsyncIterable<ZipEntry>,
  { level = 6, signal }: { level?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9; signal?: AbortSignal } = {},
): ReadableStream<Uint8Array> {
  let release: (() => void) | undefined
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const waitForPull = (): Promise<void> => {
        if ((controller.desiredSize ?? 1) > 0) return Promise.resolve()
        return new Promise<void>((resolve) => {
          release = resolve
          signal?.addEventListener('abort', () => resolve(), { once: true })
        })
      }
      const pump = async (): Promise<void> => {
        try {
          const zip = new Zip((error, chunk, final) => {
            if (error) {
              controller.error(error)
              return
            }
            if (chunk.byteLength > 0) controller.enqueue(chunk)
            if (final) controller.close()
          })
          for await (const entry of entries) {
            signal?.throwIfAborted()
            const file = new ZipDeflate(entry.path, { level })
            zip.add(file)
            if (entry.content !== undefined) {
              file.push(strToU8(entry.content), true)
              await waitForPull()
            } else if (entry.data !== undefined) {
              file.push(entry.data, true)
              await waitForPull()
            } else if (entry.chunks !== undefined) {
              const iterator = entry.chunks[Symbol.asyncIterator]()
              let current = await iterator.next()
              if (current.done) {
                file.push(new Uint8Array(0), true)
              } else {
                for (;;) {
                  const next = await iterator.next()
                  file.push(current.value, next.done === true)
                  if (next.done === true) break
                  current = next
                  await waitForPull()
                }
              }
            } else {
              file.push(new Uint8Array(0), true)
            }
          }
          zip.end()
        } catch (error) {
          controller.error(error)
        }
      }
      void pump()
    },
    pull() {
      const pending = release
      release = undefined
      pending?.()
    },
  })
}

// ---------------------------------------------------------------------------
// 上传落盘
// ---------------------------------------------------------------------------

/** 把 Request 的字节流写到临时 .zip 文件，返回写入字节数；超限抛错。 */
export async function writeUploadTo(
  body: ReadableStream<Uint8Array> | null | undefined,
  destination: string,
  signal?: AbortSignal,
): Promise<number> {
  if (body === null || body === undefined) {
    await writeEmpty(destination)
    return 0
  }
  const stream = createWriteStream(destination, { mode: 0o600 })
  let total = 0
  const reader = body.getReader()
  try {
    for (;;) {
      if (signal?.aborted) throw new Error('upload aborted')
      const { done, value } = await reader.read()
      if (done) break
      const chunk = value as Uint8Array
      total += chunk.byteLength
      if (total > LIMITS.maxArchiveBytes) {
        throw new Error(`archive exceeds ${LIMITS.maxArchiveBytes} bytes`)
      }
      if (!stream.write(chunk)) {
        await once(stream, 'drain')
        if (signal?.aborted) throw new Error('upload aborted')
      }
    }
    stream.end()
    await once(stream, 'finish')
  } catch (error) {
    stream.destroy()
    try { rmSync(destination, { force: true }) } catch { /* ignore */ }
    throw error
  }
  return total
}

async function writeEmpty(destination: string): Promise<void> {
  const stream: WriteStream = createWriteStream(destination, { mode: 0o600 })
  stream.end()
  await once(stream, 'finish')
}

// ---------------------------------------------------------------------------
// 解包
// ---------------------------------------------------------------------------

export interface ExtractedMember {
  /** 规范化后的包内相对路径（已剥离可能的顶层包装目录） */
  readonly name: string
  readonly bytes: number
}

export interface ExtractResult {
  /** name → bytes */
  readonly members: ReadonlyMap<string, number>
  /** 剥离的顶层包装目录（若有），不含末尾 `/` */
  readonly wrapper: string
}

interface OpenMember {
  readonly fd: number
  bytes: number
}

/**
 * 把临时 .zip 文件解到 directory。
 *
 * 同步写盘：Unzip.push 是同步驱动的，ondata 回调里直接 writeSync，避免为
 * 每个成员缓存整块内容。每次 push 之间交还事件循环（setImmediate），长任务
 * 不会把 Host 完全卡死。
 */
export async function extractZipTo(
  archivePath: string,
  directory: string,
  options: { signal?: AbortSignal; maxExpandedBytes?: number; maxMembers?: number } = {},
): Promise<ExtractResult> {
  const maxExpanded = options.maxExpandedBytes ?? LIMITS.maxExpandedBytes
  const maxMembers = options.maxMembers ?? LIMITS.maxFileCount + 200
  mkdirSync(directory, { recursive: true, mode: 0o700 })

  const rawNames: string[] = []
  const bytesByName = new Map<string, number>()
  const open = new Map<string, OpenMember>()
  let expandedTotal = 0
  let failure: Error | undefined

  const unzip = new Unzip()
  unzip.register(UnzipInflate)
  unzip.register(UnzipPassThrough)
  unzip.onfile = (file: UnzipFile): void => {
    if (failure !== undefined) return
    const checked = checkMember(file.name)
    if (!checked.safe) {
      failure = new Error(`unsafe member: ${file.name} (${checked.reason ?? 'unknown'})`)
      return
    }
    if (rawNames.length >= maxMembers) {
      failure = new Error('too many members')
      return
    }
    if (file.compression !== 0 && file.compression !== 8) {
      failure = new Error(`unsupported compression: ${file.compression}`)
      return
    }
    const name = checked.normalized
    rawNames.push(name)
    let fd: number
    try {
      const target = joinMember(directory, name)
      fd = openSync(target, 'w', 0o600)
    } catch (error) {
      failure = error instanceof Error ? error : new Error(String(error))
      return
    }
    const state: OpenMember = { fd, bytes: 0 }
    open.set(name, state)
    file.ondata = (error, data, final): void => {
      if (failure !== undefined) return
      if (error !== null) {
        failure = error
        return
      }
      try {
        expandedTotal += data.byteLength
        state.bytes += data.byteLength
        if (expandedTotal > maxExpanded) throw new Error('expanded size exceeds limit')
        if (data.byteLength > 0) writeSync(state.fd, data)
        if (final) {
          closeSync(state.fd)
          open.delete(name)
          bytesByName.set(name, state.bytes)
        }
      } catch (cause) {
        failure = cause instanceof Error ? cause : new Error(String(cause))
      }
    }
    // fflate 的 Unzip 不会自动开始解压：必须显式 start()，否则 ondata 永不触发。
    file.start()
  }

  const stream = createReadStream(archivePath, { highWaterMark: 128 * 1024 })
  try {
    for await (const raw of stream) {
      if (options.signal?.aborted === true) throw new Error('extract aborted')
      if (failure !== undefined) throw failure
      const chunk = raw as Uint8Array
      unzip.push(chunk, false)
      await new Promise<void>((resolve) => setImmediate(resolve))
    }
    unzip.push(new Uint8Array(0), true)
    if (failure !== undefined) throw failure
  } finally {
    stream.destroy()
    for (const state of open.values()) {
      try { closeSync(state.fd) } catch { /* already closed */ }
    }
    open.clear()
  }

  const { prefix } = stripCommonWrapper(rawNames)
  const wrapper = prefix.endsWith('/') ? prefix.slice(0, -1) : ''
  const members = new Map<string, number>()
  for (const [name, bytes] of bytesByName) {
    members.set(wrapper !== '' && name.startsWith(prefix) ? name.slice(prefix.length) : name, bytes)
  }
  return { members, wrapper }
}

/** 成员名 → 临时目录内的本机绝对路径；同时创建父目录。用 path.join 转成本机分隔符（Windows/Linux 一致）。 */
export function joinMember(directory: string, member: string): string {
  const segments = member.split('/')
  const filename = segments.pop() ?? ''
  const parent = segments.length > 0 ? join(directory, ...segments) : directory
  mkdirSync(parent, { recursive: true, mode: 0o700 })
  return join(parent, filename)
}

/** 读取解包目录内某个成员的本机路径。 */
export function memberPath(directory: string, wrapper: string, name: string): string {
  const prefix = wrapper !== '' ? wrapper.split('/') : []
  return join(directory, ...prefix, ...name.split('/'))
}

/** 分块读取本机文件，交给 ZIP 流式写入。 */
export async function* streamFile(path: string): AsyncGenerator<Uint8Array> {
  const stream = createReadStream(path, { highWaterMark: 128 * 1024 })
  for await (const chunk of stream) yield chunk as Uint8Array
}
