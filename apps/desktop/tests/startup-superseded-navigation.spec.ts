import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ windows: [] as any[], dialogs: [] as string[], superseded: [] as string[], userData: '' }))

vi.mock('node:child_process', () => ({ spawn: vi.fn(), spawnSync: vi.fn(), execFile: vi.fn() }))
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  class Window extends EventEmitter {
    destroyed = false; url = ''; shown = false
    pending: { url: string, reject: (error: Error) => void } | undefined
    webContents = Object.assign(new EventEmitter(), {
      getURL: () => this.url, setWindowOpenHandler: vi.fn(),
      session: { setSpellCheckerLanguages: vi.fn(), closeAllConnections: vi.fn(async () => {}), clearStorageData: vi.fn(async () => {}), clearCache: vi.fn(async () => {}) },
    })
    constructor(readonly options: any) { super(); state.windows.push(this) }
    /** Electron 语义：同一 webContents 上的新导航会让上一次未完成的导航以 ERR_ABORTED(-3) 失败。 */
    loadURL(url: string) {
      const previous = this.pending
      if (previous) { state.superseded.push(previous.url); previous.reject(new Error(`ERR_ABORTED (-3) loading '${url}'`)) }
      const pending = { url, reject: (_error: Error) => {} }
      this.pending = pending; this.url = url
      return new Promise<void>((_resolve, reject) => { pending.reject = reject })
    }
    show() { this.shown = true } setTitle() {} setBackgroundColor() {} isDestroyed() { return this.destroyed }
    getBounds() { return { x: 0, y: 0, width: 1440, height: 960 } }
    destroy() { this.destroyed = true; this.emit('closed') }
  }
  return {
    BrowserWindow: Window,
    ipcMain: { handle: vi.fn() },
    app: Object.assign(new EventEmitter(), { setActivationPolicy: vi.fn(), setName: vi.fn(), getVersion: () => '1.0.0', requestSingleInstanceLock: () => true, whenReady: async () => {}, quit: vi.fn(), exit: vi.fn(), relaunch: vi.fn(), getPath: () => state.userData, getAppPath: () => state.userData }),
    shell: { openExternal: vi.fn() },
    dialog: { showErrorBox: vi.fn((title: string, content?: string) => { state.dialogs.push(`${title} ${content ?? ''}`) }) },
    Menu: { buildFromTemplate: (menu: any[]) => menu, setApplicationMenu: vi.fn() },
    powerMonitor: new EventEmitter(),
    Tray: class { setToolTip() {} setContextMenu() {} on() {} },
  }
})

it('treats a splash navigation superseded by the login page as success, not a workspace failure', async () => {
  const root = mkdtempSync(join(tmpdir(), 'workdsh-splash-supersession-'))
  state.userData = join(root, 'desktop')
  const resourcesDescriptor = Object.getOwnPropertyDescriptor(process, 'resourcesPath')
  Object.defineProperty(process, 'resourcesPath', { value: join(root, 'resources'), configurable: true })
  mkdirSync(state.userData, { recursive: true }); mkdirSync(join(root, 'resources'))
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
  mkdirSync(home, { recursive: true })
  vi.stubEnv('WORKDSH_RESOURCES', join(root, 'resources'))
  vi.stubEnv('WORKDSH_BUNDLED_PROFILE', source)
  vi.stubEnv('WORKDSH_DSH_HOME', home)
  vi.stubEnv('WORKDSH_NODE_EXECUTABLE', process.execPath)
  vi.stubEnv('WORKDSH_PRIMARY_RUNTIME', root)
  vi.stubEnv('WORKDSH_ENTERPRISE_PORTAL', '')
  try {
    await import('../src/workdsh-main.ts')
    // 首次启动（环境未就绪、无本地登录态）：过场页先加载，随后同一窗口切到登录页。
    await vi.waitFor(() => expect(state.windows).toHaveLength(1))
    const entry = state.windows[0]
    await vi.waitFor(() => expect(decodeURIComponent(entry.url)).toContain('id="account-login"'))
    // 场景确实发生：过场页的导航被登录页取代并返回 ERR_ABORTED(-3)。
    expect(state.superseded).toHaveLength(1)
    expect(decodeURIComponent(state.superseded[0]!)).toContain('id="splash"')
    // 取代不是失败：不弹「无法打开工作区」，不销毁窗口，也不退回入口页。
    expect(state.dialogs).toEqual([])
    expect(entry.destroyed).toBe(false)
    expect(entry.shown).toBe(true)
    expect(state.windows).toHaveLength(1)
  } finally {
    if (resourcesDescriptor) Object.defineProperty(process, 'resourcesPath', resourcesDescriptor)
    vi.unstubAllEnvs()
  }
})
