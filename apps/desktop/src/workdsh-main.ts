import {composeInstalledEnterprisePlugins,installedEnterprisePlugins} from './enterprise-plugins.ts'
/** Minimal Electron carrier for the bundled WorkDSH release profile. */

import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, net, powerMonitor, shell, Tray, type IpcMainInvokeEvent, type MenuItemConstructorOptions } from 'electron'
import { exec, spawn, type ChildProcess } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { enterpriseLoginHtml, connectionLoadingHtml, accountSplashHtml, accountLoginHtml } from './connection-entry.ts'
import { connectionPartition, enterpriseConnection, type DesktopConnection } from './connection-mode.ts'
import { parseDeploymentConfig } from './deployment-config.ts'
import { readModelCredentials } from './model-credentials.ts'
import { readAppConfig, type AppEnvironment, type ResolvedAppConfig } from './app-config.ts'
import { createDebugLog, type DebugLog } from './debug-log.ts'
import { AccountLogin, AccountStore, restoreAccountLogin, startAccountAuthority, type AccountAuthority } from './member-auth.ts'
import { EnterpriseLogin, startEnterpriseAuthority, type Authority } from './enterprise-auth.ts'
import { desktopEnterprisePatch, desktopAccountPatch, desktopConnectorMarketPatch, desktopSkillMarketPatch, desktopModelMarketPatch, desktopExpertMarketPatch, accountSpace, enterpriseEnvironment, enterpriseSpace, materializeRuntimeProfile, markProfileUpdated, officialLauncher, officialHostLauncher, type AccountActor } from './local-runtime.ts'
import { manageCommand } from './command-management.ts'
import { createRuntimeOutputRedactor, redactRuntimeOutput, runtimeFailureDetail, runtimeFailureLog } from './runtime-diagnostics.ts'
import { cleanOwnedProcessTree, reclaimOrphanedToolProcesses, stopOwnedProcess, trackOwnedProcess } from './owned-process.ts'
import { prepareRuntimePort, runtimePortConflict } from './runtime-port.ts'
import { runOfficialCommand } from './official-command.ts'
import { renderMarkdown } from './update-markdown.ts'
import type { UpdateCandidate } from './update-release.ts'
import { UpdateService } from './update-service.ts'
import type { UpdateSnapshot } from './update-state.ts'
import type { UpdateView } from './update-view.ts'
import { verifyWindowsInstaller } from './update-install.ts'
import { launchMacInstaller } from './update-install-mac.ts'
import { updateWindowHtml } from './update-window.ts'
import { updateToastHtml } from './update-toast.ts'

const PROFILE_NAME = 'workdsh'
const READY_PATTERN = /dsh web:\s+(http:\/\/127\.0\.0\.1:\d+\/?\?token=[^\s]+)/u

let runtime: ChildProcess | undefined
let runtimeStarting = false
let window: BrowserWindow | undefined
let quitting = false
let switching = false
let quitRequested = false
let returnRequested = false
let installer: ChildProcess | undefined
const enterpriseWindows = new Set<BrowserWindow>()
let enterprisePortal = process.env.WORKDSH_ENTERPRISE_PORTAL ?? ''
let managedBackend: string | undefined
let entrySurface = false
let pendingConnection: ReturnType<typeof enterpriseConnection> | undefined
let enterprise: { login: EnterpriseLogin, root: string, home: string, deviceId: string, authority?: Authority, authFile?: string } | undefined
let verifyTimer: ReturnType<typeof setInterval> | undefined
let verifying = false

// ── 客户端在线更新（仅 win32-x64）──────────────────────────────────────────
let updater: UpdateService | undefined
let updateWindow: BrowserWindow | undefined
let updateView: UpdateView = { phase: 'idle' }
let updateWindowPhase: UpdateView['phase'] | undefined
let updaterInstalling = false
let updateLog: DebugLog | undefined
let trayUpdateLabel: string | undefined
let lastAutoCheckAt = 0

// Account (replaces personal identity) session state.
let appConfig: ResolvedAppConfig | undefined
let account: { login: AccountLogin, store: AccountStore, deviceId: string, authority?: AccountAuthority, authFile?: string, stopSync?: () => void } | undefined

// ── 启动耗时打点（纯观测，不改变任何启动行为）──────────────────────────────
// 双击到主界面之间可能有一段“一个窗口都没有”的空窗期。此打点把各阶段耗时写入
// userData/startup-timing.log，用于区分两段不同性质的耗时：
//   1) whenReady 之前 —— Electron/系统冷启动（含 asar 完整性校验、系统首扫等）；
//   2) whenReady 之后 —— 过场页展示与 DSH 运行环境准备（物化 profile、装依赖、起本机服务）。
// 局限：无法覆盖操作系统在“进程创建之前”的校验耗时（如 macOS Gatekeeper 首次打开），
// 那一段只能用秒表从“双击”量到“首个窗口出现”，再与日志里的总耗时对比。
const startupOrigin = Date.now()
const startupPreJsMs = Math.round(process.uptime() * 1000)
const startupMarks: { label: string, elapsedMs: number }[] = []
let startupLogFile: string | undefined
/** 账号登录发起时刻；用于统计“从登录到主界面”的总耗时，undefined 表示当前不在登录流程中。 */
let loginStartedAt: number | undefined

/** 整体覆盖写入日志（内容很小）；失败绝不影响启动。 */
function flushStartupTiming(): void {
  if (startupLogFile === undefined) return
  const lines = [
    `[startup] +0ms  主进程 JS 开始执行（进程此前已运行 ${startupPreJsMs}ms）`,
    ...startupMarks.map(mark => `[startup] +${mark.elapsedMs}ms  ${mark.label}`),
  ]
  try { writeFileSync(startupLogFile, lines.join('\n') + '\n', { mode: 0o600 }) } catch { /* 打点写入失败不影响启动 */ }
}

/** 记录一个启动节点：写入内存并同步刷新日志与 stderr。 */
function markStartup(label: string): void {
  const elapsedMs = Date.now() - startupOrigin
  startupMarks.push({ label, elapsedMs })
  process.stderr.write(`[startup] +${elapsedMs}ms ${label}\n`)
  flushStartupTiming()
}

/** 进程回收失败的落盘记录：现场只能看到弹窗，底层原因需要留在 userData/logs 里可查。 */
let cleanupLog: DebugLog | undefined
function recordCleanupFailure(scope: string, error: unknown): void {
  const detail = error instanceof Error ? error.message : String(error)
  process.stderr.write(`[cleanup] ${scope}: ${detail}\n`)
  try {
    cleanupLog ??= createDebugLog(join(app.getPath('userData'), 'logs'), 'process-cleanup')
    cleanupLog.write(`[${new Date().toISOString()}] ${scope}: ${detail}\n`)
  } catch { /* 记录失败不影响退出 */ }
}

function bundledProfileDirectory(): string {
  const overridden = process.env.WORKDSH_BUNDLED_PROFILE
  if (overridden !== undefined && overridden.length > 0) return overridden
  return join(process.resourcesPath, 'workdsh-runtime', 'profiles', PROFILE_NAME)
}

function runtimeHome(): string {
  const overridden = process.env.WORKDSH_DSH_HOME
  if (overridden !== undefined && overridden.length > 0) return overridden
  return join(app.getPath('userData'), 'dsh-home')
}

function bundledNodeExecutable(): string {
  const overridden = process.env.WORKDSH_NODE_EXECUTABLE
  if (overridden !== undefined && overridden.length > 0) return overridden
  return join(
    bundledPrimaryRuntime(),
    'dependencies',
    'node',
    'bin',
    process.platform === 'win32' ? 'node.exe' : 'node',
  )
}

function bundledPrimaryRuntime(): string {
  const overridden = process.env.WORKDSH_PRIMARY_RUNTIME
  if (overridden !== undefined && overridden.length > 0) return overridden
  return join(process.resourcesPath, 'workdsh-runtime', 'primary-runtime')
}

function browserWorkerRequest(): { port: number, profile: string } | undefined {
  const portArg = process.argv.find(arg => arg.startsWith('--workdsh-browser-worker-port='))
  if (portArg === undefined) return undefined
  const port = Number(portArg.slice('--workdsh-browser-worker-port='.length))
  const profile = process.argv.find(arg => arg.startsWith('--workdsh-browser-worker-profile='))
    ?.slice('--workdsh-browser-worker-profile='.length)
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || !profile || !isAbsolute(profile) || !existsSync(profile)) {
    throw new Error('Invalid WorkDSH browser worker arguments')
  }
  return { port, profile }
}

function startBrowserWorker(request: { port: number, profile: string }): void {
  // Set this before Electron becomes ready: hiding the Dock afterwards briefly
  // registers every task's browser worker as another foreground application.
  // Accessory permits the hidden browser window without a Dock icon or menu bar.
  if (process.platform === 'darwin') app.setActivationPolicy('accessory')
  app.setPath('userData', request.profile)
  app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1')
  app.commandLine.appendSwitch('remote-debugging-port', String(request.port))
  void app.whenReady().then(async () => {
    const page = new BrowserWindow({
      show: false,
      width: 1280,
      height: 800,
      webPreferences: {
        offscreen: true,
        backgroundThrottling: false,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      },
    })
    disableSpellcheckDictionaryDownloads(page)
    page.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    await page.loadURL('about:blank')
    process.stdout.write('WORKDSH_BROWSER_WORKER_READY\n')
  }).catch(error => {
    process.stderr.write(`WorkDSH browser worker failed: ${String(error)}\n`)
    app.exit(1)
  })
}

/** 系统托盘（右下角通知区域）：提供「显示主界面」与「退出软件」两个入口。 */
let tray: Tray | undefined

/** 叉号关闭行为偏好：用户勾选「不再提醒」后记住的选择。 */
type CloseAction = 'minimize' | 'quit'
const CLOSE_PREFERENCE_FILENAME = 'close-behavior.json'

function closePreferenceFile(): string { return join(app.getPath('userData'), CLOSE_PREFERENCE_FILENAME) }

function readClosePreference(): CloseAction | undefined {
  try {
    const value = JSON.parse(readFileSync(closePreferenceFile(), 'utf8')) as { action?: unknown }
    return value.action === 'minimize' || value.action === 'quit' ? value.action : undefined
  } catch { return undefined }
}

function writeClosePreference(action: CloseAction): void {
  try {
    mkdirSync(app.getPath('userData'), { recursive: true })
    writeFileSync(closePreferenceFile(), JSON.stringify({ action }), { mode: 0o600 })
  } catch { /* 写入失败不阻断关闭流程 */ }
}

/** 恢复并聚焦主窗口（托盘图标点击 / 二次启动）。 */
function revealMainWindow(): void {
  if (!window || window.isDestroyed()) return
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}

async function applyCloseAction(page: BrowserWindow, action: CloseAction): Promise<void> {
  if (action === 'quit') { app.quit(); return }
  if (!page.isDestroyed()) page.hide()
}

let closePromptOpen = false

/**
 * 叉号关闭请求：默认弹窗让用户选择「最小化到托盘」或「退出软件」，可勾选「不再提醒」记住选择。
 * 永远阻止默认关闭，避免直接结束进程；真正的退出统一走 app.quit()。
 */
