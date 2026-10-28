/**
 * macOS 安装交接：解压更新包、校验 .app 结构，并在应用退出后由独立助手进程原地替换。
 * 与 Windows 的 NSIS 静默安装对齐：用户确认后不再需要手工拖拽 DMG。
 */
import { execFile, spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { access, chmod, mkdir, open, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

/** Mach-O 魔数（64/32 位，大小端各一份）：防止把 HTML 错误页或截断文件当成 app。 */
const MACHO_MAGIC = new Set([0xfeedfacf, 0xcffaedfe, 0xfeedface, 0xcefaedfe])

/** 助手进程的日志与脚本名，随暂存目录一起清理。 */
const INSTALL_SCRIPT_NAME = 'install.sh'

export interface MacInstallContext {
  /** 下载并校验过的更新包（ZIP）。 */
  readonly archivePath: string
  /** 解压与助手脚本的暂存目录，位于应用自己的 userData 下。 */
  readonly stagingDirectory: string
  /** 当前运行的可执行文件绝对路径，通常是 app.getPath('exe')。 */
  readonly executablePath: string
  /** 执行外部命令；测试注入点。 */
  readonly run?: (command: string, args: readonly string[]) => Promise<void>
  /** 读取 Info.plist 中的 CFBundleIdentifier；测试注入点。 */
  readonly readBundleIdentifier?: (plistPath: string) => Promise<string | undefined>
}

export interface StagedMacUpdate {
  /** 需要被替换的已安装 .app。 */
  readonly targetApp: string
  /** 解压出来、已校验的新 .app。 */
  readonly stagedApp: string
}

export interface LaunchMacInstallerOptions extends MacInstallContext {
  /** 当前应用进程号；助手进程等它退出后才替换。 */
  readonly pid: number
  /** 助手进程日志。 */
  readonly logFile: string
  /** 目标目录写权限判断；测试注入点。 */
  readonly writable?: (directory: string) => Promise<boolean>
  /** 启动助手进程；测试注入点。 */
  readonly launchDetached?: (scriptPath: string) => Promise<void>
  /** 平台判断注入点，默认 process.platform。 */
  readonly platform?: string
}

/** 从 `X.app/Contents/MacOS/<name>` 反推 bundle 路径；结构不符时返回 undefined。 */
export function macBundlePath(executablePath: string): string | undefined {
  const macos = dirname(executablePath)
  const contents = dirname(macos)
  const bundle = dirname(contents)
  if (basename(macos) !== 'MacOS' || basename(contents) !== 'Contents') return undefined
  return bundle.endsWith('.app') ? bundle : undefined
}

/** POSIX 单引号转义：路径里的空格、引号都不能破坏脚本结构。 */
export function shellQuote(value: string): string {
  return `'${value.replaceAll('\'', '\'\\\'\'')}'`
}

/**
 * 生成原地替换脚本：等旧进程退出 → 复制到同卷的 `.new` → 原子改名替换 → 清 quarantine → 重新拉起。
 * 复制失败时保留旧版本并重新打开它，避免用户既没装上新版本也没有应用可用。
 */
export function macInstallScript(input: {
  readonly pid: number
  readonly stagedApp: string
  readonly targetApp: string
  readonly stagingDirectory: string
  readonly logFile: string
}): string {
  const target = shellQuote(input.targetApp)
  const staging = shellQuote(input.stagingDirectory)
  return `#!/bin/sh
# WorkDSH 在线更新助手：仅在本进程退出后替换应用，失败时回退到旧版本。
exec >>${shellQuote(input.logFile)} 2>&1
echo "[$(/bin/date '+%Y-%m-%dT%H:%M:%S%z')] waiting for pid ${input.pid}"
while kill -0 ${input.pid} 2>/dev/null; do /bin/sleep 1; done
NEW=${shellQuote(`${input.targetApp}.new`)}
/bin/rm -rf "$NEW"
if /usr/bin/ditto ${shellQuote(input.stagedApp)} "$NEW"; then
  /bin/rm -rf ${target}
  if /bin/mv "$NEW" ${target}; then
    /usr/bin/xattr -dr com.apple.quarantine ${target} 2>/dev/null
    echo "[$(/bin/date '+%Y-%m-%dT%H:%M:%S%z')] installed"
    /usr/bin/open ${target}
  else
    echo "failed to move the staged app into place"
    /usr/bin/open ${target}
  fi
else
  /bin/rm -rf "$NEW"
  echo "failed to copy the staged app"
  /usr/bin/open ${target}
fi
/bin/rm -rf ${staging}
`
}

async function defaultRun(command: string, args: readonly string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    execFile(command, [...args], error => {
      if (error !== null && error !== undefined) reject(error)
      else resolve()
    })
  })
}

