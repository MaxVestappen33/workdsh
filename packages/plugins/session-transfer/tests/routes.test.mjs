/**
 * Host 路由层验收：直接调用 dist/index.js 的 apply()，走真实注册的 7 个
 * /api/session.transfer.* 路由（真实 Request / Response），并且使用**真实官方
 * @deepseek-ai/dsh-session-format-catalog（v4）与 @deepseek-ai/dsh-session-log-export**
 * —— 其它测试注入的是 mock catalog/logExport，这里补上真实解码链的验证。
 *
 * 模拟「两台设备」：导出侧工作区/附件放在 sourceRoot/external 目录，导入侧
 * 通过 registry.resolveByPath 映射到另一个 targetRoot，附件回写到 DSH_HOME。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply, name, inject } from '../dist/index.js'
import { ROUTES, ERR } from '../dist/constants.js'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const jsonHeaders = { 'content-type': 'application/json' }

function makeHost(serviceMap) {
  const routes = new Map()
  const provided = []
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
    provide: (service, value) => { provided.push({ service, value }) },
    get: (service) => serviceMap[service],
    logger: { warn() {} },
  }
  return { ctx, routes, provided, dispose: () => cleanup?.() }
}

async function call(routes, pathWithQuery, init = {}) {
  const path = pathWithQuery.split('?')[0]
  const def = routes.get(path)
  assert.ok(def !== undefined, `路由未注册：${path}`)
  return def.fetch(new Request('http://localhost' + pathWithQuery, init))
}

async function postJson(routes, path, body) {
  return call(routes, path, { method: 'POST', headers: jsonHeaders, body: JSON.stringify(body) })
}

/** 构造一套可同时充当导出机与导入机的 mock 运行时。 */
async function makeWorld(home) {
  const sourceRoot = join(home, 'source-workspace')
  const targetRoot = join(home, 'target-workspace')
  const externalAttachments = join(home, 'source-attachments')
  await mkdir(join(sourceRoot, 'src'), { recursive: true })

  const imageBytes = Buffer.from('real-http-roundtrip-png')
  const sha = createHash('sha256').update(imageBytes).digest('hex')
  const externalAttachmentPath = join(externalAttachments, sha.slice(0, 2), sha)
  await mkdir(join(externalAttachments, sha.slice(0, 2)), { recursive: true })
  await writeFile(externalAttachmentPath, imageBytes)
  const fileBytes = Buffer.from('export const a = 1\n')
  await writeFile(join(sourceRoot, 'src', 'a.ts'), fileBytes)

  const header = { version: 4, id: 's1', createdAt: 1, cwd: sourceRoot, isSeeded: false }
  // 真实 v4 事件必须带 seq（从 0 开始）与 time，否则官方 createRestore 会拒绝。
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
  const state = { attached: [], bound: [], audits: [], denyLogin: false }

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
    workdshIdentity: {
      resolve: async () => {
        if (state.denyLogin) throw new Error('未登录')
        return { principalId: 'p', organizationId: 'o', requestId: 'r' }
      },
    },
    workdshAudit: { append: async (event) => { state.audits.push(event) }, flush: async () => undefined },
    workdshAccess: { bindSession: async (_actor, request) => { state.bound.push(request) } },
    attachments: {
      imageHostPath: () => externalAttachmentPath,
      fileHostPath: () => undefined,
      saveImage: async () => { throw new Error('不应被调用') },
      saveFileStream: async () => { throw new Error('不应被调用') },
    },
  }
  return { home, sourceRoot, targetRoot, imageBytes, sha, fileBytes, sessions, state, serviceMap }
}

async function withHome(run) {
  const home = await mkdtemp(join(tmpdir(), 'st-http-e2e-'))
  const saved = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    return await run(home)
  } finally {
    if (saved === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = saved
    await rm(home, { recursive: true, force: true })
  }
}