async function resolveCloseRequest(page: BrowserWindow): Promise<void> {
  const remembered = readClosePreference()
  if (remembered) { await applyCloseAction(page, remembered); return }
  if (closePromptOpen) return
  closePromptOpen = true
  try {
    const { response, checkboxChecked } = await dialog.showMessageBox(page, {
      type: 'question',
      title: '关闭警务助手',
      message: '关闭窗口还是最小化到系统托盘？',
      detail: '选择「最小化到托盘」后程序继续在后台运行，双击右下角托盘图标即可恢复。',
      buttons: ['最小化到托盘', '退出软件'],
      defaultId: 0,
      cancelId: 0,
      checkboxLabel: '不再提醒',
      checkboxChecked: false,
      noLink: true,
    })
    const action: CloseAction = response === 1 ? 'quit' : 'minimize'
    if (checkboxChecked) writeClosePreference(action)
    await applyCloseAction(page, action)
  } finally { closePromptOpen = false }
}

/** 托盘菜单是唯一常驻入口：更新状态变化时只重建这一份菜单。 */
function refreshTrayMenu(): void {
  if (!tray) return
  const items: MenuItemConstructorOptions[] = [
    { label: '显示主界面', click: () => revealMainWindow() },
  ]
  if (updater !== undefined) {
    items.push({
      label: trayUpdateLabel ?? '检查更新…',
      click: () => {
        // 有更新时只保证左下角提醒条可见（已显示则不重复）；更新窗口只由提醒条的
        // “更新日志”打开。无更新或检查失败才用窗口告知结果。
        if (trayUpdateLabel !== undefined) {
          syncUpdateToast()
          return
        }
        checkForUpdatesManually()
      },
    })
  }
  items.push({ type: 'separator' }, { label: '退出软件', click: () => app.quit() })
  tray.setContextMenu(Menu.buildFromTemplate(items))
}

function installTray(): void {
  if (tray) return
  try {
    const icon = fileURLToPath(new URL(process.platform === 'darwin' ? '../build/tray-iconTemplate.png' : '../build/tray-icon-blue.png', import.meta.url))
    tray = new Tray(icon)
    tray.setToolTip('警务助手')
    refreshTrayMenu()
    tray.on('click', () => revealMainWindow())
    tray.on('double-click', () => revealMainWindow())
  } catch { tray = undefined }
}

// ── 在线更新 ────────────────────────────────────────────────────────────────

function updateSkippedFile(): string {
  return join(app.getPath('userData'), 'update-skipped.json')
}

/** 用户点过“稍后”的版本；自动检查据此不再重复弹窗。 */
function readSkippedVersion(): string | undefined {
  try {
    const value = JSON.parse(readFileSync(updateSkippedFile(), 'utf8')) as { version?: unknown }
    return typeof value.version === 'string' && value.version.length > 0 ? value.version : undefined
  } catch { return undefined }
}

function rememberSkippedVersion(version: string): void {
  try {
    mkdirSync(app.getPath('userData'), { recursive: true })
    writeFileSync(updateSkippedFile(), JSON.stringify({ version }), { mode: 0o600 })
  } catch { /* 记住忽略版本失败只会多提示一次，不阻断更新 */ }
}

function viewForUpdate(snapshot: UpdateSnapshot): UpdateView {
  const candidate = snapshot.candidate
  const notesHtml = candidate?.notes === undefined ? undefined : renderMarkdown(candidate.notes)
  return {
    phase: snapshot.phase,
    ...(candidate === undefined ? {} : {
      version: candidate.version,
      releaseType: candidate.releaseType,
      mandatory: candidate.mandatory,
      size: candidate.size,
      ...(candidate.publishedAt === undefined ? {} : { publishedAt: candidate.publishedAt }),
    }),
    currentVersion: app.getVersion(),
    ...(snapshot.percent === undefined ? {} : { percent: snapshot.percent }),
    ...(notesHtml === undefined ? {} : { notesHtml }),
    ...(snapshot.failure === undefined ? {} : {
      failure: { operation: snapshot.failure.operation, code: snapshot.failure.code },
    }),
  }
}

/** 更新窗口尺寸：宽度固定，高度随状态收缩，避免“一片空白里嵌一张小卡片”。 */
const UPDATE_WINDOW_WIDTH = 560
function updateWindowHeight(phase: UpdateView['phase']): number {
  switch (phase) {
    case 'checking': return 300
    case 'idle': return 320
    case 'available': return 520
    case 'ready': return 340
    case 'downloading': return 340
    case 'verifying': return 340
    case 'installing': return 340
    case 'error': return 360
  }
}

/** 更新状态只通过这一处同步到托盘、更新窗口与系统通知。 */
function handleUpdateState(snapshot: UpdateSnapshot): void {
  updateView = viewForUpdate(snapshot)
  const phaseChanged = snapshot.phase !== updateWindowPhase
  updateWindowPhase = snapshot.phase
  if (updateWindow !== undefined && !updateWindow.isDestroyed()) {
    updateWindow.webContents.send('workdsh:update-view', updateView)
    try { updateWindow.setClosable(snapshot.phase !== 'installing') } catch { /* 平台不支持时忽略 */ }
    // 用户手动拖动过尺寸时不再干预；最大化期间也不改，避免把用户的操作顶掉。
    if (phaseChanged && !updateWindow.isMaximized()) {
      try { updateWindow.setContentSize(UPDATE_WINDOW_WIDTH, updateWindowHeight(snapshot.phase)) } catch { /* 忽略尺寸调整失败 */ }
    }
  }

  const label = snapshot.phase === 'available' || snapshot.phase === 'ready'
    ? `新版本 ${snapshot.candidate?.version ?? ''}（点击更新）`
    : snapshot.phase === 'downloading' ? '正在下载更新…'
      : snapshot.phase === 'installing' ? '正在安装更新…'
        : undefined
  if (label !== trayUpdateLabel) {
    trayUpdateLabel = label
    refreshTrayMenu()
  }

  const candidate = snapshot.candidate
  if (snapshot.phase === 'available' && candidate?.mandatory === true) {
    // 强制更新直接展示窗口，用户不能只关闭提示。
    showUpdateWindow()
  }
  syncUpdateToast()
}

function showUpdateWindow(): void {
  if (updater === undefined) return
  if (updateWindow !== undefined && !updateWindow.isDestroyed()) {
    updateWindow.show()
    updateWindow.focus()
    return
  }
  // 强制更新使用模态窗口阻止继续操作主界面；普通更新保持独立窗口。
  const parent = window !== undefined && !window.isDestroyed() ? window : undefined
  const modal = updateView.mandatory === true && parent !== undefined
  updateWindow = new BrowserWindow({
    width: UPDATE_WINDOW_WIDTH,
    height: updateWindowHeight(updateView.phase),
    minWidth: 480,
    minHeight: 260,
    ...(modal && parent !== undefined ? { parent, modal: true } : {}),
    title: '软件更新',
    // 自绘标题栏：系统蓝色标题条与观感不一致，这里只保留我们自己的控件。
    frame: false,
    resizable: true,
    maximizable: true,
    fullscreenable: false,
    show: false,
    autoHideMenuBar: true,
    minimizable: !modal,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#101216' : '#f6f8fb',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: fileURLToPath(new URL('./update-preload.cjs', import.meta.url)),
    },
  })
  const page = updateWindow
  page.setMenuBarVisibility(false)
  const sendMaximized = (): void => {
    if (!page.isDestroyed()) page.webContents.send('workdsh:update-maximized', page.isMaximized())
  }
  page.on('maximize', sendMaximized)
  page.on('unmaximize', sendMaximized)
  page.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//u.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  page.on('close', event => {
    if (quitting || updaterInstalling) return
    event.preventDefault()
    // 强制更新不允许只关闭提示；普通更新关闭即隐藏。
    if (updateView.mandatory !== true) page.hide()
  })
  page.on('closed', () => {
    if (updateWindow === page) {
      updateWindow = undefined
      updateWindowPhase = undefined
    }
  })
  void page.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(updateWindowHtml())).then(() => {
    if (page.isDestroyed()) return
    page.webContents.send('workdsh:update-view', updateView)
    page.show()
  }).catch(() => { if (!page.isDestroyed()) page.destroy() })
}

// ── 左下角“新版本可用”提醒条 ────────────────────────────────────────────────
/** 提醒条固定尺寸；高度含透明窗口的留白，实际可见条更矮。 */
const UPDATE_TOAST_WIDTH = 396
const UPDATE_TOAST_HEIGHT = 64
const UPDATE_TOAST_MARGIN = 12

let updateToast: BrowserWindow | undefined
let updateToastParent: BrowserWindow | undefined
let toastParentHandlers: {
  move: () => void
  resize: () => void
  minimize: () => void
  restore: () => void
  hide: () => void
  show: () => void
} | undefined

/** 只有“可更新”才提示；强制更新走独立窗口，已最新不打扰。 */
function toastVisibleFor(view: UpdateView): boolean {
  if (view.mandatory === true) return false
  return view.phase === 'available' || view.phase === 'ready'
}

function positionUpdateToast(): void {
  const toast = updateToast
  const parent = updateToastParent
  if (toast === undefined || parent === undefined || toast.isDestroyed() || parent.isDestroyed()) return
  const bounds = parent.getContentBounds()
  toast.setPosition(
    bounds.x + UPDATE_TOAST_MARGIN,
    bounds.y + bounds.height - UPDATE_TOAST_HEIGHT - UPDATE_TOAST_MARGIN,
  )
}

function detachToastParent(): void {
  const parent = updateToastParent
  const handlers = toastParentHandlers
  if (parent !== undefined && !parent.isDestroyed() && handlers !== undefined) {
    parent.off('move', handlers.move)
    parent.off('resize', handlers.resize)
    parent.off('minimize', handlers.minimize)
    parent.off('restore', handlers.restore)
    parent.off('hide', handlers.hide)
    parent.off('show', handlers.show)
  }
  toastParentHandlers = undefined
}

function destroyUpdateToast(): void {
  detachToastParent()
  const toast = updateToast
  updateToast = undefined
  updateToastParent = undefined
  if (toast !== undefined && !toast.isDestroyed()) toast.destroy()
}

function hideUpdateToast(): void {
  if (updateToast !== undefined && !updateToast.isDestroyed()) updateToast.hide()
}

/**
 * 提醒条挂在当前应用窗口下：登录页也能看到，主窗口移动/缩放/最小化时跟随。
 * 登录页与工作台会切换窗口对象，这时按新的父窗口重建一次。
 */
function ensureUpdateToast(): void {
  const parent = window
  if (parent === undefined || parent.isDestroyed()) return
  if (updateToast !== undefined && !updateToast.isDestroyed() && updateToastParent === parent) {
    positionUpdateToast()
    if (!updateToast.isVisible()) updateToast.showInactive()
    return
  }
  destroyUpdateToast()
  updateToastParent = parent
  const toast = new BrowserWindow({
    width: UPDATE_TOAST_WIDTH,
    height: UPDATE_TOAST_HEIGHT,
    parent,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: fileURLToPath(new URL('./update-toast-preload.cjs', import.meta.url)),
    },
  })
  updateToast = toast
  toast.setMenuBarVisibility(false)
  const drop = (): void => {
    if (updateToast !== toast) return
    updateToast = undefined
    updateToastParent = undefined
    toastParentHandlers = undefined
  }
  toast.on('closed', drop)
  parent.once('closed', drop)
  const show = (): void => {
    if (!toastVisibleFor(updateView) || toast.isDestroyed()) return
    positionUpdateToast()
    toast.showInactive()
  }
  const handlers = {
    move: positionUpdateToast,
    resize: positionUpdateToast,
    minimize: () => { if (!toast.isDestroyed()) toast.hide() },
    restore: show,
    hide: () => { if (!toast.isDestroyed()) toast.hide() },
    show,
  }
  toastParentHandlers = handlers
  parent.on('move', handlers.move)
  parent.on('resize', handlers.resize)
  parent.on('minimize', handlers.minimize)
  parent.on('restore', handlers.restore)
  parent.on('hide', handlers.hide)
  parent.on('show', handlers.show)
  void toast.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(updateToastHtml())).then(() => {
    if (toast.isDestroyed()) return
    toast.webContents.send('workdsh:update-view', updateView)
    show()
  }).catch(() => { if (!toast.isDestroyed()) toast.destroy() })
}

