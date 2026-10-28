import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  launchMacInstaller,
  macBundlePath,
  macInstallScript,
  shellQuote,
  stageMacUpdate,
} from '../src/update-install-mac.ts'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'workdsh-mac-install-'))
  roots.push(root)
  return root
}

/** Mach-O 64 位小端魔数；用于让结构校验通过。 */
const MACHO = Buffer.from([0xcf, 0xfa, 0xed, 0xfe])

async function fakeApp(appPath: string, executableName = 'PoliceAssistant'): Promise<void> {
  await mkdir(join(appPath, 'Contents', 'MacOS'), { recursive: true })
  await writeFile(join(appPath, 'Contents', 'Info.plist'), 'plist')
  await writeFile(join(appPath, 'Contents', 'MacOS', executableName), MACHO)
}

/** 模拟 ditto 解压：在暂存目录里放一个同名 .app。 */
function extractingRun(stagingDirectory: string, bundles: readonly string[] = ['PoliceAssistant.app']) {
  const calls: string[] = []
  return {
    calls,
    run: async (command: string, args: readonly string[]): Promise<void> => {
      calls.push(`${command} ${args.join(' ')}`)
      await mkdir(stagingDirectory, { recursive: true })
      for (const bundle of bundles) await fakeApp(join(stagingDirectory, bundle))
    },
  }
}

describe('macOS bundle location', () => {
  it('derives the app bundle from the running executable', () => {
    expect(macBundlePath('/Applications/PoliceAssistant.app/Contents/MacOS/PoliceAssistant'))
      .toBe('/Applications/PoliceAssistant.app')
  })

  it('refuses paths that are not inside an app bundle', () => {
    expect(macBundlePath('/usr/local/bin/node')).toBeUndefined()
    expect(macBundlePath('/Applications/PoliceAssistant.app/Contents/Frameworks/Electron')).toBeUndefined()
  })

  it('quotes paths so spaces and apostrophes cannot break the helper script', () => {
    expect(shellQuote('/Applications/Police Assistant.app')).toBe('\'/Applications/Police Assistant.app\'')
    expect(shellQuote('/tmp/it\'s.app')).toBe('\'/tmp/it\'\\\'\'s.app\'')
  })
})

describe('macOS install helper script', () => {
  it('waits for the current process, swaps the bundle atomically, and reopens the app', () => {
    const script = macInstallScript({
      pid: 4242,
      stagedApp: '/Users/me/Library/Application Support/PoliceAssistant/updates/staging/1.0.2/PoliceAssistant.app',
      targetApp: '/Applications/Police Assistant.app',
      stagingDirectory: '/Users/me/Library/Application Support/PoliceAssistant/updates/staging/1.0.2',
      logFile: '/Users/me/Library/Application Support/PoliceAssistant/logs/update-install.log',
    })

    expect(script).toContain('while kill -0 4242 2>/dev/null; do /bin/sleep 1; done')
    expect(script).toContain('/usr/bin/ditto \'/Users/me/Library/Application Support/PoliceAssistant/updates/staging/1.0.2/PoliceAssistant.app\' "$NEW"')
    expect(script).toContain('NEW=\'/Applications/Police Assistant.app.new\'')
    expect(script).toContain('/bin/mv "$NEW" \'/Applications/Police Assistant.app\'')
    expect(script).toContain('/usr/bin/xattr -dr com.apple.quarantine \'/Applications/Police Assistant.app\'')
    expect(script).toContain('/usr/bin/open \'/Applications/Police Assistant.app\'')
    // 替换失败时也要重新打开旧版本，避免用户既没有新版本也没有可用应用。
    expect(script.split('/usr/bin/open').length - 1).toBe(3)
    expect(script.trimEnd().endsWith(
      '/bin/rm -rf \'/Users/me/Library/Application Support/PoliceAssistant/updates/staging/1.0.2\'',
    )).toBe(true)
  })
})

