import { EventEmitter } from 'node:events'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ loadGate: undefined as Promise<void> | undefined, windows: [] as any[], menu: [] as any[], handlers: {} as Record<string, (...args: any[]) => Promise<any>>, logins: [] as string[], userData: '', revoked: true, stop: vi.fn(async () => {}), logout: vi.fn(async () => false), verify: vi.fn(async () => {}), closed: vi.fn(async () => {}) }))
const actor = { id: 'a', organizationId: 'org-a', organizationName: 'Company', displayName: 'A', email: 'a@test', role: 'MEMBER' as const, mustChangePassword: false }
vi.mock('../src/enterprise-auth.ts', () => ({
  EnterpriseLogin: { login: async (origin: string) => { state.logins.push(origin); return { backendUrl: origin, actor, verify: state.verify, logout: state.logout, cancelRequests() {} } } },
  startEnterpriseAuthority: async () => ({ url: 'http://127.0.0.1:19898', key: 'a'.repeat(64), close: state.closed }),
}))
vi.mock('../src/enterprise-plugins.ts',()=>({installedEnterprisePlugins:vi.fn(()=>['workdsh-provider-identity-enterprise','workdsh-plugin-enterprise-collaboration']),composeInstalledEnterprisePlugins:vi.fn(async()=>['workdsh-provider-identity-enterprise','workdsh-plugin-enterprise-collaboration'])}))
vi.mock('../src/owned-process.ts', () => ({ trackOwnedProcess: vi.fn(), stopOwnedProcess: state.stop, cleanOwnedProcessTree: vi.fn(async () => {}), reclaimOrphanedToolProcesses: vi.fn() }))
vi.mock('node:child_process', () => ({ spawn: vi.fn() }))
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  class Window extends EventEmitter {
    destroyed = false; url = ''
    webContents = Object.assign(new EventEmitter(), {
      getURL: () => this.url, setWindowOpenHandler: vi.fn(),
      session: { setSpellCheckerLanguages: vi.fn(), closeAllConnections: vi.fn(async () => {}), clearStorageData: vi.fn(async () => {}), clearCache: vi.fn(async () => {}) },
    })
    constructor(readonly options: any) { super(); state.windows.push(this) }
    async loadURL(url: string) { this.url = url; if (url.startsWith('http://127.0.0.1:19999')) await state.loadGate }
    show() {} setTitle() {} setBackgroundColor() {} isDestroyed() { return this.destroyed }
    destroy() { this.destroyed = true; this.emit('closed') }
  }
  return {
    BrowserWindow: Window,
    ipcMain: { handle: (name: string, fn: any) => { state.handlers[name] = fn } },
    app: Object.assign(new EventEmitter(), { setActivationPolicy: vi.fn(), setName: vi.fn(), setAppUserModelId: vi.fn(), getVersion: () => '1.0.0', requestSingleInstanceLock: () => true, whenReady: async () => {}, quit: vi.fn(), exit: vi.fn(), relaunch: vi.fn(), getPath: () => state.userData, getAppPath: () => '/tmp/WorkDSH development/app' }),
    shell: { openExternal: vi.fn() }, net: { fetch: vi.fn() }, dialog: { showErrorBox: vi.fn(), showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })) },
    Menu: { buildFromTemplate: (menu: any[]) => menu, setApplicationMenu: (menu: any[]) => { state.menu = menu } },
    powerMonitor: new EventEmitter(),
    Tray: class { setToolTip() {} setContextMenu() {} on() {} },
  }
})

