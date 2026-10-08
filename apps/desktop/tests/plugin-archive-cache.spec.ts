import { afterEach, expect, test } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { cachedPackageManager } from '../src/plugin-archive-cache.ts'

const homes: string[] = []
afterEach(() => { for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }) })
test('local archives are retained by content and pnpm records the managed path', () => {
  const home = mkdtempSync(join(tmpdir(), 'workdsh-plugin-cache-')); homes.push(home)
  const fake = join(home, 'pnpm.mjs')
  writeFileSync(fake, 'console.log(JSON.stringify(process.argv.slice(2)))')
  const source = join(home, 'download with spaces.tgz'); writeFileSync(source, 'archive content')
  const runner = cachedPackageManager(home, fake)
  const args = JSON.parse(execFileSync(process.execPath, [runner, 'add', source, '--save-exact'], { encoding: 'utf8' })) as string[]
  expect(args[0]).toBe('add'); expect(args[2]).toBe('--save-exact')
  expect(args[1]).toMatch(/plugin-archives[/\\][a-f0-9]{64}\.tgz$/)
  rmSync(source)
  expect(readFileSync(args[1]!, 'utf8')).toBe('archive content')
  expect(JSON.parse(execFileSync(process.execPath, [runner, 'install', '--frozen-lockfile'], { encoding: 'utf8' }))).toEqual(['install', '--frozen-lockfile'])
  writeFileSync(args[1]!, 'corrupted'); writeFileSync(source, 'archive content')
  expect(() => execFileSync(process.execPath, [runner, 'add', source], { stdio: 'pipe' })).toThrow()
})
test('registry installs pass through and personal/member caches are separate', () => {
  const home = mkdtempSync(join(tmpdir(), 'workdsh-plugin-cache-')); homes.push(home)
  const fake = join(home, 'pnpm.mjs'); writeFileSync(fake, 'console.log(JSON.stringify(process.argv.slice(2)))')
  const member = join(home, 'member'); mkdirSync(member)
  const personalRunner = cachedPackageManager(home, fake), memberRunner = cachedPackageManager(member, fake)
  expect(memberRunner).not.toBe(personalRunner)
  expect(JSON.parse(execFileSync(process.execPath, [memberRunner, 'add', '@company/plugin@1.0.0'], { encoding: 'utf8' }))).toEqual(['add', '@company/plugin@1.0.0'])
})
