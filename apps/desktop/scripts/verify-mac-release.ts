/** Verify the signed application inside one macOS release DMG and the matching update ZIP. */

import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Injectable filesystem and command boundaries for release verification. */
export interface MacReleaseVerificationOptions {
  /** Directory containing exactly one release DMG and one update ZIP. */
  readonly distDir: string
  /** Architecture expected in this release. */
  readonly targetArch: 'x64' | 'arm64'
  /** Installed application bundle and executable name inside the artifacts. */
  readonly executableName: string
  /** Return regular DMG files in the distribution directory. */
  readonly listDmgs: (distDir: string) => readonly string[]
  /** Return regular ZIP files in the distribution directory. */
  readonly listZips: (distDir: string) => readonly string[]
  /** Create a private empty mount point. */
  readonly makeMountPoint: () => string
  /** Create a private empty ZIP extraction directory. */
  readonly makeExtractDir: () => string
  /** Execute one macOS verification command. */
  readonly run: (command: string, args: readonly string[]) => void
  /** Remove the detached empty mount point. */
  readonly removeMountPoint: (mountPoint: string) => void
  /** Remove the private ZIP extraction directory. */
  readonly removeExtractDir: (directory: string) => void
}

function artifactsWithExtension(distDir: string, extension: string): readonly string[] {
  return readdirSync(distDir)
    .filter(name => name.endsWith(extension))
    .map(name => join(distDir, name))
    .filter(path => statSync(path).isFile())
}

function listDmgs(distDir: string): readonly string[] {
  return artifactsWithExtension(distDir, '.dmg')
}

function listZips(distDir: string): readonly string[] {
  return artifactsWithExtension(distDir, '.zip')
}

function run(command: string, args: readonly string[]): void {
  const result = spawnSync(command, args, { stdio: 'inherit' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with ${String(result.status)}`)
  }
}

function defaultOptions(): MacReleaseVerificationOptions {
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  return {
    distDir: process.argv[2] === undefined
      ? join(packageRoot, 'dist', 'mac-release')
      : resolve(process.argv[2]),
    targetArch: process.argv[3] === 'x64' ? 'x64' : 'arm64',
    executableName: 'PoliceAssistant',
    listDmgs,
    listZips,
    makeMountPoint: () => mkdtempSync(join(tmpdir(), 'dsh-desktop-dmg-')),
    makeExtractDir: () => mkdtempSync(join(tmpdir(), 'dsh-desktop-zip-')),
    run,
    removeMountPoint: mountPoint => rmdirSync(mountPoint),
    removeExtractDir: directory => rmdirSync(directory),
  }
}

/** Signature, Gatekeeper, architecture, and stapled-ticket checks shared by both artifacts. */
function verifyApp(
  appPath: string,
  options: MacReleaseVerificationOptions,
): void {
  const executablePath = join(appPath, 'Contents', 'MacOS', options.executableName)
  const binaryArch = options.targetArch === 'x64' ? 'x86_64' : 'arm64'
  options.run('lipo', [executablePath, '-verify_arch', binaryArch])
  options.run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath])
  options.run('spctl', ['--assess', '--type', 'execute', '--verbose=4', appPath])
  options.run('xcrun', ['stapler', 'validate', appPath])
}

function uniqueArtifact(
  paths: readonly string[],
  distDir: string,
  kind: string,
): string {
  if (paths.length !== 1) {
    throw new Error(
      `macOS release verification requires exactly one ${kind} in ${distDir}; found ${String(paths.length)}`,
    )
  }
  return paths[0]!
}

/**
 * Verify the mounted DMG first, then the update ZIP used by in-app upgrades.
 * Both artifacts seal the same signed application; the ZIP must stay installable
 * without Gatekeeper or stapler regressions.
 * @param options - Filesystem and command boundaries.
 * @returns The verified artifact and application paths.
 */
export function verifyMacRelease(
  options: MacReleaseVerificationOptions = defaultOptions(),
): { readonly appPath: string; readonly dmgPath: string; readonly zipPath: string; readonly zipAppPath: string } {
  if (options.targetArch !== 'x64' && options.targetArch !== 'arm64') {
    throw new Error(`unsupported macOS target architecture: ${options.targetArch}`)
  }
  const dmgPath = uniqueArtifact(options.listDmgs(options.distDir), options.distDir, 'DMG')
  const mountPoint = options.makeMountPoint()
  const appPath = join(mountPoint, `${options.executableName}.app`)
  let mounted = false
  let failure: unknown

  try {
    options.run('hdiutil', ['attach', dmgPath, '-mountpoint', mountPoint, '-nobrowse', '-readonly'])
    mounted = true
    verifyApp(appPath, options)
  } catch (cause) {
    failure = cause
  }

  const cleanupFailures: unknown[] = []
  if (mounted) {
    try {
      options.run('hdiutil', ['detach', mountPoint])
    } catch (cause) {
      cleanupFailures.push(cause)
    }
  }
  try {
    options.removeMountPoint(mountPoint)
  } catch (cause) {
    cleanupFailures.push(cause)
  }

  if (failure !== undefined || cleanupFailures.length > 0) {
    const failures = failure === undefined ? cleanupFailures : [failure, ...cleanupFailures]
    throw new AggregateError(failures, `failed to verify macOS release DMG ${basename(dmgPath)}`)
  }

  const zipPath = uniqueArtifact(options.listZips(options.distDir), options.distDir, 'ZIP')
  const extractDir = options.makeExtractDir()
  const zipAppPath = join(extractDir, `${options.executableName}.app`)
  let zipFailure: unknown
  try {
    options.run('ditto', ['-x', '-k', zipPath, extractDir])
    verifyApp(zipAppPath, options)
  } catch (cause) {
    zipFailure = cause
  }
  const zipCleanupFailures: unknown[] = []
  try {
    options.removeExtractDir(extractDir)
  } catch (cause) {
    zipCleanupFailures.push(cause)
  }
  if (zipFailure !== undefined || zipCleanupFailures.length > 0) {
    const failures = zipFailure === undefined ? zipCleanupFailures : [zipFailure, ...zipCleanupFailures]
    throw new AggregateError(failures, `failed to verify macOS update ZIP ${basename(zipPath)}`)
  }

  return { appPath, dmgPath, zipPath, zipAppPath }
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  try {
    const verified = verifyMacRelease()
    console.log(`macOS release verification passed: ${verified.dmgPath} and ${verified.zipPath}`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