function syncUpdateToast(): void {
  if (!toastVisibleFor(updateView)) {
    hideUpdateToast()
    return
  }
  ensureUpdateToast()
  if (updateToast !== undefined && !updateToast.isDestroyed()) {
    updateToast.webContents.send('workdsh:update-view', updateView)
  }
}

/** “重启升级”：先提醒会重启，确认后自动下载、安装并重启。 */
async function confirmAndRestartUpgrade(parentWindow?: BrowserWindow): Promise<void> {
  if (updater === undefined || updateView.phase === 'installing') return
  const version = updateView.version ?? '新版本'
  const options = {
    type: 'question' as const,
    title: '重启升级',
    message: `升级到 ${version} 需要重启软件`,
    detail: '升级过程中软件会自动关闭并重新启动，请先保存正在编辑的内容。',
    buttons: ['取消', '确定'],
    defaultId: 1,
    cancelId: 0,
    noLink: true,
  }
  // 弹窗挂在触发它的窗口上：提醒条的按钮挂在主窗口，更新窗口的按钮挂在更新窗口。
  const owner = parentWindow !== undefined && !parentWindow.isDestroyed() ? parentWindow : undefined
  const parent = owner ?? (window !== undefined && !window.isDestroyed() ? window : undefined)
  const result = parent === undefined
    ? await dialog.showMessageBox(options)
    : await dialog.showMessageBox(parent, options)
  if (result.response !== 1) return
  hideUpdateToast()
  showUpdateWindow()
  void updater.downloadAndInstall()
}

function assertUpdateSender(event: IpcMainInvokeEvent): void {
  if (updateWindow === undefined || updateWindow.isDestroyed() || event.sender !== updateWindow.webContents) {
    throw new Error('更新窗口来源无效')
  }
}

function assertToastSender(event: IpcMainInvokeEvent): void {
  if (updateToast === undefined || updateToast.isDestroyed() || event.sender !== updateToast.webContents) {
    throw new Error('更新提醒来源无效')
  }
}

function installUpdateHandlers(): void {
  ipcMain.handle('workdsh:update-ready', (event) => {
    assertUpdateSender(event)
    return updateView
  })
  ipcMain.handle('workdsh:update-action', async (event, action: unknown) => {
    assertUpdateSender(event)
    if (typeof action !== 'string' || updater === undefined) return
    switch (action) {
      case 'download': void updater.download(); return
      case 'install': void updater.install(); return
      case 'upgrade':
        // 与提醒条的“重启升级”一致：先确认会重启，再开始下载安装。
        await confirmAndRestartUpgrade(updateWindow)
        return
      case 'cancel': void updater.cancel(); return
      case 'retry': void updater.retry(); return
      case 'check': void updater.check(true); return
      case 'dismiss':
        await updater.dismiss()
        updateWindow?.hide()
        return
      case 'close':
        if (updateView.phase !== 'installing') updateWindow?.hide()
        return
      default:
        return
    }
  })
  ipcMain.handle('workdsh:update-window', (event, action: unknown) => {
    assertUpdateSender(event)
    const page = updateWindow
    if (page === undefined || page.isDestroyed() || typeof action !== 'string') return false
    switch (action) {
      case 'minimize':
        page.minimize()
        break
      case 'maximize':
        if (page.isMaximized()) page.unmaximize()
        else page.maximize()
        break
      case 'close':
        // 强制更新不能只关掉提示；安装阶段窗口也不允许自行关闭。
        if (updateView.mandatory !== true && updateView.phase !== 'installing') page.hide()
        break
      default:
        break
    }
    return page.isMaximized()
  })
  ipcMain.handle('workdsh:update-toast-ready', (event) => {
    assertToastSender(event)
    return updateView
  })
  ipcMain.handle('workdsh:update-toast-action', async (event, action: unknown) => {
    assertToastSender(event)
    if (typeof action !== 'string' || updater === undefined) return
    switch (action) {
      case 'notes':
        showUpdateWindow()
        return
      case 'restart':
        await confirmAndRestartUpgrade()
        return
      case 'dismiss':
        await updater.dismiss()
        hideUpdateToast()
        return
      default:
        return
    }
  })
}

function checkForUpdatesManually(): void {
  if (updater === undefined) return
  lastAutoCheckAt = Date.now()
  // 有更新时只显示左下角提醒条；已最新或失败才用独立窗口告知。
  void updater.check(true).then(() => {
    if (updateView.phase === 'idle' || updateView.phase === 'error') showUpdateWindow()
  })
}

function scheduleUpdateChecks(minutes: number): void {
  const intervalMs = Math.max(5, minutes) * 60_000
  const jitter = (value: number): number => Math.round(value * (0.9 + Math.random() * 0.2))
  const tick = (): void => {
    if (updater === undefined) return
    lastAutoCheckAt = Date.now()
    void updater.check(false)
    setTimeout(tick, jitter(intervalMs))
  }
  setTimeout(tick, jitter(30_000))
  powerMonitor.on('resume', () => {
    if (updater === undefined || Date.now() - lastAutoCheckAt < 5 * 60_000) return
    lastAutoCheckAt = Date.now()
    void updater.check(false)
  })
}

/** 更新前停止本机运行，但保留登录态与用户数据。 */
async function stopRuntimeForUpdate(): Promise<void> {
  account?.stopSync?.()
  await account?.authority?.close()
  account?.login.cancelRequests()
  if (enterprise !== undefined) {
    await enterprise.authority?.close()
    enterprise.login.cancelRequests()
  }
  const child = runtime
  if (child !== undefined) {
    await stopOwnedProcess(child)
    if (runtime === child) {
      runtime = undefined
      runtimeStarting = false
    }
  }
}

/** 安装阶段进度进程的命令行参数：主程序退出后由它接管同一张进度页。 */
interface UpdateProgressRequest {
  readonly installer: string
  readonly version: string
  /** 进度页显示完成后写入的标记文件：主程序据此在交接时不留空白。 */
  readonly readyFlag: string
  /** 主程序更新窗口当前的位置与尺寸，交接后进度页停留在原处。 */
  readonly bounds?: { readonly x: number, readonly y: number, readonly width: number, readonly height: number }
}

function parseWindowBounds(value: string | undefined): UpdateProgressRequest['bounds'] {
  if (value === undefined || value.length === 0) return undefined
  const parts = value.split(',').map(part => Number.parseInt(part, 10))
  if (parts.length !== 4) return undefined
  const [x, y, width, height] = parts
  if (x === undefined || y === undefined || width === undefined || height === undefined) return undefined
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return undefined
  return { x, y, width, height }
}

function updateProgressRequest(): UpdateProgressRequest | undefined {
  const flag = process.argv.find(argument => argument.startsWith('--update-progress='))
  if (flag === undefined) return undefined
  const installer = flag.slice('--update-progress='.length)
  if (installer.length === 0) return undefined
  const target = process.argv.find(argument => argument.startsWith('--update-target='))
  const ready = process.argv.find(argument => argument.startsWith('--update-ready='))
  const bounds = process.argv.find(argument => argument.startsWith('--update-bounds='))
  const parsedBounds = parseWindowBounds(bounds === undefined ? undefined : bounds.slice('--update-bounds='.length))
  return {
    installer,
    version: target === undefined ? '' : target.slice('--update-target='.length),
    readyFlag: ready === undefined ? '' : ready.slice('--update-ready='.length),
    ...(parsedBounds === undefined ? {} : { bounds: parsedBounds }),
  }
}

/** 等标记文件出现；超时返回 false，让主程序照常退出，不至于卡在安装页。 */
async function waitForMarker(path: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (existsSync(path)) return true
    await new Promise(resolve => setTimeout(resolve, 60))
  }
  return false
}

/**
 * 安装阶段的“同一张进度页”：主程序先退出（文件才能被替换），由这个独立进程继续
 * 展示“正在安装更新”，静默跑完安装器后再一并退出，避免中途跳出 NSIS 安装界面。
 */
async function startUpdateProgressWindow(request: UpdateProgressRequest): Promise<void> {
  await app.whenReady()
  const view: UpdateView = {
    phase: 'installing',
    ...(request.version.length === 0 ? {} : { version: request.version }),
    currentVersion: '',
  }
  const page = new BrowserWindow({
    ...(request.bounds === undefined
      ? { width: UPDATE_WINDOW_WIDTH, height: updateWindowHeight('installing') }
      : request.bounds),
    frame: false,
    resizable: false,
    // 安装期间允许最小化，并且出现在任务栏：用户随时能把进度页找回来。
    minimizable: true,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: false,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#101216' : '#f6f8fb',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: fileURLToPath(new URL('./update-preload.cjs', import.meta.url)),
    },
  })
  page.setMenuBarVisibility(false)
  ipcMain.handle('workdsh:update-ready', () => view)
  ipcMain.handle('workdsh:update-action', () => undefined)
  ipcMain.handle('workdsh:update-window', (_event, action: unknown) => {
    if (action === 'minimize' && !page.isDestroyed()) page.minimize()
    return false
  })
  try {
    await page.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(updateWindowHtml({ progressOnly: true })))
    if (page.isDestroyed()) return
    // 加载文档会覆盖标题，这里在加载完成后再设一次，任务栏显示的是安装进度。
    page.setTitle('警务助手 · 正在安装更新')
    page.webContents.send('workdsh:update-view', view)
    page.show()
    // 告诉主程序“进度页已经显示出来了”，它再关掉自己那张，避免闪一下再消失。
    if (request.readyFlag.length > 0) {
      try { writeFileSync(request.readyFlag, '1') } catch { /* 标记失败只会多一次窗口切换 */ }
    }
    // 等主程序完全退出，避免安装器认为应用仍在运行而先杀进程。
    await new Promise(resolve => setTimeout(resolve, 1500))
    await new Promise<void>(resolve => {
      const child = spawn(request.installer, ['/S', '--updated'], { stdio: 'ignore', windowsHide: true })
      child.once('error', () => resolve())
      child.once('exit', () => resolve())
    })
  } finally {
    if (!page.isDestroyed()) page.destroy()
    app.quit()
  }
}

/** 安装阶段进度页的工作目录：必须是安装目录之外的副本，安装器才能覆盖 $INSTDIR。 */
const PROGRESS_HELPER_DIRECTORY = 'workdsh-update-progress-app'

function progressHelperDirectory(): string {
  return join(app.getPath('temp'), PROGRESS_HELPER_DIRECTORY)
}

/** 用系统命令删除目录：Electron 的 fs 把 app.asar 当目录，fs.rm 删除整棵副本会报 EPERM。 */
function removeDirectory(target: string): Promise<void> {
  return new Promise(resolve => {
    exec(`rd /s /q "${target}"`, { windowsHide: true }, () => resolve())
  })
}

/** 清掉上一次升级留下的进度页副本与缓存；新版本启动时调用。 */
async function cleanProgressHelper(): Promise<void> {
  const helperDirectory = progressHelperDirectory()
  const dataDirectory = join(app.getPath('temp'), 'workdsh-update-progress')
  if (existsSync(helperDirectory)) await removeDirectory(helperDirectory)
  if (existsSync(dataDirectory)) await removeDirectory(dataDirectory)
}

