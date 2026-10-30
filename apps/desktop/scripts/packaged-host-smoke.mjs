import { writeFileSync } from 'node:fs'
import { dirname, join, delimiter } from 'node:path'
import { PRODUCT_PACKAGES } from './workdsh-package-boundary.mjs'

export const PRODUCT_SERVICES = Object.freeze({
  'workdsh-plugin-connectors': 'workdshConnectors',
  'workdsh-plugin-experts': 'workdshExperts',
  'workdsh-plugin-library': 'workdshLibrary',
  'workdsh-plugin-model-market': 'workdshModelMarket',
  'workdsh-plugin-projects': 'workdshProjects',
  'workdsh-plugin-prompts': 'workdshPrompts',
  'workdsh-plugin-skills': 'workdshSkills',
  'workdsh-plugin-workbenches': 'workdshWorkbenchRegistration',
})
const REQUIRED_PLATFORM_SERVICES = ['profileContext', 'loader', 'storageDomain', 'connection', 'workdshIdentity', 'workdshAccess', 'sessionController', 'workspaceController', 'tools']

/** Inspect mandatory product fibers only. Optional official/model plugins may
 * legitimately remain lazy or unconfigured in a fresh personal installation. */
export function inspectStartedHost(ctx, products, platformServices) {
  if (ctx.fiber.state !== 2) throw new Error('Packaged Host root did not finish initialization')
  const profile = ctx.get('profileContext')
  const selected = profile?.startedBundles ?? []
  const runtimes = [...ctx.registry.values()]
  for (const [name, service] of Object.entries(products)) {
    if (!selected.includes(name)) throw new Error('Packaged Host did not start selected product: ' + name)
    if (!ctx.get(service)) throw new Error('Packaged Host service is unavailable: ' + service)
    const runtimeName = name === 'workdsh-plugin-workbenches' ? 'workdsh-workbenches' : name
    const fibers = runtimes.filter(runtime => runtime.name === runtimeName).flatMap(runtime => [...runtime.fibers])
    if (!fibers.length || fibers.some(fiber => fiber.state !== 2)) throw new Error('Packaged Host product initialization is incomplete: ' + name)
  }
  for (const service of platformServices) if (!ctx.get(service)) throw new Error('Packaged Host platform service is unavailable: ' + service)
  return { kind: 'workdsh-packaged-host-ready', products: Object.keys(products).sort(), services: Object.values(products).sort(), installAnchor: profile.installAnchor }
}

/** A temporary owned probe observes the official appReady public contract;
 * the product's officialHostLauncher and installed runtime remain unchanged. */
export function prepareHostSmokeProbe(home) {
  if (JSON.stringify(Object.keys(PRODUCT_SERVICES).sort()) !== JSON.stringify([...PRODUCT_PACKAGES].sort())) throw new Error('Host smoke product service map differs from the release inventory')
  const probe = join(home, '.workdsh-host-smoke-probe.mjs')
  const source = `const inspect = ${inspectStartedHost.toString()};\nexport const name='workdsh-packaged-host-smoke';\nexport const inject=${JSON.stringify(['appReady', ...REQUIRED_PLATFORM_SERVICES, ...Object.values(PRODUCT_SERVICES)])};\nexport function apply(ctx){return ctx.effect(()=>ctx.get('appReady').onReady(()=>{const receipt=inspect(ctx,${JSON.stringify(PRODUCT_SERVICES)},${JSON.stringify(REQUIRED_PLATFORM_SERVICES)});process.send?.(receipt);}),'packaged-host-readiness');}\n`
  writeFileSync(probe, source, { mode: 0o600 })
  const patch = join(home, '.headless-host-smoke.patch.yml')
  writeFileSync(patch, JSON.stringify([{ id: 'webserver', config: { host: '127.0.0.1', port: 0 } }, { insert: [{ id: 'workdsh-packaged-host-smoke', name: probe }] }]), { mode: 0o600 })
  return patch
}

export function hostSmokeEnvironment(home, primary, executable, parent = process.env) {
  const env = {}
  for (const key of ['SystemRoot', 'WINDIR', 'ComSpec', 'PATHEXT', 'LANG', 'LC_ALL', 'TZ']) if (parent[key]) env[key] = parent[key]
  Object.assign(env, { PATH: dirname(executable) + delimiter + (parent.PATH ?? ''), HOME: home, USERPROFILE: home,
    TMPDIR: home, TMP: home, TEMP: home, APPDATA: join(home, 'appdata'), LOCALAPPDATA: join(home, 'localappdata'),
    DSH_HOME: home, DSH_AGENTS_HOME: join(home, 'agents'), DSH_BUNDLED_PRIMARY_RUNTIME: primary, DSH_TELEMETRY_DISABLED: '1' })
  return env
}

export const scrubHostDiagnostics = value => value.replace(/([?&]token=)[^\s\u001b"']+/gu, '$1[redacted]')

/** Both full official app readiness and mandatory services must settle. An
 * HTTP listening message or manager-only bundle inventory is insufficient. */
export function waitForPackagedHostReady(child, { timeoutMs = 90_000 } = {}) {
  let output = '', url, receipt
  const diagnostics = () => scrubHostDiagnostics(output).slice(-6000)
  const ready = new Promise((accept, reject) => {
    const finish = () => { if (url && receipt) { clearTimeout(timer); accept({ url, receipt, diagnostics }) } }
    const timer = setTimeout(() => reject(new Error('Packaged Host did not finish mandatory service initialization: ' + diagnostics())), timeoutMs)
    const read = chunk => {
      output = (output + chunk.toString()).slice(-64_000)
      const failure = output.match(/(?:failed to import|cannot find (?:module|package)|ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND)[^\n]{0,1000}/iu)
      if (failure) { clearTimeout(timer); reject(new Error('Packaged Host startup dependency failed: ' + scrubHostDiagnostics(failure[0]) + '\n' + diagnostics())); return }
      const match = output.match(/http:\/\/(?:127\.0\.0\.1|localhost):\d+\/[^\s\u001b]*\?token=[^\s\u001b]+/u)
      if (match) url = match[0]
      finish()
    }
    child.stdout.on('data', read); child.stderr.on('data', read)
    child.on('message', message => { if (message?.kind === 'workdsh-packaged-host-ready') { receipt = message; finish() } })
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('exit', code => { clearTimeout(timer); reject(new Error('Packaged Host exited before readiness (' + code + '): ' + diagnostics())) })
  })
  return { ready, diagnostics }
}
