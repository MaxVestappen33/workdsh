import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { AccountStore } from '../src/member-auth.ts'

/**
 * 回归：关闭软件不能等同于「退出账号」。
 * 旧实现里 before-quit 会走 leaveAccountWorkspace()，从而 store.clear() + 调后台登出，
 * 于是每次关软件都抹掉本地加密登录态，下次打开必然回到登录页。
 */
const state = vi.hoisted(() => ({
  windows: [] as any[],
  children: [] as any[],
  dialogs: [] as string[],
  requests: [] as string[],
  userData: '',
}))

vi.mock('node:child_process', () => ({ spawn: vi.fn(), spawnSync: vi.fn(), execFile: vi.fn() }))
vi.mock('../src/owned-process.ts', () => ({
  stopOwnedProcess: vi.fn(async () => {}),
  cleanOwnedProcessTree: vi.fn(async () => {}),
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
    ipcMain: { handle: vi.fn() },
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
    // 关闭行为改为「确认后隐藏到托盘」，载体启动时会创建托盘图标。
    Tray: class { setToolTip() {} setContextMenu() {} on() {} },
    // 系统级加密不可用 → 走本机密钥文件方案，加密/解密在同一台机器上可复现。
    safeStorage: { isEncryptionAvailable: () => false, encryptString: vi.fn(), decryptString: vi.fn() },
  }
})

const TOKEN = 'test-account-token'

it('keeps the encrypted login session across a normal quit so the next launch skips the login page', async () => {
  const root = mkdtempSync(join(tmpdir(), 'workdsh-account-quit-'))
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
  // 载体按 pnpm 清单选择安装工具参数，缺失时启动失败。
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

  // 上一次成功登录留下的加密登录态 + 「环境已就绪」标记：本次是再次打开。
  new AccountStore(state.userData).write({
    token: TOKEN,
    user: { userId: 'u-1', username: 'zhangsan', displayName: '张三', organizationId: 'org-1', organizationName: '某单位', role: 'member' },
    rawUserInfo: { id: 'u-1', username: 'zhangsan', realname: '张三' },
  })
  const sessionFile = join(state.userData, 'account-session.bin')
  expect(existsSync(sessionFile)).toBe(true)
  writeFileSync(join(state.userData, '.workdsh-env-ready'), '1.0.0|0.2.0-rc.2\n')

  const { app } = await import('electron')
  const { spawn } = await import('node:child_process')
  vi.mocked(spawn).mockImplementation(() => {
    const child: any = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(), stderr: new EventEmitter(), exitCode: null, signalCode: null,
      kill: vi.fn(() => { queueMicrotask(() => child.emit('exit', 0)); return true }),
    })
    state.children.push(child)
    // 官方 Host 就绪输出：载体据此打开主界面。
    queueMicrotask(() => child.stdout.emit('data', Buffer.from('dsh web: http://127.0.0.1:19997/?token=host-token')))
    return child
  })
  // 运行中的会话校验会轮询后台；这里模拟离线，不能因此登出。
  vi.stubGlobal('fetch', vi.fn(async (input: any) => { state.requests.push(String(input)); throw new Error('offline') }))
  const quitEvent = { preventDefault: vi.fn() }
  try {
    await import('../src/workdsh-main.ts')
    // 已登录 + 环境就绪 → 直达工作区：拉起本机 Host，且没有任何窗口是登录页。
    await vi.waitFor(() => expect(spawn).toHaveBeenCalled(), { timeout: 5000 })
    await vi.waitFor(() => expect(state.windows.some(page => page.url.includes('127.0.0.1:19997'))).toBe(true))
    expect(state.windows.some(page => page.url.includes('account-login'))).toBe(false)
    expect(state.dialogs).toEqual([])

    // 正常关闭软件。
    app.emit('before-quit', quitEvent)
    await vi.waitFor(() => expect(app.quit).toHaveBeenCalled())

    // 关键断言：登录态必须保留，且没有调用后台登出。
    expect(existsSync(sessionFile)).toBe(true)
    expect(new AccountStore(state.userData).read()?.token).toBe(TOKEN)
    expect(state.requests.filter(url => url.endsWith('/sys/logout'))).toEqual([])
  } finally {
    app.emit('before-quit', quitEvent)
    if (resourcesDescriptor) Object.defineProperty(process, 'resourcesPath', resourcesDescriptor)
    else Reflect.deleteProperty(process, 'resourcesPath')
    vi.unstubAllEnvs(); vi.unstubAllGlobals()
    rmSync(root, { recursive: true, force: true })
  }
})