/**
 * 安装器要覆盖 $INSTDIR 下的 exe 与 app.asar，从安装目录启动的进度进程会把文件锁住，
 * 所以进度页必须来自副本。Electron 把 app.asar 当目录读，fs.cp 无法复制它；
 * 交给 robocopy 在系统层复制，并跳过 resources/workdsh-runtime（约 900MB）。
 */
function copyShellForProgress(installDirectory: string, helperDirectory: string, runtimeDirectory: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('robocopy', [
      installDirectory,
      helperDirectory,
      '/E',
      '/XD', runtimeDirectory,
      '/NFL', '/NDL', '/NJH', '/NJS', '/NP',
    ], { windowsHide: true })
    child.once('error', reject)
    // robocopy 以 0–7 表示成功（0 为无变化、1 为已复制），8 及以上才是失败。
    child.once('exit', code => {
      if (code !== null && code < 8) resolve()
      else reject(new Error(`无法准备更新进度页（robocopy ${String(code)}）`))
    })
  })
}

async function prepareProgressHelper(): Promise<string> {
  const installDirectory = dirname(process.resourcesPath)
  const helperDirectory = progressHelperDirectory()
  const runtimeDirectory = join(installDirectory, 'resources', 'workdsh-runtime')
  await cleanProgressHelper()
  try {
    await copyShellForProgress(installDirectory, helperDirectory, runtimeDirectory)
  } catch (error) {
    await cleanProgressHelper()
    throw error
  }
  return join(helperDirectory, basename(process.execPath))
}

async function installUpdate(candidate: UpdateCandidate, installerPath: string): Promise<void> {
  updaterInstalling = true
  updateLog?.write(`[${new Date().toISOString()}] install ${candidate.version}\n`)
  try {
    await stopRuntimeForUpdate()
    if (process.platform === 'darwin') {
      // macOS：解压校验后交给助手脚本，等本进程退出再原地替换 .app 并重新拉起。
      await launchMacInstaller({
        archivePath: installerPath,
        stagingDirectory: join(app.getPath('userData'), 'updates', 'staging', candidate.version),
        executablePath: app.getPath('exe'),
        pid: process.pid,
        logFile: join(app.getPath('userData'), 'logs', 'update-install.log'),
      })
      quitForUpdate()
      return
    }
    if (!await verifyWindowsInstaller(installerPath)) throw new Error('安装包不是有效的 Windows 安装程序')
    // 交给独立进度进程：它先展示同一张进度页，再静默运行安装器，装完自行退出。
    // 进度进程从安装目录之外的副本启动，避免锁住待覆盖的文件；
    // 独立 userData 目录，避免与主程序共用 Chromium 单例锁而无法显示窗口。
    const helperExecutable = app.isPackaged ? await prepareProgressHelper() : process.execPath
    const helperUserData = join(app.getPath('temp'), 'workdsh-update-progress')
    // 交接不闪：把当前进度页的位置/尺寸交给新进程，等它显示出来后再关掉本进程的窗口。
    const bounds = updateWindow !== undefined && !updateWindow.isDestroyed() && !updateWindow.isMinimized()
      ? updateWindow.getBounds()
      : undefined
    const readyFlag = join(app.getPath('temp'), `workdsh-update-ready-${String(process.pid)}.flag`)
    try { rmSync(readyFlag, { force: true }) } catch { /* 旧标记删不掉不影响本次交接 */ }
    const args = [
      `--user-data-dir=${helperUserData}`,
      `--update-progress=${installerPath}`,
      `--update-target=${candidate.version}`,
      `--update-ready=${readyFlag}`,
      ...(bounds === undefined ? [] : [`--update-bounds=${bounds.x},${bounds.y},${bounds.width},${bounds.height}`]),
    ]
    if (!app.isPackaged) args.unshift(app.getAppPath())
    // 不能加 windowsHide：它会让进度进程的首个窗口以隐藏状态创建，show() 也显示不出来。
    const helper = spawn(helperExecutable, args, { detached: true, stdio: 'ignore' })
    helper.unref()
    updateLog?.write(`[${new Date().toISOString()}] helper-spawned ${String(helper.pid)}\n`)
    await waitForMarker(readyFlag, 8_000)
    try { rmSync(readyFlag, { force: true }) } catch { /* 标记清理失败无影响 */ }
  } catch (error) {
    // 安装交接失败时本机 Host 已被主动停止：回到登录页，避免用户停在一个已停止的工作区。
    updaterInstalling = false
    void returnToLogin()
    throw error
  }
  // 进度页由独立进程接管：主程序只负责退出，由安装器覆盖文件后重新拉起应用。
  quitForUpdate()
}

/** 交接完成后关闭所有窗口并退出；安装器/助手进程负责重新拉起应用。 */
function quitForUpdate(): void {
  quitting = true
  for (const page of BrowserWindow.getAllWindows()) {
    if (!page.isDestroyed()) page.destroy()
  }
  app.quit()
}

function startUpdater(): void {
  // Windows x64 走 NSIS 静默升级；macOS 只在打包版本上启用原地替换，开发态不触碰自身应用。
  const windows = process.platform === 'win32' && process.arch === 'x64'
  const macos = process.platform === 'darwin' && app.isPackaged
  if (!windows && !macos) return
  const config = loadConfig()
  if (!config.server.updateEnabled) return

  updateLog = createDebugLog(join(app.getPath('userData'), 'logs'), 'update')
  updater = new UpdateService({
    baseUrl: config.server.baseUrl,
    appId: config.server.appId,
    platform: process.platform,
    arch: process.arch,
    currentVersion: app.getVersion(),
    latestVersionPath: config.server.latestVersionPath,
    downloadDirectory: join(app.getPath('userData'), 'updates'),
    // net.fetch 复用 Chromium 网络栈：系统代理、证书库与内网自建 CA 都能生效。
    fetch: net.fetch as unknown as typeof fetch,
    onState: handleUpdateState,
    onInstall: installUpdate,
    onJournal: (event, detail) => updateLog?.write(`[${new Date().toISOString()}] ${event}${detail === undefined ? '' : ` ${detail}`}\n`),
    skippedVersion: readSkippedVersion,
    rememberSkipped: rememberSkippedVersion,
  })
  installUpdateHandlers()
  scheduleUpdateChecks(config.server.updateCheckIntervalMinutes)
  refreshTrayMenu()
}

/**
 * Chromium 会在页面出现可编辑元素时到 Google CDN 拉取拼写词典
 * (https://redirector.gvt1.com/edgedl/chrome/dict/...)。该域名在部分网络下不可达，
 * TLS 握手会被对端关闭 (net_error -100)，启动期因此出现重试停顿与报错刷屏。
 * 清空词典语言列表即不会发起该下载；仅设置 webPreferences.spellcheck: false 无法阻止。
 */
function disableSpellcheckDictionaryDownloads(page: BrowserWindow): void {
  page.webContents.session.setSpellCheckerLanguages([])
}

/** 解析 workdsh:// 窄通道的目标主机名；非该协议或无效 URL 一律返回 undefined。 */
function workdshCommand(target: string): string | undefined {
  if (!target.startsWith('workdsh://')) return undefined
  try { return new URL(target).hostname } catch { return undefined }
}