test('apply() 注册 7 个路由，登录/方法/参数门禁与错误映射正确', { concurrency: false }, async () => {
  await withHome(async (home) => {
    const world = await makeWorld(home)
    const host = makeHost(world.serviceMap)
    apply(host.ctx)
    try {
      assert.equal(name, 'workdsh-plugin-session-transfer')
      assert.deepEqual(inject, ['connection'])
      assert.equal(host.routes.size, 7)
      for (const path of Object.values(ROUTES)) assert.ok(host.routes.has(path), `缺少路由 ${path}`)
      assert.equal(host.routes.get(ROUTES.importPreview).requestBody, 'streaming', '上传必须走 streaming')
      assert.equal(host.provided[0].service, 'workdshSessionTransfer')
      assert.deepEqual(host.provided[0].value.routes.importApply, ROUTES.importApply)

      // 方法门禁
      const wrongMethod = await call(host.routes, ROUTES.exportPreview, { method: 'GET' })
      assert.equal(wrongMethod.status, 405)
      assert.equal((await wrongMethod.json()).error.code, ERR.invalidRequest)

      // 登录门禁
      world.state.denyLogin = true
      const unauth = await postJson(host.routes, ROUTES.exportPreview, {})
      assert.equal(unauth.status, 401)
      assert.equal((await unauth.json()).error.code, ERR.unauthenticated)
      world.state.denyLogin = false

      // 请求体窄化
      const badJson = await call(host.routes, ROUTES.exportPreview, { method: 'POST', headers: jsonHeaders, body: '{oops' })
      assert.equal(badJson.status, 400)
      assert.equal((await badJson.json()).error.code, ERR.invalidRequest)
      const missingToken = await postJson(host.routes, ROUTES.importApply, { decisions: [], mapping: [] })
      assert.equal(missingToken.status, 400)

      // 空选 = 轻量列举会话（不 flush、不读日志）
      const list = await postJson(host.routes, ROUTES.exportPreview, {})
      assert.equal(list.status, 200)
      const listBody = await list.json()
      assert.equal(listBody.sessions.length, 1)
      assert.equal(listBody.sessions[0].id, 's1')
      assert.equal(listBody.attachments.count, 0)

      // 状态查询与取消的 404 / false 分支
      assert.equal((await call(host.routes, ROUTES.exportStatus + '?jobId=nope')).status, 404)
      assert.equal((await call(host.routes, ROUTES.importStatus + '?batchId=nope')).status, 404)
      assert.equal((await postJson(host.routes, ROUTES.importCancel, {})).status, 400)
      const noBatch = await postJson(host.routes, ROUTES.importCancel, { batchId: 'nope' })
      assert.deepEqual(await noBatch.json(), { cancelled: false })
    } finally {
      host.dispose()
    }
    assert.equal(host.routes.size, 0, 'effect cleanup 应反注册全部路由')
  })
})

