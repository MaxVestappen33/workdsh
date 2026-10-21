import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { load } from 'js-yaml'
import { afterEach, expect, it } from 'vitest'
import { desktopConnectorMarketPatch, desktopSkillMarketPatch, desktopModelMarketPatch, desktopEnterprisePatch, enterpriseEnvironment, enterpriseSpace, materializeRuntimeProfile, markProfileUpdated, officialLauncher, officialHostLauncher } from '../src/local-runtime.ts'
import type { ServerConfig } from '../src/app-config.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
const DEFAULT_MODEL_PATCH = [
  '# 安装方说明：这段注释与下面的备用写法都不应进入用户打开的文件',
  '- id: llm-pi-ai',
  '  name: "@deepseek-ai/dsh-llm-pi-ai"',
  '  config:',
  '    providers:',
  '      deepseek-v4-flash-0731-w8a8:',
  '        displayName: DeepSeek-V4-Flash-0731-w8a8',
  '# 备用部署的写法（当前未生效）',
  '#       yantai-route:',
  '- id: agent-default-model',
  '  name: "@deepseek-ai/dsh-agent-default-model"',
  '  config:',
  '    provider: deepseek-v4-flash-0731-w8a8',
  '    model: DeepSeek-V4-Flash-0731-w8a8',
].join('\n') + '\n'
function fixture({ defaults = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'desktop-profile-')); roots.push(root)
  const source = join(root, 'bundle', 'profiles', 'workdsh'), home = join(root, 'home')
  mkdirSync(join(source, 'node_modules/@deepseek-ai/dsh/lib'), { recursive: true })
  mkdirSync(join(source, 'node_modules/pnpm/bin'), { recursive: true })
  writeFileSync(join(source, 'node_modules/@deepseek-ai/dsh/package.json'), JSON.stringify({ version: '0.2.0-rc.2' }))
  writeFileSync(join(source, 'node_modules/@deepseek-ai/dsh/lib/bin.js'), '')
  writeFileSync(join(source, 'node_modules/@deepseek-ai/dsh/lib/profile-boot.js'), '')
  mkdirSync(join(source, 'node_modules/@deepseek-ai/dsh-app-boot/lib'), { recursive: true })
  writeFileSync(join(source, 'node_modules/@deepseek-ai/dsh-app-boot/lib/index.js'), '')
  writeFileSync(join(source, 'node_modules/pnpm/bin/pnpm.cjs'), '')
  writeFileSync(join(source, 'node_modules/pnpm/package.json'), JSON.stringify({ name: 'pnpm', version: '11.7.0' }))
  const base = { packageManager: 'pnpm@11.7.0', dependencies: { '@deepseek-ai/dsh': '0.2.0-rc.2', 'workdsh-plugin-skills': '1.0.0' }, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'workdsh-plugin-skills'] } } }
  writeFileSync(join(source, 'package.json'), JSON.stringify(base))
  writeFileSync(join(source, 'profile-installation.json'), JSON.stringify(base))
  if (defaults) {
    mkdirSync(join(source, 'node_modules/workdsh-bundle'), { recursive: true })
    writeFileSync(join(source, 'node_modules/workdsh-bundle/cordis.defaults.patch.yml'), DEFAULT_MODEL_PATCH)
  }
  return { root, source, home, base }
}
it('seeds installation-provided editable defaults into the profile patch layer exactly once', () => {
  const { source, home } = fixture({ defaults: true })
  const { profile } = materializeRuntimeProfile(source, home)
  const patchFile = join(profile, 'cordis.patch.yml')
  const seeded = readFileSync(patchFile, 'utf8')
  expect(seeded).toContain('- id: llm-pi-ai')
  expect(seeded).toContain('- id: agent-default-model')
  // 种子只写有效配置：源码注释与被注释掉的备用写法绝不进入用户可打开的文件。
  expect(seeded).not.toContain('#')
  expect(seeded).not.toContain('yantai-route')
  // The seeded layer must stay a valid YAML sequence; the settings editor owns and rewrites this file.
  expect(load(seeded)).toHaveLength(2)
  expect(existsSync(join(profile, '.workdsh-desktop-defaults.json'))).toBe(true)
  // A later user edit is never overwritten and the removed default is never re-added.
  writeFileSync(patchFile, '- id: llm-pi-ai\n  config:\n    providers:\n      user-model: {}\n')
  materializeRuntimeProfile(source, home)
  const edited = readFileSync(patchFile, 'utf8')
  expect(edited).toContain('user-model')
  expect(edited).not.toContain('agent-default-model')
})
it('appends seeded defaults after an untouched empty template without breaking the sequence', () => {
  const { source, home } = fixture({ defaults: true })
  const { profile } = materializeRuntimeProfile(source, home)
  const patchFile = join(profile, 'cordis.patch.yml')
  writeFileSync(patchFile, '# user configuration\n[]\n')
  rmSync(join(profile, '.workdsh-desktop-defaults.json'))
  materializeRuntimeProfile(source, home)
  const content = readFileSync(patchFile, 'utf8')
  expect(content).toContain('# user configuration')
  expect(load(content)).toHaveLength(2)
})
it('uses official installation anchoring without a shared writable module symlink, and preserves user changes', () => {
  const { source, home, base } = fixture()
  const first = materializeRuntimeProfile(source, home)
  expect(existsSync(join(first.profile, 'node_modules'))).toBe(false)
  const manifest = join(first.profile, 'package.json')
  expect(JSON.parse(readFileSync(manifest, 'utf8')).dependencies).toEqual({})
  const user = { ...JSON.parse(readFileSync(manifest, 'utf8')), dependencies: { 'user-plugin': 'file:custom.tgz' } }
  writeFileSync(manifest, JSON.stringify(user)); writeFileSync(join(first.profile, 'cordis.patch.yml'), '# user configuration\n[]\n')
  const lock = join(first.profile, 'pnpm-lock.yaml'); writeFileSync(lock, 'user lock')
  materializeRuntimeProfile(source, home)
  expect(readFileSync(manifest, 'utf8')).toBe(JSON.stringify(user))
  expect(readFileSync(lock, 'utf8')).toBe('user lock')
  expect(readFileSync(join(first.profile, 'cordis.patch.yml'), 'utf8')).toContain('user configuration')
  base.dependencies['workdsh-plugin-skills'] = '1.0.1'; writeFileSync(join(source, 'package.json'), JSON.stringify(base))
  expect(materializeRuntimeProfile(source, home).changed).toBe(false)
  expect(JSON.parse(readFileSync(manifest, 'utf8')).dependencies).toEqual({ 'user-plugin': 'file:custom.tgz' })
  markProfileUpdated(source, first.profile)
  expect(materializeRuntimeProfile(source, home).changed).toBe(false)
})
it('isolates account/backend directories, device records and credential/skill environments', () => {
  const { root } = fixture()
  const actor = { id: 'A', organizationId: 'org', organizationName: 'Company', email: 'a@test', displayName: 'A', role: 'MEMBER' as const, mustChangePassword: false }
  const a = enterpriseSpace(root, 'https://company.test', actor)
  expect(enterpriseSpace(root, 'https://company.test', actor).deviceId).toBe(a.deviceId)
  expect(enterpriseSpace(root, 'https://other.test', actor).root).not.toBe(a.root)
  expect(enterpriseSpace(root, 'https://company.test', { ...actor, id: 'B' }).root).not.toBe(a.root)
  const env = enterpriseEnvironment(a.root, '/runtime/node', { PATH: '/usr/bin', DEEPSEEK_API_KEY: 'personal', DSH_AGENTS_HOME: '/personal/skills', NODE_OPTIONS: '--inspect', WORKDSH_SERVICE_KEY: 'server' })
  expect(env.DEEPSEEK_API_KEY).toBeUndefined(); expect(env.WORKDSH_SERVICE_KEY).toBeUndefined(); expect(env.NODE_OPTIONS).toBeUndefined()
  expect(env.DSH_AGENTS_HOME).toBe(join(a.root, 'agents')); expect(env.HOME).toBe(join(a.root, 'home'))
  const bridge = desktopEnterprisePatch(a.home, { url: 'http://127.0.0.1:12345', key: 'capability', close: async () => {} }, actor, 'https://company.test', a.deviceId)
  expect(readFileSync(bridge.patch, 'utf8')).toContain('workdsh-provider-identity-enterprise/desktop')
  expect(readFileSync(bridge.patch, 'utf8')).not.toContain('id: workdsh-identity-enterprise\n  disabled: true')
  expect(readFileSync(bridge.patch, 'utf8')).not.toContain('capability')
  expect(JSON.parse(readFileSync(bridge.authFile, 'utf8')).principalId).toBe('A')
})
it('delegates startup and plugin installation to official runCli using one packaged Node and pnpm', () => {
  const { source, home } = fixture(); materializeRuntimeProfile(source, home)
  const launcher = readFileSync(officialLauncher(source, home, '/runtime/node', join(source, 'node_modules/pnpm/bin/pnpm.cjs')), 'utf8')
  expect(launcher).toContain('runCli({ manageDesktopProfile: true, packageManager:'); expect(launcher).toContain('.workdsh-package-manager.mjs'); expect(readFileSync(join(home, '.workdsh-package-manager.mjs'), 'utf8')).toContain(JSON.stringify(join(source, 'node_modules/pnpm/bin/pnpm.cjs')))
  expect(launcher).not.toContain('token'); expect(launcher).not.toContain('createHost')
  const host = readFileSync(officialHostLauncher(source, home, '/runtime/node', join(source, 'node_modules/pnpm/bin/pnpm.cjs'), ['/user/patch.yml']), 'utf8')
  expect(host).toContain('runProfile({ environment: loadLayeredEnv')
  expect(host).toContain('resolvedProfile: { profile, installAnchor }')
  expect(host).toContain(JSON.stringify(join(source, 'profile-installation.json')))
  expect(host).toContain('patchFiles: ["/user/patch.yml"]')
})
it('keeps user install policies while updating the product-owned official version overrides', () => {
  const { source, home } = fixture()
  writeFileSync(join(source, 'pnpm-workspace.yaml'), 'autoInstallPeers: true\noverrides:\n  "@deepseek-ai/dsh": "0.2.0-rc.2"\nstrictPeerDependencies: false\n')
  const { profile } = materializeRuntimeProfile(source, home)
  const policy = join(profile, 'pnpm-workspace.yaml')
  expect(readFileSync(policy, 'utf8')).toContain('autoInstallPeers: false')
  expect(readFileSync(join(source, 'pnpm-workspace.yaml'), 'utf8')).toContain('autoInstallPeers: true')
  mkdirSync(join(profile, 'node_modules'))
  writeFileSync(policy, 'overrides:\n  "@deepseek-ai/dsh": "0.1.7-rc.2"\n  "user-lib": "1.0.0"\nstrictPeerDependencies: true\n')
  expect(materializeRuntimeProfile(source, home).changed).toBe(true)
  expect(readFileSync(policy, 'utf8')).toContain("'@deepseek-ai/dsh': 0.2.0-rc.2")
  expect(readFileSync(policy, 'utf8')).toContain('user-lib: 1.0.0')
  expect(readFileSync(policy, 'utf8')).toContain('strictPeerDependencies: true')
  markProfileUpdated(source, profile)
  expect(materializeRuntimeProfile(source, home).changed).toBe(false)
})
it('retries a failed version-policy installation after restart until official installation succeeds', () => {
  const { source, home } = fixture()
  const policy = join(source, 'pnpm-workspace.yaml')
  writeFileSync(policy, 'overrides:\n  "@deepseek-ai/dsh": "0.2.0-rc.1"\n')
  const { profile } = materializeRuntimeProfile(source, home)
  mkdirSync(join(profile, 'node_modules'))
  writeFileSync(policy, 'overrides:\n  "@deepseek-ai/dsh": "0.2.0-rc.2"\n')
  expect(materializeRuntimeProfile(source, home).changed).toBe(true)
  // The policy file is already current, but the preceding install failed and was never marked successful.
  expect(materializeRuntimeProfile(source, home).changed).toBe(true)
  expect(materializeRuntimeProfile(source, home).changed).toBe(true)
  markProfileUpdated(source, profile)
  expect(materializeRuntimeProfile(source, home).changed).toBe(false)
})
const MARKET_PATHS = {
  mcpMarketListPath: '/desktop-client/mcptool/queryAuthorizedMcpToolList',
  mcpMarketCategoriesPath: '/desktop-client/mcptool/queryMcpToolBizSceneList',
  mcpMarketInstallPath: '/desktop-client/mcptool/installMcpTool',
  mcpMarketUninstallPath: '/desktop-client/mcptool/unInstallMcpTool',
}
const asServer = (value: Record<string, unknown>) => value as unknown as ServerConfig

