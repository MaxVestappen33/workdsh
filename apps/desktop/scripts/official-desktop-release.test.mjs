import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { verifyArtifact, lock } from './official-desktop-release.mjs'
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
