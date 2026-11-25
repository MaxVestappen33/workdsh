import { expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import AdmZip from 'adm-zip'
import { buildRuntimeLogBundle, buildZip, planRuntimeLogs, runtimeLogReadme } from '../src/runtime-log-export.ts'

function workspace(): { root: string, logs: string, userData: string, profile: string, crash: string } {
  const root = mkdtempSync(join(tmpdir(), 'workdsh-runtime-log-'))
  const logs = join(root, 'logs')
  const profile = join(root, 'profiles', 'workdsh')
  const crash = join(root, 'crash')
  mkdirSync(logs, { recursive: true })
  mkdirSync(profile, { recursive: true })
  mkdirSync(crash, { recursive: true })
  writeFileSync(join(logs, 'carrier-2026-11-25.log'), 'token=secret-token carrier\n')
  writeFileSync(join(logs, 'host-output-2026-11-25.log'), 'host error\n')
  writeFileSync(join(logs, 'runtime-failure.log'), 'startup failed\n')
  writeFileSync(join(logs, 'account-session.bin'), 'credential')
  writeFileSync(join(root, 'startup-timing.log'), '[startup] +0ms\n')
  writeFileSync(join(root, 'logs', 'chromium.log'), 'gpu error\n')
  writeFileSync(join(profile, 'package.json'), '{"name":"workdsh"}')
  writeFileSync(join(crash, 'crash.dmp'), Buffer.from([0x4d, 0x44, 0x4d, 0x50]))
  return { root, logs, userData: root, profile, crash }
}

it('collects every runtime log but never credential files', () => {
  const files = workspace()
  try {
    const plan = planRuntimeLogs({ logDirectory: files.logs, userDataDirectory: files.userData, profileDirectory: files.profile, crashDumpDirectory: files.crash })
    const paths = plan.files.map(file => file.archivePath)
    expect(paths).toContain('logs/carrier-2026-11-25.log')
    expect(paths).toContain('logs/host-output-2026-11-25.log')
    expect(paths).toContain('logs/runtime-failure.log')
    expect(paths).toContain('logs/chromium.log')
    expect(paths).toContain('startup-timing.log')
    expect(paths).toContain('profile/package.json')
    expect(paths).toContain('crash-dumps/crash.dmp')
    expect(paths).not.toContain('logs/account-session.bin')
    expect(plan.skipped.some(item => item.reason === 'credential')).toBe(true)
  } finally { rmSync(files.root, { recursive: true, force: true }) }
})

it('applies the total budget after higher-priority logs', () => {
  const files = workspace()
  try {
    const plan = planRuntimeLogs({ logDirectory: files.logs, userDataDirectory: files.userData, maxTotalBytes: 1 })
    expect(plan.files.length).toBe(0)
    expect(plan.skipped.filter(item => item.reason !== 'credential').every(item => item.reason === 'budget')).toBe(true)
  } finally { rmSync(files.root, { recursive: true, force: true }) }
})

it('writes a readable zip with redacted text, manifest and readme', () => {
  const files = workspace()
  try {
    const bundle = buildRuntimeLogBundle({
      logDirectory: files.logs,
      userDataDirectory: files.userData,
      profileDirectory: files.profile,
      crashDumpDirectory: files.crash,
      metadata: { app: { version: '1.0.0' } },
    })
    const zip = new AdmZip(bundle.data)
    const names = zip.getEntries().map(entry => entry.entryName)
    expect(names).toContain('manifest.json')
    expect(names).toContain('README-运行日志说明.txt')
    expect(names).toContain('logs/carrier-2026-11-25.log')
    expect(names).not.toContain('logs/account-session.bin')
    expect(zip.readAsText('logs/carrier-2026-11-25.log')).toContain('[redacted]')
    expect(zip.readAsText('logs/carrier-2026-11-25.log')).not.toContain('secret-token')
    expect(zip.readAsText('manifest.json')).toContain('1.0.0')
    expect(zip.readAsText('README-运行日志说明.txt')).toContain('carrier-*.log')
    expect(zip.readFile('crash-dumps/crash.dmp')?.equals(Buffer.from([0x4d, 0x44, 0x4d, 0x50]))).toBe(true)
  } finally { rmSync(files.root, { recursive: true, force: true }) }
})

it('supports UTF-8 names and an empty archive', () => {
  expect(new AdmZip(buildZip([])).getEntries()).toHaveLength(0)
  const zip = new AdmZip(buildZip([{ path: '日志/说明.txt', data: Buffer.from('ok') }]))
  expect(zip.getEntries()[0]?.entryName).toBe('日志/说明.txt')
  expect(zip.readAsText('日志/说明.txt')).toBe('ok')
})

it('explains where to look when the app cannot start at all', () => {
  const text = runtimeLogReadme(new Date('2026-11-25T00:00:00Z'), { files: [], skipped: [], totalBytes: 0 })
  expect(text).toContain('APPDATA')
  expect(text).toContain('DiagnosticReports')
})
