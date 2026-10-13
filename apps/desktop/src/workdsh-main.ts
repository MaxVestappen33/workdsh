import {composeInstalledEnterprisePlugins,installedEnterprisePlugins} from './enterprise-plugins.ts'
/** Minimal Electron carrier for the bundled WorkDSH release profile. */

import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { connectionEntryHtml, enterpriseLoginHtml, connectionLoadingHtml, accountSplashHtml, accountLoginHtml } from './connection-entry.ts'
import { connectionPartition, enterpriseConnection, type DesktopConnection } from './connection-mode.ts'
import { parseDeploymentConfig } from './deployment-config.ts'
import { readModelCredentials } from './model-credentials.ts'
import { readAppConfig, type ResolvedAppConfig } from './app-config.ts'
import { AccountLogin, AccountStore, restoreAccountLogin, startAccountAuthority, type AccountAuthority } from './member-auth.ts'
import { EnterpriseLogin, startEnterpriseAuthority, type Authority } from './enterprise-auth.ts'
import { desktopEnterprisePatch, desktopAccountPatch, accountSpace, enterpriseEnvironment, enterpriseSpace, materializeRuntimeProfile, markProfileUpdated, officialLauncher, officialHostLauncher, type AccountActor } from './local-runtime.ts'
import { manageCommand } from './command-management.ts'
import { cleanOwnedProcessTree, stopOwnedProcess } from './owned-process.ts'

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

// Account (replaces personal identity) session state.
let appConfig: ResolvedAppConfig | undefined
let account: { login: AccountLogin, store: AccountStore, deviceId: string, authority?: AccountAuthority, authFile?: string } | undefined
let accountVerifyTimer: ReturnType<typeof setInterval> | undefined

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

/**
 * Chromium 会在页面出现可编辑元素时到 Google CDN 拉取拼写词典
 * (https://redirector.gvt1.com/edgedl/chrome/dict/...)。该域名在部分网络下不可达，
 * TLS 握手会被对端关闭 (net_error -100)，启动期因此出现重试停顿与报错刷屏。
 * 清空词典语言列表即不会发起该下载；仅设置 webPreferences.spellcheck: false 无法阻止。
 */
function disableSpellcheckDictionaryDownloads(page: BrowserWindow): void {
  page.webContents.session.setSpellCheckerLanguages([])
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
        void returnToEntry()
        return
      }
      try { if (new URL(target).origin === origin) return } catch { /* invalid navigation is refused */ }
      event.preventDefault()
    })
  }
  void page.loadURL(url).then(() => {
    if (page.isDestroyed()) return
    if (reveal) { markStartup(carrier ? '入口页面已显示' : '工作台窗口已显示'); page.show() }
    if (previous && !previous.isDestroyed()) previous.destroy()
  }).catch(() => {
    if (!page.isDestroyed()) page.destroy()
    if (previous && !previous.isDestroyed()) { window = previous; entrySurface = previousEntrySurface }
    dialog.showErrorBox('无法打开工作区', '请检查企业地址、网络或本地运行状态。')
    if (runtime) void returnToEntry()
  })
  page.on('closed', () => { enterpriseWindows.delete(page); if (window === page) window = undefined })
}