it('injects market paths and the offline package registry as one connectors patch layer', () => {
  const { home } = fixture()
  mkdirSync(home, { recursive: true })
  const registry = 'http://nexus.intranet:8081/repository/npm-group/'
  const patch = desktopConnectorMarketPatch(home, asServer({ ...MARKET_PATHS, mcpPackageRegistry: registry }), { node: '/opt/workdsh/node', pnpm: '/opt/workdsh/pnpm.cjs' })
  expect(patch).toBeTruthy()
  // 同 id 的 config 会整体替换，所以路径与安装参数必须在同一个节点里。
  const rows = load(readFileSync(patch!, 'utf8')) as { id: string, config: Record<string, unknown> }[]
  expect(rows).toHaveLength(1)
  expect(rows[0]?.id).toBe('workdsh-connectors')
  expect(rows[0]?.config.paths).toEqual({ list: MARKET_PATHS.mcpMarketListPath, categories: MARKET_PATHS.mcpMarketCategoriesPath, install: MARKET_PATHS.mcpMarketInstallPath, uninstall: MARKET_PATHS.mcpMarketUninstallPath })
  expect(rows[0]?.config.install).toEqual({ registry, node: '/opt/workdsh/node', pnpm: '/opt/workdsh/pnpm.cjs', root: join(home, 'mcp') })
})