it('starts on the account login page and never renders the removed mode chooser', async () => {
  const root = mkdtempSync(join(tmpdir(), 'workdsh-lifecycle-')); state.userData = join(root, 'desktop')
  const resourcesDescriptor = Object.getOwnPropertyDescriptor(process, 'resourcesPath')
  Object.defineProperty(process, 'resourcesPath', { value: join(root, 'resources'), configurable: true })
  mkdirSync(join(root, 'resources')); mkdirSync(state.userData)
  // 随包声明了企业后台地址：旧实现会因此停在「选择使用方式」入口页，现在必须直接进登录页。
  writeFileSync(join(root, 'resources/workdsh-config.json'), JSON.stringify({ enterprise: { backendUrl: 'https://company.test' } }))
  writeFileSync(join(state.userData, 'enterprise-backend.json'), JSON.stringify({ backend: 'https://other.test' }))
  const source = join(root, 'bundle/profiles/workdsh'), home = join(root, 'personal')
  for (const path of ['@deepseek-ai/dsh/lib', '@deepseek-ai/dsh-app-boot/lib', 'pnpm/bin']) mkdirSync(join(source, 'node_modules', path), { recursive: true })
  writeFileSync(join(source, 'node_modules/@deepseek-ai/dsh/package.json'), JSON.stringify({ version: '0.2.0-rc.2' }))
  writeFileSync(join(source, 'node_modules/@deepseek-ai/dsh/lib/bin.js'), '')
  writeFileSync(join(source, 'node_modules/@deepseek-ai/dsh/lib/profile-boot.js'), '')
  writeFileSync(join(source, 'node_modules/@deepseek-ai/dsh-app-boot/lib/index.js'), '')
  writeFileSync(join(source, 'node_modules/pnpm/bin/pnpm.cjs'), '')
  writeFileSync(join(source, 'node_modules/pnpm/package.json'), JSON.stringify({ name: 'pnpm', version: '11.28.5' }))
  mkdirSync(join(root, 'dependencies/pnpm/bin'), { recursive: true })
  writeFileSync(join(root, 'dependencies/pnpm/bin/pnpm.cjs'), '')
  writeFileSync(join(root, 'dependencies/pnpm/package.json'), JSON.stringify({ name: 'pnpm', version: '11.28.5' }))
  writeFileSync(join(source, 'package.json'), JSON.stringify({ dependencies: {}, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } } }))
  writeFileSync(join(source, 'profile-installation.json'), readFileSync(join(source, 'package.json')))
  mkdirSync(home); writeFileSync(join(home, 'retained'), 'personal data')
  // 环境已准备：跳过过场页 / Profile 物化，直接验证登录门禁。
  writeFileSync(join(state.userData, '.workdsh-env-ready'), '1.0.0|0.2.0-rc.2\n')
  vi.stubEnv('WORKDSH_BUNDLED_PROFILE', source); vi.stubEnv('WORKDSH_DSH_HOME', home)
  vi.stubEnv('WORKDSH_NODE_EXECUTABLE', process.execPath); vi.stubEnv('WORKDSH_PRIMARY_RUNTIME', root)
  const { spawn } = await import('node:child_process')
  vi.mocked(spawn).mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), exitCode: null, signalCode: null, kill: vi.fn(() => { queueMicrotask(() => child.emit('exit', 0)); return true }) })
    return child as any
  })
  try {
    await import('../src/workdsh-main.ts')
    const { app: startupApp } = await import('electron')
    if (process.platform === 'darwin') expect(startupApp.setActivationPolicy).toHaveBeenCalledWith('regular')
    else expect(startupApp.setActivationPolicy).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(state.windows).toHaveLength(1))
    const login = state.windows[0]
    const html = decodeURIComponent(login.url)
    expect(html).toContain('id="account-login"')
    expect(html).not.toContain('选择使用方式')
    expect(html).not.toContain('name="portal"')
    // 后台地址只用于登录请求，不渲染到页面。
    expect(html).not.toContain('https://company.test')
    // 未登录不启动本机 Host，也不触碰个人数据目录。
    expect(vi.mocked(spawn)).not.toHaveBeenCalled()
    expect(readFileSync(join(home, 'retained'), 'utf8')).toBe('personal data')
    // 只有入口页窗口能发起登录；企业登录入口随「选择使用方式」页一起下线。
    expect(await state.handlers['workdsh:account-login']!({ sender: {} }, { username: 'a', password: 'secret' })).toEqual({ error: '此页面不能发起登录' })
    expect(await state.handlers['workdsh:enterprise-login']!({ sender: login.webContents }, { account: 'a', password: 'secret' })).toEqual({ error: '此页面不能发起企业登录' })
    expect(vi.mocked(spawn)).not.toHaveBeenCalled()
  } finally {
    if (resourcesDescriptor) Object.defineProperty(process, 'resourcesPath', resourcesDescriptor)
    else Reflect.deleteProperty(process, 'resourcesPath')
    vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true })
  }
})
