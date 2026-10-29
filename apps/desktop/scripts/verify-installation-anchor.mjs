#!/usr/bin/env node
/** Boot the public official Profile API with release resources and no local node_modules. */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { materializeRuntimeProfile, officialHostLauncher } from '../src/local-runtime.ts'
import { DSH_VERSION } from './runtime-version.mjs'
import { BUILTIN_BUNDLES, PRODUCT_PACKAGES } from './workdsh-package-boundary.mjs'
import { verifyOfficialWebPackages } from './verify-profile-release.mjs'
import { prepareHostSmokeProbe, hostSmokeEnvironment, waitForPackagedHostReady, scrubHostDiagnostics as scrub } from './packaged-host-smoke.mjs'

const runtime = resolve(process.argv[2] ?? fileURLToPath(new URL('../build/workdsh-runtime', import.meta.url)))
const source = join(runtime, 'profiles/workdsh')
const primary = join(runtime, 'primary-runtime')
const executable = join(primary, 'dependencies/node/bin', process.platform === 'win32' ? 'node.exe' : 'node')
const pnpm = join(primary, 'dependencies/pnpm/bin/pnpm.cjs')
const release = JSON.parse(readFileSync(join(runtime, 'package-cache/release-manifest.json'), 'utf8'))
const actual = JSON.parse(readFileSync(join(source, 'node_modules/@deepseek-ai/dsh/package.json'), 'utf8')).version
if (actual !== DSH_VERSION) throw new Error('Installation anchor uses another official DSH version')
verifyOfficialWebPackages(release, source)
const home = mkdtempSync(join(tmpdir(), 'workdsh-anchor-check-'))
let child
let finished
let diagnostics = () => ''
try {
  const { profile } = materializeRuntimeProfile(source, home)
  if (existsSync(join(profile, 'node_modules'))) throw new Error('Fresh Profile unexpectedly has its own dependency tree')
  const inventory = spawnSync(executable, [fileURLToPath(new URL('./verify-product-plugin-inventory.mjs', import.meta.url)), runtime, profile], { encoding: 'utf8', timeout: 30_000 })
  if (inventory.error || inventory.status !== 0) throw new Error('Writable Profile product inventory failed: ' + (inventory.error?.message ?? scrub(inventory.stdout + inventory.stderr)))
  const patch = prepareHostSmokeProbe(home)
  const launcher = officialHostLauncher(source, home, executable, pnpm, [join(source, 'cordis.patch.yml'), patch])
  const env = hostSmokeEnvironment(home, primary, executable)
  child = spawn(executable, [launcher, '--no-open'], { env, cwd: home, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
  finished = new Promise(resolveExit => child.once('close', resolveExit))
  const startup = waitForPackagedHostReady(child)
  diagnostics = startup.diagnostics
  const { url, receipt } = await startup.ready
  if (receipt.installAnchor !== join(source, 'profile-installation.json')) throw new Error('Host smoke used another installation anchor')
  const authorize = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(20_000) })
  if (authorize.status !== 303) throw new Error('Official process-token login did not exchange for a browser cookie')
  const target = new URL(authorize.headers.get('location'), url)
  if (target.origin !== new URL(url).origin) throw new Error('Official process-token login changed origin')
  const cookie = authorize.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
  if (!cookie) throw new Error('Official process-token login did not issue a cookie')
  const response = await fetch(target, { headers: { cookie }, signal: AbortSignal.timeout(20_000) })
  if (!response.ok) throw new Error('Official Web page failed: ' + response.status)
  const html = await response.text()
  const match = html.match(/globalThis\["__DSH_BOOT__"\] = (.*?)<\/script>/su)
  if (!match) throw new Error('Official Web did not advertise its Client boot graph')
  const graph = JSON.parse(match[1])
  const ids = new Set(graph.entries.map(entry => entry.id))
  for (const client of release.officialWeb.clients.filter(row => !row.conditional)) {
    if (!ids.has(client.package)) throw new Error('Unconditional official Web client missing at runtime: ' + client.package)
  }
  // Built-in third-party bundles must render from the immutable runtime on a
  // fresh Profile: their client is part of the boot graph, not installed later.
  for (const name of Object.keys(BUILTIN_BUNDLES)) {
    if (!ids.has(name)) throw new Error('Built-in plugin client missing at runtime: ' + name + '; ' + diagnostics())
  }
  // account-settings 声明 client.immediately，官方客户端会立即拉起随包的账号设置 UI；
  // 其余默认客户端必须与产品清单完全一致，不允许额外 WorkDSH 客户端混入。
  const expectedOwned = [...PRODUCT_PACKAGES, 'workdsh-bundle', 'workdsh-plugin-account-settings'].sort()
  for (const name of expectedOwned) if (!ids.has(name)) throw new Error('Owned client missing at runtime: ' + name + '; owned graph=' + [...ids].filter(row => row.startsWith('workdsh-')).join(',') + '; ' + diagnostics())
  const owned = [...ids].filter(name => name.startsWith('workdsh-')).sort()
  if (JSON.stringify(owned) !== JSON.stringify(expectedOwned)) throw new Error('Unexpected default owned client inventory: expected=' + JSON.stringify(expectedOwned) + '; actual=' + JSON.stringify(owned) + '; ' + diagnostics())
  for (const batch of graph.batches) {
    const address = new URL(batch.url, url)
    if (address.origin !== new URL(url).origin) throw new Error('Client batch escaped the loopback runtime origin')
    const artifact = await fetch(address, { redirect: 'error', signal: AbortSignal.timeout(20_000) })
    if (!artifact.ok || !(await artifact.text()).includes('__ModuleLoader__')) throw new Error('Advertised client batch is unavailable')
  }
  if (existsSync(join(profile, 'node_modules'))) throw new Error('Runtime wrote a shared or copied dependency tree into the writable Profile')
  if (/failed to import|startup.*failed|ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND/iu.test(diagnostics())) throw new Error('Official Host reported a startup/import failure: ' + diagnostics())
  console.log(JSON.stringify({ dsh: actual, independentWritableProfile: true, noProfileNodeModules: true, installationProvidedProductBundles: PRODUCT_PACKAGES, initializedProductServices: receipt.services, officialRoster: release.officialWeb.clients.length, loadedOfficialClients: [...ids].filter(name => name.startsWith('@deepseek-ai/dsh')).length, ownedClients: owned, clientBatches: graph.batches.length, modelCallsRequested: 0, guiLaunchRequested: false }))
} finally {
  if (child && child.exitCode === null) {
    child.kill('SIGTERM')
    let timeout
    await Promise.race([finished, new Promise(resolveWait => { timeout = setTimeout(() => { child.kill('SIGKILL'); resolveWait() }, 10_000) })])
    clearTimeout(timeout)
  }
  if (child) {
    // Failed startup can leave a descendant holding inherited stdio open,
    // including after the direct Host process has already exited.
    child.stdout.destroy(); child.stderr.destroy()
    if (child.connected) child.disconnect()
    let forcedTimeout
    await Promise.race([finished, new Promise(resolveWait => { forcedTimeout = setTimeout(resolveWait, 3000) })])
    clearTimeout(forcedTimeout)
  }
  rmSync(home, { recursive: true, force: true })
}
