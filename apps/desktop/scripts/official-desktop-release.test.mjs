import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, symlinkSync, unlinkSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { copyOfficialRuntime, isOfficialReleaseCacheValid, verifyArtifact, lock } from './official-desktop-release.mjs'
import { OFFICIAL_PNPM_VERSION } from './runtime-version.mjs'

test('both runtime copies preserve relative executable links after their sources are removed', { skip: process.platform === 'win32' }, () => {
  const directory = mkdtempSync(join(tmpdir(), 'workdsh runtime links '))
  try {
    const source = join(directory, 'extracted'), cache = join(directory, 'cache'), prepared = join(directory, 'prepared')
    const bin = join('dependencies', 'python', 'bin')
    mkdirSync(join(source, bin), { recursive: true })
    writeFileSync(join(source, bin, 'python3.12'), 'bundled Python')
    symlinkSync('python3.12', join(source, bin, 'python3'))
    copyOfficialRuntime(source, cache)
    // An existing output from the old copier must also be repaired on rerun.
    mkdirSync(join(prepared, bin), { recursive: true })
    symlinkSync(join(source, bin, 'python3.12'), join(prepared, bin, 'python3'))
    copyOfficialRuntime(cache, prepared)
    rmSync(source, { recursive: true, force: true })
    rmSync(cache, { recursive: true, force: true })
    assert.equal(readlinkSync(join(prepared, bin, 'python3')), 'python3.12')
    assert.equal(readFileSync(join(prepared, bin, 'python3'), 'utf8'), 'bundled Python')
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

test('cache reuse rejects the previous copy format and missing executable targets', () => {
  const directory = mkdtempSync(join(tmpdir(), 'workdsh-runtime-cache-'))
  try {
    const target = 'mac-arm64', runtime = join(directory, 'runtime/primary-runtime')
    const write = (path, value = 'fixture') => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, value) }
    write(join(runtime, 'runtime.json'), JSON.stringify({ desktopVersion: lock.version, platform: 'darwin', arch: 'arm64', pnpm: OFFICIAL_PNPM_VERSION }))
    const executable = join(runtime, 'dependencies/python/bin/python3')
    const executableTarget = process.platform === 'win32' ? executable : join(runtime, 'dependencies/python/bin/python3.12')
    for (const path of [executableTarget, join(runtime, 'dependencies/node/bin/node'), join(runtime, 'dependencies/pnpm/bin/pnpm.cjs'), join(directory, 'runtime/cli/command-manager.js')]) write(path)
    if (process.platform !== 'win32') symlinkSync('python3.12', executable)
    mkdirSync(join(directory, 'runtime/office-skills'))
    const identity = { version: lock.version, target, artifact: lock.desktopArtifacts[target] }
    write(join(directory, 'receipt.json'), JSON.stringify(identity))
    assert.equal(isOfficialReleaseCacheValid(directory, target), false, 'old absolute-link copies must be rebuilt')
    write(join(directory, 'receipt.json'), JSON.stringify({ copyFormat: 2, ...identity }))
    assert.equal(isOfficialReleaseCacheValid(directory, target), true)
    unlinkSync(executableTarget)
    assert.equal(isOfficialReleaseCacheValid(directory, target), false)
    assert.equal(existsSync(join(runtime, 'runtime.json')), true, 'a receipt and metadata alone do not establish a usable cache')
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
test('official binary archives require both the locked size and content digest', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'workdsh-release-hash-'))
  try {
    const file = join(directory, 'release.zip'), bytes = Buffer.from('official candidate')
    writeFileSync(file, bytes)
    const artifact = { size: bytes.length, sha512: createHash('sha512').update(bytes).digest('base64') }
    await verifyArtifact(file, artifact)
    await assert.rejects(verifyArtifact(file, { ...artifact, size: bytes.length + 1 }), /mismatch/)
    writeFileSync(file, Buffer.from('modified candidate'))
    await assert.rejects(verifyArtifact(file, artifact), /mismatch/)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
test('every supported target has an immutable official URL and a full digest', () => {
  assert.equal(lock.distribution, 'published-packages-and-desktop-release')
  for (const target of ['mac-arm64', 'mac-x64', 'win-x64']) {
    const artifact = lock.desktopArtifacts[target]
    assert.equal(new URL(artifact.url).hostname, 'download.deepseek.com')
    assert.ok(artifact.url.includes('deepseek-harness-' + lock.version + '-' + target))
    assert.equal(Buffer.from(artifact.sha512, 'base64').length, 64)
    assert.ok(artifact.size > 0)
  }
})