function runtimeEnvironment(home: string): NodeJS.ProcessEnv {
  return {
    ...(enterprise ? enterpriseEnvironment(enterprise.root, bundledNodeExecutable(), process.env) : process.env),
    DSH_HOME: home,
    DSH_AGENTS_HOME: enterprise ? join(enterprise.root, 'agents') : join(home, 'agents'),
    DSH_BUNDLED_PRIMARY_RUNTIME: bundledPrimaryRuntime(),
    DSH_ELECTRON_EXECUTABLE: process.execPath,
    // A packaged carrier embeds the WorkDSH entry point, but a development
    // Electron binary needs the app directory as the worker's first argument.
    DSH_ELECTRON_APP_PATH: app.isPackaged ? undefined : app.getAppPath(),
    // WorkDSH 定制：注入随包交付的默认模型访问值（安装包 Resources 下的 model-credentials.json）。
    // 与 cordis.defaults.patch.yml 里预置 provider 的 apiKeyEnv 引用名一一对应，让个人工作区开箱即用。
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
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, [launcher, ...args], { env: runtimeEnvironment(home), cwd: home, detached: process.platform !== 'win32', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    installer = child
    let settled = false
    const timer = setTimeout(() => { void stopOwnedProcess(child).then(() => finish(new Error('官方插件安装超时，请检查网络后重试')), finish) }, timeoutMs)
    function finish(error?: Error): void {
      if (settled) return
      settled = true; clearTimeout(timer)
      if (installer === child) installer = undefined
      void cleanOwnedProcessTree(child).then(() => error ? reject(error) : resolve(), reject)
    }
    child.stdout.on('data', () => {})
    child.stderr.on('data', () => {})
    child.once('error', () => finish(new Error('无法启动官方插件安装工具')))
    child.once('exit', code => finish(quitRequested ? new Error('插件安装已取消') : code === 0 ? undefined : new Error(`官方插件操作失败 (${code})；请核对插件版本和网络`)))
  })
}

async function prepareProfile(home: string, onLoading?: (message: string, index: number) => Promise<void> | void): Promise<string> {
  markStartup('prepareProfile 开始（物化运行时 Profile）')
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
  return result.profile
}

function rememberCommandSpace(home?: string): void {
  const active = home
    ? { mode: enterprise ? 'enterprise' as const : (account ? 'account' as const : 'personal' as const), home, ...(enterprise ? { root: enterprise.root } : {}),
        label: enterprise ? `${enterprise.login.actor.organizationName ?? '企业'} / ${enterprise.login.actor.displayName}` : (account ? `${account.login.user.displayName}（账号）` : '个人工作区') }
    : undefined
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(join(app.getPath('userData'), 'command-context.json'), JSON.stringify({ personalHome: runtimeHome(), active }), { mode: 0o600 })
}

