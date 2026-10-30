import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { AccountStore } from '../src/member-auth.ts'

/**
 * 回归：登录凭据已经保存、但本机 DSH 起不来时，不能把这次登录当成「退出登录」清掉。
 * 旧实现在登录失败分支直接调用 leaveAccountWorkspace()，它会 store.clear() + 调后台登出，
 * 于是任何一次运行时/主机启动失败（例如运行时被换成别的平台的产物）都会让下次打开回到登录页，
 * 并且顺带把远端会话也撤销掉。
 */
const state = vi.hoisted(() => ({
  windows: [] as any[],
  dialogs: [] as string[],
  requests: [] as string[],
  handlers: new Map<string, (...args: any[]) => any>(),
  userData: '',
}))

vi.mock('node:child_process', () => ({ spawn: vi.fn(), spawnSync: vi.fn(), execFile: vi.fn() }))
vi.mock('../src/owned-process.ts', () => ({
  stopOwnedProcess: vi.fn(async () => {}),
  cleanOwnedProcessTree: vi.fn(async () => {}),
  terminateOwnedProcessImmediately: vi.fn(),
  reclaimOrphanedToolProcesses: vi.fn(),
  trackOwnedProcess: vi.fn(),
}))
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  class Window extends EventEmitter {
    destroyed = false; url = ''; shown = false
    webContents = Object.assign(new EventEmitter(), {
      getURL: () => this.url, setWindowOpenHandler: vi.fn(),
      session: { setSpellCheckerLanguages: vi.fn(), closeAllConnections: vi.fn(async () => {}), clearStorageData: vi.fn(async () => {}), clearCache: vi.fn(async () => {}) },
    })
    constructor(readonly options: any) { super(); state.windows.push(this) }
    async loadURL(url: string) { this.url = url }
    show() { this.shown = true } setTitle() {} setBackgroundColor() {} isDestroyed() { return this.destroyed }
    getBounds() { return { x: 0, y: 0, width: 1440, height: 960 } }
    destroy() { this.destroyed = true; this.emit('closed') }
  }
  return {
    BrowserWindow: Window,
    ipcMain: { handle: vi.fn((name: string, handler: (...args: any[]) => any) => { state.handlers.set(name, handler) }) },
    app: Object.assign(new EventEmitter(), {
      setActivationPolicy: vi.fn(), setName: vi.fn(), setAppUserModelId: vi.fn(), getVersion: () => '1.0.0',
      requestSingleInstanceLock: () => true, whenReady: async () => {}, quit: vi.fn(), exit: vi.fn(), relaunch: vi.fn(),
      getPath: () => state.userData, getAppPath: () => state.userData,
    }),
    shell: { openExternal: vi.fn() },
    net: { fetch: vi.fn() },
    dialog: { showErrorBox: vi.fn((title: string, content?: string) => { state.dialogs.push(`${title} ${content ?? ''}`) }) },
    Menu: { buildFromTemplate: (menu: any[]) => menu, setApplicationMenu: vi.fn() },
    powerMonitor: new EventEmitter(),
    Tray: class { setToolTip() {} setContextMenu() {} on() {} },
    safeStorage: { isEncryptionAvailable: () => false, encryptString: vi.fn(), decryptString: vi.fn() },
  }
})

const TOKEN = 'test-entry-failure-token'
const LOGIN_RESPONSE = { code: 200, result: { token: TOKEN, userInfo: { id: 'u-1', username: 'zhangsan', realname: '张三' } } }

