import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zipStream, writeUploadTo, extractZipTo, memberPath } from '../dist/zip.js'
import { collectAttachmentsFromLog, collectFileReferences, subagentCascade, expandSelection } from '../dist/collect.js'
import { collectWorkspaceFiles, restoreWorkspaceFiles, effectiveExcludes, targetDirState } from '../dist/workspace-files.js'
import { JobStore, progressPercent } from '../dist/jobs.js'

async function withTemp(run) {
  const directory = await mkdtemp(join(tmpdir(), 'session-transfer-test-'))
  try { return await run(directory) } finally { await rm(directory, { recursive: true, force: true }) }
}

async function streamToBuffer(stream) {
  const chunks = []
  const reader = stream.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(Buffer.from(value))
  }
  return Buffer.concat(chunks)
}

test('zipStream -> writeUploadTo -> extractZipTo round-trips every member', async () => {
  await withTemp(async (directory) => {
    const payload = {
      'manifest.json': JSON.stringify({ kind: 'workdsh-session-transfer', schema: 2 }),
      'sessions/s1.jsonl': '{"type":"session","version":4,"id":"s1"}\n',
      'workspace/w1/src/a.txt': 'hello world',
    }
    const archivePath = join(directory, 'bundle.zip')
    const contentRoot = join(directory, 'content')
    const buffer = await streamToBuffer(zipStream((async function* () {
      for (const [path, content] of Object.entries(payload)) yield { path, content }
    })()))
    const written = await writeUploadTo(new Blob([buffer]).stream(), archivePath)
    assert.equal(written, buffer.byteLength)
    const extract = await extractZipTo(archivePath, contentRoot)
    assert.equal(extract.wrapper, '')
    for (const [name, content] of Object.entries(payload)) {
      assert.equal(extract.members.has(name), true, `missing ${name}`)
      assert.equal(await readFile(memberPath(contentRoot, extract.wrapper, name), 'utf8'), content)
    }
  })
})

test('extractZipTo refuses unsafe members (zip-slip) instead of writing outside', async () => {
  await withTemp(async (directory) => {
    const archivePath = join(directory, 'evil.zip')
    const buffer = await streamToBuffer(zipStream((async function* () {
      yield { path: '../escaped.txt', content: 'bad' }
    })()))
    await writeUploadTo(new Blob([buffer]).stream(), archivePath)
    await assert.rejects(() => extractZipTo(archivePath, join(directory, 'content')), /unsafe member/u)
  })
})

test('collectAttachmentsFromLog keeps the full AttachmentRefV2 from content blocks', () => {
  const sha = 'b'.repeat(64)
  const log = [
    JSON.stringify({ type: 'session', version: 4, id: 's1' }),
    JSON.stringify({
      type: 'user/message',
      data: { content: [{ type: 'image', attachment: { attachmentId: `sha256:${sha}`, mediaType: 'image/png', bytes: 42, width: 8, height: 9 } }] },
    }),
    JSON.stringify({ type: 'assistant/message', data: { content: [{ type: 'text', text: 'ok' }] } }),
  ].join('\n')
  const refs = collectAttachmentsFromLog(log)
  assert.equal(refs.size, 1)
  assert.equal(refs.get(`sha256:${sha}`).kind, 'image')
  assert.equal(refs.get(`sha256:${sha}`).width, 8)
  assert.equal(refs.get(`sha256:${sha}`).bytes, 42)
})

test('collectFileReferences only keeps references inside a workspace root', () => {
  const workspaces = [{ id: 'w1', path: '/home/u/proj' }]
  const log = [
    JSON.stringify({ type: 'session', version: 4, id: 's1' }),
    JSON.stringify({ type: 'tool/call', data: { arguments: '{"path":"/home/u/proj/src/a.ts"}' } }),
    JSON.stringify({ type: 'tool/call', data: { arguments: '{"path":"/etc/passwd"}' } }),
  ].join('\n')
  const result = collectFileReferences(log, workspaces)
  assert.equal(result.references.length, 1)
  assert.equal(result.references[0].relative, 'src/a.ts')
  assert.equal(result.references[0].workspaceId, 'w1')
  assert.ok(result.skipped.length > 0)
})

