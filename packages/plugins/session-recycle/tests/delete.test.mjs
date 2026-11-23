import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  directoryBytes,
  locateSessionDirectories,
  rollbackDirectories,
  stageDirectories,
  subagentCascade,
} from '../dist/delete.js'

const snapshot = (id, parentSession, origin) => ({
  header: { id, ...(parentSession === undefined ? {} : { parentSession }), ...(origin === undefined ? {} : { origin }) },
})

test('级联只包含 subagent 后代，分叉会话不级联', () => {
  const snapshots = [
    snapshot('root'),
    snapshot('child', 'root', 'subagent'),
    snapshot('grandchild', 'child', 'subagent'),
    snapshot('fork', 'root'),
    snapshot('unrelated', 'other', 'subagent'),
  ]
  assert.deepEqual(subagentCascade('root', snapshots), ['root', 'child', 'grandchild'])
  assert.deepEqual(subagentCascade('fork', snapshots), ['fork'])
  assert.deepEqual(subagentCascade('missing', snapshots), ['missing'])
})

test('目录定位跨工作区分组，且根目录缺失时返回空', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workdsh-recycle-'))
  try {
    await mkdir(join(root, 'project-a', 'session-a'), { recursive: true })
    await mkdir(join(root, 'project-b', 'session-a'), { recursive: true })
    await mkdir(join(root, 'project-b', 'session-b'), { recursive: true })
    const found = await locateSessionDirectories(root, 'session-a')
    assert.deepEqual(found, [join(root, 'project-a', 'session-a'), join(root, 'project-b', 'session-a')].sort())
    assert.deepEqual(await locateSessionDirectories(root, 'session-c'), [])
    assert.deepEqual(await locateSessionDirectories(join(root, 'absent'), 'session-a'), [])
    await assert.rejects(() => locateSessionDirectories(root, '../escape'), /Invalid session id/u)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('整批移动写清单，字节数与目录一致', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workdsh-recycle-'))
  try {
    const from = join(root, 'sessions', 'project-a', 'session-a')
    await mkdir(from, { recursive: true })
    await writeFile(join(from, 'session.v4.jsonl.zstd'), 'x'.repeat(16))
    const batch = join(root, '.workdsh-trash', 'batch-1')
    const entry = { id: 'session-a', from, to: join(batch, 'session-a'), bytes: await directoryBytes(from) }
    assert.equal(entry.bytes, 16)
    await stageDirectories(batch, [entry])
    assert.equal((await stat(entry.to)).isDirectory(), true)
    await assert.rejects(() => stat(entry.from))
    const manifest = JSON.parse(await readFile(join(batch, 'manifest.json'), 'utf8'))
    assert.equal(manifest.entries[0].id, 'session-a')
    assert.equal(manifest.entries[0].bytes, 16)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('中途移动失败时整批移回原位并清理批次目录', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workdsh-recycle-'))
  try {
    const first = join(root, 'sessions', 'project-a', 'session-a')
    const second = join(root, 'sessions', 'project-a', 'session-b')
    await mkdir(first, { recursive: true })
    await mkdir(second, { recursive: true })
    await writeFile(join(first, 'a.bin'), 'a')
    await writeFile(join(second, 'b.bin'), 'b')
    const batch = join(root, '.workdsh-trash', 'batch-2')
    const entries = [
      { id: 'session-a', from: first, to: join(batch, 'session-a'), bytes: 1 },
      { id: 'session-b', from: second, to: join(batch, 'session-b'), bytes: 1 },
    ]
    let calls = 0
    const rename = async (from, to) => {
      calls += 1
      if (calls === 2) throw new Error('disk busy')
      const { rename: actual } = await import('node:fs/promises')
      await actual(from, to)
    }
    await assert.rejects(() => stageDirectories(batch, entries, rename), /disk busy/u)
    assert.equal((await stat(first)).isDirectory(), true)
    assert.equal((await stat(second)).isDirectory(), true)
    await assert.rejects(() => stat(batch))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('回滚按逆序移动且忽略单条失败', async () => {
  const order = []
  await rollbackDirectories([
    { id: 'a', from: '/from/a', to: '/to/a', bytes: 0 },
    { id: 'b', from: '/from/b', to: '/to/b', bytes: 0 },
  ], async (from, to) => {
    order.push(`${from}->${to}`)
    if (from === '/to/b') throw new Error('ignored')
  })
  assert.deepEqual(order, ['/to/b->/from/b', '/to/a->/from/a'])
})
