import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  verifyMacRelease,
  type MacReleaseVerificationOptions,
} from '../scripts/verify-mac-release.ts'

function options(overrides: Partial<MacReleaseVerificationOptions> = {}) {
  const calls: Array<{ command: string; args: readonly string[] }> = []
  const removeMountPoint = vi.fn()
  const removeExtractDir = vi.fn()
  const value: MacReleaseVerificationOptions = {
    distDir: '/release/dist',
    targetArch: 'arm64',
    executableName: 'PoliceAssistant',
    listDmgs: () => ['/release/dist/PoliceAssistant-2.0.0-arm64.dmg'],
    listZips: () => ['/release/dist/PoliceAssistant-2.0.0-arm64.zip'],
    makeMountPoint: () => '/private/tmp/dsh-desktop-dmg-test',
    makeExtractDir: () => '/private/tmp/dsh-desktop-zip-test',
    run: (command, args) => { calls.push({ command, args: [...args] }) },
    removeMountPoint,
    removeExtractDir,
    ...overrides,
  }
  return { calls, removeMountPoint, removeExtractDir, value }
}

describe('macOS release artifact verification', () => {
  it('verifies the DMG first and then the update ZIP used by in-app upgrades', () => {
    const harness = options()
    const appPath = join('/private/tmp/dsh-desktop-dmg-test', 'PoliceAssistant.app')
    const zipAppPath = join('/private/tmp/dsh-desktop-zip-test', 'PoliceAssistant.app')

    expect(verifyMacRelease(harness.value)).toEqual({
      appPath,
      dmgPath: '/release/dist/PoliceAssistant-2.0.0-arm64.dmg',
      zipPath: '/release/dist/PoliceAssistant-2.0.0-arm64.zip',
      zipAppPath,
    })

    expect(harness.calls).toEqual([
      {
        command: 'hdiutil',
        args: [
          'attach', '/release/dist/PoliceAssistant-2.0.0-arm64.dmg',
          '-mountpoint', '/private/tmp/dsh-desktop-dmg-test', '-nobrowse', '-readonly',
        ],
      },
      {
        command: 'lipo',
        args: [join(appPath, 'Contents', 'MacOS', 'PoliceAssistant'), '-verify_arch', 'arm64'],
      },
      {
        command: 'codesign',
        args: ['--verify', '--deep', '--strict', '--verbose=2', appPath],
      },
      {
        command: 'spctl',
        args: ['--assess', '--type', 'execute', '--verbose=4', appPath],
      },
      {
        command: 'xcrun',
        args: ['stapler', 'validate', appPath],
      },
      {
        command: 'hdiutil',
        args: ['detach', '/private/tmp/dsh-desktop-dmg-test'],
      },
      {
        command: 'ditto',
        args: ['-x', '-k', '/release/dist/PoliceAssistant-2.0.0-arm64.zip', '/private/tmp/dsh-desktop-zip-test'],
      },
      {
        command: 'lipo',
        args: [join(zipAppPath, 'Contents', 'MacOS', 'PoliceAssistant'), '-verify_arch', 'arm64'],
      },
      {
        command: 'codesign',
        args: ['--verify', '--deep', '--strict', '--verbose=2', zipAppPath],
      },
      {
        command: 'spctl',
        args: ['--assess', '--type', 'execute', '--verbose=4', zipAppPath],
      },
      {
        command: 'xcrun',
        args: ['stapler', 'validate', zipAppPath],
      },
    ])
    expect(harness.removeMountPoint).toHaveBeenCalledWith('/private/tmp/dsh-desktop-dmg-test')
    expect(harness.removeExtractDir).toHaveBeenCalledWith('/private/tmp/dsh-desktop-zip-test')
  })

  it('rejects absent or ambiguous release images before mounting', () => {
    for (const dmgs of [[], ['/one.dmg', '/two.dmg']]) {
      const harness = options({ listDmgs: () => dmgs })
      expect(() => verifyMacRelease(harness.value)).toThrow(`found ${String(dmgs.length)}`)
      expect(harness.calls).toEqual([])
    }
  })

  it('rejects a missing or duplicated update ZIP after the DMG passes', () => {
    for (const zips of [[], ['/one.zip', '/two.zip']]) {
      const harness = options({ listZips: () => zips })
      expect(() => verifyMacRelease(harness.value)).toThrow(`found ${String(zips.length)}`)
      expect(harness.removeMountPoint).toHaveBeenCalledOnce()
      expect(harness.calls.some(call => call.command === 'ditto')).toBe(false)
    }
  })

  it('detaches the image and preserves verification and cleanup failures', () => {
    const verifyFailure = new Error('Gatekeeper rejected the app')
    const detachFailure = new Error('detach failed')
    const harness = options({
      run: (command, args) => {
        harness.calls.push({ command, args: [...args] })
        if (command === 'spctl') throw verifyFailure
        if (command === 'hdiutil' && args[0] === 'detach') throw detachFailure
      },
    })

    let caught: unknown
    try {
      verifyMacRelease(harness.value)
    } catch (cause) {
      caught = cause
    }

    expect(caught).toBeInstanceOf(AggregateError)
    expect((caught as AggregateError).errors).toEqual([verifyFailure, detachFailure])
    expect(harness.removeMountPoint).toHaveBeenCalledOnce()
    expect(harness.removeExtractDir).not.toHaveBeenCalled()
  })

  it('fails the release when the ZIP payload is not installable and still cleans up', () => {
    const zipFailure = new Error('codesign rejected the extracted app')
    const harness = options({
      run: (command, args) => {
        harness.calls.push({ command, args: [...args] })
        if (command === 'ditto' && args[0] === '-x') throw zipFailure
      },
    })

    let caught: unknown
    try {
      verifyMacRelease(harness.value)
    } catch (cause) {
      caught = cause
    }

    expect(caught).toBeInstanceOf(AggregateError)
    expect((caught as AggregateError).errors).toEqual([zipFailure])
    expect((caught as AggregateError).message).toContain('update ZIP')
    expect(harness.removeExtractDir).toHaveBeenCalledOnce()
  })
})
