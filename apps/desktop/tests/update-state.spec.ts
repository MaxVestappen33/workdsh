import { expect, it } from 'vitest'
import type { UpdateCandidate } from '../src/update-release.ts'
import {
  initialUpdateState,
  reduceUpdate,
  type UpdateEffect,
  type UpdateMachineEvent,
  type UpdateMachineState,
} from '../src/update-state.ts'

function candidate(version = '3.1.0'): UpdateCandidate {
  return {
    version,
    releaseType: 'stable',
    downloadUrl: 'http://56.82.4.232:3100/downloads/setup.exe',
    size: 1024,
    sha256: 'a'.repeat(64),
    mandatory: false,
  }
}

function run(events: readonly UpdateMachineEvent[], initial: UpdateMachineState = initialUpdateState()): {
  state: UpdateMachineState
  effects: UpdateEffect[]
} {
  let state = initial
  const effects: UpdateEffect[] = []
  for (const event of events) {
    const reduction = reduceUpdate(state, event)
    state = reduction.state
    effects.push(...reduction.effects)
  }
  return { state, effects }
}

it('walks the happy path from check to install', () => {
  const target = candidate()
  const { state, effects } = run([
    { type: 'check', manual: true, now: 1 },
    { type: 'checked', candidate: target, now: 2 },
    { type: 'download', version: '3.1.0' },
    { type: 'progress', percent: 42 },
    { type: 'downloaded' },
    { type: 'verified' },
    { type: 'install', version: '3.1.0' },
  ])

  expect(state.snapshot).toEqual({ phase: 'installing', candidate: target })
  expect(state.lastCheckAt).toBe(2)
  expect(effects).toEqual([
    { type: 'check', manual: true },
    { type: 'download', candidate: target },
    { type: 'verify', candidate: target },
    { type: 'install', candidate: target },
  ])
})

it('stays idle when the backend has no newer release', () => {
  const { state, effects } = run([
    { type: 'check', manual: false, now: 5 },
    { type: 'checked', now: 6 },
  ])
  expect(state).toEqual({ snapshot: { phase: 'idle' }, lastCheckAt: 6 })
  expect(effects).toEqual([{ type: 'check', manual: false }])
})

it('keeps automatic failures silent but surfaces manual ones', () => {
  const automatic = run([
    { type: 'check', manual: false, now: 1 },
    { type: 'check-failed', code: 'network', manual: false, now: 2 },
  ])
  expect(automatic.state).toEqual({ snapshot: { phase: 'idle' }, lastCheckAt: 2 })

  const manual = run([
    { type: 'check', manual: true, now: 1 },
    { type: 'check-failed', code: 'network', manual: true, now: 2 },
  ])
  expect(manual.state.snapshot).toEqual({
    phase: 'error',
    manual: true,
    failure: { operation: 'check', code: 'network' },
  })
})

it('refuses a download or install whose version differs from the candidate', () => {
  const checked = run([
    { type: 'check', manual: false, now: 1 },
    { type: 'checked', candidate: candidate(), now: 2 },
  ])
  const wrongDownload = reduceUpdate(checked.state, { type: 'download', version: '9.9.9' })
  expect(wrongDownload.state).toEqual(checked.state)
  expect(wrongDownload.effects).toEqual([])

  const ready = run([
    { type: 'check', manual: false, now: 1 },
    { type: 'checked', candidate: candidate(), now: 2 },
    { type: 'download', version: '3.1.0' },
    { type: 'downloaded' },
    { type: 'verified' },
  ])
  const wrongInstall = reduceUpdate(ready.state, { type: 'install', version: '9.9.9' })
  expect(wrongInstall.state).toEqual(ready.state)
  expect(wrongInstall.effects).toEqual([])
})

it('joins duplicate checks and ignores checks during download or install', () => {
  const checking = run([{ type: 'check', manual: false, now: 1 }])
  const duplicate = reduceUpdate(checking.state, { type: 'check', manual: true, now: 2 })
  expect(duplicate.state).toEqual(checking.state)
  expect(duplicate.effects).toEqual([])

  const downloading = run([
    { type: 'check', manual: false, now: 1 },
    { type: 'checked', candidate: candidate(), now: 2 },
    { type: 'download', version: '3.1.0' },
  ])
  expect(reduceUpdate(downloading.state, { type: 'check', manual: true, now: 3 }).effects).toEqual([])
})