test('真实 HTTP 全链路：export → import.preview → import.apply → status(done)', { concurrency: false }, async () => {
  await withHome(async (home) => {
    const world = await makeWorld(home)
    const host = makeHost(world.serviceMap)
    apply(host.ctx)
    try {
      // 1. 导出预览 + 导出 ZIP
      const preview = await postJson(host.routes, ROUTES.exportPreview, { sessionIds: ['s1'] })
      assert.equal(preview.status, 200)
      assert.equal((await preview.json()).totals.sessionCount, 1)

      const exported = await postJson(host.routes, ROUTES.exportRun, {
        sessionIds: ['s1'], includeWorkspaceFiles: true, userExcludes: [], archivePolicy: 'preserve',
      })
      assert.equal(exported.status, 200, JSON.stringify(await exported.clone().json().catch(() => null)))
      assert.ok(exported.headers.get('content-type').startsWith('application/zip'))
      const jobId = exported.headers.get('x-transfer-job-id')
      assert.ok(jobId)
      const zipBytes = Buffer.from(await exported.arrayBuffer())
      assert.ok(zipBytes.byteLength > 0)

      // 流消费完毕后导出 job 状态应为 done
      const exportStatus = await (await call(host.routes, ROUTES.exportStatus + `?jobId=${jobId}`)).json()
      assert.equal(exportStatus.state, 'done')

      // 2. 上传迁移包（streaming body）
      const imported = await call(host.routes, ROUTES.importPreview, {
        method: 'POST',
        headers: { 'content-type': 'application/zip' },
        body: zipBytes,
      })
      assert.equal(imported.status, 200, JSON.stringify(await imported.clone().json().catch(() => null)))
      const previewBody = await imported.json()
      assert.equal(previewBody.rejection, undefined)
      assert.equal(previewBody.summary.sourceVersion, 4)
      assert.equal(previewBody.summary.localVersion, 4)
      assert.equal(previewBody.versionVerdict, 'current')
      assert.deepEqual(previewBody.conflicts, ['s1'], '同一 mock 世界里 s1 已存在 → 冲突')
      assert.ok(previewBody.token)

      // 3. 提交导入并轮询到结束
      const applied = await postJson(host.routes, ROUTES.importApply, {
        token: previewBody.token,
        decisions: [{ sessionId: 's1', importAsNew: true, targetWorkspaceId: 'w1' }],
        mapping: previewBody.workspaces,
        archivePolicy: 'preserve',
      })
      assert.equal(applied.status, 200)
      const { batchId } = await applied.json()
      assert.ok(batchId)

      let status
      for (let i = 0; i < 200; i += 1) {
        status = await (await call(host.routes, ROUTES.importStatus + `?batchId=${batchId}`)).json()
        if (status.state !== 'running') break
        await sleep(10)
      }
      assert.equal(status.state, 'done', JSON.stringify(status.error))
      assert.equal(status.result.length, 1)
      assert.equal(status.result[0].status, 'imported')

      // 4. 真实官方 createRestore 产出的会话：ID 冲突重映射 + cwd 改写
      const newId = status.result[0].sessionId
      assert.match(newId, /^s1-import-[0-9a-f]{8}$/u)
      const restored = world.sessions.get(newId)
      assert.ok(restored, '新会话必须写入 persistence')
      assert.equal(restored.header.cwd, world.targetRoot)
      assert.equal(restored.events.length, 4)
      const cwdEvent = restored.events.find((event) => event.type === 'working-directory/change')
      assert.equal(cwdEvent.data.cwd, join(world.targetRoot, 'src'))
      const toolEvent = restored.events.find((event) => event.type === 'tool/call')
      assert.equal(toolEvent.data.arguments, '{"path":"src/a.ts"}', '事件文本里的路径不得被全局替换')
      const titleEvent = restored.events.find((event) => event.type === 'session/title')
      assert.equal(titleEvent.data.title, '迁移测试会话（导入）')

      // 5. 附件回写到 DSH_HOME、工作区源文件还原到 targetRoot
      assert.deepEqual(
        await readFile(join(home, 'attachments', 'v1', 'objects', world.sha.slice(0, 2), world.sha)),
        world.imageBytes,
      )
      assert.deepEqual(await readFile(join(world.targetRoot, 'src', 'a.ts')), world.fileBytes)
      assert.equal(status.result[0].attachmentsRestored, 1)
      assert.equal(status.result[0].filesRestored, 1)

      // 6. owner 绑定与审计
      assert.deepEqual(world.state.attached, [newId])
      assert.deepEqual(world.state.bound, [{ sessionId: newId, workspaceId: 'w1' }])
      assert.ok(world.state.audits.some((event) => event.action === 'session.transfer.import'))
      assert.ok(world.state.audits.some((event) => event.action === 'session.transfer.export'))
    } finally {
      host.dispose()
    }
  })
})

