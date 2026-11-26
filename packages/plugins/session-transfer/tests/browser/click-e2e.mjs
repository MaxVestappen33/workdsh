/**
 * 真实点击验收（手动触发，不在默认 node --test 套件内）：
 *   corepack pnpm --filter workdsh-plugin-session-transfer build
 *   corepack pnpm --filter workdsh-plugin-session-transfer test:click
 * 需要 Playwright（优先系统 Chrome，否则 chromium）：npx playwright install chromium
 *
 * 浏览器加载真实前端产物 dist/client.browser.js，跑在真实 React 19 上；
 * 宿主只 stub slots 容器、layout 服务与官方 primitives，插件 UI 代码零改写。
 * 后端是 apply() 注册的真实 7 个路由 + 官方 v4 解码链，由本地 HTTP 服务承载。
 * 导出会触发浏览器真实下载，下载的 ZIP 直接作为导入输入，形成「导出→导入」闭环。
 */
import { createServer } from 'node:http'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { ROUTES } from '../../dist/constants.js'
import { apply as applyHost } from '../../dist/index.js'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
const repoRoot = join(root, '..', '..', '..')
const require = createRequire(import.meta.url)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function assert(condition, message) {
  if (!condition) throw new Error(`断言失败：${message}`)
}

async function loadEsbuild() {
  const local = join(repoRoot, 'apps', 'web', 'node_modules', 'esbuild', 'lib', 'main.js')
  if (existsSync(local)) return import(pathToFileURL(local).href)
  return import('esbuild')
}

async function loadPlaywright() {
  try { return require('playwright') } catch { /* fall through */ }
  const candidates = [
    join(root, 'node_modules', 'playwright', 'index.js'),
    join(repoRoot, 'apps', 'web', 'node_modules', 'playwright', 'index.js'),
    join(repoRoot, 'apps', 'web', 'node_modules', '@playwright', 'test', 'index.js'),
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return import(pathToFileURL(candidate).href)
  }
  return null
}

/** 把宿主 harness 打成浏览器可执行的 iife（React 一并打进去，保证单一实例）。 */
async function buildHostBundle() {
  const esbuild = await loadEsbuild()
  const result = await esbuild.build({
    entryPoints: [join(here, 'host.tsx')],
    bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022',
    jsx: 'automatic', logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"production"' },
  })
  return result.outputFiles[0].text
}