function openWindow(url: string, connection: DesktopConnection = { mode: 'personal' }, carrier = false, reveal = true, backgroundColor = '#111113'): void {
  const previous = window
  const previousEntrySurface = entrySurface
  const icon = fileURLToPath(new URL('../build/app-icon.png', import.meta.url))
  window = new BrowserWindow({
    width: 1440,
    height: 960,
    ...(previous && typeof previous.getBounds === 'function' ? previous.getBounds() : {}),
    minWidth: 960,
    minHeight: 640,
    title: '警务助手',
    icon,
    backgroundColor,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      ...(carrier ? { preload: fileURLToPath(new URL('./connection-preload.cjs', import.meta.url)) } : {}),
      ...(connectionPartition(connection) === undefined ? {} : { partition: connectionPartition(connection)! }),
    },
  })
  const page = window
  disableSpellcheckDictionaryDownloads(page)
  entrySurface = carrier
  window.on('page-title-updated', event => {
    event.preventDefault()
    page.setTitle('警务助手')
  })
  if (connection.mode === 'enterprise') enterpriseWindows.add(page)
  window.webContents.setWindowOpenHandler(({ url: target }) => {
    if (target.startsWith('https://') || target.startsWith('http://')) void shell.openExternal(target)
    return { action: 'deny' }
  })
  if (!carrier) {
    const origin = new URL(url).origin
    page.webContents.on('will-navigate', (event, target) => {
      if (target === 'workdsh://entry' && window === page && !switching) {
        event.preventDefault()
        if (!enterprisePluginAvailable()) { dialog.showErrorBox('企业插件不可用', '请先安装兼容的企业账号插件。'); return }
        void returnToLogin()
        return
      }
      // 工作台账号菜单的「检查更新」：沿用 workdsh:// 窄通道，不往官方页面注入任何桥。
      if (workdshCommand(target) === 'check-update') {
        event.preventDefault()
        if (window === page) checkForUpdatesManually()
        return
      }
      try { if (new URL(target).origin === origin) return } catch { /* invalid navigation is refused */ }
      event.preventDefault()
    })
  }
  void page.loadURL(url).then(() => {
    if (page.isDestroyed()) return
    if (reveal) {
      if (carrier) markStartup('入口页面已显示')
      else {
        markStartup(loginStartedAt === undefined
          ? '工作台窗口已显示（主界面就绪）'
          : `工作台窗口已显示（登录到主界面总耗时 ${Date.now() - loginStartedAt}ms）`)
        loginStartedAt = undefined
      }
      page.show()
    }
    if (previous && !previous.isDestroyed()) previous.destroy()
  }).catch((error: unknown) => {
    // 失败原因是区分「本地服务未就绪」「端口/进程冲突」「被安全软件拦截」的唯一线索，
    // 必须随提示一起给出。失败 URL 带一次性 token，展示前先抹掉。
    const reason = (error instanceof Error ? error.message : String(error)).replace(/\?token=[^\s']+/gu, '?token=[redacted]')
    // ERR_ABORTED(-3) 不是加载失败：它表示这次导航被同一窗口的后一次导航取代（过场页还没加载完就切到
    // 登录页／工作区页），或窗口已被用户关闭。此时该窗口的内容以后一次导航为准，既不销毁窗口，
    // 也不能退回入口页——旧实现把这种取代当成"工作区打不开"，首次启动即弹错并拆掉整个流程。
    if (/ERR_ABORTED\s*\(-3\)/u.test(reason)) {
      process.stderr.write(`[startup] 页面导航被后一次导航取代，忽略：${reason}\n`)
      return
    }
    if (!page.isDestroyed()) page.destroy()
    if (previous && !previous.isDestroyed()) { window = previous; entrySurface = previousEntrySurface }
    dialog.showErrorBox('无法打开工作区', `请检查企业地址、网络或本地运行状态。\n\n${reason}`)
    if (runtime) void returnToLogin()
  })
  page.on('closed', () => { enterpriseWindows.delete(page); if (window === page) window = undefined })
  // 点叉号不再直接退出：交给关闭确认弹窗（隐藏到托盘 / 退出软件）。真正的退出/切换流程不受影响。
  page.on('close', event => {
    if (quitting || switching || updaterInstalling) return
    event.preventDefault()
    void resolveCloseRequest(page)
  })
}

function runtimeEnvironment(home: string): NodeJS.ProcessEnv {
  const inherited = enterprise ? enterpriseEnvironment(enterprise.root, bundledNodeExecutable(), process.env) : process.env
  return {
    ...inherited,
    // WorkDSH 定制：把随包 Python 目录放在 PATH 最前。
    // Office 技能要求用随包解释器（load_workspace_dependencies 返回的 python.exe），但工作区里的
    // Office 命令是按 `python` 这种名字执行的：PATH 里没有随包 Python 时，Windows 会命中
    // 「应用执行别名」——%LOCALAPPDATA%\Microsoft\WindowsApps\python.exe 实际是
    // AppInstallerPythonRedirector.exe（打开商店的转发器）。隔离内网上它无法初始化，
    // 直接弹出「AppInstallerPythonRedirector.exe - 应用程序无法正常启动(0xc0000142)」。
    // 前置随包目录后，`python` 命令稳定命中随包解释器，不再经过商店转发器。
    PATH: [join(bundledPrimaryRuntime(), 'dependencies', 'python'), inherited.PATH]
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
      .join(process.platform === 'win32' ? ';' : ':'),
    DSH_HOME: home,
    DSH_AGENTS_HOME: enterprise ? join(enterprise.root, 'agents') : join(home, 'agents'),
    DSH_BUNDLED_PRIMARY_RUNTIME: bundledPrimaryRuntime(),
    DSH_ELECTRON_EXECUTABLE: process.execPath,
    // 调试开关（workdsh-app.json 的 environment）：dev 时 Host 侧把出站 HTTP 请求与响应
    // 写入 WORKDSH_LOG_DIR；prod 下 Host 不产生这些日志。读取失败按 prod 处理。
    WORKDSH_ENVIRONMENT: debugEnvironment(),
    WORKDSH_LOG_DIR: debugLogDirectory(),
    // A packaged carrier embeds the WorkDSH entry point, but a development
    // Electron binary needs the app directory as the worker's first argument.
    WORKDSH_ELECTRON_APP: app.isPackaged ? undefined : app.getAppPath(),
    // WorkDSH 定制：注入随包交付的模型访问凭据（安装包 Resources 下的 model-credentials.json）。
    // 载体不再预置模型或默认模型，这些变量只供用户自建 provider 的 apiKeyEnv 引用时使用。
    // 仅个人工作区注入：企业运行的模型配置由企业侧提供，载体不代注入（enterpriseEnvironment 走白名单）。
    // 启动环境显式提供的同名变量优先，文件值只作兜底（见 readModelCredentials）。
    ...(enterprise ? {} : readModelCredentials(process.resourcesPath ?? '', process.env)),
    ELECTRON_RUN_AS_NODE: undefined,
    // WorkDSH 定制：让载体打包的 Node 信任系统证书库（--use-system-ca）。
    // 环境对 GitHub 系域名做 TLS 拦截，Node 默认只信内置 CA 导致安装插件时
    // fetch 报 UNABLE_TO_VERIFY_LEAF_SIGNATURE（前端只见 "fetch failed"）。
    // 与已有 NODE_OPTIONS 合并，不覆盖启动环境显式注入的其他选项。
    NODE_OPTIONS: ['--use-system-ca', process.env.NODE_OPTIONS].filter(Boolean).join(' '),
  }
}

async function officialCommand(home: string, args: string[], timeoutMs = 240_000): Promise<void> {
  const executable = bundledNodeExecutable()
  const launcher = officialLauncher(bundledProfileDirectory(), home, executable, join(bundledPrimaryRuntime(), 'dependencies', 'pnpm', 'bin', 'pnpm.cjs'))
  await runOfficialCommand({ executable, launcher, args, home, env: runtimeEnvironment(home), timeoutMs,
    logDirectory: join(app.getPath('userData'), 'logs'), cancelled: () => quitRequested,
    onProcess: child => { installer = child },
  })
}

async function prepareProfile(home: string, onLoading?: (message: string, index: number) => Promise<void> | void): Promise<{ profile: string, existingHome: boolean }> {
  markStartup('prepareProfile 开始（物化运行时 Profile）')
  // Capture this before materialization creates the new Home's Profile files.
  const existingHome = [join(home, 'profiles', PROFILE_NAME, 'package.json'), join(home, 'profiles', PROFILE_NAME, 'cordis.yml'), join(home, 'cordis.yml'), join(home, '.workdsh-host.mjs')].some(existsSync)
  const source = bundledProfileDirectory()
  const result = materializeRuntimeProfile(source, home)
  markStartup(result.changed ? 'prepareProfile：依赖有变化，需要安装/更新' : 'prepareProfile：依赖无变化，无需安装')
  if (result.changed) {
    const entry = window
    if (entry && !entry.isDestroyed()) {
      if (onLoading) await onLoading('正在更新工作区插件依赖', 2)
      else await entry.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(connectionLoadingHtml('正在更新工作区插件依赖')))
    }
    await officialCommand(home, ['plugin', '--profile', PROFILE_NAME, 'install'])
    markProfileUpdated(source, result.profile)
    markStartup('插件依赖安装完成')
    if (entry && !entry.isDestroyed()) {
      if (onLoading) await onLoading(enterprise ? '正在启动企业工作区' : '正在启动个人工作区', 3)
      else await entry.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(connectionLoadingHtml(enterprise ? '正在启动企业工作区' : '正在启动个人工作区')))
    }
  }
  officialLauncher(source, home, bundledNodeExecutable(), join(bundledPrimaryRuntime(), 'dependencies', 'pnpm', 'bin', 'pnpm.cjs'))
  return { profile: result.profile, existingHome }
}

function rememberCommandSpace(home?: string): void {
  const active = home
    ? { mode: enterprise ? 'enterprise' as const : (account ? 'account' as const : 'personal' as const), home, ...(enterprise ? { root: enterprise.root } : {}),
        label: enterprise ? `${enterprise.login.actor.organizationName ?? '企业'} / ${enterprise.login.actor.displayName}` : (account ? `${account.login.user.displayName}（账号）` : '个人工作区') }
    : undefined
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(join(app.getPath('userData'), 'command-context.json'), JSON.stringify({ personalHome: runtimeHome(), active }), { mode: 0o600 })
}

/**
 * 把载体配置里的 MCP / 技能市场接口路径与本机包安装参数作为补丁层交给对应插件（缺配置时它们用内置默认值）。
 * 配置读取失败不阻断工作区启动：账号流程在启动前已读取并校验过同一份配置，这里退化为内置默认值。
 */
function marketPatchLayers(home: string): string[] {
  try {
    const server = loadConfig().server
    const connector = desktopConnectorMarketPatch(home, server, { node: bundledNodeExecutable(), pnpm: join(bundledPrimaryRuntime(), 'dependencies', 'pnpm', 'bin', 'pnpm.cjs') })
    const skill = desktopSkillMarketPatch(home, server)
    const model = desktopModelMarketPatch(home, server)
    const expert = desktopExpertMarketPatch(home, server)
    return [connector, skill, model, expert].filter((patch): patch is string => patch !== undefined)
  } catch (error) {
    process.stderr.write(`[startup] 市场接口路径与本机包安装配置未注入，插件将使用内置默认值：${error instanceof Error ? error.message : String(error)}\n`)
    return []
  }
}

