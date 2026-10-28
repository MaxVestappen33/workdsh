import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { installerFileName, installerPathFor, UpdateService } from '../src/update-service.ts'
import type { UpdateSnapshot } from '../src/update-state.ts'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'workdsh-update-service-'))
  roots.push(root)
  return root
}

const installerBody = Buffer.from('fake-installer-'.repeat(64))
const installerSha = createHash('sha256').update(installerBody).digest('hex')

function envelope(result: unknown): Record<string, unknown> {
  return { code: 200, message: '', result, success: true, timestamp: 1 }
}

function release(version: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    appId: 'police-assistant',
    arch: 'x64',
    filePath: 'http://mirror.test/api/download/setup.exe',
    fileSize: installerBody.byteLength,
    mandatory: '0',
    minimumVersion: null,
    notes: '## 更新内容\n\n- 修复问题',
    platform: 'win32',
    publishedTime: '2026-10-26 22:17:13',
    releaseType: 'Stable',
    sequence: 1,
    sha256: installerSha,
    status: 'published',
    version,
    ...overrides,
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function bodyResponse(body: Uint8Array): Response {
  const bytes = new Uint8Array(body.byteLength)
  bytes.set(body)
  return new Response(bytes.buffer, { status: 200, headers: { 'Content-Length': String(bytes.byteLength) } })
}

function downloadFetch(body: Uint8Array = installerBody): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('queryLatestVersionApp')) return jsonResponse(envelope(release('1.0.1')))
    return bodyResponse(body)
  }) as typeof fetch
}

interface Harness {
  readonly service: UpdateService
  readonly snapshots: UpdateSnapshot[]
  readonly installed: { version: string, path: string }[]
  readonly root: string
}

function harness(options: {
  fetch?: typeof fetch
  currentVersion?: string
  skipped?: string
  onInstall?: (candidate: { version: string }, path: string) => Promise<void>
} = {}): Harness {
  const snapshots: UpdateSnapshot[] = []
  const installed: { version: string, path: string }[] = []
  let skipped = options.skipped
  const root = roots.at(-1)!
  const service = new UpdateService({
    baseUrl: 'http://mirror.test/api',
    appId: 'police-assistant',
    platform: 'win32',
    arch: 'x64',
    currentVersion: options.currentVersion ?? '1.0.0',
    downloadDirectory: root,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    freeBytes: async () => Number.MAX_SAFE_INTEGER,
    onState: snapshot => snapshots.push(snapshot),
    onInstall: async (candidate, path) => {
      installed.push({ version: candidate.version, path })
      if (options.onInstall !== undefined) await options.onInstall(candidate, path)
    },
    skippedVersion: () => skipped,
    rememberSkipped: version => { skipped = version },
  })
  return { service, snapshots, installed, root }
}

it('stores the macOS payload as a ZIP so the app can replace itself in place', () => {
  expect(installerFileName('darwin')).toBe('update.zip')
  expect(installerFileName('win32')).toBe('setup.exe')
  expect(installerPathFor('/updates', '1.0.1', 'darwin')).toBe(join('/updates', 'app', '1.0.1', 'update.zip'))
  expect(installerPathFor('/updates', '1.0.1', 'win32')).toBe(join('/updates', 'app', '1.0.1', 'setup.exe'))
})

it('checks, downloads, verifies and hands the installer to the main process', async () => {
  await workspace()
  const h = harness({ fetch: downloadFetch() })
  await h.service.check(true)
  expect(h.service.snapshot.phase).toBe('available')
  expect(h.service.snapshot.candidate?.version).toBe('1.0.1')
  expect(h.service.snapshot.candidate?.releaseType).toBe('stable')

  await h.service.download()
  expect(h.service.snapshot.phase).toBe('ready')
  const installer = installerPathFor(h.root, '1.0.1', 'win32')
  expect(existsSync(installer)).toBe(true)
  expect((await stat(installer)).size).toBe(installerBody.byteLength)

  await h.service.install()
  expect(h.service.snapshot.phase).toBe('installing')
  expect(h.installed).toEqual([{ version: '1.0.1', path: installer }])
  expect(h.snapshots.map(snapshot => snapshot.phase)).toContain('downloading')
  expect(h.snapshots.map(snapshot => snapshot.phase)).toContain('verifying')
})

it('stays idle when the backend offers the current version', async () => {
  await workspace()
  const h = harness({ currentVersion: '1.0.1', fetch: downloadFetch() })
  await h.service.check(false)
  expect(h.service.snapshot.phase).toBe('idle')
  expect(h.snapshots.map(snapshot => snapshot.phase)).toEqual(['checking', 'idle'])
})

it('does not re-prompt an automatic check for a skipped version, but shows it on manual check', async () => {
  await workspace()
  const h = harness({ fetch: downloadFetch(), skipped: '1.0.1' })
  await h.service.check(false)
  expect(h.service.snapshot.phase).toBe('idle')

  await h.service.check(true)
  expect(h.service.snapshot.phase).toBe('available')

  await h.service.dismiss()
  expect(h.service.snapshot.phase).toBe('idle')

  await h.service.check(false)
  expect(h.service.snapshot.phase).toBe('idle')
})

it('surfaces a manual check failure with a stable failure code', async () => {
  await workspace()
  const offline = (async () => { throw new TypeError('fetch failed') }) as typeof fetch
  const h = harness({ fetch: offline })
  await h.service.check(true)
  expect(h.service.snapshot).toMatchObject({
    phase: 'error',
    manual: true,
    failure: { operation: 'check', code: 'network' },
  })
})

it('reports a digest mismatch as a download failure and keeps the candidate', async () => {
  await workspace()
  const h = harness({ fetch: downloadFetch(Buffer.from('x'.repeat(installerBody.byteLength))) })
  await h.service.check(true)
  await h.service.download()
  expect(h.service.snapshot).toMatchObject({
    phase: 'error',
    candidate: { version: '1.0.1' },
    failure: { operation: 'download', code: 'hash-mismatch' },
  })
})

it('cancelling an in-flight download returns to available and removes the partial file', async () => {
  await workspace()
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('queryLatestVersionApp')) return jsonResponse(envelope(release('1.0.1')))
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(installerBody.subarray(0, 8))
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('aborted')
          error.name = 'AbortError'
          controller.error(error)
        })
      },
    })
    return new Response(stream, { status: 200, headers: { 'Content-Length': String(installerBody.byteLength) } })
  }) as typeof fetch
  const h = harness({ fetch: fetchImpl })
  await h.service.check(true)
  const downloading = h.service.download()
  await new Promise(resolve => setTimeout(resolve, 20))
  expect(h.service.snapshot.phase).toBe('downloading')
  await h.service.cancel()
  await downloading
  expect(h.service.snapshot.phase).toBe('available')
  expect(existsSync(`${installerPathFor(h.root, '1.0.1', 'win32')}.part`)).toBe(false)
})

it('reports an install failure and allows a retry from ready', async () => {
  await workspace()
  const h = harness({
    fetch: downloadFetch(),
    onInstall: async () => { throw new Error('spawn failed') },
  })
  await h.service.check(true)
  await h.service.download()
  await h.service.install()
  expect(h.service.snapshot).toMatchObject({
    phase: 'error',
    failure: { operation: 'install', code: 'installer-failed' },
  })
  await h.service.retry()
  expect(h.service.snapshot.phase).toBe('ready')
})