it('injects only the package registry when no market path is configured', () => {
  const { home } = fixture()
  mkdirSync(home, { recursive: true })
  const patch = desktopConnectorMarketPatch(home, asServer({ mcpPackageRegistry: 'http://nexus.intranet:8081/repository/npm-group/' }), { node: 'node', pnpm: 'pnpm.cjs' })
  const rows = load(readFileSync(patch!, 'utf8')) as { config: Record<string, unknown> }[]
  expect(rows[0]?.config.paths).toBeUndefined()
  expect(rows[0]?.config.install).toBeTruthy()
})

it('skips the connectors patch layer when neither paths nor a package registry are configured', () => {
  const { home } = fixture()
  expect(desktopConnectorMarketPatch(home, asServer({}), { node: 'node', pnpm: 'pnpm.cjs' })).toBeUndefined()
  // 非法 registry（不是 http(s) 地址）同样不落盘，让插件保持内置默认行为。
  expect(desktopConnectorMarketPatch(home, asServer({ mcpPackageRegistry: 'nexus.intranet/repository' }), { node: 'node', pnpm: 'pnpm.cjs' })).toBeUndefined()
})

it('injects skill-market and skill-listing paths as one skills patch layer', () => {
  const { home } = fixture()
  mkdirSync(home, { recursive: true })
  const patch = desktopSkillMarketPatch(home, asServer({
    skillMarketListPath: '/desktop-client/skill/queryAuthorizedSkillList',
    skillMarketCategoriesPath: '/desktop-client/skill/querySkillBizSceneList',
    skillMarketInstallPath: '/desktop-client/skill/installSkill',
    skillMarketUninstallPath: '/desktop-client/skill/unInstallSkill',
    skillListingSubmitPath: '/desktop-client/skill/listingRequest',
    skillListingListPath: '/desktop-client/skill/queryMyListingSkillList',
    skillListingNodePath: '/desktop-client/queryAiNodeList',
    skillListingScenePath: '/desktop-client/queryAiBizSceneList',
    skillDictPath: '/desktop-client/getDictItems',
    skillUploadPath: '/desktop-client/upload',
  }))
  expect(patch).toBeTruthy()
  const rows = load(readFileSync(patch!, 'utf8')) as { id: string, config: { market: { paths: Record<string, unknown> }, listing: { paths: Record<string, unknown> } } }[]
  expect(rows).toHaveLength(1)
  expect(rows[0]?.id).toBe('workdsh-skills')
  expect(rows[0]?.config.market.paths).toEqual({
    list: '/desktop-client/skill/queryAuthorizedSkillList',
    categories: '/desktop-client/skill/querySkillBizSceneList',
    install: '/desktop-client/skill/installSkill',
    uninstall: '/desktop-client/skill/unInstallSkill',
  })
  expect(rows[0]?.config.listing.paths).toEqual({
    submit: '/desktop-client/skill/listingRequest',
    list: '/desktop-client/skill/queryMyListingSkillList',
    nodes: '/desktop-client/queryAiNodeList',
    scenes: '/desktop-client/queryAiBizSceneList',
    dict: '/desktop-client/getDictItems',
    upload: '/desktop-client/upload',
  })
})

