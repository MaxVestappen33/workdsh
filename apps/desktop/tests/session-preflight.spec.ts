import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import {
  HOST_STACK_SIZE_KB,
  hostNodeArguments,
  hostStackSizeKb,
  runSessionPreflight,
  sessionPreflightEnabled,
  sessionPreflightSummary,
} from '../src/session-preflight.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** 造一个最小的 dsh-home：只包含预检会看的两个目录。 */
function home(): string {
  const root = mkdtempSync(join(tmpdir(), 'workdsh-preflight-'))
  roots.push(root)
  mkdirSync(join(root, 'storages'), { recursive: true })
  mkdirSync(join(root, 'sessions'), { recursive: true })
  return root
}

const fill = (path: string, bytes: number): void => writeFileSync(path, Buffer.alloc(bytes, 0x78))
const fixedNow = (): Date => new Date('2026-11-16T00:00:00.000Z')

it('does nothing when the session state is ordinary', () => {
  const root = home()
  const domain = join(root, 'storages', 'session_projcache', 'sessions')
  mkdirSync(domain, { recursive: true })
  fill(join(domain, 'a.json'), 1024)
  mkdirSync(join(root, 'sessions', 'workspace', 'session-1'), { recursive: true })
  fill(join(root, 'sessions', 'workspace', 'session-1', 'session.v4.jsonl.zstd'), 2048)

  const result = runSessionPreflight(root, { now: fixedNow })
  expect(result.quarantined).toEqual([])
  expect(result.oversizedSessions).toEqual([])
  expect(result.error).toBeUndefined()
  // 日常启动不产生任何噪声。
  expect(sessionPreflightSummary(result)).toBeUndefined()
})

it('moves a pathological single projection record aside and keeps a restorable backup', () => {
  const root = home()
  const records = join(root, 'storages', 'session_projcache', 'sessions')
  mkdirSync(records, { recursive: true })
  fill(join(records, 'huge.json'), 4096)
  fill(join(records, 'small.json'), 16)

  const result = runSessionPreflight(root, { now: fixedNow, maxProjectionRecordBytes: 1024 })
  expect(result.quarantined).toHaveLength(1)
  expect(result.quarantined[0]!.path).toBe(join(records, 'huge.json'))
  expect(result.quarantined[0]!.bytes).toBe(4096)
  expect(result.quarantined[0]!.backupPath).toContain('huge.json.oversized-2026-11-16T00-00-00-000Z')
  // 只搬超大记录，正常会话缓存原样保留；留档文件仍在同一目录，可人工恢复。
  expect(readdirSync(records).sort()).toEqual(['huge.json.oversized-2026-11-16T00-00-00-000Z', 'small.json'])
  const summary = sessionPreflightSummary(result)
  expect(summary).toContain('投影缓存已搬开留档')
  expect(summary).toContain('0.0MB')
})

it('quarantines the whole projection domain once its total exceeds the budget', () => {
  const root = home()
  const domain = join(root, 'storages', 'session_projcache')
  mkdirSync(join(domain, 'sessions'), { recursive: true })
  fill(join(domain, 'sessions', 'a.json'), 2048)
  fill(join(domain, 'sessions', 'b.json'), 2048)

  const result = runSessionPreflight(root, { now: fixedNow, maxProjectionCacheBytes: 1024 })
  expect(result.quarantined).toHaveLength(1)
  expect(result.quarantined[0]!.path).toBe(domain)
  expect(result.quarantined[0]!.bytes).toBe(4096)
  expect(readdirSync(join(root, 'storages'))).toEqual(['session_projcache.oversized-2026-11-16T00-00-00-000Z'])
})

it('quarantines the legacy single-file projection cache at the upstream threshold', () => {
  const root = home()
  const legacy = join(root, 'storages', 'session_projcache.json')
  fill(legacy, 4096)

  const result = runSessionPreflight(root, { now: fixedNow, maxLegacyProjectionCacheBytes: 1024 })
  expect(result.quarantined).toHaveLength(1)
  expect(result.quarantined[0]!.path).toBe(legacy)
})

it('never touches data when relocation is disabled, but still reports oversized sessions', () => {
  const root = home()
  const records = join(root, 'storages', 'session_projcache', 'sessions')
  mkdirSync(records, { recursive: true })
  fill(join(records, 'huge.json'), 4096)
  const log = join(root, 'sessions', 'workspace', 'session-1', 'session.v4.jsonl.zstd')
  mkdirSync(join(root, 'sessions', 'workspace', 'session-1'), { recursive: true })
  fill(log, 4096)

  const result = runSessionPreflight(root, { now: fixedNow, relocate: false, maxProjectionRecordBytes: 1024, maxSessionLogBytes: 1024 })
  expect(result.quarantined).toEqual([])
  expect(readdirSync(records)).toEqual(['huge.json'])
  expect(result.oversizedSessions).toEqual([{ path: log, bytes: 4096 }])
  expect(sessionPreflightSummary(result)).toContain('超长会话日志 1 个')
})

it('returns an empty result instead of throwing when the home is unreadable', () => {
  const result = runSessionPreflight(join(tmpdir(), 'workdsh-preflight-missing-home'))
  expect(result.quarantined).toEqual([])
  expect(result.oversizedSessions).toEqual([])
  expect(result.error).toBeUndefined()
})

it('keeps the session preflight opt-out and the host stack headroom explicit', () => {
  expect(sessionPreflightEnabled({})).toBe(true)
  expect(sessionPreflightEnabled({ WORKDSH_SESSION_PREFLIGHT: 'off' })).toBe(false)
  expect(sessionPreflightEnabled({ WORKDSH_SESSION_PREFLIGHT: ' OFF ' })).toBe(false)

  expect(hostStackSizeKb({})).toBe(HOST_STACK_SIZE_KB)
  expect(hostStackSizeKb({ WORKDSH_HOST_STACK_SIZE: '4096' })).toBe(4096)
  // 现场误配不能把栈压到启动即崩，也不能大到让 V8 直接失败。
  expect(hostStackSizeKb({ WORKDSH_HOST_STACK_SIZE: '8' })).toBe(512)
  expect(hostStackSizeKb({ WORKDSH_HOST_STACK_SIZE: '999999' })).toBe(8192)
  expect(hostStackSizeKb({ WORKDSH_HOST_STACK_SIZE: 'abc' })).toBe(HOST_STACK_SIZE_KB)

  // 栈参数必须在启动脚本之前：否则会被 launcher 当成自己的参数。
  expect(hostNodeArguments('/home/.workdsh-host.mjs', ['--no-open'], {})).toEqual([`--stack-size=${HOST_STACK_SIZE_KB}`, '/home/.workdsh-host.mjs', '--no-open'])
})
