/** Writable Profile/configuration over the official installation anchor. No custom Loader. */
import { createHash, randomUUID } from 'node:crypto'
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { load, dump } from 'js-yaml'
import { syncBundledCompatibility } from './runtime-compatibility.ts'
import { cachedPackageManager } from './plugin-archive-cache.ts'
import { enterpriseNamespace } from './connection-mode.ts'
import type { EnterpriseMember, Authority } from './enterprise-auth.ts'
import type { AccountAuthority } from './member-auth.ts'
import type { ServerConfig } from './app-config.ts'

type ProfilePackage = { dependencies?: Record<string, string>, optionalDependencies?: Record<string, string>, dsh?: { profile?: { bundles?: string[] } }, [key: string]: unknown }
const BASE_STATE = '.workdsh-desktop-base.json'
const PROFILE_PATCH = 'cordis.patch.yml'
const json = (file: string): ProfilePackage => JSON.parse(readFileSync(file, 'utf8')) as ProfilePackage
const writeJson = (file: string, value: unknown): void => writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 })

function memberDefaults(release: ProfilePackage): ProfilePackage {
  return { name: 'workdsh-member-profile', private: true, type: 'module', packageManager: release.packageManager,
    dependencies: {}, ...(release.dsh ? { dsh: structuredClone(release.dsh) } : {}) }
}
function baseDigest(source: string, base: ProfilePackage, version: string): string {
  const marker = join(source, '.workdsh-desktop-release.json')
  const workspace = join(source, 'pnpm-workspace.yaml')
  return createHash('sha256').update('installation-owned-defaults-v2').update(JSON.stringify(base)).update(version).update(existsSync(marker) ? readFileSync(marker) : '')
    .update(existsSync(workspace) ? readFileSync(workspace) : '').digest('hex')
}

function updatePackagePolicy(source: string, target: string): boolean {
  const policy = join(source, 'pnpm-workspace.yaml'), current = join(target, 'pnpm-workspace.yaml')
  if (!existsSync(policy)) return false
  const parse = (path: string): Record<string, unknown> => {
    const value = load(readFileSync(path, 'utf8'))
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Profile 包管理配置必须是 YAML 对象')
    return value as Record<string, unknown>
  }
  if (!existsSync(current)) {
    const defaults = parse(policy)
    // Like the official external Profile initializer, use installation-owned service peers.
    defaults.autoInstallPeers = false
    writeFileSync(current, dump(defaults), { mode: 0o600 })
    return true
  }
  const owned = parse(policy), user = parse(current)
  if (JSON.stringify(user.overrides) === JSON.stringify(owned.overrides)) return false
  if ((user.overrides !== undefined && (!user.overrides || typeof user.overrides !== 'object' || Array.isArray(user.overrides)))
    || !owned.overrides || typeof owned.overrides !== 'object' || Array.isArray(owned.overrides)) throw new Error('Profile 包版本约束无效')
  // Official runtime/Cordis versions are product-owned. Other install preferences and overrides are user-owned.
  const overrides = { ...user.overrides as Record<string, unknown>, ...owned.overrides as Record<string, unknown> }
  if (JSON.stringify(user.overrides) === JSON.stringify(overrides)) return false
  user.overrides = overrides
  writeFileSync(current, dump(user), { mode: 0o600 })
  return true
}

