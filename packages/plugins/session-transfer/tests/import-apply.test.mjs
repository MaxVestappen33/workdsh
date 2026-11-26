/**
 * 导入侧端到端验收：用真实 exportArchive 产出 ZIP，再跑 importPreview /
 * importApply 的完整批次，验证会话、结构化 cwd、附件、工作区源文件、owner
 * 绑定与审计都真正落地；并覆盖冲突重映射与「取消 = 回滚全部」两条拍板语义。
 *
 * 运行前需先执行 build（测试 import 的是 dist/*.js）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { exportArchive } from '../dist/export.js'
import { importPreview, importApply } from '../dist/import.js'
import { JobStore } from '../dist/jobs.js'

const SESSION_VERSION = 4
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function consume(stream) {
  const chunks = []
  const reader = stream.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(Buffer.from(value))
  }
  return Buffer.concat(chunks)
}

async function waitForBatch(jobs, batchId, timeoutMs = 5000) {
  const start = Date.now()
  for (;;) {
    const status = jobs.getBatch(batchId)?.status
    if (status !== undefined && status.state !== 'running') return status
    if (Date.now() - start > timeoutMs) throw new Error('等待导入批次超时')
    await sleep(5)
  }
}

function makeLog(root, sha, imageBytes) {
  return [
    JSON.stringify({ type: 'session', version: SESSION_VERSION, id: 's1', createdAt: 1, cwd: root, isSeeded: false }),
    JSON.stringify({ type: 'session/title', data: { title: '迁移测试会话' } }),
    JSON.stringify({ type: 'working-directory/change', data: { cwd: join(root, 'src') } }),
    JSON.stringify({
      type: 'user/message',
      data: { content: [{ type: 'image', attachment: { attachmentId: `sha256:${sha}`, mediaType: 'image/png', bytes: imageBytes } }] },
    }),
    JSON.stringify({ type: 'tool/call', data: { arguments: '{"path":"src/a.ts"}' } }),
  ].join('\n') + '\n'
}

/** 在「源设备」临时目录里造一个自洽的迁移包（附件 sha 与真实字节一致）。 */
async function buildBundle() {
  const exportHome = await mkdtemp(join(tmpdir(), 'st-e2e-export-'))
  const root = join(exportHome, 'workspace')
  await mkdir(join(root, 'src'), { recursive: true })
  const imageBytes = Buffer.from('png-bytes-for-session-transfer-e2e')
  const sha = createHash('sha256').update(imageBytes).digest('hex')
  await mkdir(join(exportHome, 'attachments', 'v1', 'objects', sha.slice(0, 2)), { recursive: true })
  await writeFile(join(exportHome, 'attachments', 'v1', 'objects', sha.slice(0, 2), sha), imageBytes)
  const fileBytes = Buffer.from('export const a = 1\n')
  await writeFile(join(root, 'src', 'a.ts'), fileBytes)

  const snapshot = {
    header: { version: SESSION_VERSION, id: 's1', createdAt: 1, cwd: root, isSeeded: false },
    sizeBytes: 128,
  }
  const services = {
    persistence: { list: async () => [snapshot], flush: async () => undefined },
    registry: { list: () => [{ id: 'w1', title: '项目 A', path: root }], archivedSessionIds: [] },
    identity: { resolve: async () => ({ principalId: 'p', organizationId: 'o', requestId: 'r' }) },
  }
  const catalog = {
    currentVersion: SESSION_VERSION,
    readHeader: () => ({ status: 'current' }),
    createRestore: () => ({}),
  }
  const logExport = {
    sessionLogExportDeps: () => ({}),
    flushLiveSessionLog: async () => undefined,
    readSessionLogText: async () => makeLog(root, sha, imageBytes.length),
  }
  const context = {
    ctx: { get: () => undefined, logger: { warn() {} } },
    services, catalog, logExport,
    actor: { principalId: 'p', organizationId: 'o', requestId: 'r' },
    home: exportHome,
  }
  const archive = await exportArchive(context, {
    sessionIds: ['s1'], includeWorkspaceFiles: true, userExcludes: [], archivePolicy: 'preserve',
  })
  return {
    exportHome, imageBytes, sha, fileBytes,
    bytes: await consume(archive.stream),
  }
}