it('keeps the encrypted login session when the local runtime fails to start after a successful login', async () => {
  const root = mkdtempSync(join(tmpdir(), 'workdsh-account-entry-'))
  state.userData = join(root, 'desktop')
  const resourcesDescriptor = Object.getOwnPropertyDescriptor(process, 'resourcesPath')
  Object.defineProperty(process, 'resourcesPath', { value: join(root, 'resources'), configurable: true })
  mkdirSync(state.userData, { recursive: true }); mkdirSync(join(root, 'resources'))
  // 捆绑 Profile 骨架：清单与安装记录一致 → prepareProfile 判定「依赖无变化」，不触发安装。
  const source = join(root, 'bundle/profiles/workdsh'), home = join(root, 'personal')
  for (const path of ['@deepseek-ai/dsh/lib', '@deepseek-ai/dsh-app-boot/lib', 'pnpm/bin']) mkdirSync(join(source, 'node_modules', path), { recursive: true })
  writeFileSync(join(source, 'node_modules/@deepseek-ai/dsh/package.json'), JSON.stringify({ version: '0.2.0-rc.2' }))
  writeFileSync(join(source, 'node_modules/@deepseek-ai/dsh/lib/bin.js'), '')
  writeFileSync(join(source, 'node_modules/@deepseek-ai/dsh/lib/profile-boot.js'), '')
  writeFileSync(join(source, 'node_modules/@deepseek-ai/dsh-app-boot/lib/index.js'), '')
  writeFileSync(join(source, 'node_modules/pnpm/bin/pnpm.cjs'), '')
  mkdirSync(join(root, 'dependencies/pnpm/bin'), { recursive: true })
  writeFileSync(join(root, 'dependencies/pnpm/bin/pnpm.cjs'), '')
  writeFileSync(join(root, 'dependencies/pnpm/package.json'), JSON.stringify({ name: 'pnpm', version: '11.28.5' }))
  writeFileSync(join(source, 'package.json'), JSON.stringify({ dependencies: {}, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } } }))
  writeFileSync(join(source, 'profile-installation.json'), readFileSync(join(source, 'package.json')))
  mkdirSync(home, { recursive: true })
  vi.stubEnv('WORKDSH_RESOURCES', join(root, 'resources'))
  vi.stubEnv('WORKDSH_BUNDLED_PROFILE', source)
  vi.stubEnv('WORKDSH_DSH_HOME', home)
  vi.stubEnv('WORKDSH_NODE_EXECUTABLE', process.execPath)
  vi.stubEnv('WORKDSH_PRIMARY_RUNTIME', root)
  vi.stubEnv('WORKDSH_ENTERPRISE_PORTAL', '')
  // 环境已就绪且没有登录态：启动直接停在登录页，等待用户输入账号密码。
  writeFileSync(join(state.userData, '.workdsh-env-ready'), '1.0.0|0.2.0-rc.2\n')

  const { spawn } = await import('node:child_process')
  // 本机 DSH 起不来：与「运行时被换成别的平台产物」时的 spawn ENOEXEC 同一类失败。
  vi.mocked(spawn).mockImplementation(() => { throw new Error('spawn ENOEXEC') })
  vi.stubGlobal('fetch', vi.fn(async (input: any) => {
    const url = String(input); state.requests.push(url)
    if (url.endsWith('/sys/pcClientLogin')) return new Response(JSON.stringify(LOGIN_RESPONSE), { status: 200, headers: { 'content-type': 'application/json' } })
    throw new Error('offline')
  }))

  try {
    await import('../src/workdsh-main.ts')
    await vi.waitFor(() => expect(state.windows.some(page => !page.destroyed && page.url.includes('account-login'))).toBe(true), { timeout: 5000 })
    const login = state.handlers.get('workdsh:account-login')
    expect(login).toBeTypeOf('function')
    const entry = state.windows.filter(page => !page.destroyed && page.url.includes('account-login')).at(-1)
    const result = await login!({ sender: entry!.webContents }, { username: 'zhangsan', password: 'secret' })

    expect(result).toEqual({ error: 'spawn ENOEXEC' })
    // 关键断言：这次登录已经验证并落盘，本机启动失败不能顺手把它清掉或撤销。
    expect(existsSync(join(state.userData, 'account-session.bin'))).toBe(true)
    expect(new AccountStore(state.userData).read()?.token).toBe(TOKEN)
    expect(state.requests.filter(url => url.endsWith('/sys/logout'))).toEqual([])
    expect(state.dialogs.some(text => text.startsWith('无法进入'))).toBe(true)
  } finally {
    if (resourcesDescriptor) Object.defineProperty(process, 'resourcesPath', resourcesDescriptor)
    else Reflect.deleteProperty(process, 'resourcesPath')
    vi.unstubAllEnvs(); vi.unstubAllGlobals()
    rmSync(root, { recursive: true, force: true })
  }
})
