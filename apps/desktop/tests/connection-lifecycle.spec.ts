import { EventEmitter } from 'node:events'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { enterpriseSpace } from '../src/local-runtime.ts'

const state = vi.hoisted(() => ({ loadGate: undefined as Promise<void> | undefined, windows: [] as any[], menu: [] as any[], handlers: {} as Record<string, (...args: any[]) => Promise<any>>, logins: [] as string[], userData: '', revoked: true, stop: vi.fn(async () => {}), logout: vi.fn(async () => false), verify: vi.fn(async () => {}), closed: vi.fn(async () => {}) }))
const actor = { id: 'a', organizationId: 'org-a', organizationName: 'Company', displayName: 'A', email: 'a@test', role: 'MEMBER' as const, mustChangePassword: false }
vi.mock('../src/enterprise-auth.ts', () => ({
  EnterpriseLogin: { login: async (origin: string) => { state.logins.push(origin); return { backendUrl: origin, actor, verify: state.verify, logout: state.logout, cancelRequests() {} } } },
  startEnterpriseAuthority: async () => ({ url: 'http://127.0.0.1:19898', key: 'a'.repeat(64), close: state.closed }),
}))
vi.mock('../src/enterprise-plugins.ts',()=>({installedEnterprisePlugins:vi.fn(()=>['workdsh-provider-identity-enterprise','workdsh-plugin-enterprise-collaboration']),composeInstalledEnterprisePlugins:vi.fn(async()=>['workdsh-provider-identity-enterprise','workdsh-plugin-enterprise-collaboration'])}))
vi.mock('../src/owned-process.ts', () => ({ stopOwnedProcess: state.stop, cleanOwnedProcessTree: vi.fn(async () => {}) }))
vi.mock('node:child_process', () => ({ spawn: vi.fn() }))
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  class Window extends EventEmitter {
    destroyed = false; url = ''
    webContents = Object.assign(new EventEmitter(), {
      getURL: () => this.url, setWindowOpenHandler: vi.fn(),
      session: { closeAllConnections: vi.fn(async () => {}), clearStorageData: vi.fn(async () => {}), clearCache: vi.fn(async () => {}) },
    })
    constructor(readonly options: any) { super(); state.windows.push(this) }
    async loadURL(url: string) { this.url = url; if (url.startsWith('http://127.0.0.1:19999')) await state.loadGate }
    show() {} setTitle() {} isDestroyed() { return this.destroyed }
    destroy() { this.destroyed = true; this.emit('closed') }
  }
  return {
    BrowserWindow: Window,
    ipcMain: { handle: (name: string, fn: any) => { state.handlers[name] = fn } },
    app: Object.assign(new EventEmitter(), { setActivationPolicy: vi.fn(), setName: vi.fn(), requestSingleInstanceLock: () => true, whenReady: async () => {}, quit: vi.fn(), relaunch: vi.fn(), getPath: () => state.userData }),
    shell: { openExternal: vi.fn() }, dialog: { showErrorBox: vi.fn(), showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })) },
    Menu: { buildFromTemplate: (menu: any[]) => { state.menu = menu; return menu }, setApplicationMenu: vi.fn() },
  }
})