function startRuntime(home: string, connection: DesktopConnection, patches: string[] = []): void {
  rememberCommandSpace(home)
  if (quitRequested) throw new Error('启动已取消')
  const executable = bundledNodeExecutable()
  if (!existsSync(executable)) throw new Error(`Bundled Node.js runtime is missing: ${executable}`)
  const basePatch = join(bundledProfileDirectory(), 'cordis.patch.yml')
  const layers = [...(existsSync(basePatch) ? [basePatch] : []), ...patches]
  const launcher = officialHostLauncher(bundledProfileDirectory(), home, executable, join(bundledPrimaryRuntime(), 'dependencies', 'pnpm', 'bin', 'pnpm.cjs'), layers)
  const child = spawn(executable, [launcher, '--no-open'], {
    env: runtimeEnvironment(home),
    cwd: enterprise ? join(enterprise.root, 'workspace') : home,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  runtime = child
  runtimeStarting = true
  markStartup('DSH Host 进程已拉起（等待就绪）')
  let ready = false
  let output = ''
  const consume = (chunk: Buffer): void => {
    const text = chunk.toString('utf8')
    process.stderr.write(text.replace(/\?token=[^\s]+/gu, '?token=[redacted]'))
    if (ready || switching || runtime !== child) return
    output = `${output}${text}`.slice(-16_384)
    const match = READY_PATTERN.exec(output)
    if (match?.[1] !== undefined) {
      ready = true
      runtimeStarting = false
      markStartup('DSH 已就绪，开始打开主界面')
      openWindow(match[1], connection)
    }
  }
  child.stdout.on('data', consume)
  child.stderr.on('data', chunk => process.stderr.write(chunk.toString().replace(/\?token=[^\s]+/gu, '?token=[redacted]')))
  child.once('error', cause => {
    if (!quitting && runtime === child) { dialog.showErrorBox('启动失败', cause.message); void returnToEntry() }
  })
  child.once('exit', code => {
    if (runtime !== child) return
    void cleanOwnedProcessTree(child).then(() => {
      if (runtime === child) { runtime = undefined; runtimeStarting = false }
      if (!quitting && !switching) {
        dialog.showErrorBox('本机运行已停止', ready ? `官方 DSH 进程已退出 (${code})` : '官方 DSH 未能完成启动，请检查插件版本和 Profile 配置')
        void returnToEntry()
      }
    }).catch(() => dialog.showErrorBox('进程清理失败', '本机工具进程停止尚未确认，请退出后检查。'))
  })
  const readyTimeout = setTimeout(() => { if (!ready && runtime === child) { dialog.showErrorBox('启动超时', '官方 DSH 尚未就绪，已停止本机进程'); void returnToEntry() } }, 90_000)
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
  if (child) { await stopOwnedProcess(child); if (runtime === child) { runtime = undefined; runtimeStarting = false } }
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
  if (accountVerifyTimer) { clearInterval(accountVerifyTimer); accountVerifyTimer = undefined }
  const session = account
  await session?.authority?.close()
  session?.login.cancelRequests()
  const child = runtime
  if (child) { await stopOwnedProcess(child); if (runtime === child) { runtime = undefined; runtimeStarting = false } }
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

async function returnToEntry(): Promise<void> {
  if (quitting) return
  if (switching) { returnRequested = true; return }
  switching = true
  try { await leaveWorkspace(); showConnectionEntry() }
  catch (error) { dialog.showErrorBox('暂时无法切换', error instanceof Error ? error.message : '请稍后重试') }
  finally { endSwitch() }
}

function endSwitch(): void {
  switching = false
  if (quitRequested) app.quit()
  else if (returnRequested) { returnRequested = false; void returnToEntry() }
}

function savedBackendFile(): string { return join(app.getPath('userData'), 'enterprise-backend.json') }
function rememberBackend(backend: string): void {
  if (managedBackend) return
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(savedBackendFile(), JSON.stringify({ backend }), { mode: 0o600 })
}

function showConnectionEntry(): void {
  openWindow('data:text/html;charset=utf-8,' + encodeURIComponent(connectionEntryHtml(enterprisePortal, managedBackend !== undefined, enterprisePluginAvailable())), { mode: 'personal' }, true)
  connectEntryNavigation(window!)
}

/**
 * 个人工作区直启时的启动页展示阈值。
 * 启动窗口先保持隐藏：本机 DSH 就绪后 startRuntime 直接显示工作台窗口，用户通常看不到启动页。
 * 只有明显变慢（冷启动、首次安装插件等）超过该阈值时才显示启动页，避免"点了没反应"。
 * 实测本机热启动到就绪约 1.7s，故阈值取 4s。
 */
const STARTUP_REVEAL_DELAY_MS = 4000

/** The account splash and login surfaces are light; match the window background so there is no dark flash. */
const LIGHT_ENTRY_BACKGROUND = '#ffffff'

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
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(accountLoginHtml(logoDataUri(config.loginLogoPath), '警务助手'))
}

/** Advance the account splash to a real startup stage via executeJavaScript (no full reload). */
async function showSplashEntry(entry: BrowserWindow, stage: number, done = false): Promise<void> {
  if (entry.isDestroyed() || window !== entry) return
  await entry.webContents.executeJavaScript(`window.__setStage(${stage}, ${done})`).catch(() => { /* page can be pre-working */ })
}

function accountActor(login: AccountLogin): AccountActor {
  return {
    principalId: login.user.userId,
    organizationId: login.user.organizationId,
    organizationName: login.user.organizationName,
    displayName: login.user.displayName,
  }
}

/** Start the DSH runtime bound to the logged-in account identity. */
async function startAccountRuntime(home: string): Promise<void> {
  const session = account
  if (!session) throw new Error('请先登录账号')
  const entry = window
  if (entry && !entry.isDestroyed()) { void showSplashEntry(entry, 4, true); entry.show() }
  const actor = accountActor(session.login)
  const space = accountSpace(app.getPath('userData'), actor.principalId)
  session.deviceId = space.deviceId
  // A restored session restarts its loopback authority here; a fresh login already bound one.
  if (!session.authority) {
    session.authority = await startAccountAuthority(session.login, () => { void leaveAccountToLogin() }, () => { void leaveAccountToLogin() })
  }
  const { authority } = session
  if (!authority) throw new Error('账号授权未就绪')
  const patch = desktopAccountPatch(home, authority, actor, space.deviceId, session.login.origin)
  session.authFile = patch.authFile
  entrySurface = false
  startRuntime(home, { mode: 'personal' }, [patch.patch])
  if (accountVerifyTimer) clearInterval(accountVerifyTimer)
  accountVerifyTimer = setInterval(() => {
    if (verifying || switching) return
    if (session.login.isExpired()) {
      dialog.showErrorBox('账号登录已过期', '登录已失效，本机运行将停止，请重新登录。')
      void leaveAccountToLogin()
    }
  }, 30_000)
}

/** Full startup driven by splash stages (对话一). Reuses the stage-driven prepareProfile. */
async function launchAccountRuntime(): Promise<void> {
  const home = runtimeHome()
  await prepareProfile(home, (_, index) => showSplashEntry(window!, index))
  await startAccountRuntime(home)
}

async function leaveAccountToLogin(): Promise<void> {
  if (quitting) return
  if (switching) { returnRequested = true; return }
  switching = true
  try { await leaveAccountWorkspace(); showAccountLogin() }
  catch (error) { dialog.showErrorBox('暂时无法返回登录', error instanceof Error ? error.message : '请稍后重试') }
  finally { endSwitch() }
}

function showAccountSplash(): BrowserWindow {
  openWindow(accountSplashUrl(), { mode: 'personal' }, true, false, LIGHT_ENTRY_BACKGROUND)
  const entry = window!
  markStartup('过场页窗口已创建（尚未显示）')
  const reveal = setTimeout(() => { if (window === entry && !entry.isDestroyed() && entrySurface) { entry.show(); markStartup('过场页窗口已显示（4s 兜底触发）') } }, STARTUP_REVEAL_DELAY_MS)
  entry.on('closed', () => clearTimeout(reveal))
  connectEntryNavigation(entry)
  return entry
}

function showAccountLogin(): void {
  markStartup('切换到登录页')
  if (window && !window.isDestroyed()) {
    window.setBackgroundColor(LIGHT_ENTRY_BACKGROUND)
    void window.loadURL(accountLoginUrl())
    window.show()
    markStartup('登录页已显示')
  } else {
    openWindow(accountLoginUrl(), { mode: 'personal' }, true, true, LIGHT_ENTRY_BACKGROUND)
  }
}

/**
 * 账号登录门禁（取代个人身份）。启动即显示 splash（图一）：先查本地加密登录态。
 * 有效则逐阶段推进到主界面；无效则切到登录页（图二），登录成功后走同一启动流程。
 */
async function autoStartAccountWorkspace(): Promise<void> {
  const entry = showAccountSplash()
  try {
    const config = loadConfig()
    // 开发辅助：WORKDSH_SPLASH_PREVIEW=1 时无关登录态，完整播放一遍过场页各阶段，供本地肉眼验证。
    if (process.env.WORKDSH_SPLASH_PREVIEW === '1' || process.env.WORKDSH_SPLASH_PREVIEW === 'true') {
      const total = Math.max(1, config.splash.stages.length)
      for (let index = 0; index < total; index++) {
        await showSplashEntry(entry, index, index === total - 1)
        await new Promise(resolve => setTimeout(resolve, 1200))
      }
      if (!entry.isDestroyed()) entry.show()
      showAccountLogin()
      return
    }
    const store = new AccountStore(app.getPath('userData'))
    const restored = store.read()
    await showSplashEntry(entry, 1)
    if (restored) {
      const login = restoreAccountLogin(config.account, restored.user, restored.token, restored.session.expiry, restored.session.rawUserInfo)
      if (!login.isExpired()) {
        account = { login, store, deviceId: '' }
        entrySurface = true
        // Hold the splash while the runtime boots: it already covers the launch window.
        await showSplashEntry(entry, 2)
        await launchAccountRuntime()
        return
      }
      store.clear()
    }
    // No session, or the stored session is expired → offline login page.
    await showSplashEntry(entry, 1, true)
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
          await prepareProfile(home)
          entrySurface = false
          startRuntime(home, { mode: 'personal' })
        } else if (command.hostname === 'entry') {
          await leaveWorkspace(); showConnectionEntry()
        }
      } catch (error) {
        dialog.showErrorBox('无法进入', error instanceof Error ? error.message : '请检查入口配置')
        showConnectionEntry()
      } finally { endSwitch() }
    })()
  })
}

