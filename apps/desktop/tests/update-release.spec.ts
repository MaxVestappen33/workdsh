import { expect, it } from 'vitest'
import {
  MAX_INSTALLER_BYTES,
  MAX_RELEASE_NOTES_LENGTH,
  parseClientRelease,
  parseLatestVersionResponse,
  resolveCandidate,
  type ClientRelease,
} from '../src/update-release.ts'

const context = { appId: 'police-assistant', platform: 'win32', arch: 'x64' } as const
const hash = '9f0b882044a983978092b581bd719954617a4a426663cdf56557bd9ac121faff'
const downloadUrl = 'http://172.17.236.61:53755/yt-jwai/client-release/PoliceAssistant-1.0.0-x64-Setup.exe'

/** 与后端 /desktop-client/queryLatestVersionApp 的实际返回保持一致。 */
function record(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    appId: 'police-assistant',
    arch: 'x64',
    createBy: 'admin',
    createTime: '2026-10-26 21:23:14',
    delFlag: '0',
    filePath: downloadUrl,
    fileSize: 339_012_164,
    id: '2114709438946795521',
    mandatory: '0',
    minimumVersion: '1.0.0',
    notes: '### 体验优化\n\n- 修复若干问题。',
    platform: 'win32',
    publishedBy: 'admin',
    publishedTime: '2026-10-26 22:17:13',
    releaseType: 'Stable',
    remark: '',
    sequence: 1,
    sha256: hash,
    status: 'published',
    version: '3.1.0',
    ...overrides,
  }
}

function envelope(result: unknown, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { code: 200, message: '', result, success: true, timestamp: 1_793_024_260_189, ...overrides }
}

function accepted(value: unknown, target: typeof context & { baseUrl?: string } = context): ClientRelease {
  const result = parseClientRelease(value, target)
  if (!result.ok) throw new Error(`Expected a valid release, rejected with ${result.reason}`)
  return result.release
}

it('maps the real backend record onto the internal release shape', () => {
  const release = accepted(record())
  expect(release).toMatchObject({
    appId: 'police-assistant',
    version: '3.1.0',
    releaseType: 'stable',
    platform: 'win32',
    arch: 'x64',
    downloadUrl,
    size: 339_012_164,
    sha256: hash,
    mandatory: false,
    publishedAt: '2026-10-26 22:17:13',
    minimumVersion: '1.0.0',
    sequence: 1,
    notes: '### 体验优化\n\n- 修复若干问题。',
  })
})

it('parses the Jeecg envelope, including the empty result', () => {
  const found = parseLatestVersionResponse(envelope(record()), context)
  expect(found.ok).toBe(true)
  if (!found.ok) throw new Error('Expected a parsed release')
  expect(found.release?.version).toBe('3.1.0')

  expect(parseLatestVersionResponse(envelope(null), context)).toEqual({ ok: true, release: null })
  expect(parseLatestVersionResponse(envelope(undefined), context)).toEqual({ ok: true, release: null })
})

it('treats a non-200 code or success=false as a server failure', () => {
  expect(parseLatestVersionResponse(envelope(record(), { code: 500, message: 'Failed to query latest version app' }), context))
    .toEqual({ ok: false, reason: 'server-error' })
  expect(parseLatestVersionResponse(envelope(record(), { success: false }), context))
    .toEqual({ ok: false, reason: 'server-error' })
  expect(parseLatestVersionResponse(null, context)).toEqual({ ok: false, reason: 'invalid-envelope' })
})

it('rejects records for another app, platform or arch', () => {
  expect(parseClientRelease(record({ appId: 'another-app' }), context)).toEqual({ ok: false, reason: 'app-mismatch' })
  expect(parseClientRelease(record({ platform: 'darwin' }), context)).toEqual({ ok: false, reason: 'platform-mismatch' })
  expect(parseClientRelease(record({ arch: 'arm64' }), context)).toEqual({ ok: false, reason: 'arch-mismatch' })
  // appId 缺失时按请求参数补全，兼容老记录。
  expect(accepted(record({ appId: undefined })).appId).toBe('police-assistant')
})

