import { afterEach, expect, test } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { cachedPackageManager } from '../src/plugin-archive-cache.ts'

const homes: string[] = []
afterEach(() => { for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }) })
function fakePnpm(home: string, version = '11.28.5'): string {
  const directory = join(home, 'engine'), entry = join(directory, 'bin', 'pnpm.mjs')
  mkdirSync(join(directory, 'bin'), { recursive: true })
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ name: 'pnpm', version, bin: { pnpm: 'bin/pnpm.mjs' } }))
  writeFileSync(entry, 'console.log(JSON.stringify(process.argv.slice(2)))')
  return entry
}
const fixedPnpm11 = ['--pm-on-fail=ignore', '--config.verify-deps-before-run=false']
test('local archives are retained by content and pnpm records the managed path', () => {
  const home = mkdtempSync(join(tmpdir(), 'workdsh-plugin-cache-')); homes.push(home)
  const fake = fakePnpm(home)
  const source = join(home, 'download with spaces.tgz'); writeFileSync(source, 'archive content')
  const runner = cachedPackageManager(home, fake)
  const received = JSON.parse(execFileSync(process.execPath, [runner, 'add', source, '--save-exact'], { encoding: 'utf8' })) as string[]
  expect(received.slice(0, 2)).toEqual(fixedPnpm11)
  const args = received.slice(2)
  expect(args[0]).toBe('add'); expect(args[2]).toBe('--save-exact')
  expect(args[1]).toMatch(/plugin-archives[/\\][a-f0-9]{64}\.tgz$/)
  rmSync(source)
  expect(readFileSync(args[1]!, 'utf8')).toBe('archive content')
  expect(JSON.parse(execFileSync(process.execPath, [runner, 'install', '--frozen-lockfile'], { encoding: 'utf8' }))).toEqual([...fixedPnpm11, 'install', '--frozen-lockfile'])
  writeFileSync(args[1]!, 'corrupted'); writeFileSync(source, 'archive content')
  expect(() => execFileSync(process.execPath, [runner, 'add', source], { stdio: 'pipe' })).toThrow()
})
test('registry installs pass through and personal/member caches are separate', () => {
  const home = mkdtempSync(join(tmpdir(), 'workdsh-plugin-cache-')); homes.push(home)
  const fake = fakePnpm(home)
  const member = join(home, 'member'); mkdirSync(member)
  const personalRunner = cachedPackageManager(home, fake), memberRunner = cachedPackageManager(member, fake)
  expect(memberRunner).not.toBe(personalRunner)
  expect(JSON.parse(execFileSync(process.execPath, [memberRunner, 'add', '@company/plugin@1.0.0'], { encoding: 'utf8' }))).toEqual([...fixedPnpm11, 'add', '@company/plugin@1.0.0'])
})

test('uses the older pnpm policy only with an older bundled engine and rejects invalid metadata', () => {
  const home = mkdtempSync(join(tmpdir(), 'workdsh-plugin-cache-')); homes.push(home)
  const fake = fakePnpm(home, '10.34.5'), runner = cachedPackageManager(home, fake)
  expect(JSON.parse(execFileSync(process.execPath, [runner, 'install'], { encoding: 'utf8' }))).toEqual(['--config.manage-package-manager-versions=false', '--config.package-manager-strict=false', 'install'])
  writeFileSync(join(home, 'engine', 'package.json'), JSON.stringify({ name: 'another-manager', version: '11.28.5' }))
  expect(() => cachedPackageManager(home, fake)).toThrow('内置插件安装工具清单无效')
})
