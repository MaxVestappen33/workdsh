import { expect, it } from 'vitest'
import { LATEST_VERSION_PATH, latestVersionUrl, queryLatestVersion } from '../src/update-client.ts'

const baseUrl = 'http://127.0.0.1:18080/ytsj-ai'
const hash = '9f0b882044a983978092b581bd719954617a4a426663cdf56557bd9ac121faff'

function envelope(result: unknown, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { code: 200, message: '', result, success: true, timestamp: 1_793_024_260_189, ...overrides }
}

function record(): Record<string, unknown> {
  return {
    appId: 'police-assistant',
    arch: 'x64',
    filePath: 'http://172.17.236.61:53755/yt-jwai/client-release/setup.exe',
    fileSize: 7_513_142,
    mandatory: '0',
    minimumVersion: '1.0.0',
    notes: '修复若干问题',
    platform: 'win32',
    publishedTime: '2026-10-26 22:17:13',
    releaseType: 'Stable',
    sequence: 1,
    sha256: hash,
    status: 'published',
    version: '3.1.0',
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

it('builds the request URL against the configured base path', () => {
  const url = latestVersionUrl({
    baseUrl: 'http://127.0.0.1:18080/ytsj-ai/',
    appId: 'police-assistant',
    platform: 'win32',
    arch: 'x64',
  })
  expect(url.pathname).toBe(`/ytsj-ai${LATEST_VERSION_PATH}`)
  expect(url.searchParams.get('appId')).toBe('police-assistant')
  expect(url.searchParams.get('platform')).toBe('win32')
  expect(url.searchParams.get('arch')).toBe('x64')
})

it('queries the anonymous endpoint without credentials and parses the record', async () => {
  let requested = ''
  let init: RequestInit | undefined
  const fake = (async (input: RequestInfo | URL, options?: RequestInit) => {
    requested = String(input)
    init = options
    return jsonResponse(envelope(record()))
  }) as typeof fetch

  const result = await queryLatestVersion({
    baseUrl,
    appId: 'police-assistant',
    platform: 'win32',
    arch: 'x64',
    fetch: fake,
  })

  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error('Expected a parsed release')
  expect(result.release?.version).toBe('3.1.0')
  expect(result.release?.downloadUrl).toBe('http://172.17.236.61:53755/yt-jwai/client-release/setup.exe')
  expect(requested).toContain('/ytsj-ai/desktop-client/queryLatestVersionApp')
  expect(init?.credentials).toBe('omit')
  expect(init?.headers).toMatchObject({ Accept: 'application/json', 'Cache-Control': 'no-cache' })
})

it('returns an empty result when the backend has no record', async () => {
  const fake = (async () => jsonResponse(envelope(null))) as typeof fetch
  await expect(queryLatestVersion({ baseUrl, appId: 'police-assistant', platform: 'win32', arch: 'x64', fetch: fake }))
    .resolves.toEqual({ ok: true, release: null })
})

it('reports server failures for non-2xx responses or an error envelope', async () => {
  const httpError = (async () => jsonResponse(envelope(null, { code: 500, message: 'Failed to query latest version app' }), 500)) as typeof fetch
  await expect(queryLatestVersion({ baseUrl, appId: 'police-assistant', platform: 'win32', arch: 'x64', fetch: httpError }))
    .resolves.toEqual({ ok: false, reason: 'server-error' })

  const envelopeError = (async () => jsonResponse(envelope(null, { code: 500, success: false }))) as typeof fetch
  await expect(queryLatestVersion({ baseUrl, appId: 'police-assistant', platform: 'win32', arch: 'x64', fetch: envelopeError }))
    .resolves.toEqual({ ok: false, reason: 'server-error' })
})

it('rejects non-JSON, empty and oversized bodies', async () => {
  const html = (async () => new Response('<html>login</html>', { status: 200 })) as typeof fetch
  await expect(queryLatestVersion({ baseUrl, appId: 'police-assistant', platform: 'win32', arch: 'x64', fetch: html }))
    .resolves.toEqual({ ok: false, reason: 'invalid-envelope' })

  const empty = (async () => new Response('', { status: 200 })) as typeof fetch
  await expect(queryLatestVersion({ baseUrl, appId: 'police-assistant', platform: 'win32', arch: 'x64', fetch: empty }))
    .resolves.toEqual({ ok: false, reason: 'invalid-envelope' })

  const huge = (async () => new Response('x'.repeat(512 * 1024 + 1), { status: 200 })) as typeof fetch
  await expect(queryLatestVersion({ baseUrl, appId: 'police-assistant', platform: 'win32', arch: 'x64', fetch: huge }))
    .resolves.toEqual({ ok: false, reason: 'invalid-envelope' })
})

it('distinguishes timeouts from other network failures', async () => {
  const timeout = (async () => {
    const error = new Error('timed out')
    error.name = 'TimeoutError'
    throw error
  }) as typeof fetch
  await expect(queryLatestVersion({ baseUrl, appId: 'police-assistant', platform: 'win32', arch: 'x64', fetch: timeout }))
    .resolves.toEqual({ ok: false, reason: 'timeout' })

  const offline = (async () => {
    throw new TypeError('fetch failed')
  }) as typeof fetch
  await expect(queryLatestVersion({ baseUrl, appId: 'police-assistant', platform: 'win32', arch: 'x64', fetch: offline }))
    .resolves.toEqual({ ok: false, reason: 'network' })
})
