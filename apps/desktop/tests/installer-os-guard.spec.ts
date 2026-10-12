import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const packageRoot = fileURLToPath(new URL('..', import.meta.url))

/**
 * Windows 10 is the hard floor for this carrier: Electron 43 dropped Windows 7/8/8.1 and
 * the bundled DSH Node runtime requires Windows 10 as well. The installer guard is plain
 * NSIS text, so nothing else in the gate would notice if it were deleted while the
 * installer still compiled and shipped. These assertions fail instead of failing silently.
 */
describe('NSIS operating system guard', () => {
  it('refuses to install below Windows 10 before any file is written', () => {
    const script = readFileSync(join(packageRoot, 'build', 'installer.nsh'), 'utf8')
    const guard = /!macro customInit\s+([\s\S]*?)!macroend/u.exec(script)

    // electron-builder only expands the guard when the macro keeps this exact name.
    expect(guard).not.toBeNull()
    expect(guard?.[1]).toContain('${IfNot} ${AtLeastWin10}')
    expect(guard?.[1]).toContain('不支持当前操作系统版本')
    expect(guard?.[1]).toContain('Quit')
  })

  it('keeps the custom installer script wired into the NSIS build', () => {
    const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
      build?: { nsis?: { include?: unknown } }
    }

    expect(manifest.build?.nsis?.include).toBe('installer.nsh')
  })
})