/** 「目标设备」的 mock 运行时：所有落盘副作用都记录下来供断言。 */
function makeImportWorld(importHome, targetRoot, options = {}) {
  const state = { created: [], appended: [], attached: [], archived: [], bound: [], audits: [] }
  const localWorkspace = {
    id: 'local-w1', path: targetRoot, title: '本机工作区',
    attachSession: async (id) => { state.attached.push(id) },
  }
  const existingIds = options.existingIds ?? []
  const gate = options.gate
  const services = {
    persistence: {
      list: async () => existingIds.map((id) => ({
        header: { version: SESSION_VERSION, id, createdAt: 0, cwd: targetRoot, isSeeded: false },
      })),
      stat: async () => undefined,
      open: async () => { throw new Error('导入流程不应调用 open') },
      create: async (header) => {
        if (gate !== undefined) { gate.hit(); await gate.promise }
        state.created.push(header)
        return {
          header,
          append: async (events) => { state.appended.push(...events) },
          flush: async () => undefined,
          close: async () => undefined,
        }
      },
      flush: async () => undefined,
    },
    registry: {
      get: (id) => (id === 'local-w1' ? localWorkspace : undefined),
      list: () => [localWorkspace],
      resolveByPath: async () => localWorkspace,
      create: async () => { throw new Error('本用例复用已有工作区') },
      delete: async () => true,
      archivedSessionIds: [],
      archiveSession: async (id) => { state.archived.push(id) },
      unarchiveSession: async () => undefined,
      pinSession: async () => undefined,
      unpinSession: async () => undefined,
    },
    identity: { resolve: async () => ({ principalId: 'p2', organizationId: 'o2', requestId: 'r2' }) },
    audit: { append: async (event) => { state.audits.push(event) }, flush: async () => undefined },
    access: { bindSession: async (_actor, request) => { state.bound.push(request) } },
  }
  const catalog = {
    currentVersion: SESSION_VERSION,
    readHeader: (headerValue) => ({
      status: 'current', storedVersion: SESSION_VERSION, targetVersion: SESSION_VERSION, header: headerValue,
    }),
    createRestore: (headerValue) => {
      const rows = []
      return {
        header: headerValue,
        decodeRow: (row) => { rows.push(row) },
        finish: () => ({ header: headerValue, events: rows, inheritedEventCount: 0 }),
      }
    },
  }
  const jobs = new JobStore(importHome)
  const context = {
    ctx: { get: () => undefined, logger: { warn() {} } },
    services, catalog, jobs,
    actor: { principalId: 'p2', organizationId: 'o2', requestId: 'r2' },
    home: importHome,
  }
  return { context, state, jobs }
}

function applyRequest(preview) {
  return {
    token: preview.token,
    decisions: [{ sessionId: 's1', importAsNew: true, targetWorkspaceId: 'w1' }],
    mapping: preview.workspaces,
    archivePolicy: 'preserve',
  }
}

async function withImportDevice(run) {
  const bundle = await buildBundle()
  const importHome = await mkdtemp(join(tmpdir(), 'st-e2e-import-'))
  const targetRoot = join(importHome, 'target-workspace')
  try {
    return await run({ bundle, importHome, targetRoot })
  } finally {
    await rm(importHome, { recursive: true, force: true })
    await rm(bundle.exportHome, { recursive: true, force: true })
  }
}