it('enforces the packaged backend, uses explicitly installed enterprise identity, and clears locally despite remote logout failure', async () => {
  const root = mkdtempSync(join(tmpdir(), 'workdsh-lifecycle-')); state.userData = join(root, 'desktop')
  const resourcesDescriptor = Object.getOwnPropertyDescriptor(process, 'resourcesPath')
  Object.defineProperty(process, 'resourcesPath', { value: join(root, 'resources'), configurable: true })
  mkdirSync(join(root, 'resources')); mkdirSync(state.userData)
  writeFileSync(join(root, 'resources/workdsh-config.json'), JSON.stringify({ enterprise: { backendUrl: 'https://company.test' } }))
  const savedBackend = JSON.stringify({ backend: 'https://other.test' })
  writeFileSync(join(state.userData, 'enterprise-backend.json'), savedBackend)
  const source = join(root, 'bundle/profiles/workdsh'), home = join(root, 'personal')
  for (const path of ['@deepseek-ai/dsh/lib', '@deepseek-ai/dsh-app-boot/lib', 'pnpm/bin']) mkdirSync(join(source, 'node_modules', path), { recursive: true })
  writeFileSync(join(source, 'node_modules/@deepseek-ai/dsh/package.json'), JSON.stringify({ version: '0.2.0-rc.2' }))
  writeFileSync(join(source, 'node_modules/@deepseek-ai/dsh/lib/bin.js'), '')
  writeFileSync(join(source, 'node_modules/@deepseek-ai/dsh/lib/profile-boot.js'), '')
  writeFileSync(join(source, 'node_modules/@deepseek-ai/dsh-app-boot/lib/index.js'), '')
  writeFileSync(join(source, 'node_modules/pnpm/bin/pnpm.cjs'), '')
  mkdirSync(join(root, 'dependencies/pnpm/bin'), { recursive: true })
  writeFileSync(join(root, 'dependencies/pnpm/bin/pnpm.cjs'), '')
  writeFileSync(join(source, 'package.json'), JSON.stringify({ dependencies: {}, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } } }))
  writeFileSync(join(source, 'profile-installation.json'), readFileSync(join(source, 'package.json')))
  mkdirSync(home); writeFileSync(join(home, 'retained'), 'personal data')
  const enterprise = enterpriseSpace(state.userData, 'https://company.test', actor)
  const builtIn = join(source, 'node_modules/workdsh-provider-identity-enterprise')
  mkdirSync(builtIn, { recursive: true })
  writeFileSync(join(builtIn, 'package.json'), JSON.stringify({ exports: { './desktop': './dist/desktop.js' }, peerDependencies: { '@deepseek-ai/dsh': '0.2.0-rc.2' } }))
  const collaboration = join(source, 'node_modules/workdsh-plugin-enterprise-collaboration')
  mkdirSync(collaboration, {recursive:true})
  writeFileSync(join(collaboration, 'package.json'), JSON.stringify({exports:{'./desktop':'./dist/desktop.js'},peerDependencies:{'@deepseek-ai/dsh':'0.2.0-rc.2'}}))
  vi.stubEnv('WORKDSH_BUNDLED_PROFILE', source); vi.stubEnv('WORKDSH_DSH_HOME', home)
  vi.stubEnv('WORKDSH_NODE_EXECUTABLE', process.execPath); vi.stubEnv('WORKDSH_PRIMARY_RUNTIME', root)
  const { spawn } = await import('node:child_process')
  const children: any[] = []
  vi.mocked(spawn).mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), exitCode: null, signalCode: null, kill: vi.fn(() => { queueMicrotask(() => child.emit('exit', 0)); return true }) })
    children.push(child); return child as any
  })
  try {
    await import('../src/workdsh-main.ts')
    const { app: startupApp } = await import('electron')
    if (process.platform === 'darwin') expect(startupApp.setActivationPolicy).toHaveBeenCalledWith('regular')
    else expect(startupApp.setActivationPolicy).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(state.windows).toHaveLength(1))
    const entry = state.windows[0]
    expect(decodeURIComponent(entry.url)).toContain('<p>https://company.test</p>')
    expect(decodeURIComponent(entry.url)).not.toContain('name="portal"')
    entry.webContents.emit('will-navigate', { preventDefault: vi.fn() }, 'workdsh://enterprise?portal=https%3A%2F%2Fevil.test')
    await vi.waitFor(() => expect(state.windows).toHaveLength(2))
    const loginPage = state.windows[1]
    expect(loginPage.url).toMatch(/^data:text\/html/)
    expect(vi.mocked(spawn)).not.toHaveBeenCalled()
    const signIn = state.handlers['workdsh:enterprise-login']!
    expect(await signIn({ sender: {} }, { account: 'a', password: 'secret' })).toEqual({ error: '此页面不能发起企业登录' })
    expect(await signIn({ sender: loginPage.webContents }, { account: 'a', password: 'secret' })).toEqual({})
    expect(state.logins).toEqual(['https://company.test'])
    expect(readFileSync(join(state.userData, 'enterprise-backend.json'), 'utf8')).toBe(savedBackend)
    expect(spawn).toHaveBeenCalledOnce()
    expect(state.handlers['workdsh:enterprise-install']).toBeUndefined()
    expect(existsSync(join(enterprise.home, 'profiles/workdsh/node_modules/workdsh-provider-identity-enterprise'))).toBe(false)
    const launch = vi.mocked(spawn).mock.calls[0]!
    expect(launch[2]?.env?.DSH_HOME).toBe(enterprise.home)
    expect(launch[2]?.env?.DSH_AGENTS_HOME).toBe(join(enterprise.root, 'agents'))
    expect(launch[1]?.join(' ')).not.toContain('secret')
    expect(launch[1]).toEqual([join(enterprise.home, '.workdsh-host.mjs'), '--no-open'])
    const { app } = await import('electron')
    app.emit('activate')
    expect(app.relaunch).not.toHaveBeenCalled()
    expect(app.quit).not.toHaveBeenCalled()
    expect(children[0].kill).not.toHaveBeenCalled()
    let finishLoad!: () => void
    state.loadGate = new Promise<void>(resolve => { finishLoad = resolve })
    const loadingPage = state.windows[1]
    children[0].stdout.emit('data', Buffer.from('dsh web: http://127.0.0.1:19999/?token=local-token'))
    const workspace = state.windows[2]
    expect(workspace.url).toContain('127.0.0.1:19999')
    expect(loadingPage.destroyed).toBe(false)
    expect(decodeURIComponent(loadingPage.url)).toContain('正在')
    finishLoad()
    await vi.waitFor(() => expect(loadingPage.destroyed).toBe(true))
    state.loadGate = undefined
    expect(workspace.options.webPreferences.partition).toMatch(/^workdsh-enterprise-/)
    expect(workspace.options.webPreferences.preload).toBeUndefined()
    expect(workspace.options.webPreferences.sandbox).toBe(true)
    expect(await signIn({ sender: workspace.webContents }, { account: 'b', password: 'secret' })).toHaveProperty('error')
    state.menu.find(item => item.label === '工作区').submenu[0].click()
    await vi.waitFor(() => expect(state.windows).toHaveLength(4))
    expect(state.stop).toHaveBeenCalledWith(children[0])
    expect(state.logout).toHaveBeenCalledOnce(); expect(state.closed).toHaveBeenCalledOnce()
    expect(workspace.webContents.session.clearStorageData).toHaveBeenCalledOnce()
    const { dialog } = await import('electron')
    expect(dialog.showErrorBox).toHaveBeenCalledWith('本机已退出', expect.stringContaining('远端撤销尚未确认'))
    expect(readFileSync(join(home, 'retained'), 'utf8')).toBe('personal data')
    const personalEntry = state.windows[3]
    personalEntry.webContents.emit('will-navigate', { preventDefault() {} }, 'workdsh://personal')
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(2))
    expect(vi.mocked(spawn).mock.calls[1]?.[2]?.env?.DSH_HOME).toBe(home)
    app.emit('activate')
    expect(app.relaunch).not.toHaveBeenCalled()
    expect(app.quit).not.toHaveBeenCalled()
    children[1].stdout.emit('data', Buffer.from('dsh web: http://127.0.0.1:19998/?token=personal-token'))
    expect(state.windows[4].options.webPreferences.partition).toBeUndefined()
    state.menu.find(item => item.label === '工作区').submenu[0].click()
    await vi.waitFor(() => expect(state.windows).toHaveLength(6))
    expect(state.stop).toHaveBeenCalledWith(children[1])
    // A failed patch write happens after authority startup; it must leave no credential file/bridge.
    rmSync(join(enterprise.home, '.enterprise-desktop.patch.yml'))
    mkdirSync(join(enterprise.home, '.enterprise-desktop.patch.yml'))
    state.windows[5].webContents.emit('will-navigate', { preventDefault() {} }, 'workdsh://enterprise?portal=https%3A%2F%2Fcompany.test')
    await vi.waitFor(() => expect(state.windows).toHaveLength(7))
    expect(await signIn({ sender: state.windows[6].webContents }, { account: 'a', password: 'secret' })).toHaveProperty('error')
    expect(state.closed).toHaveBeenCalledTimes(2); expect(state.logout).toHaveBeenCalledTimes(2)
    expect(existsSync(join(enterprise.home, 'enterprise-auth.json'))).toBe(false)
    expect(spawn).toHaveBeenCalledTimes(2)
    expect(state.windows[7].url).toMatch(/^data:text\/html/)
    // A bad local device record fails before enterprise owns the login; revoke that newly admitted session too.
    writeFileSync(join(enterprise.root, 'device.json'), JSON.stringify({ deviceId: false }))
    state.windows[7].webContents.emit('will-navigate', { preventDefault() {} }, 'workdsh://enterprise?portal=https%3A%2F%2Fcompany.test')
    await vi.waitFor(() => expect(state.windows).toHaveLength(9))
    expect(await signIn({ sender: state.windows[8].webContents }, { account: 'a', password: 'secret' })).toHaveProperty('error')
    expect(state.logout).toHaveBeenCalledTimes(3); expect(state.closed).toHaveBeenCalledTimes(2)
    expect(spawn).toHaveBeenCalledTimes(2)
    // An incompatible installed plugin fails before authority startup, and revokes the new login.
    writeFileSync(join(enterprise.root, 'device.json'), JSON.stringify({ deviceId: enterprise.deviceId }))
    const {composeInstalledEnterprisePlugins}=await import('../src/enterprise-plugins.ts')
    vi.mocked(composeInstalledEnterprisePlugins).mockRejectedValueOnce(new Error('企业插件与当前 DSH 不兼容'))
    expect(await signIn({ sender: state.windows[8].webContents }, { account: 'a', password: 'secret' })).toEqual({ error: expect.stringContaining('不兼容') })
    expect(state.logout).toHaveBeenCalledTimes(4); expect(state.closed).toHaveBeenCalledTimes(2)
    expect(spawn).toHaveBeenCalledTimes(2)
  } finally {
    if (resourcesDescriptor) Object.defineProperty(process, 'resourcesPath', resourcesDescriptor)
    else Reflect.deleteProperty(process, 'resourcesPath')
    vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true })
  }
})