/** 构造可同时充当导出机与导入机的 mock 运行时（与 routes.test.mjs 同口径）。 */
async function makeWorld(home) {
  const sourceRoot = join(home, 'source-workspace')
  const targetRoot = join(home, 'target-workspace')
  const externalAttachments = join(home, 'source-attachments')
  await mkdir(join(sourceRoot, 'src'), { recursive: true })

  const imageBytes = Buffer.from('real-click-roundtrip-png')
  const sha = createHash('sha256').update(imageBytes).digest('hex')
  const externalAttachmentPath = join(externalAttachments, sha.slice(0, 2), sha)
  await mkdir(join(externalAttachments, sha.slice(0, 2)), { recursive: true })
  await writeFile(externalAttachmentPath, imageBytes)
  const fileBytes = Buffer.from('export const a = 1\n')
  await writeFile(join(sourceRoot, 'src', 'a.ts'), fileBytes)

  const header = { version: 4, id: 's1', createdAt: 1, cwd: sourceRoot, isSeeded: false }
  const events = [
    { seq: 0, time: 1, type: 'session/title', data: { title: '迁移测试会话' } },
    { seq: 1, time: 2, type: 'working-directory/change', data: { cwd: join(sourceRoot, 'src') } },
    {
      seq: 2, time: 3, type: 'user/message',
      data: { content: [{ type: 'image', attachment: { attachmentId: `sha256:${sha}`, mediaType: 'image/png', bytes: imageBytes.length } }] },
    },
    { seq: 3, time: 4, type: 'tool/call', data: { arguments: '{"path":"src/a.ts"}' } },
  ]

  const sessions = new Map([['s1', { header, events: [...events] }]])
  const state = { attached: [], bound: [], audits: [] }

  const handleFor = (record) => ({
    header: record.header,
    read: async () => ({ events: record.events }),
    append: async (rows) => { record.events.push(...rows) },
    flush: async () => undefined,
    close: async () => undefined,
  })
  const persistence = {
    list: async () => [...sessions.values()].map((s) => ({ header: s.header, sizeBytes: 128 })),
    stat: async (id) => sessions.get(id),
    open: async (id) => {
      const record = sessions.get(id)
      if (record === undefined) throw new Error(`会话不存在：${id}`)
      return handleFor(record)
    },
    create: async (newHeader) => {
      const record = { header: newHeader, events: [] }
      sessions.set(newHeader.id, record)
      return handleFor(record)
    },
    flush: async () => undefined,
  }

  const attachSession = async (id) => { state.attached.push(id) }
  const sourceWorkspace = { id: 'w1', title: '项目 A', path: sourceRoot, attachSession }
  const targetWorkspace = { id: 'w1', title: '项目 A', path: targetRoot, attachSession }
  const registry = {
    get: (id) => (id === 'w1' ? targetWorkspace : undefined),
    list: () => [sourceWorkspace],
    resolveByPath: async () => targetWorkspace,
    create: async () => { throw new Error('本用例复用已有工作区') },
    delete: async () => true,
    archivedSessionIds: [],
    archiveSession: async () => undefined,
    unarchiveSession: async () => undefined,
    pinSession: async () => undefined,
    unpinSession: async () => undefined,
  }

  const serviceMap = {
    sessionPersistence: persistence,
    workspaceRegistry: registry,
    workdshIdentity: { resolve: async () => ({ principalId: 'p', organizationId: 'o', requestId: 'r' }) },
    workdshAudit: { append: async (event) => { state.audits.push(event) }, flush: async () => undefined },
    workdshAccess: { bindSession: async (_actor, request) => { state.bound.push(request) } },
    attachments: {
      imageHostPath: () => externalAttachmentPath,
      fileHostPath: () => undefined,
      saveImage: async () => { throw new Error('不应被调用') },
      saveFileStream: async () => { throw new Error('不应被调用') },
    },
  }
  return { sourceRoot, targetRoot, imageBytes, sha, fileBytes, sessions, state, serviceMap }
}

function makeHost(serviceMap) {
  const routes = new Map()
  let cleanup
  const ctx = {
    connection: {
      fetch: {
        register: (def) => {
          routes.set(def.path, def)
          return () => { routes.delete(def.path) }
        },
      },
    },
    effect: (callback) => { cleanup = callback(); return cleanup },
    provide: () => undefined,
    get: (service) => serviceMap[service],
    logger: { warn() {} },
  }
  applyHost(ctx)
  return {
    handle: (path) => {
      const def = routes.get(path)
      if (def === undefined) return undefined
      return (request) => def.fetch(request)
    },
    dispose: () => cleanup?.(),
  }
}

const home = await mkdtemp(join(tmpdir(), 'st-click-e2e-'))
const savedHome = process.env.DSH_HOME
process.env.DSH_HOME = home