test('未归属工作区的会话：预览补出虚拟映射行，导入落到默认工作区', { concurrency: false }, async () => {
  await withHome(async (home) => {
    const world = await makeWorld(home)
    // 追加一个 cwd 不在任何工作区内的会话
    const looseRoot = join(home, 'loose-workspace')
    await mkdir(looseRoot, { recursive: true })
    world.sessions.set('s2', {
      header: { version: 4, id: 's2', createdAt: 2, cwd: looseRoot, isSeeded: false },
      events: [
        { seq: 0, time: 1, type: 'session/title', data: { title: '游离会话' } },
        { seq: 1, time: 2, type: 'user/message', data: { content: [{ type: 'text', text: 'hi' }] } },
      ],
    })
    const host = makeHost(world.serviceMap)
    apply(host.ctx)
    try {
      // 无投影缓存时（等价于刚导入、尚未被官方折叠过的会话），列表标题要回退读日志
      const listed = await (await call(host.routes, ROUTES.exportPreview, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
      })).json()
      const orphanItem = listed.sessions.find((item) => item.id === 's2')
      assert.equal(orphanItem?.title, '游离会话', '缺投影标题时应回退读 session/title 事件')

      const exported = await postJson(host.routes, ROUTES.exportRun, {
        sessionIds: ['s1', 's2'], includeWorkspaceFiles: false, userExcludes: [], archivePolicy: 'preserve',
      })
      assert.equal(exported.status, 200)
      const zipBytes = Buffer.from(await exported.arrayBuffer())

      const imported = await call(host.routes, ROUTES.importPreview, {
        method: 'POST',
        headers: { 'content-type': 'application/zip' },
        body: zipBytes,
      })
      assert.equal(imported.status, 200)
      const previewBody = await imported.json()
      const orphanRow = previewBody.workspaces.find((item) => item.id === '__unassigned__')
      assert.ok(orphanRow, '预览应补出未归属工作区的虚拟映射行')
      assert.equal(orphanRow.targetId, 'w1', '默认落到本机已有工作区')
      assert.equal(orphanRow.status, 'matched')

      const applied = await postJson(host.routes, ROUTES.importApply, {
        token: previewBody.token,
        decisions: [
          { sessionId: 's1', importAsNew: true, targetWorkspaceId: 'w1' },
          { sessionId: 's2', importAsNew: true, targetWorkspaceId: '__unassigned__' },
        ],
        mapping: previewBody.workspaces,
        archivePolicy: 'preserve',
      })
      assert.equal(applied.status, 200)
      const { batchId } = await applied.json()
      let status
      for (let i = 0; i < 200; i += 1) {
        status = await (await call(host.routes, ROUTES.importStatus + `?batchId=${batchId}`)).json()
        if (status.state !== 'running') break
        await sleep(10)
      }
      assert.equal(status.state, 'done', JSON.stringify(status.error))
      assert.equal(status.result.length, 2)
      assert.ok(status.result.every((row) => row.status === 'imported'), JSON.stringify(status.result))
      const landed = [...world.sessions.values()].filter((record) => record.header.cwd === world.targetRoot)
      assert.equal(landed.length, 2, '两个会话都应落到默认工作区的目标路径')
    } finally {
      host.dispose()
    }
  })
})

