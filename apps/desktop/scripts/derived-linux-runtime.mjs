/** Assemble the linux-arm64 primary runtime from locked official upstream builds.
 *
 * 官方没有发布 linux 桌面产物，因此这里按 upstream.json 的 derivedRuntimes 锁，
 * 用 nodejs.org / python-build-standalone 的官方构建加上官方 macOS 运行时里的
 * pnpm、office-skills、cli 组合出等价载荷。每个下载源都按 SHA-256 校验；缺失或
 * 不匹配时直接失败，不做任何自动回退。
 */
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, readlinkSync, renameSync, rmSync, statSync, writeFileSync, cpSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { derivedRuntimeLock, verifyDerivedRuntimeProvenance, writeDerivedRuntimeProvenance } from './official-runtime-provenance.mjs'
import { prepareOfficialRelease } from './official-desktop-release.mjs'

const PROVENANCE_FILE = '.workdsh-source-artifact.json'
const PYTHON_PLATFORMS = [
  '--platform', 'manylinux_2_28_aarch64',
  '--platform', 'manylinux2014_aarch64',
  '--python-version', '3.12',
  '--implementation', 'cp',
  '--abi', 'cp312',
]

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} exited with ${String(result.status)}`)
}

async function sha256(file) {
  const digest = createHash('sha256')
  for await (const chunk of createReadStream(file)) digest.update(chunk)
  return digest.digest('hex')
}

/** Download one locked component and refuse anything whose bytes moved. */
async function downloadLocked(url, sha256Hex, destination) {
  if (existsSync(destination)) {
    if (await sha256(destination) === sha256Hex) return destination
    rmSync(destination, { force: true })
  }
  const partial = destination + '.partial'
  try {
    // curl 尊重宿主机的代理与系统证书，Node 的 fetch 在企业网络里常连不上 release 资产。
    run('curl', ['-fL', '--retry', '3', '--connect-timeout', '30', '--max-time', '1800', '-o', partial, url], dirname(destination))
    const actual = await sha256(partial)
    if (actual !== sha256Hex) throw new Error(`Derived runtime SHA-256 mismatch for ${url}: ${actual}`)
    renameSync(partial, destination)
  } finally {
    rmSync(partial, { force: true })
  }
  return destination
}

function extract(archive, destination) {
  mkdirSync(destination, { recursive: true })
  run('tar', ['-xf', archive, '-C', destination])
  return destination
}

/** Digest of the runtime payload, excluding this project's own provenance record. */
export function payloadDigest(root) {
  const digest = createHash('sha256')
  const walk = (directory, prefix) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => (left.name < right.name ? -1 : 1))) {
      const relative = `${prefix}${entry.name}`
      const absolute = join(directory, entry.name)
      if (entry.isDirectory()) {
        digest.update(`directory ${relative}\n`)
        walk(absolute, `${relative}/`)
      } else if (entry.isSymbolicLink()) {
        digest.update(`link ${relative} ${readlinkSync(absolute)}\n`)
      } else if (entry.isFile() && entry.name !== PROVENANCE_FILE) {
        digest.update(`file ${relative} ${statSync(absolute).size}\n`)
      }
    }
  }
  walk(root, '')
  return digest.digest('hex')
}

/** Prepare the locked python wheels for aarch64 and confirm the exact locked set. */
function prepareWheels(derived, python, cache, pythonPackages) {
  const directory = join(cache, 'wheels')
  mkdirSync(directory, { recursive: true })
  const expected = derived.wheelNames
  const present = readdirSync(directory).filter(name => name.endsWith('.whl'))
  const verified = present.length === expected.length && expected.every(name => {
    const file = join(directory, name)
    return existsSync(file) && createHash('sha256').update(readFileSync(file)).digest('hex') === derived.wheels[name]
  })
  if (!verified) {
    rmSync(directory, { recursive: true, force: true })
    mkdirSync(directory, { recursive: true })
    run(python, ['-m', 'pip', 'download', '--only-binary=:all:', ...PYTHON_PLATFORMS,
      '-d', directory, ...Object.entries(pythonPackages).map(([name, version]) => `${name}==${String(version)}`)], cache)
  }
  const actual = readdirSync(directory).filter(name => name.endsWith('.whl')).sort()
  if (actual.join('\n') !== expected.join('\n')) {
    throw new Error(`Derived python wheel set differs from the lock; expected [${expected.join(', ')}] got [${actual.join(', ')}]`)
  }
  return directory
}

/**
 * Build `build/derived-runtime/<target>` with the runtime/{primary-runtime,office-skills,cli}
 * shape that the official desktop archive also provides.
 */
export async function prepareDerivedRuntime(desktopRoot, target) {
  const derived = derivedRuntimeLock(target)
  const cache = join(desktopRoot, 'build/derived-runtime-cache')
  const destination = join(desktopRoot, 'build/derived-runtime', target)
  const primary = join(destination, 'runtime', 'primary-runtime')
  if (existsSync(join(primary, 'runtime.json')) && existsSync(join(destination, 'runtime', 'office-skills')) && existsSync(join(destination, 'runtime', 'cli'))) {
    try {
      verifyDerivedRuntimeProvenance(primary, target)
      return destination
    } catch { /* 载荷与锁不一致时重新组装，不沿用旧结果。 */ }
  }
  mkdirSync(cache, { recursive: true })
  rmSync(destination, { recursive: true, force: true })
  mkdirSync(destination, { recursive: true })

  // 官方 macOS 产物提供 pnpm、office-skills、cli 与 python 包清单；这些内容与平台无关。
  const official = await prepareOfficialRelease(desktopRoot, 'mac-arm64')
  const officialRuntime = join(official, 'runtime', 'primary-runtime')
  const officialMetadata = JSON.parse(readFileSync(join(officialRuntime, 'runtime.json'), 'utf8'))

  const nodeArchive = await downloadLocked(derived.node.url, derived.node.sha256, join(cache, 'node-' + derived.node.version + '-linux-arm64.tar.xz'))
  const pythonArchive = await downloadLocked(derived.python.url, derived.python.sha256, join(cache, 'cpython-' + derived.python.version + '-aarch64-linux-gnu.tar.gz'))
  const extracted = join(cache, 'extract-' + String(Date.now()))
  mkdirSync(extracted, { recursive: true })
  try {
    const nodeRoot = join(extracted, 'node')
    extract(nodeArchive, nodeRoot)
    const nodeDirectory = readdirSync(nodeRoot).find(name => name.startsWith('node-v'))
    if (nodeDirectory === undefined) throw new Error('Derived node archive has no distribution root')
    const primary = join(destination, 'runtime', 'primary-runtime')
    const dependencies = join(primary, 'dependencies')
    mkdirSync(join(dependencies, 'node', 'bin'), { recursive: true })
    cpSync(join(nodeRoot, nodeDirectory, 'bin', 'node'), join(dependencies, 'node', 'bin', 'node'))
    cpSync(join(nodeRoot, nodeDirectory, 'LICENSE'), join(dependencies, 'node', 'LICENSE'))
    mkdirSync(join(dependencies, 'node', 'node_modules'), { recursive: true })
    writeFileSync(join(dependencies, 'node', 'node_modules', 'README.txt'), 'The official runtime ships Node without npm; install packages with the pinned pnpm below.\n')

    const pythonRoot = extract(pythonArchive, join(extracted, 'python'))
    if (!existsSync(join(pythonRoot, 'python', 'bin', 'python3'))) throw new Error('Derived python archive has no python/bin/python3')
    cpSync(join(pythonRoot, 'python'), join(dependencies, 'python'), { recursive: true, force: true, dereference: false, verbatimSymlinks: true })

    cpSync(join(officialRuntime, 'dependencies', 'pnpm'), join(dependencies, 'pnpm'), { recursive: true, force: true, dereference: false })
    cpSync(join(official, 'runtime', 'office-skills'), join(destination, 'runtime', 'office-skills'), { recursive: true, force: true, dereference: false })
    cpSync(join(official, 'runtime', 'cli'), join(destination, 'runtime', 'cli'), { recursive: true, force: true, dereference: false })
    // link-entry 只在 darwin 的分支里使用；command-path.ps1 只服务 Windows。
    rmSync(join(destination, 'runtime', 'cli', 'link-entry'), { force: true })
    rmSync(join(destination, 'runtime', 'cli', 'command-path.ps1'), { force: true })

    const python = join(officialRuntime, 'dependencies', 'python', 'bin', 'python3')
    if (!existsSync(python)) throw new Error('The official macOS runtime python is required to resolve the locked linux wheels')
    const wheels = prepareWheels(derived, python, cache, officialMetadata.pythonPackages ?? {})
    const sitePackages = join(dependencies, 'python', 'lib', 'python3.12', 'site-packages')
    mkdirSync(sitePackages, { recursive: true })
    run(python, ['-m', 'pip', 'install', '--no-index', '--find-links', wheels, '--target', sitePackages, '--only-binary=:all:', ...PYTHON_PLATFORMS, '--no-deps', '--no-compile',
      ...Object.entries(officialMetadata.pythonPackages ?? {}).map(([name, version]) => `${name}==${String(version)}`)], cache)

    writeFileSync(join(primary, 'runtime.json'), JSON.stringify({
      desktopVersion: derived.version,
      platform: 'linux',
      arch: target.slice('linux-'.length),
      payloadDigest: payloadDigest(primary),
      python: derived.python.version,
      node: derived.node.version,
      pnpm: derived.pnpm.version,
      pythonPackages: officialMetadata.pythonPackages ?? {},
    }, null, 2) + '\n')
    writeDerivedRuntimeProvenance(primary, target)
  } finally {
    rmSync(extracted, { recursive: true, force: true })
  }
  return destination
}
