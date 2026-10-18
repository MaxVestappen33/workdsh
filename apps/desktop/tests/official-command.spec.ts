import { afterEach, expect, test, vi } from 'vitest'
import { type ChildProcess } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runOfficialCommand } from '../src/official-command.ts'
import * as owned from '../src/owned-process.ts'

const homes: string[] = []
const integrationTimeout = process.platform === 'win32' ? 20_000 : 5_000
afterEach(() => { vi.restoreAllMocks(); for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }) })
function fixture(source: string) {
  const home = mkdtempSync(join(tmpdir(), 'workdsh-cli-diagnostic-')); homes.push(home)
  const launcher = join(home, 'cli.mjs'); writeFileSync(launcher, source)
  return { executable: process.execPath, launcher, args: [], home, env: {},
    logDirectory: join(home, 'logs'), cancelled: () => false, onProcess: () => {} }
}

test('retains final CLI errors and redacts credentials split across writes', async () => {
  const options = fixture(`process.stderr.write('Bearer sens'); setTimeout(() => { process.stderr.write('itive-value\\nERR_PNPM_PACKAGE_MANAGER_BAD_VERSION expected 11.7.0\\n'); process.exitCode = 1 }, 10)`)
  await expect(runOfficialCommand(options)).rejects.toThrow('ERR_PNPM_PACKAGE_MANAGER_BAD_VERSION')
  const log = readFileSync(join(options.logDirectory, 'plugin-operation-failure.log'), 'utf8')
  expect(log).toContain('expected 11.7.0')
  expect(log).toContain('[redacted]')
  expect(log).not.toContain('sensitive-value')
}, integrationTimeout)

test('successful CLI completion does not report an installation failure', async () => {
  await expect(runOfficialCommand(fixture(`console.log('done')`))).resolves.toBeUndefined()
}, integrationTimeout)

test('timeout terminates its owned process and preserves its specific reason', async () => {
  const options = fixture(`console.error('install started'); setInterval(() => {}, 1000)`)
  await expect(runOfficialCommand({ ...options, timeoutMs: 150 })).rejects.toThrow('插件依赖更新超时')
  expect(readFileSync(join(options.logDirectory, 'plugin-operation-failure.log'), 'utf8')).toContain('install started')
}, integrationTimeout)

test('retains the owned process handle if timeout cleanup cannot confirm it stopped', async () => {
  vi.spyOn(owned, 'stopOwnedProcess').mockRejectedValue(new Error('not stopped'))
  const options = fixture(`setInterval(() => {}, 1000)`)
  let tracked: ChildProcess | undefined
  try {
    await expect(runOfficialCommand({ ...options, timeoutMs: 150, onProcess: child => { tracked = child } })).rejects.toThrow('停止尚未确认')
    expect(tracked?.pid).toBeTypeOf('number')
    expect(tracked?.exitCode).toBeNull()
  } finally {
    const child = tracked
    if (child) await new Promise<void>(resolve => { child.once('close', resolve); child.kill('SIGKILL') })
  }
  await vi.waitFor(() => expect(tracked).toBeUndefined(), { timeout: process.platform === 'win32' ? 15_000 : 1_000 })
}, integrationTimeout)
