import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { downloadInstaller } from '../src/update-download.ts'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function workspace(): Promise<{ root: string, destination: string }> {
  const root = await mkdtemp(join(tmpdir(), 'workdsh-download-test-'))
  roots.push(root)
  return { root, destination: join(root, 'app', '1.0.1', 'setup.exe') }
}

function streamOf(...chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    },
  })
}

function bodyResponse(body: Uint8Array, size = body.byteLength): Response {
  return new Response(streamOf(body), {
    status: 200,
    headers: { 'Content-Length': String(size) },
  })
}

it('streams the installer to disk and verifies its digest', async () => {
  const { destination } = await workspace()
  const body = Buffer.from('installer-bytes-'.repeat(128))
  const digest = createHash('sha256').update(body).digest('hex')
  const progress: number[] = []
  const fetchImpl = (async () => bodyResponse(body)) as typeof fetch

  const result = await downloadInstaller({
    url: 'http://mirror.test/setup.exe',
    destination,
    size: body.byteLength,
    sha256: digest,
    fetch: fetchImpl,
    freeBytes: async () => Number.MAX_SAFE_INTEGER,
    onProgress: percent => progress.push(percent),
  })

  expect(result).toEqual({ ok: true })
  expect((await readFile(destination)).equals(body)).toBe(true)
  expect(progress.at(-1)).toBe(100)
})

it('rejects a body whose digest does not match', async () => {
  const { destination } = await workspace()
  const body = Buffer.from('tampered')
  const result = await downloadInstaller({
    url: 'http://mirror.test/setup.exe',
    destination,
    size: body.byteLength,
    sha256: 'a'.repeat(64),
    fetch: (async () => bodyResponse(body)) as typeof fetch,
    freeBytes: async () => Number.MAX_SAFE_INTEGER,
  })
  expect(result).toEqual({ ok: false, failure: 'hash-mismatch' })
  await expect(readFile(destination)).rejects.toThrow()
})

it('rejects a body shorter than the declared size', async () => {
  const { destination } = await workspace()
  const body = Buffer.from('short')
  const result = await downloadInstaller({
    url: 'http://mirror.test/setup.exe',
    destination,
    size: body.byteLength + 10,
    sha256: 'a'.repeat(64),
    fetch: (async () => bodyResponse(body, body.byteLength + 10)) as typeof fetch,
    freeBytes: async () => Number.MAX_SAFE_INTEGER,
  })
  expect(result).toEqual({ ok: false, failure: 'size-mismatch' })
})

it('rejects a mismatched content-length before reading the body', async () => {
  const { destination } = await workspace()
  const body = Buffer.from('bytes')
  const result = await downloadInstaller({
    url: 'http://mirror.test/setup.exe',
    destination,
    size: body.byteLength,
    sha256: 'a'.repeat(64),
    fetch: (async () => bodyResponse(body, body.byteLength + 1)) as typeof fetch,
    freeBytes: async () => Number.MAX_SAFE_INTEGER,
  })
  expect(result).toEqual({ ok: false, failure: 'size-mismatch' })
})

it('reports HTTP failures and insufficient disk space', async () => {
  const { destination } = await workspace()
  const notFound = (async () => new Response('missing', { status: 404 })) as typeof fetch
  await expect(downloadInstaller({
    url: 'http://mirror.test/setup.exe',
    destination,
    size: 10,
    sha256: 'a'.repeat(64),
    fetch: notFound,
    freeBytes: async () => Number.MAX_SAFE_INTEGER,
  })).resolves.toEqual({ ok: false, failure: 'http-status' })

  await expect(downloadInstaller({
    url: 'http://mirror.test/setup.exe',
    destination,
    size: 10,
    sha256: 'a'.repeat(64),
    fetch: (async () => bodyResponse(Buffer.from('0123456789'))) as typeof fetch,
    freeBytes: async () => 0,
  })).resolves.toEqual({ ok: false, failure: 'disk-insufficient' })
})

it('cancels before starting when the caller signal is already aborted', async () => {
  const { destination } = await workspace()
  const controller = new AbortController()
  controller.abort()
  const result = await downloadInstaller({
    url: 'http://mirror.test/setup.exe',
    destination,
    size: 10,
    sha256: 'a'.repeat(64),
    signal: controller.signal,
    fetch: (async () => bodyResponse(Buffer.from('0123456789'))) as typeof fetch,
    freeBytes: async () => Number.MAX_SAFE_INTEGER,
  })
  expect(result).toEqual({ ok: false, failure: 'cancelled' })
})

it('times out when the connection stalls longer than the idle timeout', async () => {
  const { destination } = await workspace()
  const hanging = ((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => {
      const error = new Error('aborted')
      error.name = 'AbortError'
      reject(error)
    })
  })) as typeof fetch

  const result = await downloadInstaller({
    url: 'http://mirror.test/setup.exe',
    destination,
    size: 10,
    sha256: 'a'.repeat(64),
    idleTimeoutMs: 20,
    fetch: hanging,
    freeBytes: async () => Number.MAX_SAFE_INTEGER,
  })
  expect(result).toEqual({ ok: false, failure: 'timeout' })
})
