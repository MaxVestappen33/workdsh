/** Writable Profile/configuration over the official installation anchor. No custom Loader. */
import { createHash, randomUUID } from 'node:crypto'
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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
const DEFAULTS_STATE = '.workdsh-desktop-defaults.json'
const PROFILE_PATCH = 'cordis.patch.yml'
const json = (file: string): ProfilePackage => JSON.parse(readFileSync(file, 'utf8')) as ProfilePackage
const writeJson = (file: string, value: unknown): void => writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 })

/**
 * 种子只写有效配置行：源码注释（含被注释掉的备用部署写法）不该出现在用户打开的
 * profile 补丁层里。整行注释直接丢弃，连续空行折叠为一个。
 */
function activeDefaults(text: string): string {
  return text.split(/\r?\n/u).filter(line => !/^\s*#/u.test(line)).join('\n').replace(/\n{3,}/gu, '\n\n').trim()
}

/**
 * 安装方提供的、但设置页必须能改写的默认值（预置本地模型与默认模型）绝不能通过
 * `--patch` overlay 注入：Cordis 补丁对同一 id 的 config 是整体替换，overlay 又是最高
 * 优先级层，会盖掉设置页写入 profile 用户层的修改并报
 * "overridden by a home patch or command-line overlay"。
 * 因此这里把它们一次性种子进 profile 用户层（settings 页自己拥有的那个文件），此后完全
 * 归用户所有；已种子过、用户已有该行、或用户改过的文件都不会被再动。
 */
function seedProfileDefaults(source: string, target: string): void {
  const defaultsFile = join(source, 'node_modules', 'workdsh-bundle', 'cordis.defaults.patch.yml')
  if (!existsSync(defaultsFile)) return
  const marker = join(target, DEFAULTS_STATE)
  if (existsSync(marker)) return
  const defaults = activeDefaults(readFileSync(defaultsFile, 'utf8'))
  const file = join(target, PROFILE_PATCH)
  const current = existsSync(file) ? readFileSync(file, 'utf8') : ''
  if (current.trim() === '') {
    writeFileSync(file, defaults + '\n', { mode: 0o600 })
  } else if (!/^[^\S\n]*-\s*id\s*:/mu.test(current)) {
    // 仍是空序列模板（可能带注释）：先移除空的 flow 序列，再追加块序列，避免 `[]` 与块项混排。
    writeFileSync(file, current.replace(/\[\s*\]/u, '').replace(/\s*$/u, '') + '\n' + defaults + '\n', { mode: 0o600 })
  } else if (!/^[^\S\n]*-\s*id:\s*["']?llm-pi-ai["']?\s*$/mu.test(current)) {
    writeFileSync(file, current.replace(/\s*$/u, '') + '\n' + defaults + '\n', { mode: 0o600 })
  }
  writeJson(marker, { seeded: true })
}
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
  seedProfileDefaults(source, target)
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
    ['install', server.mcpMarketInstallPath],
    ['uninstall', server.mcpMarketUninstallPath],
  ] as const).flatMap(([name, value]) => (typeof value === 'string' && /^\//u.test(value) ? [[name, value] as const] : []))
  const registry = server.mcpPackageRegistry
  const installable = typeof registry === 'string' && /^https?:\/\//u.test(registry)
  if (rows.length === 0 && !installable) return undefined
  const paths = rows.length === 0 ? '' : `    paths:\n${rows.map(([name, value]) => `      ${name}: ${JSON.stringify(value)}\n`).join('')}`
  const install = installable ? `    install:\n      registry: ${JSON.stringify(registry)}\n      node: ${JSON.stringify(runtime.node)}\n      pnpm: ${JSON.stringify(runtime.pnpm)}\n      root: ${JSON.stringify(join(home, 'mcp'))}\n` : ''
  const patch = join(home, '.connector-market.patch.yml')
  writeFileSync(patch, `- id: workdsh-connectors\n  config:\n${paths}${install}`, { mode: 0o600 })
  return patch
}

/**
 * 技能市场接口路径的注入层。与 MCP 市场同理：skills 是 Desktop/Web 共用的 Profile 包，
 * 不能自己去读载体配置，因此由这里按运行时配置生成 overlay，把接口路径作为插件选项交给 skills 插件。
 * 安装/卸载接口后台当前是预留实现；路径缺失或非法时不写进本层，插件回退到内置默认值。
 */
export function desktopSkillMarketPatch(home: string, server: ServerConfig): string | undefined {
  const rows = ([
    ['list', server.skillMarketListPath],
    ['categories', server.skillMarketCategoriesPath],
    ['install', server.skillMarketInstallPath],
    ['uninstall', server.skillMarketUninstallPath],
  ] as const).flatMap(([name, value]) => (typeof value === 'string' && /^\//u.test(value) ? [[name, value] as const] : []))
  if (rows.length === 0) return undefined
  const patch = join(home, '.skill-market.patch.yml')
  writeFileSync(patch, `- id: workdsh-skills\n  config:\n    market:\n      paths:\n${rows.map(([name, value]) => `        ${name}: ${JSON.stringify(value)}\n`).join('')}`, { mode: 0o600 })
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