test('tool/call 参数是转义 JSON 时，Windows 绝对路径也能解析为工作区相对路径', () => {
  const wsPath = 'C:\\Users\\www\\AppData\\Roaming\\PoliceAssistant\\workspace\\default-workspace'
  const target = `${wsPath}\\测试word.docx`
  const log = [
    JSON.stringify({ type: 'session', version: 4, id: 's1' }),
    JSON.stringify({
      type: 'tool/call',
      data: {
        arguments: JSON.stringify({
          description: 'copy attachment into workspace',
          command: `$file = "C:\\Users\\www\\attachments\\v1\\files\\ff\\测试word.docx"\nCopy-Item $file "${target}" -Force`,
        }),
      },
    }),
  ].join('\n')
  const { references } = collectFileReferences(log, [{ id: 'w1', path: wsPath }])
  assert.deepEqual(references.map((ref) => ref.relative), ['测试word.docx'])
})

test('deliverables/presented 的结构化产物路径也会进入工作区文件收集', () => {
  const wsPath = '/home/u/proj'
  const log = [
    JSON.stringify({ type: 'session', version: 4, id: 's1' }),
    JSON.stringify({ type: 'deliverables/presented', data: { files: [{ path: `${wsPath}/out/report.docx` }] } }),
  ].join('\n')
  const { references } = collectFileReferences(log, [{ id: 'w1', path: wsPath }])
  assert.deepEqual(references.map((ref) => ref.relative), ['out/report.docx'])
})

test('subagentCascade and expandSelection keep parent before child', () => {
  const snapshots = [
    { header: { id: 'root', version: 4, createdAt: 1, isSeeded: false } },
    { header: { id: 'child', version: 4, createdAt: 2, isSeeded: false, parentSession: 'root', origin: 'subagent' } },
    { header: { id: 'other', version: 4, createdAt: 3, isSeeded: false } },
  ]
  assert.deepEqual(subagentCascade('root', snapshots), ['root', 'child'])
  assert.deepEqual(expandSelection(['child'], snapshots), ['root', 'child'])
  assert.deepEqual(expandSelection(['other'], snapshots), ['other'])
})

test('workspace files are sha-verified, excluded by built-in rules and restored without overwrite', async () => {
  await withTemp(async (directory) => {
    const root = join(directory, 'workspace')
    const target = join(directory, 'target')
    await mkdir(join(root, 'src'), { recursive: true })
    await mkdir(join(root, 'node_modules'), { recursive: true })
    await mkdir(target, { recursive: true })
    const bytes = Buffer.from('const a = 1\n')
    await writeFile(join(root, 'src', 'a.ts'), bytes)
    await writeFile(join(root, 'node_modules', 'dep.js'), 'dep')
    await writeFile(join(root, '.env'), 'SECRET=1')
    const sha = createHash('sha256').update(bytes).digest('hex')

    const collected = await collectWorkspaceFiles(
      [
        { workspaceId: 'w1', relative: 'src/a.ts', raw: 'src/a.ts' },
        { workspaceId: 'w1', relative: 'node_modules/dep.js', raw: 'node_modules/dep.js' },
        { workspaceId: 'w1', relative: '.env', raw: '.env' },
        { workspaceId: 'w1', relative: 'missing.ts', raw: 'missing.ts' },
      ],
      new Map([['w1', root]]),
      [],
    )
    assert.equal(collected.files.length, 1)
    assert.equal(collected.files[0].sha256, sha)
    assert.equal(collected.skipped.length, 3)
    assert.deepEqual(effectiveExcludes(['*.log']).recorded.slice(-1), ['*.log'])

    const staging = join(directory, 'staging')
    await mkdir(staging, { recursive: true })
    const restored = await restoreWorkspaceFiles(
      collected.files,
      async (entry) => readFile(join(root, ...entry.path.split('/'))),
      new Map([['w1', target]]),
      staging,
    )
    assert.equal(restored.restored, 1)
    assert.equal(restored.written.length, 1)
    assert.equal(await readFile(join(target, 'src', 'a.ts'), 'utf8'), String(bytes))
    assert.equal(await targetDirState(target), 'not-empty')
  })
})