it('skips the skills patch layer when no legal skill-market path is configured', () => {
  const { home } = fixture()
  expect(desktopSkillMarketPatch(home, asServer({}))).toBeUndefined()
  // 不以 / 开头的路径不是合法接口路径，同样不落盘。
  expect(desktopSkillMarketPatch(home, asServer({ skillMarketListPath: 'desktop-client/skill/queryAuthorizedSkillList' }))).toBeUndefined()
})

it('injects model-market paths as one model-market patch layer', () => {
  const { home } = fixture()
  mkdirSync(home, { recursive: true })
  const patch = desktopModelMarketPatch(home, asServer({
    modelMarketListPath: '/desktop-client/model/queryAuthorizedModelList',
    modelMarketUsePath: '/desktop-client/model/useModel',
    modelMarketUnusePath: '/desktop-client/model/unUseModel',
  }))
  expect(patch).toBeTruthy()
  const rows = load(readFileSync(patch!, 'utf8')) as { id: string, config: { paths: Record<string, unknown> } }[]
  expect(rows).toHaveLength(1)
  expect(rows[0]?.id).toBe('workdsh-model-market')
  expect(rows[0]?.config.paths).toEqual({
    list: '/desktop-client/model/queryAuthorizedModelList',
    use: '/desktop-client/model/useModel',
    unuse: '/desktop-client/model/unUseModel',
  })
})