test('重复导入：路径不同但同名的工作区自动匹配，不再新建目录', { concurrency: false }, async () => {
  await withHome(async (home) => {
    const world = await makeWorld(home)
    const exportHost = makeHost(world.serviceMap)
    apply(exportHost.ctx)
    const exported = await postJson(exportHost.routes, ROUTES.exportRun, {
      sessionIds: ['s1'], includeWorkspaceFiles: false, userExcludes: [], archivePolicy: 'preserve',
    })
    exportHost.dispose()
    const zipBytes = Buffer.from(await exported.arrayBuffer())

    // 第二次导入：本机已存在同名工作区（上次导入新建到 ~/Documents/项目 A），路径与来源不同
    const creates = []
    world.serviceMap.workspaceRegistry = {
      ...world.serviceMap.workspaceRegistry,
      resolveByPath: async () => undefined,
      list: () => [{ id: 'local-1', title: '项目 A', path: join(home, 'Documents', '项目 A') }],
      create: async (path, title) => {
        creates.push({ path, title })
        return { id: 'created', title: title ?? 'x', path, attachSession: async () => undefined }
      },
    }
    const host = makeHost(world.serviceMap)
    apply(host.ctx)
    try {
      const imported = await call(host.routes, ROUTES.importPreview, {
        method: 'POST', headers: { 'content-type': 'application/zip' }, body: zipBytes,
      })
      const previewBody = await imported.json()
      const row = previewBody.workspaces.find((item) => item.id === 'w1')
      assert.equal(row.status, 'matched', '同名工作区应自动匹配而不是提示新建')
      assert.equal(row.targetId, 'local-1')
      assert.equal(row.targetPath, join(home, 'Documents', '项目 A'))
      assert.deepEqual(creates, [], '预览阶段不应新建目录')
    } finally {
      host.dispose()
    }
  })
})

/** 走一遍「导出 → 预览 → 导入」，返回最终批次状态。 */
async function exportAndImport(world, { targetWorkspaceId = 'w1' } = {}) {
  const exportHost = makeHost(world.serviceMap)
  apply(exportHost.ctx)
  const exported = await postJson(exportHost.routes, ROUTES.exportRun, {
    sessionIds: ['s1'], includeWorkspaceFiles: false, userExcludes: [], archivePolicy: 'preserve',
  })
  exportHost.dispose()
  const zipBytes = Buffer.from(await exported.arrayBuffer())

  const host = makeHost(world.serviceMap)
  apply(host.ctx)
  try {
    const preview = await (await call(host.routes, ROUTES.importPreview, {
      method: 'POST', headers: { 'content-type': 'application/zip' }, body: zipBytes,
    })).json()
    const applied = await postJson(host.routes, ROUTES.importApply, {
      token: preview.token,
      decisions: [{ sessionId: 's1', importAsNew: true, targetWorkspaceId }],
      mapping: preview.workspaces,
      archivePolicy: 'preserve',
    })
    const { batchId } = await applied.json()
    let status
    for (let i = 0; i < 200; i += 1) {
      status = await (await call(host.routes, ROUTES.importStatus + `?batchId=${batchId}`)).json()
      if (status.state !== 'running') break
      await sleep(10)
    }
    return status
  } finally {
    host.dispose()
  }
}

test('归属绑定：同一主体的历史绑定直接复用，不再报 bind-failed', { concurrency: false }, async () => {
  await withHome(async (home) => {
    const world = await makeWorld(home)
    // 本地会话数据被清理过，但 owner 绑定仍指向旧工作区；bindSession 会抛 owner-conflict
    world.serviceMap.workdshAccess = {
      sessionOwner: () => ({ organizationId: 'o', ownerPrincipalId: 'p', workspaceId: 'w-old' }),
      bindSession: async () => { throw new Error('access/session-owner-conflict') },
    }
    const status = await exportAndImport(world)
    assert.equal(status.state, 'done', JSON.stringify(status.error))
    assert.equal(status.result[0].status, 'imported')
    assert.equal(status.result[0].reason, undefined, '批次级提示不得写进每一行')
    assert.equal(status.warning, undefined, '同一主体已有归属时不应提示绑定失败')
  })
})

test('归属绑定：真正失败时只在批次提示里出现一次', { concurrency: false }, async () => {
  await withHome(async (home) => {
    const world = await makeWorld(home)
    world.serviceMap.workdshAccess = {
      sessionOwner: () => undefined,
      bindSession: async () => { throw new Error('access/inactive-membership') },
    }
    const status = await exportAndImport(world)
    assert.equal(status.state, 'done', JSON.stringify(status.error))
    assert.equal(status.result[0].status, 'imported', '绑定失败不影响会话本身已导入')
    assert.equal(status.result[0].reason, undefined)
    assert.match(status.warning ?? '', /1 个会话的归属绑定失败/)
  })
})