async function startRuntime(home: string, connection: DesktopConnection, patches: string[] = [], existingHome = false, onReady?: () => void): Promise<void> {
  rememberCommandSpace(home)
  if (quitRequested) throw new Error('启动已取消')
  const executable = bundledNodeExecutable()
  if (!existsSync(executable)) throw new Error(`Bundled Node.js runtime is missing: ${executable}`)
  const basePatch = join(bundledProfileDirectory(), 'cordis.patch.yml')
  // 兜底回收必须早于端口探测：上次被强杀（任务管理器 / 系统终止）遗留的 Host 仍占着
  // Home 记录的地址时，端口检查会判定“被其它应用占用”而直接拒绝启动，看起来就是永远卡在过场页。
  reclaimOrphanedToolProcesses(join(home, '.workdsh-host.mjs'))
  // upstream 的端口管理：把空闲端口作为补丁层交给官方 Web 内核，替代原来的 --port 0。
  const port = await prepareRuntimePort(home, [join(home, 'profiles', PROFILE_NAME, 'cordis.yml'), join(home, 'profiles', PROFILE_NAME, 'cordis.patch.yml'), join(home, 'cordis.yml'), join(home, 'cordis.patch.yml'), ...patches], { existingHome })
  if (quitRequested) throw new Error('启动已取消')
  const layers = [...(existsSync(basePatch) ? [basePatch] : []), ...patches, ...marketPatchLayers(home), ...(port.managed ? [port.patch] : [])]
  const launcher = officialHostLauncher(bundledProfileDirectory(), home, executable, join(bundledPrimaryRuntime(), 'dependencies', 'pnpm', 'bin', 'pnpm.cjs'), layers)
  const hostSpawnedAt = Date.now()
  const child = spawn(executable, [launcher, '--no-open'], {
    env: runtimeEnvironment(home),
    cwd: enterprise ? join(enterprise.root, 'workspace') : home,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  trackOwnedProcess(child, hostSpawnedAt)
  runtime = child
  runtimeStarting = true
  markStartup('DSH Host 进程已拉起（等待就绪）')
  let ready = false
  let output = ''
  // 调试开关打开时把 Host 的原始输出落到 userData/logs：打包应用没有终端，
  // 官方插件记录的真实错误原因（例如 MCP 连接失败的 warn）原本完全看不到。
  const hostOutputLog: DebugLog | undefined = debugEnvironment() === 'dev' ? createDebugLog(debugLogDirectory(), 'host-output') : undefined
  let diagnosticOutput = ''
  const recordOutput = (safe: string): void => {
    diagnosticOutput = `${diagnosticOutput}${safe}`.slice(-16_384)
    process.stderr.write(safe)
  }
  const stdoutRedactor = createRuntimeOutputRedactor(recordOutput)
  const stderrRedactor = createRuntimeOutputRedactor(recordOutput)
  const consume = (chunk: Buffer): void => {
    const text = chunk.toString('utf8')
    hostOutputLog?.write(text)
    stdoutRedactor.push(chunk)
    if (ready || switching || runtime !== child) return
    output = `${output}${text}`.slice(-16_384)
    const match = READY_PATTERN.exec(output)
    if (match?.[1] !== undefined) {
      ready = true
      runtimeStarting = false
      markStartup(`DSH 已就绪，开始打开主界面（主机启动 ${Date.now() - hostSpawnedAt}ms）`)
      onReady?.()
      openWindow(match[1], connection)
    }
  }
  const failureDetail = (code: number | null, cleanupFailed = false): string => {
    const detail = [!ready ? runtimePortConflict(port, diagnosticOutput) : undefined, runtimeFailureDetail(ready, code, diagnosticOutput, cleanupFailed)].filter(Boolean).join('\n\n')
    try {
      const directory = join(app.getPath('userData'), 'logs')
      mkdirSync(directory, { recursive: true })
      const path = join(directory, 'runtime-failure.log')
      writeFileSync(path, runtimeFailureLog(ready, code, diagnosticOutput, cleanupFailed), { mode: 0o600 })
      return `${detail}\n\n错误记录：${path}`
    } catch { return detail }
  }
  child.stdout.on('data', consume)
  child.stderr.on('data', chunk => {
    hostOutputLog?.write(chunk.toString())
    stderrRedactor.push(chunk)
  })
  child.stdout.once('end', () => stdoutRedactor.end())
  child.stderr.once('end', () => stderrRedactor.end())
  child.once('error', cause => {
    if (!quitting && runtime === child) { dialog.showErrorBox('启动失败', redactRuntimeOutput(cause.message)); void returnToLogin() }
  })
  child.once('exit', code => {
    if (runtime !== child) return
    void cleanOwnedProcessTree(child).then(() => {
      if (runtime === child) { runtime = undefined; runtimeStarting = false }
      if (!quitting && !switching && !updaterInstalling) {
        dialog.showErrorBox('本机运行已停止', failureDetail(code))
        void returnToLogin()
      }
    }).catch(error => {
      // 回收未确认不能让应用停在“启动中”：记录原因、提示一次后照常回到登录页，用户仍可重试或退出。
      recordCleanupFailure('startup-exit', error)
      runtime = undefined
      runtimeStarting = false
      if (quitting || switching || updaterInstalling) return
      dialog.showErrorBox('本机运行已停止', failureDetail(code, true))
      void returnToLogin()
    })
  })
  const readyTimeout = setTimeout(() => { if (!ready && runtime === child) { dialog.showErrorBox('启动超时', '官方 DSH 尚未就绪，已停止本机进程'); void returnToLogin() } }, 90_000)
  child.once('exit', () => clearTimeout(readyTimeout))
}

function stopRuntime(): void {
  quitting = true
  if (runtime !== undefined) void cleanOwnedProcessTree(runtime)
  runtime = undefined
  runtimeStarting = false
}

async function leaveWorkspace(): Promise<void> {
  const page = window
  if (verifyTimer) { clearInterval(verifyTimer); verifyTimer = undefined }
  const session = enterprise
  // Shut admission before waiting for any graceful process exit.
  await session?.authority?.close()
  session?.login.cancelRequests()
  const child = runtime
  // 回收未确认不能阻断切换/退出：记录原因后继续清理状态，遗留进程由下次启动按启动器路径回收。
  if (child) { await stopOwnedProcess(child).catch(error => recordCleanupFailure('leave-workspace', error)); if (runtime === child) { runtime = undefined; runtimeStarting = false } }
  enterprise = undefined
  rememberCommandSpace()
  if (session) {
    if (session.authFile) rmSync(session.authFile, { force: true })
    const revoked = await session.login.logout()
    if (!revoked) dialog.showErrorBox('本机已退出', '本机企业运行和登录已停止；后台连接失败，远端撤销尚未确认。')
    if (page && !page.isDestroyed()) {
      await page.webContents.session.closeAllConnections()
      await page.webContents.session.clearStorageData()
      await page.webContents.session.clearCache()
    }
  }
  for (const enterprisePage of [...enterpriseWindows]) if (!enterprisePage.isDestroyed()) enterprisePage.destroy()
  enterpriseWindows.clear()
  if (page && !page.isDestroyed()) page.destroy()
  pendingConnection = undefined; entrySurface = false
}

/** Clear the account session, stop the bound runtime and put the app back to the login page. */
async function leaveAccountWorkspace(): Promise<void> {
  const page = window
  account?.stopSync?.()
  const session = account
  await session?.authority?.close()
  session?.login.cancelRequests()
  const child = runtime
  // 同 leaveWorkspace：账号切换/退出登录也不能被进程回收卡死。
  if (child) { await stopOwnedProcess(child).catch(error => recordCleanupFailure('leave-account-workspace', error)); if (runtime === child) { runtime = undefined; runtimeStarting = false } }
  account = undefined
  rememberCommandSpace()
  if (session) {
    session.store.clear()
    const revoked = await session.login.logout()
    if (!revoked) dialog.showErrorBox('已退出登录', '本机账号登录已停止；后台连接失败，远端登出尚未确认。')
    if (page && !page.isDestroyed()) {
      await page.webContents.session.closeAllConnections()
      await page.webContents.session.clearStorageData()
      await page.webContents.session.clearCache()
    }
  }
  for (const enterprisePage of [...enterpriseWindows]) if (!enterprisePage.isDestroyed()) enterprisePage.destroy()
  enterpriseWindows.clear()
  if (page && !page.isDestroyed()) page.destroy()
  entrySurface = false
}

/**
 * 关闭软件时的账号收尾：只停止本机运行与回环授权，保留本地加密登录态。
 * 与「退出账号」刻意区分：不清除 account-session.bin、不调用后台登出、不清空渲染器存储，
 * 否则每次关软件都会变成一次登出，下次打开必然回到登录页。
 */
async function stopAccountForQuit(): Promise<void> {
  account?.stopSync?.()
  const session = account
  await session?.authority?.close()
  session?.login.cancelRequests()
  const child = runtime
  // 关软件的回收失败只记录、不阻断：退出后由下次启动回收遗留进程。
  if (child) { await stopOwnedProcess(child).catch(error => recordCleanupFailure('quit-account', error)); if (runtime === child) { runtime = undefined; runtimeStarting = false } }
  account = undefined
  rememberCommandSpace()
  entrySurface = false
}

/**
 * 回到登录页：先离开当前工作区（企业或个人账号），再展示登录页。
 * 「选择使用方式」入口页已下线——启动、异常、退出登录一律落到登录页，任何时候都不再出现该页面。
 */
async function returnToLogin(): Promise<void> {
  if (quitting) return
  if (switching) { returnRequested = true; return }
  switching = true
  try {
    if (enterprise) await leaveWorkspace()
    else await leaveAccountWorkspace()
    showAccountLogin()
  }
  catch (error) { recordCleanupFailure('return-to-login', error); dialog.showErrorBox('暂时无法返回登录', error instanceof Error ? error.message : '请稍后重试') }
  finally { endSwitch() }
}

function endSwitch(): void {
  switching = false
  if (quitRequested) app.quit()
  else if (returnRequested) { returnRequested = false; void returnToLogin() }
}

function savedBackendFile(): string { return join(app.getPath('userData'), 'enterprise-backend.json') }
function rememberBackend(backend: string): void {
  if (managedBackend) return
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(savedBackendFile(), JSON.stringify({ backend }), { mode: 0o600 })
}

/** The account splash, starting state and login surfaces are light; match the window background so there is no dark flash. */
const LIGHT_ENTRY_BACKGROUND = '#ffffff'

/**
 * “环境就绪”标记（内容为环境身份串）。过场页只在环境需要准备时出现：
 * 首次启动、或应用 / 捆绑运行时版本变化（升级）后标记失配；此后每次打开都跳过过场页。
 */
const ENV_READY_FILE = '.workdsh-env-ready'

/** 当前捆绑运行时版本；读不到时返回空串（不参与身份判定）。 */
function bundledRuntimeVersion(): string {
  try {
    return String(JSON.parse(readFileSync(join(bundledProfileDirectory(), 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), 'utf8')).version ?? '')
  } catch { return '' }
}

/** 环境身份串：应用版本 + 捆绑运行时版本，任一变化都会使标记失配、重新准备一次环境。 */
function environmentSignature(): string {
  return `${String(app.getVersion())}|${bundledRuntimeVersion()}`
}

/** 环境是否已准备就绪：标记存在且与当前环境身份一致。 */
function isEnvironmentReady(): boolean {
  try {
    const marker = readFileSync(join(app.getPath('userData'), ENV_READY_FILE), 'utf8').trim()
    return marker.length > 0 && marker === environmentSignature()
  } catch { return false }
}

/** 环境准备成功后落标记；写入失败不影响启动，下次会重新准备。 */
function markEnvironmentReady(): void {
  try { writeFileSync(join(app.getPath('userData'), ENV_READY_FILE), `${environmentSignature()}\n`, { mode: 0o600 }) } catch { /* 下次重新准备 */ }
}

/**
 * Directory holding the carrier's own packaged extras (workdsh-app.json, logo files).
 * A packaged run reads them from Resources; `scripts/start-workdsh.mjs` points the
 * development run at the source `resources/` folder with WORKDSH_RESOURCES.
 */
function carrierResources(): string {
  const overridden = process.env.WORKDSH_RESOURCES
  if (overridden !== undefined && overridden.length > 0) return overridden
  return process.resourcesPath ?? ''
}

function loadConfig(): ResolvedAppConfig {
  if (!appConfig) appConfig = readAppConfig(carrierResources(), app.getPath('userData'))
  return appConfig
}

/** 调试开关的取值；配置读取失败按 prod 处理，绝不影响启动。 */
function debugEnvironment(): AppEnvironment {
  try { return loadConfig().environment } catch { return 'prod' }
}

/** 调试日志目录：与启动耗时日志同处 userData/logs，便于一次性收集。 */
function debugLogDirectory(): string {
  return join(app.getPath('userData'), 'logs')
}

/** Read the configured logo and return a base64 data URI for embedding (CSP keeps img-src data:). */
function logoDataUri(path: string): string | undefined {
  try {
    const data = readFileSync(path)
    if (data.length === 0 || data.length > 4 * 1024 * 1024) return undefined
    const mime = /\.png$/iu.test(path) ? 'image/png' : 'image/png'
    return `data:${mime};base64,${data.toString('base64')}`
  } catch { return undefined }
}

function accountSplashUrl(): string {
  const config = loadConfig()
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(accountSplashHtml(logoDataUri(config.splashLogoPath), config.splash))
}
function accountLoginUrl(): string {
  const config = loadConfig()
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(accountLoginHtml(logoDataUri(config.loginLogoPath), '警务助手，面向公安业务场景的智能工作台'))
}

function accountActor(login: AccountLogin): AccountActor {
  return {
    principalId: login.user.userId,
    organizationId: login.user.organizationId,
    organizationName: login.user.organizationName,
    displayName: login.user.displayName,
  }
}

/**
 * 账号模式会话校验 + 用户信息同步循环。
 * 间隔 baseDelay（默认 30s，含 ±10% 抖动）；失败按 30s→60s→120s… 退避，上限 15min，成功即复位。
 * 仅「本地 exp 已过期」或「后台明确 401」才登出；网络错误/超时/5xx/服务端异常一律容忍重试。
 * 返回停止函数，随登出/切换调用，内部会解绑 powerMonitor 监听。
 */
function startAccountSync(session: { login: AccountLogin, store: AccountStore }): () => void {
  const baseDelay = Math.max(1, session.login.config.syncIntervalSeconds) * 1000
  const maxDelay = 15 * 60 * 1000
  let timer: ReturnType<typeof setTimeout> | undefined
  let failures = 0
  let stopped = false

  // 抖动：100 名员工约 28.8 万次/天，无抖动会形成整齐的请求尖峰。
  const jitter = (delay: number): number => Math.round(delay * (0.9 + Math.random() * 0.2))
  const schedule = (delay: number): void => { if (!stopped) timer = setTimeout(() => { void run() }, delay) }

  const run = async (): Promise<void> => {
    // 防重入：沿用现有 verifying 标志；正在登录/切换时不打断，顺延一个间隔。
    if (stopped) return
    if (verifying || switching) { schedule(jitter(baseDelay)); return }
    verifying = true
    try {
      // ① 本地 exp 已过期：直接登出，不发请求。
      if (session.login.isExpired()) {
        stopped = true
        dialog.showErrorBox('账号登录已过期', '登录已失效，本机运行将停止，请重新登录。')
        void returnToLogin()
        return
      }
      const result = await session.login.syncProfile()
      if (stopped) return
      if (result.outcome === 'unauthorized') {
        // ② 仅后台明确 401：弹提示并退回登录页。
        stopped = true
        dialog.showErrorBox('账号登录已失效', result.message)
        void returnToLogin()
        return
      }
      if (result.outcome === 'ok') {
        failures = 0
        // 落盘节流：只有快照内容确实变化时才写回，绝不次次写盘。
        if (result.changed) session.store.write(session.login.seal())
        schedule(jitter(baseDelay))
        return
      }
      // ③ 其他失败（网络/超时/5xx/服务端异常）：容忍并退避。
      failures += 1
      schedule(Math.min(baseDelay * 2 ** (failures - 1), maxDelay))
    } finally {
      verifying = false
    }
  }

  // 启动即校验：登录恢复后立刻打一次，不必等满一个间隔。
  void run()
  // 睡眠唤醒补偿：macOS 合盖期间定时器被冻结，唤醒后立即补一次。
  const onResume = (): void => { if (timer) { clearTimeout(timer); timer = undefined } void run() }
  powerMonitor.on('resume', onResume)

  return () => {
    stopped = true
    if (timer) { clearTimeout(timer); timer = undefined }
    powerMonitor.off('resume', onResume)
  }
}

/** Start the DSH runtime bound to the logged-in account identity. */
async function startAccountRuntime(home: string): Promise<void> {
  const session = account
  if (!session) throw new Error('请先登录账号')
  const entry = window
  // 等待 DSH 就绪期间保持入口窗口可见（过场页或“正在启动”加载态），避免出现无窗口空档。
  if (entry && !entry.isDestroyed()) entry.show()
  const actor = accountActor(session.login)
  const space = accountSpace(app.getPath('userData'), actor.principalId)
  session.deviceId = space.deviceId
  // A restored session restarts its loopback authority here; a fresh login already bound one.
  if (!session.authority) {
    session.authority = await startAccountAuthority(session.login, () => { void returnToLogin() }, () => { void returnToLogin() }, abandonAccountSession)
  }
  const { authority } = session
  if (!authority) throw new Error('账号授权未就绪')
  const patch = desktopAccountPatch(home, authority, actor, space.deviceId, session.login.origin)
  session.authFile = patch.authFile
  entrySurface = false
  // “环境已就绪”标记只在 DSH 真正起来后才落盘：避免“标记已写、依赖却没装成”导致后续启动跳过准备。
  await startRuntime(home, { mode: 'personal' }, [patch.patch], false, () => markEnvironmentReady())
  // 会话校验 + 用户信息同步：随运行时启动，随登出/切换停止（重复启动先停旧的）。
  session.stopSync?.()
  session.stopSync = startAccountSync(session)
}

/** 环境已就绪（再次打开）时的启动：先用过场页覆盖本机 DSH 启动等待，再物化/按需更新 Profile 并启动。 */
async function launchAccountRuntime(): Promise<void> {
  const home = runtimeHome()
  await showSplashForRuntimeBoot()
  await prepareProfile(home, keepEntryPage)
  await startAccountRuntime(home)
}

/**
 * 成员身份的请求（如连接器市场）被后台判定为未授权时的收尾。
 * 与 startAccountSync 轮询拿到 unauthorized 时完全一致：弹「账号登录已失效」提示并退回登录页，
 * 不必等最多一个轮询间隔。重复通知由回环桥保证只收尾一次。
 */
function abandonAccountSession(): void {
  dialog.showErrorBox('账号登录已失效', '登录已过期，请重新登录。')
  void returnToLogin()
}

/** 首次启动 / 升级后的“环境准备中”过场页：创建即显示，不再隐藏等待。 */
function showAccountSplash(): BrowserWindow {
  openWindow(accountSplashUrl(), { mode: 'personal' }, true, true, LIGHT_ENTRY_BACKGROUND)
  const entry = window!
  connectEntryNavigation(entry)
  return entry
}

/**
 * 用过场页覆盖本机 DSH 的启动等待：复用当前入口窗口（登录页），必要时新建。
 * 过场页只展示标题/副标题与进度条，不含阶段文案。
 */
async function showSplashForRuntimeBoot(): Promise<void> {
  const entry = window
  if (entry && !entry.isDestroyed()) {
    await entry.loadURL(accountSplashUrl())
    entry.show()
    return
  }
  showAccountSplash()
}

/** 保持当前入口页面不动（过场页不含阶段文案，无需再切换加载页）。 */
function keepEntryPage(): void {}

function showAccountLogin(): void {
  markStartup('切换到登录页')
  if (window && !window.isDestroyed()) {
    // 复用窗口时也要恢复入口标记：登录页必须能通过 workdsh:account-login 提交。
    entrySurface = true
    window.setBackgroundColor(LIGHT_ENTRY_BACKGROUND)
    void window.loadURL(accountLoginUrl())
    window.show()
    markStartup('登录页已显示')
  } else {
    openWindow(accountLoginUrl(), { mode: 'personal' }, true, true, LIGHT_ENTRY_BACKGROUND)
  }
}

/**
 * 账号启动门禁。顺序固定为：环境准备优先 → 登录门禁 → 主界面。
 * - 环境未就绪（首次启动 / 升级后）：显示“环境准备中”过场页并物化 Profile 后进入登录门禁；
 *   依赖安装由官方主机在启动时完成，“环境已就绪”标记在主机就绪后才落盘；
 * - 环境已就绪（再次打开）：不走过场流程，直接进入登录门禁；已登录则直接启动（启动等待由过场页覆盖）；
 * - 已登录且未过期：启动本机 DSH 进入主界面；未登录 / 已过期：显示登录页。
 */
async function autoStartAccountWorkspace(): Promise<void> {
  try {
    const config = loadConfig()
    // 开发辅助：WORKDSH_SPLASH_PREVIEW=1 时与登录态无关，只把过场页显示一小会儿再进入登录页，供本地肉眼验证样式。
    if (process.env.WORKDSH_SPLASH_PREVIEW === '1' || process.env.WORKDSH_SPLASH_PREVIEW === 'true') {
      showAccountSplash()
      await new Promise(resolve => setTimeout(resolve, 2000))
      showAccountLogin()
      return
    }

    // 先查本地加密登录态（廉价、同步），再按环境状态决定展示哪个入口页面。
    const store = new AccountStore(app.getPath('userData'))
    const restored = store.read()
    if (restored) {
      const login = restoreAccountLogin(config.server, restored.user, restored.token, restored.session.expiry, restored.session.rawUserInfo)
      if (login.isExpired()) store.clear()
      else account = { login, store, deviceId: '' }
    }

    if (!isEnvironmentReady()) {
      // 首次启动 / 升级后：显示过场页并物化 Profile。依赖安装由官方主机在启动时按 installAnchor 完成，
      // “环境已就绪”标记只在主机真正就绪后落盘（见 startAccountRuntime），避免标记早于安装。
      showAccountSplash()
      await prepareProfile(runtimeHome(), keepEntryPage)
      if (!account) { showAccountLogin(); return }
      // 过场页继续作为本机 DSH 启动等待的界面，主机就绪后直接换成主界面。
      await startAccountRuntime(runtimeHome())
      return
    }

    // 环境已就绪（再次打开）：不显示“环境准备中”的过场流程；已登录则直接启动（启动等待由过场页覆盖）。
    if (account) { await launchAccountRuntime(); return }
    showAccountLogin()
  } catch (error) {
    dialog.showErrorBox('无法进入', error instanceof Error ? error.message : '请检查运行环境')
    showAccountLogin()
  }
}

function connectEntryNavigation(entry: BrowserWindow): void {
  entry.webContents.on('will-navigate', (event, target) => {
    event.preventDefault()
    if (switching || window !== entry || !entrySurface) return
    void (async () => {
      switching = true
      try {
        const command = new URL(target)
        if (command.protocol !== 'workdsh:') return
        if (command.hostname === 'enterprise') {
          if (enterprise) throw new Error('请先退出当前企业账号再修改后台地址')
          const connection = enterpriseConnection(managedBackend ?? command.searchParams.get('portal') ?? '')
          pendingConnection = connection
          enterprisePortal = connection.portalOrigin
          rememberBackend(enterprisePortal)
          openWindow('data:text/html;charset=utf-8,' + encodeURIComponent(enterpriseLoginHtml(enterprisePortal)), { mode: 'personal' }, true)
          connectEntryNavigation(window!)
        } else if (command.hostname === 'personal') {
          if (enterprise) await leaveWorkspace()
          const home = runtimeHome()
          await entry.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(connectionLoadingHtml('正在启动个人工作区')))
          const prepared = await prepareProfile(home)
          entrySurface = false
          await startRuntime(home, { mode: 'personal' }, [], prepared.existingHome)
        } else if (command.hostname === 'entry') {
          await leaveWorkspace(); showAccountLogin()
        }
      } catch (error) {
        dialog.showErrorBox('无法进入', error instanceof Error ? error.message : '请检查入口配置')
        showAccountLogin()
      } finally { endSwitch() }
    })()
  })
}

function enterprisePluginAvailable():boolean {
 try{return installedEnterprisePlugins(join(runtimeHome(),'profiles',PROFILE_NAME),JSON.parse(readFileSync(join(bundledProfileDirectory(),'node_modules','@deepseek-ai','dsh','package.json'),'utf8')).version).includes('workdsh-provider-identity-enterprise')}
 catch{return false}
}

async function activateEnterprise(existingHome: boolean): Promise<void> {
  const session = enterprise
  if (!session) throw new Error('请重新登录企业账号')
  await session.login.verify()
  if (quitRequested) throw new Error('启动已取消')
  const pluginNames=await composeInstalledEnterprisePlugins(join(runtimeHome(),'profiles',PROFILE_NAME),join(session.home,'profiles',PROFILE_NAME),JSON.parse(readFileSync(join(bundledProfileDirectory(),'node_modules','@deepseek-ai','dsh','package.json'),'utf8')).version,bundledNodeExecutable(),join(bundledPrimaryRuntime(),'dependencies','pnpm','bin','pnpm.cjs'))
  if(quitRequested||enterprise!==session)throw new Error('企业启动已取消')
  const manifest = join(session.home, 'profiles', PROFILE_NAME, 'package.json')
  const selected = JSON.parse(readFileSync(manifest, 'utf8')) as { dsh?: { profile?: { bundles?: string[] } } }
  selected.dsh ??= {}; selected.dsh.profile ??= {}; selected.dsh.profile.bundles ??= []
  const bundles = selected.dsh.profile.bundles
  // Disable personal identity at composition, rather than allow an identity fallback.
  selected.dsh.profile.bundles = bundles.filter(name => name !== 'workdsh-provider-identity-local')
  for (const name of pluginNames) {
    if (!selected.dsh.profile.bundles.includes(name)) selected.dsh.profile.bundles.push(name)
  }
  writeFileSync(manifest, JSON.stringify(selected, null, 2) + '\n', { mode: 0o600 })
  session.authority = await startEnterpriseAuthority(session.login, session.deviceId, () => { void returnToLogin() }, () => { void returnToLogin() })
  // Record before writing either file, so a partial patch failure is also cleaned.
  session.authFile = join(session.home, 'enterprise-auth.json')
  const patch = desktopEnterprisePatch(session.home, session.authority, session.login.actor, session.login.backendUrl, session.deviceId, pluginNames.includes('workdsh-plugin-enterprise-collaboration'))
  session.authFile = patch.authFile
  const connection: DesktopConnection = { mode: 'enterprise', portalOrigin: session.login.backendUrl, organizationId: session.login.actor.organizationId, principalId: session.login.actor.id }
  if (window) await window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(connectionLoadingHtml('正在启动企业工作区')))
  entrySurface = false
  await startRuntime(session.home, connection, [patch.patch], existingHome)
  verifyTimer = setInterval(() => {
    if (verifying || switching) return
    verifying = true
    void session.login.verify().then(()=>{
      const current=installedEnterprisePlugins(join(runtimeHome(),'profiles',PROFILE_NAME),JSON.parse(readFileSync(join(bundledProfileDirectory(),'node_modules','@deepseek-ai','dsh','package.json'),'utf8')).version)
      if(pluginNames.some(name=>!current.includes(name)))throw new Error('企业插件已卸载，请重新安装后登录')
    }).catch(() => {
      dialog.showErrorBox('企业认证不可用', '企业账号已过期、被撤销、后台不可达或企业插件已卸载。本机企业运行将停止，请检查后重新登录。')
      void returnToLogin()
    }).finally(() => { verifying = false })
  }, 30_000)
}

