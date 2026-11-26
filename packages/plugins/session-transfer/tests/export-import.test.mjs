import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { exportArchive } from '../dist/export.js'
import { writeUploadTo, extractZipTo, memberPath } from '../dist/zip.js'
import { parseManifest, crossCheckMembers } from '../dist/manifest.js'

const SHA = 'c'.repeat(64)

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

function logText(root) {
  return [
    JSON.stringify({ type: 'session', version: 4, id: 's1', createdAt: 1, cwd: root, isSeeded: false }),
    JSON.stringify({ type: 'session/title', data: { title: '迁移测试会话' } }),
    JSON.stringify({
      type: 'user/message',
      data: { content: [{ type: 'image', attachment: { attachmentId: `sha256:${SHA}`, mediaType: 'image/png', bytes: 5 } }] },
    }),
    JSON.stringify({ type: 'tool/call', data: { arguments: '{"path":"src/a.ts"}' } }),
  ].join('\n') + '\n'
}

test('exportArchive produces a self-consistent package that import validation accepts', async () => {
  const home = await mkdtemp(join(tmpdir(), 'session-transfer-export-'))
  const root = join(home, 'workspace')
  try {
    await mkdir(join(root, 'src'), { recursive: true })
    await mkdir(join(home, 'attachments', 'v1', 'objects', SHA.slice(0, 2)), { recursive: true })
    const fileBytes = Buffer.from('export const a = 1\n')
    await writeFile(join(root, 'src', 'a.ts'), fileBytes)
    await writeFile(join(home, 'attachments', 'v1', 'objects', SHA.slice(0, 2), SHA), 'image')

    const snapshot = { header: { version: 4, id: 's1', createdAt: 1, cwd: root, isSeeded: false }, sizeBytes: 128 }
    const workspaces = [{ id: 'w1', title: '项目 A', path: root }]
    const services = {
      persistence: {
        list: async () => [snapshot],
        flush: async () => undefined,
      },
      registry: {
        list: () => workspaces,
        archivedSessionIds: [],
      },
      identity: { resolve: async () => ({ principalId: 'p', organizationId: 'o', requestId: 'r' }) },
    }
    const catalog = { currentVersion: 4, readHeader: () => ({ status: 'current' }), createRestore: () => ({}) }
    const logExport = {
      sessionLogExportDeps: () => ({}),
      flushLiveSessionLog: async () => undefined,
      readSessionLogText: async () => logText(root),
    }
    const context = {
      ctx: { get: () => undefined, logger: { warn() {} } },
      services, catalog, logExport,
      actor: { principalId: 'p', organizationId: 'o', requestId: 'r' },
      home,
    }

    const progress = []
    const archive = await exportArchive(
      context,
      { sessionIds: ['s1'], includeWorkspaceFiles: true, userExcludes: [], archivePolicy: 'preserve' },
      undefined,
      (info) => progress.push(info.phase),
    )
    const bytes = await consume(archive.stream)
    assert.ok(bytes.byteLength > 0)
    assert.ok(progress.includes('logs'))
    assert.ok(progress.includes('attachments'))
    assert.ok(progress.includes('workspace-files'))

    const zipPath = join(home, 'bundle.zip')
    await writeUploadTo(new Blob([bytes]).stream(), zipPath)
    const extract = await extractZipTo(zipPath, join(home, 'content'))
    const manifestText = await readFile(memberPath(join(home, 'content'), extract.wrapper, 'manifest.json'), 'utf8')
    const manifest = parseManifest(manifestText)

    // 关键：manifest 声明的每个成员都必须真实存在（导入端会做同样校验）。
    assert.doesNotThrow(() => crossCheckMembers(manifest, new Set(extract.members.keys())))
    assert.equal(manifest.sessions.length, 1)
    assert.equal(manifest.attachments.length, 1)
    assert.equal(manifest.workspaceFiles.files.length, 1)
    assert.equal(manifest.workspaceFiles.files[0].sha256, createHash('sha256').update(fileBytes).digest('hex'))
    assert.equal(manifest.format.sessionVersion, 4)

    // readManifest() 返回与实际 ZIP 内容一致的版本（供导出审计使用）。
    assert.deepEqual(archive.readManifest().workspaceFiles.files, manifest.workspaceFiles.files)
    assert.equal(
      await readFile(memberPath(join(home, 'content'), extract.wrapper, manifest.sessions[0].logName), 'utf8'),
      logText(root),
    )
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
