/** Package the Linux arm64 .deb from the prepared runtime and verify the archive.
 *
 * Linux 没有官方桌面产物，运行时由 `dist:linux` 前置步骤按 upstream.json 的
 * derivedRuntimes 锁组装。这里只做打包与产物校验；缺少已准备的 linux 运行时
 * 时直接失败，不会退回占位载荷。
 */
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { electronBuilderEnvironment } from './electron-builder-environment.ts'

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const builderCli = require.resolve('electron-builder/cli.js')
const manifest = JSON.parse(readFileSync(join(desktopRoot, 'package.json'), 'utf8'))
const arch = process.env.WORKDSH_LINUX_ARCH ?? 'arm64'
const outputDir = join(desktopRoot, 'dist', 'linux', arch)

function run(command, args, cwd, env) {
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with ${String(result.status)}`)
  }
}

/** Refuse to package a carrier whose bundled runtime is not the prepared linux one. */
function assertPreparedRuntime() {
  const runtime = join(desktopRoot, 'build', 'workdsh-runtime', 'primary-runtime', 'runtime.json')
  if (!existsSync(runtime)) throw new Error('Prepare the linux primary runtime first: WORKDSH_TARGET_PLATFORM=linux yarn dist:linux')
  const metadata = JSON.parse(readFileSync(runtime, 'utf8'))
  if (metadata.platform !== 'linux' || metadata.arch !== arch) {
    throw new Error(`Prepared runtime is ${String(metadata.platform)}-${String(metadata.arch)}, not linux-${arch}`)
  }
}

/** Confirm the produced deb is a Debian archive carrying control and data members. */
function verifyDeb(file) {
  if (!existsSync(file)) throw new Error(`Linux deb was not produced: ${file}`)
  if (!readFileSync(file).subarray(0, 8).equals(Buffer.from('!<arch>\n'))) {
    throw new Error(`Linux deb is not a Debian archive: ${file}`)
  }
  const listing = spawnSync('ar', ['t', file], { encoding: 'utf8' })
  if (listing.error !== undefined) throw listing.error
  if (listing.status !== 0) throw new Error(`ar t ${file} exited with ${String(listing.status)}`)
  const members = listing.stdout.split('\n').map(member => member.trim()).filter(Boolean)
  for (const member of ['debian-binary', 'control.tar', 'data.tar']) {
    if (!members.some(name => name.startsWith(member))) {
      throw new Error(`Linux deb has no ${member} member: ${members.join(', ')}`)
    }
  }
  console.log(`Verified Debian archive members: ${members.join(', ')}`)
}

function packageLinuxDeb() {
  if (arch !== 'arm64' && arch !== 'x64') {
    throw new Error(`Linux packaging requires arm64 or x64; received ${arch}`)
  }
  if (!existsSync(join(desktopRoot, 'lib', 'workdsh-main.js'))) {
    throw new Error('Build the Desktop carrier with `yarn run build` before packaging')
  }
  assertPreparedRuntime()
  rmSync(outputDir, { recursive: true, force: true })
  run(
    process.execPath,
    [
      builderCli,
      '--linux',
      'deb',
      `--${arch}`,
      '--publish',
      'never',
      '--config.npmRebuild=false',
      `--config.directories.output=${outputDir}`,
    ],
    desktopRoot,
    electronBuilderEnvironment({
      ...process.env,
      CSC_IDENTITY_AUTO_DISCOVERY: 'false',
    }),
  )
  verifyDeb(join(outputDir, `PoliceAssistant-${manifest.version}-${arch}.deb`))
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  try {
    packageLinuxDeb()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