it('clamps progress to an integer percentage and ignores unchanged values', () => {
  const downloading = run([
    { type: 'check', manual: false, now: 1 },
    { type: 'checked', candidate: candidate(), now: 2 },
    { type: 'download', version: '3.1.0' },
  ])

  expect(reduceUpdate(downloading.state, { type: 'progress', percent: 140 }).state.snapshot.percent).toBe(100)
  expect(reduceUpdate(downloading.state, { type: 'progress', percent: -5 }).state.snapshot.percent).toBe(0)
  expect(reduceUpdate(downloading.state, { type: 'progress', percent: 12.9 }).state.snapshot.percent).toBe(12)
  expect(reduceUpdate(downloading.state, { type: 'progress', percent: Number.NaN }).state.snapshot.percent).toBe(0)
  expect(reduceUpdate(downloading.state, { type: 'progress', percent: 0 }).effects).toEqual([])
})

it('cancelling a download returns to available and discards the partial package', () => {
  const downloading = run([
    { type: 'check', manual: false, now: 1 },
    { type: 'checked', candidate: candidate(), now: 2 },
    { type: 'download', version: '3.1.0' },
  ])
  const cancelled = reduceUpdate(downloading.state, { type: 'cancel' })
  expect(cancelled.state.snapshot).toEqual({ phase: 'available', candidate: candidate() })
  expect(cancelled.effects).toEqual([{ type: 'discard', version: '3.1.0' }])
})

it('dismisses available, ready and error without losing a verified package', () => {
  const available = run([
    { type: 'check', manual: false, now: 1 },
    { type: 'checked', candidate: candidate(), now: 2 },
  ])
  expect(reduceUpdate(available.state, { type: 'dismiss' }).state.snapshot).toEqual({ phase: 'idle' })

  const ready = run([
    { type: 'check', manual: false, now: 1 },
    { type: 'checked', candidate: candidate(), now: 2 },
    { type: 'download', version: '3.1.0' },
    { type: 'downloaded' },
    { type: 'verified' },
  ])
  expect(reduceUpdate(ready.state, { type: 'dismiss' }).state.snapshot).toEqual({
    phase: 'available',
    candidate: candidate(),
  })

  const failed = run([
    { type: 'check', manual: false, now: 1 },
    { type: 'checked', candidate: candidate(), now: 2 },
    { type: 'download', version: '3.1.0' },
    { type: 'download-failed', code: 'network' },
  ])
  expect(reduceUpdate(failed.state, { type: 'dismiss' }).state.snapshot).toEqual({ phase: 'idle' })
})

it('retries according to the failed operation', () => {
  const downloadFailure = run([
    { type: 'check', manual: false, now: 1 },
    { type: 'checked', candidate: candidate(), now: 2 },
    { type: 'download', version: '3.1.0' },
    { type: 'download-failed', code: 'network' },
  ])
  const downloadRetry = reduceUpdate(downloadFailure.state, { type: 'retry' })
  expect(downloadRetry.state.snapshot).toEqual({ phase: 'downloading', candidate: candidate(), percent: 0 })
  expect(downloadRetry.effects).toEqual([{ type: 'download', candidate: candidate() }])

  const checkFailure = run([
    { type: 'check', manual: true, now: 1 },
    { type: 'check-failed', code: 'timeout', manual: true, now: 2 },
  ])
  const checkRetry = reduceUpdate(checkFailure.state, { type: 'retry' })
  expect(checkRetry.state.snapshot).toEqual({ phase: 'checking', manual: true })
  expect(checkRetry.effects).toEqual([{ type: 'check', manual: true }])

  const installFailure = run([
    { type: 'check', manual: false, now: 1 },
    { type: 'checked', candidate: candidate(), now: 2 },
    { type: 'download', version: '3.1.0' },
    { type: 'downloaded' },
    { type: 'verified' },
    { type: 'install', version: '3.1.0' },
    { type: 'install-failed', code: 'host-stop-failed' },
  ])
  const installRetry = reduceUpdate(installFailure.state, { type: 'retry' })
  // 安装失败后必须重新走用户确认，绝不自动重试安装。
  expect(installRetry.state.snapshot).toEqual({ phase: 'ready', candidate: candidate() })
  expect(installRetry.effects).toEqual([])
})

it('ignores events that do not belong to the current phase', () => {
  const idle = initialUpdateState()
  for (const event of [
    { type: 'progress', percent: 10 },
    { type: 'downloaded' },
    { type: 'verified' },
    { type: 'install', version: '3.1.0' },
    { type: 'cancel' },
    { type: 'dismiss' },
    { type: 'retry' },
    { type: 'checked', now: 1 },
  ] satisfies UpdateMachineEvent[]) {
    const reduction = reduceUpdate(idle, event)
    expect(reduction.state).toEqual(idle)
    expect(reduction.effects).toEqual([])
  }
})