export function materializeRuntimeProfile(source: string, home: string): { profile: string, changed: boolean } {
  const target = join(home, 'profiles', 'workdsh')
  const release = json(join(source, 'package.json'))
  // Defaults are already installed in the immutable runtime. The member project owns only explicit additions.
  const base = memberDefaults(release)
  const version = json(join(source, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')).version
  if (typeof version !== 'string') throw new Error('Bundled DSH version is missing')
  const state = join(target, BASE_STATE)
  const manifest = join(target, 'package.json')
  const modules = join(target, 'node_modules')
  mkdirSync(target, { recursive: true, mode: 0o700 })
  // A previous shared symlink is not safe for plugin writes. Refuse to mutate it.
  if (existsSync(modules) && lstatSync(modules).isSymbolicLink()) throw new Error('此 Profile 的依赖仍链接到安装包，请选择独立的可写空间后再启动')
  const digest = baseDigest(source, release, version)
  const previous = existsSync(state) ? JSON.parse(readFileSync(state, 'utf8')) as { digest: string, base: ProfilePackage, pendingInstallation?: boolean } : undefined
  let changed = previous?.pendingInstallation === true
  if (!existsSync(manifest)) {
    writeJson(manifest, base)
    writeFileSync(join(target, PROFILE_PATCH), '[]\n', { mode: 0o600 })
  } else if (previous?.digest !== digest) {
    if (!previous) throw new Error('已有 Profile 缺少 Desktop 版本记录；请在官方插件管理中核对后使用独立空间')
    const current = json(manifest)
    // Only the unchanged recorded default remains product-owned. A user may
    // pin another manager/version or remove the declaration altogether.
    if (current.packageManager === previous.base.packageManager) {
      if (base.packageManager === undefined) delete current.packageManager
      else current.packageManager = base.packageManager
    }
    for (const section of ['dependencies', 'optionalDependencies'] as const) {
      const owned = previous.base[section] ?? {}
      const next = base[section] ?? {}
      current[section] ??= {}
      for (const [name, value] of Object.entries(owned)) {
        if (current[section]![name] !== value) continue // Explicit user removal/change remains owned by the user.
        if (next[name] === undefined) delete current[section]![name]
        else current[section]![name] = next[name]!
      }
      for (const [name, value] of Object.entries(next)) {
        if (owned[name] === undefined && current[section]![name] === undefined) current[section]![name] = value
      }
    }
    const selected = current.dsh?.profile?.bundles ?? []
    const oldBundles = previous.base.dsh?.profile?.bundles ?? []
    const nextBundles = base.dsh?.profile?.bundles ?? []
    current.dsh ??= {}; current.dsh.profile ??= {}
    current.dsh.profile.bundles = selected.filter(name => !oldBundles.includes(name) || nextBundles.includes(name))
    for (const name of nextBundles) if (!oldBundles.includes(name) && !current.dsh.profile.bundles.includes(name)) current.dsh.profile.bundles.push(name)
    if (JSON.stringify(json(manifest)) !== JSON.stringify(current)) {
      writeJson(manifest, current)
      // Only a changed local dependency graph requires package installation, not a refreshed bundle selection.
      changed ||= ['dependencies', 'optionalDependencies'].some(section => JSON.stringify(previous.base[section]) !== JSON.stringify(base[section])) && existsSync(modules)
    }
  }
  const policyChanged = updatePackagePolicy(source, target)
  if (policyChanged && existsSync(modules)) changed = true
  const cache = join(home, 'package-cache')
  const sourceCache = join(source, '..', '..', 'package-cache')
  if (existsSync(sourceCache)) cpSync(sourceCache, cache, { recursive: true, force: false, errorOnExist: false })
  syncBundledCompatibility(source, target, digest)
  // Caller installs changed dependencies with the pinned official package manager before marking success.
  if (changed) writeJson(state, { digest: previous?.digest ?? digest, base: previous?.base ?? base, pendingInstallation: true })
  else writeJson(state, { digest, base })
  return { profile: target, changed }
}

export function markProfileUpdated(source: string, profile: string): void {
  const release = json(join(source, 'package.json'))
  const base = memberDefaults(release)
  const version = json(join(source, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')).version as string
  const digest = baseDigest(source, release, version)
  writeJson(join(profile, BASE_STATE), { digest, base })
}

/**
 * 凭据文档旁边的残留文件：备份（`.bak`）、原子写留下的临时文件（`.tmp`）、
 * 上一个进程异常退出后没释放的锁（`.lock` / `.lock.takeover-<hash>`）。
 * 官方凭据 provider 只读精确路径 `.credentials.yaml`，从不扫描目录、也不匹配 `.bak`，
 * 因此这些文件本身不会让启动失败；但它们是外部工具或异常退出留下的垃圾，
 * 不该要求用户手工删除。启动前把它们移出 `dsh-home` 根目录，留在
 * `.workdsh-state/quarantine/<时间戳>/` 便于事后追查；持锁进程仍活着的锁一律不动。
 * @param home - 本次启动使用的 DSH Home。
 * @returns 已隔离的文件名。
 */
export function quarantineCredentialsResidue(home: string): string[] {
  let names: string[]
  try { names = readdirSync(home) } catch { return [] }
  const moved: string[] = []
  let directory: string | undefined
  for (const name of names) {
    if (!CREDENTIAL_RESIDUE.test(name)) continue
    const file = join(home, name)
    if (name.includes('.lock') && lockStillHeld(file)) continue
    try {
      directory ??= join(home, '.workdsh-state', 'quarantine', new Date().toISOString().replace(/[:.]/gu, '-'))
      mkdirSync(directory, { recursive: true, mode: 0o700 })
      renameSync(file, join(directory, name))
      moved.push(name)
    } catch { /* 隔离失败不影响启动：读取端本来就只认精确路径 */ }
  }
  return moved
}

/** `.credentials.yaml` 的备份、临时文件与锁（含 atomic-write 的 takeover 探针）。 */
const CREDENTIAL_RESIDUE = /^\.credentials\.yaml\.(?:bak.*|.*\.tmp|lock(?:\.takeover-[0-9a-f]+)?)$/u

/** 锁记录的持锁进程是否仍存在；记录不完整时按修改时间判断，宁可不删。 */
function lockStillHeld(file: string): boolean {
  let record: string
  let mtime: number
  try { record = readFileSync(file, 'utf8'); mtime = statSync(file).mtimeMs }
  catch (error) { return (error as NodeJS.ErrnoException).code !== 'ENOENT' }
  const match = /^(\d+)\n$/u.exec(record)
  if (!match) return Date.now() - mtime < 60_000
  const pid = Number(match[1])
  if (pid === 0 || pid === process.pid) return true
  try { process.kill(pid, 0); return true }
  catch (error) { return (error as NodeJS.ErrnoException).code !== 'ESRCH' }
}

export function enterpriseSpace(userData: string, backend: string, actor: EnterpriseMember): { root: string, home: string, deviceId: string } {
  const root = join(userData, 'enterprise', enterpriseNamespace(backend, actor.organizationId, actor.id))
  mkdirSync(root, { recursive: true, mode: 0o700 })
  const deviceFile = join(root, 'device.json')
  if (!existsSync(deviceFile)) writeJson(deviceFile, { deviceId: randomUUID() })
  const parsed: unknown = JSON.parse(readFileSync(deviceFile, 'utf8'))
  const deviceId = (parsed as { deviceId?: unknown }).deviceId
  if (typeof deviceId !== 'string' || !/^[0-9a-f-]{36}$/u.test(deviceId)) throw new Error('企业本机设备记录无效')
  for (const name of ['home', 'dsh', 'agents', 'workspace', 'tmp', 'appdata', 'localappdata']) mkdirSync(join(root, name), { recursive: true, mode: 0o700 })
  return { root, home: join(root, 'dsh'), deviceId }
}

export function enterpriseEnvironment(root: string, executable: string, parent: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {}
  for (const key of ['SystemRoot', 'WINDIR', 'ComSpec', 'PATHEXT', 'LANG', 'LC_ALL', 'TZ', 'DISPLAY', 'WAYLAND_DISPLAY']) if (parent[key]) result[key] = parent[key]
  result.PATH = `${dirname(executable)}${process.platform === 'win32' ? ';' : ':'}${parent.PATH ?? ''}`
  result.HOME = join(root, 'home'); result.USERPROFILE = result.HOME
  result.DSH_HOME = join(root, 'dsh'); result.DSH_AGENTS_HOME = join(root, 'agents')
  result.TMPDIR = join(root, 'tmp'); result.TMP = result.TMPDIR; result.TEMP = result.TMPDIR
  result.APPDATA = join(root, 'appdata'); result.LOCALAPPDATA = join(root, 'localappdata')
  return result
}

export function officialLauncher(source: string, home: string, executable: string, packageManager: string = join(dirname(executable), '..', '..', 'pnpm', 'bin', 'pnpm.cjs')): string {
  const cli = join(source, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  if (!existsSync(cli) || !existsSync(packageManager)) throw new Error('安装包缺少官方 DSH 或锁定的插件安装工具')
  const pnpm = cachedPackageManager(home, packageManager)
  const launcher = join(home, '.workdsh-launch.mjs')
  writeFileSync(launcher, `import { runCli } from ${JSON.stringify(pathToFileURL(cli).href)};\nawait runCli({ manageDesktopProfile: true, packageManager: { command: ${JSON.stringify(executable)}, args: [${JSON.stringify(pnpm)}] } });\n`, { mode: 0o600 })
  return launcher
}

/** The official application-owned Profile API supplies the full installation dependency graph. */
export function officialHostLauncher(source: string, home: string, executable: string, packageManager: string, patches: string[]): string {
  const boot = join(source, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'profile-boot.js')
  const appBoot = join(source, 'node_modules', '@deepseek-ai', 'dsh-app-boot', 'lib', 'index.js')
  if (!existsSync(boot) || !existsSync(appBoot) || !existsSync(packageManager)) throw new Error('安装包缺少官方 Profile 启动接口')
  const anchor = join(source, 'profile-installation.json'), profile = join(home, 'profiles', 'workdsh')
  if (!existsSync(anchor)) throw new Error('安装包缺少完整官方与 WorkDSH 安装清单')
  const launcher = join(home, '.workdsh-host.mjs')
  packageManager = cachedPackageManager(home, packageManager)
  writeFileSync(launcher, `import { runProfile } from ${JSON.stringify(pathToFileURL(boot).href)};\nimport { loadProfileDirectory, loadLayeredEnv, reportSkippedBundles } from ${JSON.stringify(pathToFileURL(appBoot).href)};\nconst installAnchor = ${JSON.stringify(anchor)};\nconst profile = loadProfileDirectory('dsh', ${JSON.stringify(profile)}, installAnchor);\nreportSkippedBundles('dsh', profile);\nawait runProfile({ environment: loadLayeredEnv('dsh'), profile: 'workdsh', resolvedProfile: { profile, installAnchor }, patchFiles: ${JSON.stringify(patches)}, args: process.argv.slice(2), packageManager: { command: ${JSON.stringify(executable)}, args: [${JSON.stringify(packageManager)}] } });\n`, { mode: 0o600 })
  return launcher
}

export function desktopEnterprisePatch(home: string, authority: Authority, actor: EnterpriseMember, backendUrl: string, deviceId: string, collaboration = true): { authFile: string, patch: string } {
  // The root enterprise bundle contributes the shared account client; only ./desktop supplies identity.
  const authFile = join(home, 'enterprise-auth.json')
  writeJson(authFile, { authorityUrl: authority.url, authorityKey: authority.key, backendUrl, principalId: actor.id, organizationId: actor.organizationId, deviceId })
  const patch = join(home, '.enterprise-desktop.patch.yml')
  writeFileSync(patch, `- id: workdsh-identity-local\n  disabled: true\n- insert:\n    - id: workdsh-enterprise-account-client\n      name: workdsh-provider-identity-enterprise\n    - id: workdsh-desktop-identity\n      name: workdsh-provider-identity-enterprise/desktop\n      config:\n        authFile: ${JSON.stringify(authFile)}\n        principalId: ${JSON.stringify(actor.id)}\n        organizationId: ${JSON.stringify(actor.organizationId)}\n        deviceId: ${JSON.stringify(deviceId)}\n${collaboration ? `- insert:\n    - id: workdsh-desktop-collaboration\n      name: workdsh-plugin-enterprise-collaboration\n      config:\n        desktop: true\n` : ''}- id: workdsh-session-access\n  config:\n    autoBindFixedMemberSessions: true\n- id: workdsh-tool-access\n  config:\n    autoBindPersonalSessions: false\n    autoBindFixedMemberSessions: true\n- id: workspace-controller\n  config:\n    documentsDirectory: ${JSON.stringify(join(home, '..', 'workspace'))}\n`, { mode: 0o600 })
  return { authFile, patch }
}

/**
 * MCP 市场接口路径与本机包安装配置的注入层。两者都归载体配置（workdsh-app.json 的 server 段）
 * 所有，而 connectors 是 Desktop/Web 共用的 Profile 包、不能自己去读载体配置，因此由这里按运行时
 * 配置生成 overlay，把市场路径与本机 npm 安装参数作为插件选项交给 connectors 插件。
 * app-config 已保证路径以 `/` 开头、registry 为 http(s) 地址；缺失或取值非法的字段不写进本层，
 * 插件回退到内置默认值。两段配置必须合并进同一个 `- id: workdsh-connectors` 节点的 config：
 * Cordis 补丁对同 id 的 config 是整体替换，拆成两个节点会互相覆盖。
 */
export function desktopConnectorMarketPatch(home: string, server: ServerConfig, runtime: { node: string, pnpm: string }): string | undefined {
  const rows = ([
    ['list', server.mcpMarketListPath],
    ['categories', server.mcpMarketCategoriesPath],
    // 安装/卸载完成后统一实时上报到资产操作记录接口（旧安装上报接口已下线）。
    ['report', server.assetOperationReportPath],
  ] as const).flatMap(([name, value]) => (typeof value === 'string' && /^\//u.test(value) ? [[name, value] as const] : []))
  // 资产操作记录的 clientId 取载体配置的 appId（与版本检查同源），不再使用设备 UUID。
  const clientId = typeof server.appId === 'string' && server.appId.trim() ? server.appId.trim() : undefined
  const registry = server.mcpPackageRegistry
  const installable = typeof registry === 'string' && /^https?:\/\//u.test(registry)
  if (rows.length === 0 && !installable && clientId === undefined) return undefined
  const paths = rows.length === 0 ? '' : `    paths:\n${rows.map(([name, value]) => `      ${name}: ${JSON.stringify(value)}\n`).join('')}`
  const client = clientId === undefined ? '' : `    clientId: ${JSON.stringify(clientId)}\n`
  const install = installable ? `    install:\n      registry: ${JSON.stringify(registry)}\n      node: ${JSON.stringify(runtime.node)}\n      pnpm: ${JSON.stringify(runtime.pnpm)}\n      root: ${JSON.stringify(join(home, 'mcp'))}\n` : ''
  const patch = join(home, '.connector-market.patch.yml')
  writeFileSync(patch, `- id: workdsh-connectors\n  config:\n${client}${paths}${install}`, { mode: 0o600 })
  return patch
}

/**
 * 技能市场与上架申请的接口路径注入层。与 MCP 市场同理：skills 是 Desktop/Web 共用的 Profile 包，
 * 不能自己去读载体配置，因此由这里按运行时配置生成 overlay，把接口路径作为插件选项交给 skills 插件。
 * 两类路径各自独立：任一为空时只写另一类，插件对缺失项回退到内置默认值。
 */
export function desktopSkillMarketPatch(home: string, server: ServerConfig): string | undefined {
  const marketRows = ([
    ['list', server.skillMarketListPath],
    ['categories', server.skillMarketCategoriesPath],
    // 安装/卸载完成后统一实时上报到资产操作记录接口（旧安装上报接口已下线）。
    ['report', server.assetOperationReportPath],
    // 技能安装必须先取签名并验签；签名接口与闸门策略同属 desktop-client/asset 命名空间。
    ['signature', server.assetGateSignaturePath],
  ] as const).flatMap(([name, value]) => (typeof value === 'string' && /^\//u.test(value) ? [[name, value] as const] : []))
  const listingRows = ([
    ['submit', server.skillListingSubmitPath],
    ['list', server.skillListingListPath],
    ['nodes', server.skillListingNodePath],
    ['scenes', server.skillListingScenePath],
    ['dict', server.skillDictPath],
    ['upload', server.skillUploadPath],
    ['ssoParams', server.adminSsoParamsPath],
  ] as const).flatMap(([name, value]) => (typeof value === 'string' && /^\//u.test(value) ? [[name, value] as const] : []))
  const ssoUrl = typeof server.adminSsoUrl === 'string' && /^https?:\/\//u.test(server.adminSsoUrl) ? server.adminSsoUrl : undefined
  // 资产操作记录的 clientId 取载体配置的 appId（与版本检查同源），不再使用设备 UUID。
  const clientId = typeof server.appId === 'string' && server.appId.trim() ? server.appId.trim() : undefined
  if (marketRows.length === 0 && listingRows.length === 0 && ssoUrl === undefined && clientId === undefined) return undefined
  const marketPaths = marketRows.length === 0 ? ''
    : `      paths:\n${marketRows.map(([key, value]) => `        ${key}: ${JSON.stringify(value)}\n`).join('')}`
  const client = clientId === undefined ? '' : `      clientId: ${JSON.stringify(clientId)}\n`
  const market = marketPaths === '' && client === '' ? '' : `    market:\n${client}${marketPaths}`
  // 上架申请段同时承载接口路径与单点登录地址：地址缺失时只写路径，插件回退内置默认值。
  const listing = listingRows.length === 0 && ssoUrl === undefined ? ''
    : `    listing:\n${listingRows.length === 0 ? '' : `      paths:\n${listingRows.map(([key, value]) => `        ${key}: ${JSON.stringify(value)}\n`).join('')}`}${ssoUrl === undefined ? '' : `      ssoUrl: ${JSON.stringify(ssoUrl)}\n`}`
  const patch = join(home, '.skill-market.patch.yml')
  writeFileSync(patch, `- id: workdsh-skills\n  config:\n${market}${listing}`, { mode: 0o600 })
  return patch
}

/**
 * 提示词列表接口路径的注入层。prompts 与 skills 一样是 Desktop/Web 共用的 Profile 包，
 * 不能自己读载体配置，因此由这里把 workdsh-app.json 的 server.promptListPath 作为插件选项注入；
 * 缺失或取值非法时不写这一层，插件回退到内置默认值。
 */
export function desktopPromptPatch(home: string, server: ServerConfig): string | undefined {
  const list = typeof server.promptListPath === 'string' && /^\//u.test(server.promptListPath) ? server.promptListPath : undefined
  if (!list) return undefined
  const patch = join(home, '.prompt-list.patch.yml')
  writeFileSync(patch, `- id: workdsh-prompts\n  config:\n    paths:\n      list: ${JSON.stringify(list)}\n`, { mode: 0o600 })
  return patch
}

/**
 * 模型市场接口路径的注入层。模型查询与安装/卸载上报都走 desktop-client 命名空间；
 * 安装动作本身在 Host 侧写官方 llm-pi-ai 配置，这里只提供路径。
 * `stateDir` 让安装记录与默认模型完成标记跟随登录账号；未给出时插件沿用 DSH_HOME 下的共享目录。
 */
export function desktopModelMarketPatch(home: string, server: ServerConfig, stateDir?: string): string | undefined {
  const rows = ([
    ['list', server.modelMarketListPath],
    // 安装/卸载完成后统一实时上报到资产操作记录接口（旧 useModel/unUseModel 已下线）。
    ['report', server.assetOperationReportPath],
  ] as const).flatMap(([name, value]) => (typeof value === 'string' && /^\//u.test(value) ? [[name, value] as const] : []))
  // 资产操作记录的 clientId 取载体配置的 appId（与版本检查同源），不再使用设备 UUID。
  const clientId = typeof server.appId === 'string' && server.appId.trim() ? server.appId.trim() : undefined
  if (rows.length === 0 && stateDir === undefined && clientId === undefined) return undefined
  const paths = rows.length === 0 ? '' : `    paths:\n${rows.map(([name, value]) => `      ${name}: ${JSON.stringify(value)}\n`).join('')}`
  const client = clientId === undefined ? '' : `    clientId: ${JSON.stringify(clientId)}\n`
  const state = stateDir === undefined ? '' : `    stateDir: ${JSON.stringify(stateDir)}\n`
  const patch = join(home, '.model-market.patch.yml')
  writeFileSync(patch, `- id: workdsh-model-market\n  config:\n${client}${paths}${state}`, { mode: 0o600 })
  return patch
}

/**
 * 模型市场按账号隔离的安装状态目录。安装记录与默认模型完成标记跟随登录账号，
 * 同一台电脑上不同账号各自的“已处理默认模型”互不影响。
 */
export function accountModelStateDirectory(home: string, principalId: string): string {
  if (!/^[\w-]{1,160}$/u.test(principalId)) throw new Error('账号用户标识无效')
  return join(home, '.workdsh-state', 'models', 'accounts', principalId)
}

/**
 * 资产闸门按账号隔离的快照目录。快照文件本身由插件加密，这里的目录只负责分隔账号。
 */
export function accountAssetGateStateDirectory(home: string, principalId: string): string {
  if (!/^[\w-]{1,160}$/u.test(principalId)) throw new Error('账号用户标识无效')
  return join(home, '.workdsh-state', 'asset-gate', 'accounts', principalId)
}

/**
 * 资产闸门策略目录。策略不含账号信息，因此不按账号隔离；同一个工作区共用一份，
 * 换账号沿用上次成功拉取的结果，拉取失败时才按 fail-closed 处理。
 */
export function assetGatePolicyDirectory(home: string): string {
  return join(home, '.workdsh-state', 'asset-gate', 'policy')
}

/**
 * 资产闸门的接口路径、快照目录与策略目录注入层。插件是 Desktop/Web 共用的 Profile 包，
 * 不能自己读载体配置，因此由这里把 server 段的两个端点注入。
 */
export function desktopAssetGatePatch(home: string, server: ServerConfig, stateDir?: string, policyDir?: string): string | undefined {
  const rows = ([
    ['policy', server.assetGatePolicyPath],
    ['snapshot', server.assetGateSnapshotPath],
    ['report', server.assetGateReportPath],
  ] as const).flatMap(([name, value]) => (typeof value === 'string' && /^\//u.test(value) ? [[name, value] as const] : []))
  if (rows.length === 0 && stateDir === undefined && policyDir === undefined) return undefined
  const paths = rows.length === 0 ? '' : `    paths:\n${rows.map(([name, value]) => `      ${name}: ${JSON.stringify(value)}\n`).join('')}`
  const state = stateDir === undefined ? '' : `    stateDir: ${JSON.stringify(stateDir)}\n`
  const policy = policyDir === undefined ? '' : `    policyDir: ${JSON.stringify(policyDir)}\n`
  const patch = join(home, '.asset-gate.patch.yml')
  writeFileSync(patch, `- id: workdsh-asset-gate\n  config:\n${paths}${state}${policy}`, { mode: 0o600 })
  return patch
}

/**
 * 专家市场与上架申请的接口路径注入层。experts 与 skills 一样是 Desktop/Web 共用的 Profile 包，
 * 不能自己读载体配置，因此由这里把 workdsh-app.json 的 server 段作为插件选项注入。
 * 节点列表、字典与附件上传和技能上架共用同一批端点，直接复用对应字段。
 */
export function desktopExpertMarketPatch(home: string, server: ServerConfig): string | undefined {
  const rows = ([
    ['marketAgentList', server.expertMarketAgentListPath],
    ['marketTeamList', server.expertMarketTeamListPath],
    ['myListingAgent', server.expertMyListingAgentPath],
    ['myListingTeam', server.expertMyListingTeamPath],
    ['submitAgent', server.expertListingSubmitAgentPath],
    ['submitTeam', server.expertListingSubmitTeamPath],
    ['withdrawAgent', server.expertListingWithdrawAgentPath],
    ['withdrawTeam', server.expertListingWithdrawTeamPath],
    ['upload', server.skillUploadPath],
    ['nodes', server.skillListingNodePath],
    ['dict', server.skillDictPath],
    ['adminSsoParams', server.adminSsoParamsPath],
  ] as const).flatMap(([name, value]) => (typeof value === 'string' && /^\//u.test(value) ? [[name, value] as const] : []))
  const ssoUrl = typeof server.adminSsoUrl === 'string' && /^https?:\/\//u.test(server.adminSsoUrl) ? server.adminSsoUrl : undefined
  if (rows.length === 0 && ssoUrl === undefined) return undefined
  const sso = ssoUrl === undefined ? '' : `    adminSsoUrl: ${JSON.stringify(ssoUrl)}\n`
  const patch = join(home, '.expert-market.patch.yml')
  writeFileSync(patch, `- id: workdsh-experts\n  config:\n    paths:\n${rows.map(([name, value]) => `      ${name}: ${JSON.stringify(value)}\n`).join('')}${sso}`, { mode: 0o600 })
  return patch
}

export interface AccountActor {
  principalId: string
  organizationId: string
  organizationName: string
  displayName: string
}

/**
 * A stable, per-account device record under the application userData directory.
 * The account replaces the personal `local-user` identity entirely.
 */
export function accountSpace(userData: string, principalId: string): { root: string, deviceId: string } {
  if (!/^[\w-]{1,160}$/u.test(principalId)) throw new Error('账号用户标识无效')
  const root = join(userData, 'account')
  mkdirSync(root, { recursive: true, mode: 0o700 })
  const deviceFile = join(root, 'device.json')
  if (!existsSync(deviceFile)) writeJson(deviceFile, { deviceId: randomUUID() })
  const parsed: unknown = JSON.parse(readFileSync(deviceFile, 'utf8')) as unknown
  const deviceId = (parsed as { deviceId?: unknown }).deviceId
  if (typeof deviceId !== 'string' || !/^[0-9a-f-]{36}$/u.test(deviceId) || !/^[\w-]{1,160}$/u.test(deviceId)) throw new Error('账号本机设备记录无效')
  return { root, deviceId }
}

/**
 * Disable the personal local identity and bind the account identity to a loopback
 * authority owned by Main. The account provider resolves the logged-in user instead.
 */
export function desktopAccountPatch(home: string, authority: AccountAuthority, actor: AccountActor, deviceId: string, backendUrl: string): { authFile: string, patch: string } {
  const authFile = join(home, 'account-auth.json')
  writeJson(authFile, { authorityUrl: authority.url, authorityKey: authority.key, backendUrl, principalId: actor.principalId, organizationId: actor.organizationId, deviceId })
  const patch = join(home, '.account-desktop.patch.yml')
  writeFileSync(patch, `- id: workdsh-identity-local\n  disabled: true\n- insert:\n    - id: workdsh-account-desktop\n      name: workdsh-provider-identity-account/desktop\n      config:\n        authFile: ${JSON.stringify(authFile)}\n        principalId: ${JSON.stringify(actor.principalId)}\n        organizationId: ${JSON.stringify(actor.organizationId)}\n        organizationName: ${JSON.stringify(actor.organizationName)}\n        displayName: ${JSON.stringify(actor.displayName)}\n        deviceId: ${JSON.stringify(deviceId)}\n- id: workdsh-session-access\n  config:\n    autoBindFixedMemberSessions: true\n- id: workdsh-tool-access\n  config:\n    autoBindPersonalSessions: false\n    autoBindFixedMemberSessions: true\n- id: workspace-controller\n  config:\n    documentsDirectory: ${JSON.stringify(join(home, '..', 'workspace'))}\n`, { mode: 0o600 })
  return { authFile, patch }
}