function enterprisePluginAvailable():boolean {
 try{return installedEnterprisePlugins(join(runtimeHome(),'profiles',PROFILE_NAME),JSON.parse(readFileSync(join(bundledProfileDirectory(),'node_modules','@deepseek-ai','dsh','package.json'),'utf8')).version).includes('workdsh-provider-identity-enterprise')}
 catch{return false}
}

async function activateEnterprise(): Promise<void> {
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
  session.authority = await startEnterpriseAuthority(session.login, session.deviceId, () => { void returnToEntry() }, () => { void returnToEntry() })
  // Record before writing either file, so a partial patch failure is also cleaned.
  session.authFile = join(session.home, 'enterprise-auth.json')
  const patch = desktopEnterprisePatch(session.home, session.authority, session.login.actor, session.login.backendUrl, session.deviceId, pluginNames.includes('workdsh-plugin-enterprise-collaboration'))
  session.authFile = patch.authFile
  const connection: DesktopConnection = { mode: 'enterprise', portalOrigin: session.login.backendUrl, organizationId: session.login.actor.organizationId, principalId: session.login.actor.id }
  if (window) await window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(connectionLoadingHtml('正在启动企业工作区')))
  entrySurface = false
  startRuntime(session.home, connection, [patch.patch])
  verifyTimer = setInterval(() => {
    if (verifying || switching) return
    verifying = true
    void session.login.verify().then(()=>{
      const current=installedEnterprisePlugins(join(runtimeHome(),'profiles',PROFILE_NAME),JSON.parse(readFileSync(join(bundledProfileDirectory(),'node_modules','@deepseek-ai','dsh','package.json'),'utf8')).version)
      if(pluginNames.some(name=>!current.includes(name)))throw new Error('企业插件已卸载，请重新安装后登录')
    }).catch(() => {
      dialog.showErrorBox('企业认证不可用', '企业账号已过期、被撤销、后台不可达或企业插件已卸载。本机企业运行将停止，请检查后重新登录。')
      void returnToEntry()
    }).finally(() => { verifying = false })
  }, 30_000)
}

