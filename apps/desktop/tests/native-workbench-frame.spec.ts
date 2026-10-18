import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ensureNativeWorkbenchFrame, verifyNativeWorkbenchFrame } from '../../../scripts/native-workbench-frame-patch.mjs'

describe('Desktop native Conversation frame guard', () => {
  it('fails closed for unsupported installed bytes and leaves the original file untouched', async () => {
    const profile = await mkdtemp(join(tmpdir(), 'workdsh-desktop-frame-'))
    const pkg = join(profile, 'node_modules/@deepseek-ai/dsh-client-ui-conversation')
    const target = join(pkg, 'lib/client.js')
    try {
      await mkdir(join(pkg, 'lib'), { recursive: true })
      await writeFile(join(profile, 'package.json'), '{}')
      await writeFile(join(pkg, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-client-ui-conversation', version: '0.2.1-rc.1' }))
      await writeFile(target, 'unexpected-runtime-bytes')
      await expect(ensureNativeWorkbenchFrame(profile)).rejects.toThrow('unsupported runtime bytes')
      await expect(verifyNativeWorkbenchFrame(profile)).rejects.toThrow('unsupported packaged runtime bytes')
      await expect(ensureNativeWorkbenchFrame(profile, { rollback: true })).rejects.toThrow('Cannot roll back unknown runtime')
      expect(await readFile(target, 'utf8')).toBe('unexpected-runtime-bytes')
      await writeFile(join(pkg, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-client-ui-conversation', version: '0.2.1-unknown' }))
      await expect(ensureNativeWorkbenchFrame(profile)).rejects.toThrow('runtime version mismatch')
      await expect(verifyNativeWorkbenchFrame(profile)).rejects.toThrow('runtime version mismatch')
      expect(await readFile(target, 'utf8')).toBe('unexpected-runtime-bytes')
    } finally {
      await rm(profile, { recursive: true, force: true })
    }
  })
})