test('完整链路：导出包 → 预览 → 落盘，会话/附件/源文件/归属绑定/审计全部生效', async () => {
  await withImportDevice(async ({ bundle, importHome, targetRoot }) => {
    const { context, state, jobs } = makeImportWorld(importHome, targetRoot)
    const preview = await importPreview(context, new Blob([bundle.bytes]).stream())

    assert.equal(preview.rejection, undefined)
    assert.ok(preview.token.length > 0)
    assert.equal(preview.summary.sessionCount, 1)
    assert.equal(preview.summary.workspaceCount, 1)
    assert.equal(preview.summary.attachmentCount, 1)
    assert.equal(preview.summary.filesIncluded, true)
    assert.equal(preview.versionVerdict, 'current')
    assert.equal(preview.targetDirStatus, 'ok')
    assert.deepEqual(preview.conflicts, [])
    assert.equal(preview.localWorkspaces.length, 1)
    assert.equal(preview.workspaces[0].status, 'matched')

    const batchId = await importApply(context, applyRequest(preview))
    const status = await waitForBatch(jobs, batchId)
    assert.equal(status.state, 'done', JSON.stringify(status.error))
    assert.equal(status.percent, 100)

    // 会话头 cwd 改写为目标工作区根（attachSession 的硬约束）
    assert.equal(state.created.length, 1)
    assert.equal(state.created[0].id, 's1')
    assert.equal(state.created[0].cwd, targetRoot)

    // 只改结构化 cwd；事件文本里的路径字符串原样保留（红线 2）
    const cwdEvent = state.appended.find((event) => event.type === 'working-directory/change')
    assert.equal(cwdEvent.data.cwd, join(targetRoot, 'src'))
    const toolEvent = state.appended.find((event) => event.type === 'tool/call')
    assert.equal(toolEvent.data.arguments, '{"path":"src/a.ts"}')

    // 附件按 sha 内容寻址回写；工作区源文件还原
    assert.deepEqual(
      await readFile(join(importHome, 'attachments', 'v1', 'objects', bundle.sha.slice(0, 2), bundle.sha)),
      bundle.imageBytes,
    )
    assert.deepEqual(await readFile(join(targetRoot, 'src', 'a.ts')), bundle.fileBytes)

    assert.deepEqual(state.attached, ['s1'])
    assert.deepEqual(state.bound, [{ sessionId: 's1', workspaceId: 'local-w1' }])
    assert.equal(state.audits.length, 1)
    assert.equal(state.audits[0].action, 'session.transfer.import')

    assert.equal(status.result.length, 1)
    assert.equal(status.result[0].status, 'imported')
    assert.equal(status.result[0].attachmentsRestored, 1)
    assert.equal(status.result[0].attachmentsSkipped, 0)
    assert.equal(status.result[0].filesRestored, 1)
  })
})

test('同 ID 冲突：整组重映射新 ID、标题追加（导入）、绑定用新 ID', async () => {
  await withImportDevice(async ({ bundle, importHome, targetRoot }) => {
    const { context, state, jobs } = makeImportWorld(importHome, targetRoot, { existingIds: ['s1'] })
    const preview = await importPreview(context, new Blob([bundle.bytes]).stream())
    assert.deepEqual(preview.conflicts, ['s1'])
    assert.equal(preview.sessions[0].conflict, true)

    const batchId = await importApply(context, applyRequest(preview))
    const status = await waitForBatch(jobs, batchId)
    assert.equal(status.state, 'done', JSON.stringify(status.error))

    const newId = state.created[0].id
    assert.match(newId, /^s1-import-[0-9a-f]{8}$/u)
    const titleEvent = state.appended.find((event) => event.type === 'session/title')
    assert.equal(titleEvent.data.title, '迁移测试会话（导入）')
    assert.ok(status.result[0].title.endsWith('（导入）'))
    assert.equal(status.result[0].sessionId, newId)
    assert.deepEqual(state.attached, [newId])
    assert.deepEqual(state.bound, [{ sessionId: newId, workspaceId: 'local-w1' }])
  })
})

test('中途取消：状态 cancelled、不绑定 owner、不写审计、不残留附件对象', async () => {
  await withImportDevice(async ({ bundle, importHome, targetRoot }) => {
    let release
    const gatePromise = new Promise((resolve) => { release = resolve })
    let hit = false
    const { context, state, jobs } = makeImportWorld(importHome, targetRoot, {
      gate: { hit: () => { hit = true }, promise: gatePromise },
    })
    const preview = await importPreview(context, new Blob([bundle.bytes]).stream())
    const batchId = await importApply(context, applyRequest(preview))

    const start = Date.now()
    while (!hit) {
      if (Date.now() - start > 5000) throw new Error('批次未到达会话落盘阶段')
      await sleep(5)
    }
    assert.equal(jobs.requestCancel(batchId), true)
    assert.equal(jobs.requestCancel(batchId), false, '重复取消应幂等返回 false')
    release()

    const status = await waitForBatch(jobs, batchId)
    assert.equal(status.state, 'cancelled')
    assert.deepEqual(status.result, [])
    assert.equal(state.bound.length, 0)
    assert.equal(state.audits.length, 0)
    // 阶段边界的取消检查点阻止了附件回写
    await assert.rejects(
      () => readFile(join(importHome, 'attachments', 'v1', 'objects', bundle.sha.slice(0, 2), bundle.sha)),
      { code: 'ENOENT' },
    )
  })
})
