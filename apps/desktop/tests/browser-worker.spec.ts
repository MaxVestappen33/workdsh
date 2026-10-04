import { expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { browserWorkerExecutable } from '../src/browser-worker.ts'
import { prepareBrowserWorker } from '../scripts/prepare-browser-worker.ts'

it('uses the native background bundle only in packaged macOS', () => {
  expect(browserWorkerExecutable('/Applications/WorkDSH.app/Contents/MacOS/WorkDSH', 'darwin', false)).toBe('/Applications/WorkDSH.app/Contents/Helpers/WorkDSH Browser.app/Contents/MacOS/WorkDSH Browser')
  expect(browserWorkerExecutable('/development/Electron', 'darwin', true)).toBe('/development/Electron')
  expect(browserWorkerExecutable('C:/WorkDSH.exe', 'win32', false)).toBe('C:/WorkDSH.exe')
})

it.skipIf(process.platform !== 'darwin')('declares UIElement before launch and shares existing frameworks and resources', async () => {
  const root = mkdtempSync(join(tmpdir(), 'workdsh-native-worker-'))
  const contents = join(root, 'WorkDSH.app', 'Contents')
  try {
    mkdirSync(join(contents, 'Resources'), { recursive: true }); mkdirSync(join(contents, 'Frameworks'))
    writeFileSync(join(contents, 'Info.plist'), '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>WorkDSH</string><key>CFBundleName</key><string>WorkDSH</string><key>CFBundleIdentifier</key><string>io.techflag.dsh.ssh</string></dict></plist>')
    await prepareBrowserWorker(contents, join(process.cwd(), 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'))
    const helper = join(contents, 'Helpers/WorkDSH Browser.app/Contents')
    expect(execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :LSUIElement', join(helper, 'Info.plist')], { encoding: 'utf8' }).trim()).toBe('true')
    expect(realpathSync(join(helper, 'Resources'))).toBe(realpathSync(join(contents, 'Resources')))
    expect(realpathSync(join(helper, 'Frameworks'))).toBe(realpathSync(join(contents, 'Frameworks')))
  } finally { rmSync(root, { recursive: true, force: true }) }
})