function installLoginHandlers(): void {
  ipcMain.handle('workdsh:account-login', async (event, input: unknown) => {
    if (!entrySurface || event.sender !== window?.webContents || switching || enterprise) return { error: '此页面不能发起登录' }
    switching = true
    loginStartedAt = Date.now()
    markStartup('收到账号登录请求')
    let admitted: AccountLogin | undefined
    try {
      const value = input as { username?: unknown, password?: unknown }
      if (!value || typeof value.username !== 'string' || typeof value.password !== 'string') throw new Error('请输入账号和密码')
      const config = loadConfig()
      const login = await AccountLogin.login(config.server, value.username.trim(), value.password)
      admitted = login
      markStartup(`账号服务登录成功（耗时 ${Date.now() - loginStartedAt}ms）`)
      const store = new AccountStore(app.getPath('userData'))
      store.write(login.seal())
      account = { login, store, deviceId: '' }
      // Bind the account identity to a loopback authority held in Main.
      const authority = await startAccountAuthority(login, () => { void returnToLogin() }, () => { void returnToLogin() }, abandonAccountSession)
      account.authority = authority
      // 登录成功：把入口窗口切到过场页，用它的展示时间覆盖本机 DSH 的启动等待；主机就绪后直接换成主界面。
      const home = runtimeHome()
      await showSplashForRuntimeBoot()
      await prepareProfile(home, keepEntryPage)
      await startAccountRuntime(home)
      return { ok: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : '登录失败'
      markStartup(`账号登录失败（耗时 ${loginStartedAt === undefined ? '?' : `${Date.now() - loginStartedAt}ms`}）：${message}`)
      loginStartedAt = undefined
      if (account) { await leaveAccountWorkspace(); showAccountLogin(); dialog.showErrorBox('无法进入', message) }
      else if (admitted && !await admitted.logout()) dialog.showErrorBox('登录未完成', '后台连接失败，远端登录撤销尚未确认。')
      return { error: message }
    } finally { endSwitch() }
  })
  ipcMain.handle('workdsh:enterprise-login', async (event, input: unknown) => {
    if (!entrySurface || event.sender !== window?.webContents || switching || !pendingConnection || enterprise) return { error: '此页面不能发起企业登录' }
    switching = true
    let admittedLogin: EnterpriseLogin | undefined
    try {
      const value = input as { account?: unknown, password?: unknown }
      if (!value || typeof value.account !== 'string' || typeof value.password !== 'string') throw new Error('请输入账号和密码')
      const login = await EnterpriseLogin.login(pendingConnection.portalOrigin, value.account, value.password)
      admittedLogin = login
      const space = enterpriseSpace(app.getPath('userData'), login.backendUrl, login.actor)
      enterprise = { login, ...space }
      const prepared = await prepareProfile(space.home)
      await activateEnterprise(prepared.existingHome)
      return {}
    } catch (error) {
      const message = error instanceof Error ? error.message : '企业登录失败'
      if (enterprise) { await leaveWorkspace(); showAccountLogin(); dialog.showErrorBox('无法进入企业', message) }
      else if (admittedLogin && !await admittedLogin.logout()) dialog.showErrorBox('企业启动未完成', '本机未进入企业运行；后台连接失败，远端登录撤销尚未确认。')
      return { error: message }
    } finally { endSwitch() }
  })
}

function installConnectionMenu(): void {
  // 全中文菜单：内置 role 菜单的默认标签是英文，会造成中英混排，因此显式给出中文标签与中文子项。
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
    { label: '工具', submenu: [{ label: '终端命令 dsh（可选）…', click: () => { void manageCommand(join(process.resourcesPath, 'workdsh-runtime'), enterprise ? `${enterprise.login.actor.organizationName ?? '企业'} / ${enterprise.login.actor.displayName}` : (account ? `${account.login.user.displayName}（账号）` : '个人工作区')) } }] },
    { label: '编辑', submenu: [
      { role: 'undo' as const, label: '撤销' },
      { role: 'redo' as const, label: '重做' },
      { type: 'separator' as const },
      { role: 'cut' as const, label: '剪切' },
      { role: 'copy' as const, label: '复制' },
      { role: 'paste' as const, label: '粘贴' },
      { type: 'separator' as const },
      { role: 'selectAll' as const, label: '全选' },
    ] },
    { label: '视图', submenu: [
      { role: 'reload' as const, label: '重新加载' },
      { role: 'forceReload' as const, label: '强制重新加载' },
      { role: 'toggleDevTools' as const, label: '切换开发者工具' },
      { type: 'separator' as const },
      { role: 'resetZoom' as const, label: '实际大小' },
      { role: 'zoomIn' as const, label: '放大' },
      { role: 'zoomOut' as const, label: '缩小' },
      { type: 'separator' as const },
      { role: 'togglefullscreen' as const, label: '全屏' },
    ] },
    { label: '窗口', submenu: [
      { role: 'minimize' as const, label: '最小化' },
      { role: 'close' as const, label: '关闭' },
    ] },
  ]))
}