const world = await makeWorld(home)
const host = makeHost(world.serviceMap)
const hostBundle = await buildHostBundle()

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  const chunks = []
  req.on('data', (chunk) => chunks.push(chunk))
  req.on('end', async () => {
    if (url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end('<!doctype html><html><head><meta charset="utf-8"><title>transfer click</title></head>'
        + '<body style="margin:0"><div id="root"></div>'
        + '<script src="/host.js"></script><script src="/client.browser.js"></script>'
        + '<script>__boot()</script></body></html>')
      return
    }
    if (url.pathname === '/host.js') {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' })
      res.end(hostBundle)
      return
    }
    if (url.pathname === '/client.browser.js') {
      const code = await readFile(join(root, 'dist', 'client.browser.js'), 'utf8')
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' })
      res.end(code)
      return
    }
    if (url.pathname === '/favicon.ico') {
      res.writeHead(204)
      res.end()
      return
    }
    const handler = host.handle(url.pathname)
    if (handler === undefined) {
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { code: 'not-found', message: `未注册路由 ${url.pathname}` } }))
      return
    }
    const body = Buffer.concat(chunks)
    const request = new Request(`http://127.0.0.1${url.pathname}${url.search}`, {
      method: req.method,
      headers: req.headers,
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
    })
    const response = await handler(request)
    const headers = {}
    for (const [key, value] of response.headers.entries()) headers[key] = value
    res.writeHead(response.status, headers)
    res.end(Buffer.from(await response.arrayBuffer()))
  })
})

const playwrightModule = await loadPlaywright()
const playwright = playwrightModule?.chromium !== undefined ? playwrightModule : playwrightModule?.default
if (playwright?.chromium === undefined) {
  console.error('缺少 playwright：npm i -D playwright 或 npx playwright install chromium')
  process.exit(2)
}

const port = await new Promise((resolve) => {
  server.listen(0, '127.0.0.1', () => resolve(server.address().port))
})
const origin = `http://127.0.0.1:${port}`
const artifacts = join(root, '.artifacts', 'session-transfer-click')
await mkdir(artifacts, { recursive: true })

const browser = await playwright.chromium.launch({ channel: 'chrome' }).catch(() => playwright.chromium.launch())
const page = await browser.newPage({ acceptDownloads: true, viewport: { width: 1360, height: 1000 } })
const consoleErrors = []
page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
page.on('pageerror', (error) => consoleErrors.push(String(error)))

const shot = async (name) => page.screenshot({ path: join(artifacts, `${name}.png`), fullPage: true })

