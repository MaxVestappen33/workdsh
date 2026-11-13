import { Zip, ZipDeflate, strToU8 } from 'fflate'

/** 一条 ZIP 条目：文本、整块二进制或分块流（大附件走流式，避免整包进内存）。 */
export interface ZipEntry {
  path: string
  content?: string
  data?: Uint8Array
  chunks?: AsyncIterable<Uint8Array>
}

/**
 * 把条目序列写成 ZIP 流。条目按产出顺序写入，压缩等级沿用官方默认 6。
 * 只在消费端拉取时才继续产出，避免大附件把整个包堆在内存里。
 */
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