function installLoginHandlers(): void {
  ipcMain.handle('workdsh:account-login', async (event, input: unknown) => {
    if (!entrySurface || event.sender !== window?.webContents || switching || enterprise) return { error: '此页面不能发起登录' }
    switching = true
    let admitted: AccountLogin | undefined
    try {
      const value = input as { username?: unknown, password?: unknown }
      if (!value || typeof value.username !== 'string' || typeof value.password !== 'string') throw new Error('请输入账号和密码')
      const config = loadConfig()
      const login = await AccountLogin.login(config.account, value.username.trim(), value.password)
      admitted = login
      const store = new AccountStore(app.getPath('userData'))
      store.write(login.seal())
      account = { login, store, deviceId: '' }
      // Bind the account identity to a loopback authority held in Main.
      const authority = await startAccountAuthority(login, () => { void leaveAccountToLogin() }, () => { void leaveAccountToLogin() })
      account.authority = authority
      // Switch the carrier window to the splash so startup stages are visible.
      const entry = window
      if (entry && !entry.isDestroyed()) { await entry.loadURL(accountSplashUrl()); await showSplashEntry(entry, 1) }
      const home = runtimeHome()
      await prepareProfile(home, (_, index) => showSplashEntry(window!, index))
      await startAccountRuntime(home)
      return { ok: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : '登录失败'
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
      await prepareProfile(space.home)
      await activateEnterprise()
      return {}
    } catch (error) {
      const message = error instanceof Error ? error.message : '企业登录失败'
      if (enterprise) { await leaveWorkspace(); showConnectionEntry(); dialog.showErrorBox('无法进入企业', message) }
      else if (admittedLogin && !await admittedLogin.logout()) dialog.showErrorBox('企业启动未完成', '本机未进入企业运行；后台连接失败，远端登录撤销尚未确认。')
      return { error: message }
    } finally { endSwitch() }
  })
}

function installConnectionMenu(): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
    { label: '工作区', submenu: [{ label: account ? '退出账号' : '切换使用方式／退出企业', click: () => { if (account) void leaveAccountToLogin(); else void returnToEntry() } }] },
    { label: '工具', submenu: [{ label: '终端命令 dsh（可选）…', click: () => { void manageCommand(join(process.resourcesPath, 'workdsh-runtime'), enterprise ? `${enterprise.login.actor.organizationName ?? '企业'} / ${enterprise.login.actor.displayName}` : (account ? `${account.login.user.displayName}（账号）` : '个人工作区')) } }] },
    { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' },
  ]))
}

