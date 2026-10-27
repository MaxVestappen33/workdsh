import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'

/**
 * 载体外壳行为回归：
 * - 点叉号不再直接退出进程：弹窗询问「最小化到托盘 / 退出软件」，可勾选「不再提醒」记住选择；
 * - 「最小化到托盘」隐藏窗口，进程保留；托盘右键「退出软件」才是真正的退出入口；
 * - 应用菜单全中文，且不再包含「工作区」菜单。
 */
const state = vi.hoisted(() => ({
  windows: [] as any[],
  dialogs: [] as string[],
  boxes: [] as any[],
  trayMenu: [] as any[],
  appMenu: [] as any[],
  nextBox: { response: 0, checkboxChecked: false },
  userData: '',
}))

vi.mock('node:child_process', () => ({ spawn: vi.fn(), spawnSync: vi.fn(), execFile: vi.fn() }))
vi.mock('../src/owned-process.ts', () => ({
  stopOwnedProcess: vi.fn(async () => {}),
  cleanOwnedProcessTree: vi.fn(async () => {}),
  reclaimOrphanedToolProcesses: vi.fn(),
}))
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  class Window extends EventEmitter {
    destroyed = false; url = ''; shown = false; hidden = false
    webContents = Object.assign(new EventEmitter(), {
      getURL: () => this.url, setWindowOpenHandler: vi.fn(),
      session: { setSpellCheckerLanguages: vi.fn(), closeAllConnections: vi.fn(async () => {}), clearStorageData: vi.fn(async () => {}), clearCache: vi.fn(async () => {}) },
    })
    constructor(readonly options: any) { super(); state.windows.push(this) }
    async loadURL(url: string) { this.url = url }
    show() { this.shown = true; this.hidden = false } hide() { this.hidden = true }
    focus() {} setTitle() {} setBackgroundColor() {} isMinimized() { return false }
    isDestroyed() { return this.destroyed }
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
    dialog: {
      showErrorBox: vi.fn((title: string, content?: string) => { state.dialogs.push(`${title} ${content ?? ''}`) }),
      showMessageBox: vi.fn(async (_page: any, options: any) => { state.boxes.push(options); return state.nextBox }),
    },
    Menu: { buildFromTemplate: (menu: any[]) => menu, setApplicationMenu: (menu: any[]) => { state.appMenu = menu } },
    powerMonitor: new EventEmitter(),
    Tray: class { setToolTip() {} setContextMenu(menu: any[]) { state.trayMenu = menu } on() {} },
  }
})

it('confirms the close button, keeps the tray as the real quit entry, and ships an all-Chinese menu', async () => {
  const root = mkdtempSync(join(tmpdir(), 'workdsh-carrier-shell-'))
  state.userData = join(root, 'desktop')
  const resourcesDescriptor = Object.getOwnPropertyDescriptor(process, 'resourcesPath')
  Object.defineProperty(process, 'resourcesPath', { value: join(root, 'resources'), configurable: true })
  mkdirSync(state.userData, { recursive: true }); mkdirSync(join(root, 'resources'))
  // 捆绑 Profile 骨架：清单与安装记录一致 → prepareProfile 判定「依赖无变化」。
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
  const preferenceFile = join(state.userData, 'close-behavior.json')
  try {
    const { app } = await import('electron')
    await import('../src/workdsh-main.ts')
    // 未登录 → 过场页后进入登录页；此时窗口与菜单已建立。
    await vi.waitFor(() => expect(state.windows).toHaveLength(1))
    const page = state.windows[0]

    // ① 首次点叉号：弹窗询问，且未直接退出；选择「最小化到托盘」后窗口被隐藏。
    const first = { preventDefault: vi.fn() }
    page.emit('close', first)
    await vi.waitFor(() => expect(state.boxes).toHaveLength(1))
    expect(first.preventDefault).toHaveBeenCalledOnce()
    expect(state.boxes[0].buttons).toEqual(['最小化到托盘', '退出软件'])
    expect(state.boxes[0].checkboxLabel).toBe('不再提醒')
    await vi.waitFor(() => expect(page.hidden).toBe(true))
    expect(app.quit).not.toHaveBeenCalled()
    expect(existsSync(preferenceFile)).toBe(false)

    // ② 这次勾选「不再提醒」并选择最小化：写入偏好，供后续免打扰。
    state.nextBox = { response: 0, checkboxChecked: true }
    page.hidden = false
    page.emit('close', { preventDefault: vi.fn() })
    await vi.waitFor(() => expect(state.boxes).toHaveLength(2))
    await vi.waitFor(() => expect(page.hidden).toBe(true))
    expect(JSON.parse(readFileSync(preferenceFile, 'utf8'))).toEqual({ action: 'minimize' })

    // ③ 已记住选择：再点叉号不再弹窗，直接隐藏。
    page.hidden = false
    page.emit('close', { preventDefault: vi.fn() })
    await vi.waitFor(() => expect(page.hidden).toBe(true))
    expect(state.boxes).toHaveLength(2)

    // ④ 托盘右键「退出软件」是真正的退出入口。
    const quitItem = state.trayMenu.find(item => item.label === '退出软件')
    expect(quitItem).toBeDefined()
    quitItem.click()
    await vi.waitFor(() => expect(app.quit).toHaveBeenCalled())

    // ⑤ 应用菜单全中文，且不含「工作区」。
    const topLabels = state.appMenu.map(item => item.label).filter((label): label is string => typeof label === 'string')
    expect(topLabels).toEqual(['工具', '编辑', '视图', '窗口'])
    const items = state.appMenu.flatMap(item => item.submenu ?? []).filter(item => item.type !== 'separator')
    expect(items.some(item => item.label === '工作区')).toBe(false)
    expect(items.every(item => /[\u4e00-\u9fa5]/u.test(String(item.label)))).toBe(true)
  } finally {
    if (resourcesDescriptor) Object.defineProperty(process, 'resourcesPath', resourcesDescriptor)
    else Reflect.deleteProperty(process, 'resourcesPath')
    vi.unstubAllEnvs()
    rmSync(root, { recursive: true, force: true })
  }
})