async function defaultReadBundleIdentifier(plistPath: string): Promise<string | undefined> {
  return await new Promise<string | undefined>(resolve => {
    execFile(
      '/usr/bin/plutil',
      ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', plistPath],
      { encoding: 'utf8' },
      (error, stdout) => {
        if (error !== null && error !== undefined) resolve(undefined)
        else resolve(stdout.trim() === '' ? undefined : stdout.trim())
      },
    )
  })
}

async function canWrite(directory: string): Promise<boolean> {
  try {
    await access(directory, constants.W_OK)
    return true
  } catch {
    return false
  }
}

function launchDetached(scriptPath: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn('/bin/sh', [scriptPath], {
      detached: true,
      stdio: 'ignore',
      shell: false,
    })
    const cleanup = (): void => {
      child.off('error', onError)
      child.off('spawn', onSpawn)
    }
    const onError = (error: Error): void => {
      cleanup()
      reject(error)
    }
    const onSpawn = (): void => {
      cleanup()
      child.unref()
      resolve()
    }
    child.once('error', onError)
    child.once('spawn', onSpawn)
  })
}

/** 结构校验：必须是目录、含 Info.plist，且可执行文件是 Mach-O。 */
async function verifyMacApp(appPath: string, executableName: string): Promise<void> {
  const info = await stat(appPath)
  if (!info.isDirectory()) throw new Error('更新包内不是应用目录')
  const plist = await stat(join(appPath, 'Contents', 'Info.plist'))
  if (!plist.isFile()) throw new Error('更新包内缺少 Info.plist')

  const executable = join(appPath, 'Contents', 'MacOS', executableName)
  const handle = await open(executable, 'r')
  try {
    const head = Buffer.alloc(4)
    const { bytesRead } = await handle.read(head, 0, head.length, 0)
    if (bytesRead !== head.length || !MACHO_MAGIC.has(head.readUInt32LE(0))) {
      throw new Error('更新包内不是可执行的 macOS 应用')
    }
  } finally {
    await handle.close()
  }
}

/**
 * 解压更新包并校验新应用：结构、Mach-O 与 bundle 标识都要与当前应用一致。
 * @param context - 更新包、暂存目录与当前应用位置。
 * @returns 已校验的新 .app 与待替换的已安装 .app。
 */
export async function stageMacUpdate(context: MacInstallContext): Promise<StagedMacUpdate> {
  const targetApp = macBundlePath(context.executablePath)
  if (targetApp === undefined) throw new Error('无法定位当前应用所在的应用包')

  const run = context.run ?? defaultRun
  const readBundleIdentifier = context.readBundleIdentifier ?? defaultReadBundleIdentifier
  await rm(context.stagingDirectory, { recursive: true, force: true })
  await mkdir(context.stagingDirectory, { recursive: true, mode: 0o700 })
  await run('/usr/bin/ditto', ['-x', '-k', context.archivePath, context.stagingDirectory])

  const bundles = (await readdir(context.stagingDirectory)).filter(name => name.endsWith('.app'))
  if (bundles.length !== 1) throw new Error('更新包内必须包含且只包含一个应用')
  const stagedApp = join(context.stagingDirectory, bundles[0]!)
  const executableName = basename(context.executablePath)
  await verifyMacApp(stagedApp, executableName)

  const current = await readBundleIdentifier(join(targetApp, 'Contents', 'Info.plist'))
  const staged = await readBundleIdentifier(join(stagedApp, 'Contents', 'Info.plist'))
  if (current === undefined || staged === undefined || current !== staged) {
    throw new Error('更新包与本机应用不是同一个应用')
  }
  return { targetApp, stagedApp }
}

/**
 * 校验通过后启动助手进程并返回；调用方随后退出应用，由助手完成替换与重新拉起。
 * @param options - 更新包位置、进程号、日志与测试注入点。
 */
export async function launchMacInstaller(options: LaunchMacInstallerOptions): Promise<void> {
  if ((options.platform ?? process.platform) !== 'darwin') {
    throw new Error('当前平台不支持 macOS 原地升级')
  }
  const { targetApp, stagedApp } = await stageMacUpdate(options)

  const writable = options.writable ?? canWrite
  if (!await writable(dirname(targetApp))) {
    throw new Error('没有权限替换应用目录中的当前版本')
  }

  const scriptPath = join(options.stagingDirectory, INSTALL_SCRIPT_NAME)
  await mkdir(dirname(options.logFile), { recursive: true })
  await writeFile(scriptPath, macInstallScript({
    pid: options.pid,
    stagedApp,
    targetApp,
    stagingDirectory: options.stagingDirectory,
    logFile: options.logFile,
  }), { mode: 0o700 })
  await chmod(scriptPath, 0o700)
  await (options.launchDetached ?? launchDetached)(scriptPath)
}