describe('macOS update staging', () => {
  it('extracts exactly one bundle and returns the installed and staged app paths', async () => {
    const root = await workspace()
    const installed = join(root, 'Applications', 'PoliceAssistant.app')
    await fakeApp(installed)
    const staging = join(root, 'staging')
    const extract = extractingRun(staging)

    const staged = await stageMacUpdate({
      archivePath: join(root, 'update.zip'),
      stagingDirectory: staging,
      executablePath: join(installed, 'Contents', 'MacOS', 'PoliceAssistant'),
      run: extract.run,
      readBundleIdentifier: async () => 'io.techflag.dsh.ssh',
    })

    expect(staged).toEqual({ targetApp: installed, stagedApp: join(staging, 'PoliceAssistant.app') })
    expect(extract.calls).toEqual([`/usr/bin/ditto -x -k ${join(root, 'update.zip')} ${staging}`])
  })

  it('rejects a payload that does not contain exactly one application', async () => {
    const root = await workspace()
    const installed = join(root, 'Applications', 'PoliceAssistant.app')
    await fakeApp(installed)
    for (const bundles of [[], ['A.app', 'B.app']]) {
      const staging = join(root, `staging-${String(bundles.length)}`)
      const extract = extractingRun(staging, bundles)
      await expect(stageMacUpdate({
        archivePath: join(root, 'update.zip'),
        stagingDirectory: staging,
        executablePath: join(installed, 'Contents', 'MacOS', 'PoliceAssistant'),
        run: extract.run,
        readBundleIdentifier: async () => 'io.techflag.dsh.ssh',
      })).rejects.toThrow('只包含一个应用')
    }
  })

  it('rejects a staged bundle whose identity differs from the running app', async () => {
    const root = await workspace()
    const installed = join(root, 'Applications', 'PoliceAssistant.app')
    await fakeApp(installed)
    const staging = join(root, 'staging')
    const extract = extractingRun(staging)
    const identities = ['io.techflag.dsh.ssh', 'com.example.other']

    await expect(stageMacUpdate({
      archivePath: join(root, 'update.zip'),
      stagingDirectory: staging,
      executablePath: join(installed, 'Contents', 'MacOS', 'PoliceAssistant'),
      run: extract.run,
      readBundleIdentifier: async () => identities.shift(),
    })).rejects.toThrow('不是同一个应用')
  })

  it('rejects a staged executable that is not Mach-O', async () => {
    const root = await workspace()
    const installed = join(root, 'Applications', 'PoliceAssistant.app')
    await fakeApp(installed)
    const staging = join(root, 'staging')
    const run = async (): Promise<void> => {
      await fakeApp(join(staging, 'PoliceAssistant.app'))
      await writeFile(join(staging, 'PoliceAssistant.app', 'Contents', 'MacOS', 'PoliceAssistant'), '<html>')
    }

    await expect(stageMacUpdate({
      archivePath: join(root, 'update.zip'),
      stagingDirectory: staging,
      executablePath: join(installed, 'Contents', 'MacOS', 'PoliceAssistant'),
      run,
      readBundleIdentifier: async () => 'io.techflag.dsh.ssh',
    })).rejects.toThrow('不是可执行的 macOS 应用')
  })
})

describe('macOS install handoff', () => {
  async function installedApp(root: string): Promise<string> {
    const installed = join(root, 'Applications', 'PoliceAssistant.app')
    await fakeApp(installed)
    return installed
  }

  it('only runs on macOS', async () => {
    const root = await workspace()
    const installed = await installedApp(root)
    await expect(launchMacInstaller({
      archivePath: join(root, 'update.zip'),
      stagingDirectory: join(root, 'staging'),
      executablePath: join(installed, 'Contents', 'MacOS', 'PoliceAssistant'),
      pid: 1,
      logFile: join(root, 'logs', 'update-install.log'),
      platform: 'win32',
    })).rejects.toThrow('不支持 macOS 原地升级')
  })

  it('fails before quitting when the install location is not writable', async () => {
    const root = await workspace()
    const installed = await installedApp(root)
    const staging = join(root, 'staging')
    const launchDetached = vi.fn()

    await expect(launchMacInstaller({
      archivePath: join(root, 'update.zip'),
      stagingDirectory: staging,
      executablePath: join(installed, 'Contents', 'MacOS', 'PoliceAssistant'),
      pid: 1234,
      logFile: join(root, 'logs', 'update-install.log'),
      platform: 'darwin',
      run: extractingRun(staging).run,
      readBundleIdentifier: async () => 'io.techflag.dsh.ssh',
      writable: async () => false,
      launchDetached,
    })).rejects.toThrow('没有权限')

    expect(launchDetached).not.toHaveBeenCalled()
  })

  it('writes an executable helper and hands it off without blocking the app', async () => {
    const root = await workspace()
    const installed = await installedApp(root)
    const staging = join(root, 'staging')
    const logFile = join(root, 'logs', 'update-install.log')
    const launched: string[] = []

    await launchMacInstaller({
      archivePath: join(root, 'update.zip'),
      stagingDirectory: staging,
      executablePath: join(installed, 'Contents', 'MacOS', 'PoliceAssistant'),
      pid: 1234,
      logFile,
      platform: 'darwin',
      run: extractingRun(staging).run,
      readBundleIdentifier: async () => 'io.techflag.dsh.ssh',
      writable: async () => true,
      launchDetached: async scriptPath => { launched.push(scriptPath) },
    })

    const scriptPath = join(staging, 'install.sh')
    expect(launched).toEqual([scriptPath])
    const script = await readFile(scriptPath, 'utf8')
    expect(script).toContain('while kill -0 1234')
    expect(script).toContain(installed)
    if (process.platform !== 'win32') {
      expect((await stat(scriptPath)).mode & 0o777).toBe(0o700)
    }
  })
})