const worker = browserWorkerRequest()
if (worker !== undefined) {
  startBrowserWorker(worker)
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
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (window === undefined) return
    if (window.isMinimized()) window.restore()
    window.focus()
  })
  app.on('before-quit', event => {
    if (quitting) { stopRuntime(); return }
    event.preventDefault()
    if (switching) {
      quitRequested = true
      if (installer) void stopOwnedProcess(installer).catch(() => dialog.showErrorBox('进程清理失败', '插件安装进程停止尚未确认，请稍后检查。'))
      return
    }
    switching = true
    void (enterprise ? leaveWorkspace() : account ? leaveAccountWorkspace() : Promise.resolve()).then(() => {
      quitting = true
      app.quit()
    }).catch(error => {
      dialog.showErrorBox('暂时无法退出', error instanceof Error ? error.message : '请稍后重试')
    }).finally(() => { switching = false })
  })
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' && !switching) app.quit()
  })
  app.on('activate', () => {
    // The entry closes before the official Host is ready. Activating the app
    // during that window must not relaunch and cancel the pending workspace.
    if (switching || runtimeStarting || installer || quitting || quitRequested) return
    if (window === undefined) {
      // A healthy runtime always owns a window. Relaunching keeps the profile
      // lifecycle simple after the last macOS window was closed.
      app.relaunch()
      app.quit()
    }
  })
  void app.whenReady().then(() => {
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
    installLoginHandlers()
    // 个人使用场景：跳过「选择使用方式」入口页，直接启动个人工作区。
    // 例外：若已配置企业后台（随包预置的 workdsh-config.json，或本机记住的企业地址），
    // 必须保留入口页，否则用户没有任何入口可以登录企业空间。
    if (enterprisePortal) {
      showConnectionEntry()
    } else {
      // 账号登录门禁（取代个人身份）：启动进 splash，已登录则直接进工作区，未登录则展示登录页。
      void autoStartAccountWorkspace()
    }
    // 原始逻辑（无条件显示入口页，由用户手动选择）：
    // showConnectionEntry()
  }).catch(cause => {
    process.stderr.write(`WorkDSH failed to start: ${cause instanceof Error ? cause.stack ?? cause.message : String(cause)}\n`)
    app.quit()
  })
}
}