test('JobStore tracks preview tokens, batches and cancellation', async () => {
  await withTemp(async (directory) => {
    const jobs = new JobStore(directory)
    assert.equal(jobs.transferRoot, join(directory, '.workdsh-transfer'))
    const previewDirectory = await jobs.createPreviewDirectory()
    assert.ok(previewDirectory.startsWith(jobs.transferRoot))
    const preview = jobs.putPreview({
      directory: previewDirectory, archivePath: join(previewDirectory, 'bundle.zip'),
      extract: { members: new Map(), wrapper: '' }, manifest: {}, logTexts: new Map(),
    })
    assert.equal(jobs.takePreview(preview.token)?.token, preview.token)
    assert.equal(jobs.takePreview('missing'), undefined)

    const batch = jobs.createBatch(3)
    assert.equal(batch.status.state, 'running')
    assert.equal(batch.status.cancellable, true)
    assert.equal(jobs.requestCancel(batch.batchId), true)
    assert.equal(batch.controller.signal.aborted, true)
    assert.equal(jobs.requestCancel(batch.batchId), false)
    assert.equal(progressPercent(1, 3), 33)
    assert.equal(progressPercent(9, 9), 99)
    jobs.sweep()
    await jobs.dropPreview(preview.token)
  })
})

test('工作区路径含空格/中文时，仍能收集到工作区内文件引用', async () => {
  await withTemp(async (root) => {
    const wsPath = join(root, '默认 工作区')
    await mkdir(join(wsPath, 'sub dir'), { recursive: true })
    await writeFile(join(wsPath, 'make_nba_report.py'), 'print(1)\n')
    await writeFile(join(wsPath, 'sub dir', '报告 一.docx'), 'x')
    const log = [
      JSON.stringify({ type: 'session' }),
      JSON.stringify({ type: 'tool/result', data: { result: { path: join(wsPath, 'make_nba_report.py') } } }),
      JSON.stringify({ type: 'user/message', data: { content: `见 ${join(wsPath, 'sub dir', '报告 一.docx')}，注意格式` } }),
      JSON.stringify({ type: 'tool/result', data: { result: { path: join(wsPath, 'missing.py') } } }),
    ].join('\n')
    const { references } = collectFileReferences(log, [{ id: 'w1', path: wsPath }])
    const relatives = references.map((ref) => ref.relative).sort()
    assert.deepEqual(relatives, ['make_nba_report.py', 'sub dir/报告 一.docx'])
  })
})

test('工具输出写在 data.message.content 文本里的绝对路径也能收集', async () => {
  await withTemp(async (root) => {
    const wsPath = join(root, '应用 工作区')
    await mkdir(join(wsPath, 'out'), { recursive: true })
    await writeFile(join(wsPath, 'out', '报表 一.docx'), 'x')
    const log = [
      JSON.stringify({
        type: 'tool/result',
        data: { turn: 1, step: 2, message: { role: 'tool', content: [{ type: 'text', text: `Presented ${join(wsPath, 'out', '报表 一.docx')}\nsaved: 报表 一.docx` }] } },
      }),
    ].join('\n')
    const { references } = collectFileReferences(log, [{ id: 'w1', path: wsPath }])
    assert.ok(references.some((ref) => ref.relative === 'out/报表 一.docx'), JSON.stringify(references))
  })
})