it('rejects malformed versions, urls, sizes and digests', () => {
  expect(parseClientRelease(record({ version: '3.1' }), context)).toEqual({ ok: false, reason: 'invalid-version' })
  expect(parseClientRelease(record({ filePath: '/downloads/setup.exe' }), context)).toEqual({ ok: false, reason: 'invalid-url' })
  expect(parseClientRelease(record({ filePath: 'ftp://example.test/setup.exe' }), context)).toEqual({ ok: false, reason: 'invalid-url' })
  expect(parseClientRelease(record({ filePath: 'http://user:pass@example.test/setup.exe' }), context)).toEqual({ ok: false, reason: 'invalid-url' })
  expect(parseClientRelease(record({ fileSize: 0 }), context)).toEqual({ ok: false, reason: 'invalid-size' })
  expect(parseClientRelease(record({ fileSize: 1.5 }), context)).toEqual({ ok: false, reason: 'invalid-size' })
  expect(parseClientRelease(record({ fileSize: MAX_INSTALLER_BYTES + 1 }), context)).toEqual({ ok: false, reason: 'invalid-size' })
  expect(parseClientRelease(record({ sha256: 'not-a-hash' }), context)).toEqual({ ok: false, reason: 'invalid-hash' })
})

it('accepts numeric strings for fileSize and sequence, and resolves relative download paths', () => {
  const release = accepted(record({ fileSize: '7513142', sequence: '42' }))
  expect(release.size).toBe(7_513_142)
  expect(release.sequence).toBe(42)

  const relative = accepted(
    record({ filePath: '/files/setup.exe' }),
    { ...context, baseUrl: 'http://56.82.4.232:3100/ytsj-ai' },
  )
  expect(relative.downloadUrl).toBe('http://56.82.4.232:3100/files/setup.exe')
})

it('rejects over-long notes and non-object records', () => {
  expect(parseClientRelease(record({ notes: 'x'.repeat(MAX_RELEASE_NOTES_LENGTH + 1) }), context))
    .toEqual({ ok: false, reason: 'notes-too-long' })
  expect(parseClientRelease(null, context)).toEqual({ ok: false, reason: 'not-an-object' })
  expect(parseClientRelease([], context)).toEqual({ ok: false, reason: 'not-an-object' })
})

it('normalizes releaseType to a lowercase label without affecting filtering', () => {
  expect(accepted(record({ releaseType: 'Stable' })).releaseType).toBe('stable')
  expect(accepted(record({ releaseType: 'Beta' })).releaseType).toBe('beta')
  expect(accepted(record({ releaseType: 'ALPHA' })).releaseType).toBe('alpha')
  expect(accepted(record({ releaseType: undefined })).releaseType).toBe('stable')
  expect(accepted(record({ releaseType: '???' })).releaseType).toBe('stable')
})

it('reads the mandatory flag from 0/1 strings and booleans', () => {
  expect(accepted(record({ mandatory: '1' })).mandatory).toBe(true)
  expect(accepted(record({ mandatory: 1 })).mandatory).toBe(true)
  expect(accepted(record({ mandatory: true })).mandatory).toBe(true)
  expect(accepted(record({ mandatory: '0' })).mandatory).toBe(false)
  expect(accepted(record({ mandatory: false })).mandatory).toBe(false)
})

it('resolves a candidate only when the release is strictly newer', () => {
  const release = accepted(record())
  const resolved = resolveCandidate('3.0.0', release)
  expect(resolved?.candidate).toMatchObject({
    version: '3.1.0',
    releaseType: 'stable',
    size: 339_012_164,
    sha256: hash,
    mandatory: false,
  })
  expect(resolveCandidate('3.1.0', release)).toBeUndefined()
  expect(resolveCandidate('3.2.0', release)).toBeUndefined()
  expect(resolveCandidate('not-a-version', release)).toBeUndefined()
})

it('forces the update when marked mandatory or below the minimum version', () => {
  const mandatory = accepted(record({ mandatory: '1' }))
  expect(resolveCandidate('3.0.0', mandatory)?.candidate.mandatory).toBe(true)

  const minimum = accepted(record({ minimumVersion: '3.5.0' }))
  expect(resolveCandidate('3.0.0', minimum)?.forced).toBe(true)

  const aboveMinimum = accepted(record({ minimumVersion: '3.0.0' }))
  expect(resolveCandidate('3.0.1', aboveMinimum)?.forced).toBe(false)
})

it('carries notes, publish time and release type into the candidate', () => {
  const release = accepted(record({ releaseType: 'Beta' }))
  const resolved = resolveCandidate('3.0.0', release)
  expect(resolved?.candidate.releaseType).toBe('beta')
  expect(resolved?.candidate.notes).toContain('体验优化')
  expect(resolved?.candidate.publishedAt).toBe('2026-10-26 22:17:13')
})
