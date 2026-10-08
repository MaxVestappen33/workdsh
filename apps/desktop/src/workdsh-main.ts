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
import { connectionEntryHtml, enterpriseLoginHtml, connectionLoadingHtml } from './connection-entry.ts'
import { connectionPartition, enterpriseConnection, type DesktopConnection } from './connection-mode.ts'
import { parseDeploymentConfig } from './deployment-config.ts'
import { EnterpriseLogin, startEnterpriseAuthority, type Authority } from './enterprise-auth.ts'
import { desktopEnterprisePatch, enterpriseEnvironment, enterpriseSpace, materializeRuntimeProfile, markProfileUpdated, officialLauncher, officialHostLauncher } from './local-runtime.ts'
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
    page.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    await page.loadURL('about:blank')
    process.stdout.write('WORKDSH_BROWSER_WORKER_READY\n')
  }).catch(error => {
    process.stderr.write(`WorkDSH browser worker failed: ${String(error)}\n`)
    app.exit(1)
  })
}

function openWindow(url: string, connection: DesktopConnection = { mode: 'personal' }, carrier = false): void {
  const previous = window
  const previousEntrySurface = entrySurface
  const icon = fileURLToPath(new URL('../build/app-icon.png', import.meta.url))
  window = new BrowserWindow({
    width: 1440,
    height: 960,
    ...(previous && typeof previous.getBounds === 'function' ? previous.getBounds() : {}),
    minWidth: 960,
    minHeight: 640,
    title: 'WorkDSH',
    icon,
    backgroundColor: '#111113',
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
  entrySurface = carrier
  window.on('page-title-updated', event => {
    event.preventDefault()
    page.setTitle('WorkDSH')
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
    page.show()
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
    ELECTRON_RUN_AS_NODE: undefined,
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

async function prepareProfile(home: string): Promise<string> {
  const source = bundledProfileDirectory()
  const result = materializeRuntimeProfile(source, home)
  if (result.changed) {
    const entry = window
    if (entry && !entry.isDestroyed()) await entry.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(connectionLoadingHtml('正在更新工作区插件依赖')))
    await officialCommand(home, ['plugin', '--profile', PROFILE_NAME, 'install'])
    markProfileUpdated(source, result.profile)
    if (entry && !entry.isDestroyed()) await entry.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(connectionLoadingHtml(enterprise ? '正在启动企业工作区' : '正在启动个人工作区')))
  }
  officialLauncher(source, home, bundledNodeExecutable(), join(bundledPrimaryRuntime(), 'dependencies', 'pnpm', 'bin', 'pnpm.cjs'))
  return result.profile
}

function rememberCommandSpace(home?: string): void {
  const active = home ? { mode: enterprise ? 'enterprise' : 'personal', home, ...(enterprise ? { root: enterprise.root } : {}), label: enterprise ? `${enterprise.login.actor.organizationName ?? '企业'} / ${enterprise.login.actor.displayName}` : '个人工作区' } : undefined
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
    { label: '工作区', submenu: [{ label: '切换使用方式／退出企业', click: () => { void returnToEntry() } }] },
    { label: '工具', submenu: [{ label: '终端命令 dsh（可选）…', click: () => { void manageCommand(join(process.resourcesPath, 'workdsh-runtime'), enterprise ? `${enterprise.login.actor.organizationName ?? '企业'} / ${enterprise.login.actor.displayName}` : '个人工作区') } }] },
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
app.setName('WorkDSH')
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
    void leaveWorkspace().then(() => {
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
    showConnectionEntry()
  }).catch(cause => {
    process.stderr.write(`WorkDSH failed to start: ${cause instanceof Error ? cause.stack ?? cause.message : String(cause)}\n`)
    app.quit()
  })
}
}