try {
  await page.goto(origin, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.__booted === true, undefined, { timeout: 20000 })

  const regCount = await page.evaluate(() => window.__registeredCount())
  assert(regCount === 3, `应注册 3 个插槽入口（panellist / main / session-menu），实际 ${regCount}`)
  await shot('01-host')

  // 入口：资料库在上，会话迁移在其下方
  assert((await page.getByTestId('host-library-row').count()) === 1, '宿主资料库行缺失')
  assert((await page.getByTestId('host-transfer-row').count()) === 1, '会话迁移侧栏入口缺失')
  await page.getByTestId('host-transfer-row').click()

  // 主面板整页
  await page.getByPlaceholder('搜索会话名称或 ID').waitFor({ timeout: 10000 })
  await page.getByText(/已选 0 \/ 1/).waitFor()
  assert((await page.getByRole('button', { name: '导出', exact: true }).count()) === 1, '导出 Tab 缺失')
  await shot('02-panel')

  // 分组默认展开，可收起 / 展开；列表按日志里的 session/title 显示标题
  const rowCount = async () => page.getByText('迁移测试会话', { exact: true }).count()
  assert((await rowCount()) === 1, '默认应展开工作区分组')
  await page.getByRole('button', { name: '收起工作区' }).click()
  assert((await rowCount()) === 0, '收起后不应渲染会话行')
  await page.getByRole('button', { name: '展开工作区' }).click()
  assert((await rowCount()) === 1, '展开后应恢复会话行')

  // 单个工作区全选（工具栏全选在前，分组全选是最后一个）
  await page.getByRole('button', { name: '全选', exact: true }).last().click()
  await page.getByText(/已选 1 \/ 1/).waitFor()
  const filesToggle = page.getByRole('checkbox', { name: /携带工作区文件/ })
  assert((await filesToggle.count()) === 1, '工作区应出现「携带工作区文件」勾选框')
  await filesToggle.check()
  await page.getByText('附加忽略规则（每行一条，内置安全基线不可移除）').waitFor()
  await shot('03-selected')

  // 预览
  await page.getByRole('button', { name: /下一步：预览/ }).click()
  await page.getByRole('button', { name: /上一步/ }).waitFor({ timeout: 15000 })
  const previewText = await page.getByTestId('host-main').innerText()
  assert(/1 个/u.test(previewText), `预览应显示 1 个工作区文件，实际：${previewText.slice(0, 400)}`)
  await shot('04-preview')

  // 真实下载
  await page.getByRole('button', { name: '生成并下载' }).click()
  const downloadPromise = page.waitForEvent('download', { timeout: 30000 })
  await page.getByText('导出完成').waitFor({ timeout: 30000 })
  const download = await downloadPromise
  const zipPath = join(artifacts, 'export.zip')
  await download.saveAs(zipPath)
  const zip = await readFile(zipPath)
  assert(zip.byteLength > 0, '下载的 ZIP 为空')
  await shot('05-export-done')
  await page.getByRole('button', { name: '返回列表' }).click()

  // 导入：选择 ZIP → 预览 → 执行
  await page.getByRole('button', { name: '导入', exact: true }).click()
  await page.getByText('把会话迁移包拖到这里').waitFor()
  await page.locator('input[type=file]').setInputFiles(zipPath)
  await page.getByText('目标工作区').waitFor({ timeout: 15000 })
  const importText = await page.getByTestId('host-main').innerText()
  assert(/项目 A/u.test(importText), '导入预览应显示工作区映射')
  await shot('06-import-preview')

  await page.getByRole('button', { name: '开始导入' }).click()
  await page.getByText(/成功导入 1 个会话/u).waitFor({ timeout: 30000 })
  await shot('07-result')

  // 后端真实写入：新会话 + 绑定 + 附件/文件还原 + 审计
  const restored = [...world.sessions.values()].filter((session) => session.header.cwd === world.targetRoot)
  assert(restored.length === 1, `应写入 1 个新会话，实际 ${restored.length}`)
  assert(world.state.bound.length === 1, `应绑定 1 个会话，实际 ${world.state.bound.length}`)
  assert(world.state.attached.length === 1, `应 attachSession 1 次，实际 ${world.state.attached.length}`)
  assert(world.state.audits.some((event) => event.action === 'session.transfer.import'), '缺少导入审计')
  assert(
    await readFile(join(home, 'attachments', 'v1', 'objects', world.sha.slice(0, 2), world.sha)).then((buf) => buf.equals(world.imageBytes)),
    '附件应回写到 DSH_HOME',
  )
  assert(
    await readFile(join(world.targetRoot, 'src', 'a.ts')).then((buf) => buf.equals(world.fileBytes)),
    '工作区文件应还原到目标工作区',
  )

  await page.getByRole('button', { name: '完成' }).click()
  await page.getByText('把会话迁移包拖到这里').waitFor()

  // 会话行右键「迁移会话」：打开主面板并预选该会话
  await page.getByTestId('host-session-menu').getByRole('button', { name: /迁移会话/ }).click()
  await page.getByPlaceholder('搜索会话名称或 ID').waitFor()
  await page.getByText(/已选 1 \/ 1/).waitFor()
  await shot('08-menu-preset')

  assert(consoleErrors.length === 0, `存在页面异常或 console.error：${consoleErrors.join(' | ')}`)
  console.log(`点击验收通过：入口 ${regCount} 个，导出 ${zip.byteLength} 字节，导入 ${restored.length} 个新会话`)
  console.log(`截图输出：${artifacts}`)
  process.exitCode = 0
} catch (error) {
  await shot('99-failure').catch(() => undefined)
  console.error(error)
  process.exitCode = 1
} finally {
  await browser.close()
  server.close()
  host.dispose()
  if (savedHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = savedHome
  await writeFile(join(artifacts, 'last-run.json'), JSON.stringify({ at: new Date().toISOString(), exitCode: process.exitCode }, null, 2))
  await sleep(10)
  await rm(home, { recursive: true, force: true })
}