it('skips the model-market patch layer when no legal path is configured', () => {
  const { home } = fixture()
  expect(desktopModelMarketPatch(home, asServer({}))).toBeUndefined()
  expect(desktopModelMarketPatch(home, asServer({ modelMarketListPath: 'desktop-client/model/queryAuthorizedModelList' }))).toBeUndefined()
})

it('migrates an unchanged platform package manager and retains a pending install until success', () => {
  const { source, home, base } = fixture()
  const { profile } = materializeRuntimeProfile(source, home)
  const manifest = join(profile, 'package.json'), state = join(profile, '.workdsh-desktop-base.json')
  const user = JSON.parse(readFileSync(manifest, 'utf8'))
  user.dependencies['user-plugin'] = 'file:custom.tgz'
  writeFileSync(manifest, JSON.stringify(user))
  writeFileSync(join(profile, 'pnpm-lock.yaml'), 'user lock remains owned')
  const previous = JSON.parse(readFileSync(state, 'utf8'))
  previous.pendingInstallation = true
  writeFileSync(state, JSON.stringify(previous))
  base.packageManager = 'pnpm@11.28.5'
  writeFileSync(join(source, 'package.json'), JSON.stringify(base))
  for (let attempt = 0; attempt < 2; attempt++) {
    expect(materializeRuntimeProfile(source, home).changed).toBe(true)
    const migrated = JSON.parse(readFileSync(manifest, 'utf8'))
    expect(migrated.packageManager).toBe('pnpm@11.28.5')
    expect(migrated.dependencies).toEqual({ 'user-plugin': 'file:custom.tgz' })
    expect(readFileSync(join(profile, 'pnpm-lock.yaml'), 'utf8')).toBe('user lock remains owned')
    expect(JSON.parse(readFileSync(state, 'utf8')).pendingInstallation).toBe(true)
  }
  markProfileUpdated(source, profile)
  expect(materializeRuntimeProfile(source, home).changed).toBe(false)
  expect(JSON.parse(readFileSync(state, 'utf8')).base.packageManager).toBe('pnpm@11.28.5')
})

it.each(['pnpm@10.34.5', 'yarn@4.18.0', undefined])('keeps a user-owned package manager declaration or removal (%s)', custom => {
  const { source, home, base } = fixture()
  const { profile } = materializeRuntimeProfile(source, home)
  const manifest = join(profile, 'package.json')
  const user = JSON.parse(readFileSync(manifest, 'utf8'))
  if (custom === undefined) delete user.packageManager
  else user.packageManager = custom
  writeFileSync(manifest, JSON.stringify(user))
  base.packageManager = 'pnpm@11.28.5'
  writeFileSync(join(source, 'package.json'), JSON.stringify(base))
  expect(materializeRuntimeProfile(source, home).changed).toBe(false)
  expect(JSON.parse(readFileSync(manifest, 'utf8')).packageManager).toBe(custom)
  expect(materializeRuntimeProfile(source, home).changed).toBe(false)
  expect(JSON.parse(readFileSync(manifest, 'utf8')).packageManager).toBe(custom)
})