const worker = browserWorkerRequest()
const updateProgress = updateProgressRequest()
if (worker !== undefined) {
  startBrowserWorker(worker)
} else if (updateProgress !== undefined) {
  // 安装阶段由独立进程接管进度页：主程序退出后这一页仍然在，装完再自行退出。
  void startUpdateProgressWindow(updateProgress)
} else {
// The native bundle starts without a Dock icon so spawned browser workers cannot
// flash one before JavaScript runs. Only the primary application becomes foreground.
if (process.platform === 'darwin') app.setActivationPolicy('regular')
const desktopUserData = process.env.WORKDSH_DESKTOP_USER_DATA
if (desktopUserData) {
  if (!isAbsolute(desktopUserData)) throw new Error('Desktop user data override must be absolute')
  app.setPath('userData', desktopUserData)
}
app.setName('PoliceAssistant')
// Windows 通知需要稳定的 AppUserModelId，与安装包 appId 保持一致。
if (process.platform === 'win32') app.setAppUserModelId('io.techflag.dsh.ssh')
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (_event, commandLine) => {
    // 安装器覆盖安装前会以该参数请求有序退出；走既有 before-quit 清理路径。
    if (commandLine.includes('--dsh-installer-quit')) {
      app.quit()
      return
    }
    if (window === undefined) return
    revealMainWindow()
  })
  // 终端 Ctrl+C / 系统终止信号下的有序退出。本机工具进程是 detached 启动的（自成进程组），
  // 不主动回收就会在载体被杀后成为孤儿并继续占用端口；这里同步回收进程树后立即退出。
  let terminating = false
  const terminateOnSignal = (signal: NodeJS.Signals): void => {
    if (terminating) return
    terminating = true
    quitting = true
    if (runtime !== undefined) void cleanOwnedProcessTree(runtime).catch(() => {})
    if (installer !== undefined) void stopOwnedProcess(installer).catch(() => {})
    process.stderr.write(`[startup] 收到 ${signal}，正在回收本机进程…\n`)
    // cleanOwnedProcessTree 在 POSIX 上是同步 SIGKILL；Windows 走 taskkill，需要一点执行时间。
    setTimeout(() => app.exit(0), process.platform === 'win32' ? 1500 : 0)
  }
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(signal, () => terminateOnSignal(signal))
  app.on('before-quit', event => {
    if (quitting) { stopRuntime(); return }
    // 安装器交接期间不再接受普通退出请求，避免清理与安装并发。
    if (updaterInstalling) { event.preventDefault(); return }
    event.preventDefault()
    if (switching) {
      quitRequested = true
      if (installer) void stopOwnedProcess(installer).catch(() => dialog.showErrorBox('进程清理失败', '插件安装进程停止尚未确认，请稍后检查。'))
      return
    }
    switching = true
    void (enterprise ? leaveWorkspace() : account ? stopAccountForQuit() : Promise.resolve()).then(() => {
      quitting = true
      app.quit()
    }).catch(error => {
      // 退出绝不能因为进程回收未确认而卡死：记录原因、提示一次后强制退出。
      // 残留的本机进程由下次启动的 reclaimOrphanedToolProcesses 按启动器路径兜底回收。
      recordCleanupFailure('quit', error)
      dialog.showErrorBox('退出时未能确认本机进程已停止', `${error instanceof Error ? error.message : '请稍后重试'}\n\n软件将直接退出；残留的本机进程会在下次启动时自动回收。`)
      quitting = true
      app.exit(0)
    }).finally(() => { switching = false })
  })
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' && !switching && !updaterInstalling) app.quit()
  })
  app.on('activate', () => {
    // The entry closes before the official Host is ready. Activating the app
    // during that window must not relaunch and cancel the pending workspace.
    if (switching || runtimeStarting || installer || quitting || quitRequested || updaterInstalling) return
    if (window === undefined) {
      // A healthy runtime always owns a window. Relaunching keeps the profile
      // lifecycle simple after the last macOS window was closed.
      app.relaunch()
      app.quit()
    }
  })
  void app.whenReady().then(() => {
    // 安装器请求退出：不创建窗口，直接走退出清理。
    if (process.argv.includes('--dsh-installer-quit')) { app.quit(); return }
    // 上一次升级留下的进度页副本；安装刚结束时可能仍被旧进度进程占用，稍后再清一次。
    void cleanProgressHelper()
    setTimeout(() => { void cleanProgressHelper() }, 60_000)
    startupLogFile = join(app.getPath('userData'), 'startup-timing.log')
    markStartup('app.whenReady 触发')
    const deploymentFile = join(process.resourcesPath ?? '', 'workdsh-config.json')
    if (existsSync(deploymentFile)) {
      managedBackend = parseDeploymentConfig(JSON.parse(readFileSync(deploymentFile, 'utf8'))).enterprise?.backendUrl
      if (managedBackend) enterprisePortal = managedBackend
    }
    if (!enterprisePortal && existsSync(savedBackendFile())) {
      try { enterprisePortal = enterpriseConnection(JSON.parse(readFileSync(savedBackendFile(), 'utf8')).backend).portalOrigin } catch { /* stale invalid preference is not trusted */ }
    }
    installConnectionMenu()
    // 先创建更新服务，托盘菜单才能包含“检查更新/新版本”入口。
    startUpdater()
    installTray()
    installLoginHandlers()
    // 「选择使用方式」入口页已下线：无论是否预置企业后台，启动一律走账号登录门禁——
    // 已登录则直接进工作区，未登录（或登录失效、运行异常）则停在登录页。
    void autoStartAccountWorkspace()
  }).catch(cause => {
    process.stderr.write(`WorkDSH failed to start: ${cause instanceof Error ? cause.stack ?? cause.message : String(cause)}\n`)
    app.quit()
  })
}
}
