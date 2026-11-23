import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { apply } from '../dist/index.js'

const PATH = '/api/workdsh-session-delete'
const header = (id, parentSession, origin) => ({
  header: {
    id,
    createdAt: 0,
    isSeeded: false,
    ...(parentSession === undefined ? {} : { parentSession }),
    ...(origin === undefined ? {} : { origin }),
  },
})

/** 最小 Host 组合：只实现删除流程实际读取的服务。 */
async function fixture({ snapshots, live = [], visible, enterprise = false }) {
  const home = await mkdtemp(join(tmpdir(), 'workdsh-recycle-host-'))
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = home
  const root = join(home, 'sessions')
  const visibleOf = visible ?? ((id) => existsSync(join(root, 'project-a', id)))
  const rows = new Map(snapshots.map((entry) => [entry.header.id, entry]))
  const calls = { unpin: [], unarchive: [], audit: [] }
  const routes = new Map()
  const services = {
    workdshIdentity: {
      resolve: async () => ({ principalId: 'principal', organizationId: 'org', requestId: 'request' }),
      profile: () => ({ organization: { kind: enterprise ? 'team' : 'personal' } }),
    },
    sessionPersistence: {
      stat: async (id) => rows.has(id) && visibleOf(id) ? rows.get(id) : undefined,
      list: async () => [...rows.values()],
      open: async (id) => ({
        header: rows.get(id).header,
        close: async () => undefined,
      }),
    },
    sessions: { get: (id) => live.includes(id) ? { id } : undefined },
    workspaceRegistry: {
      unpinSession: async (id) => { calls.unpin.push(id) },
      unarchiveSession: async (id) => { calls.unarchive.push(id) },
    },
    workdshAudit: { append: async (event) => { calls.audit.push(event) } },
  }
  const ctx = {
    connection: { fetch: { register: (route) => { routes.set(route.path, route); return () => undefined } } },
    effect: (callback) => { callback() },
    provide: () => undefined,
    get: (name) => services[name],
    logger: { warn: () => undefined },
  }
  apply(ctx)
  const write = async (id) => {
    const directory = join(root, 'project-a', id)
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'session.v4.jsonl.zstd'), id)
  }
  for (const id of rows.keys()) await write(id)
  return {
    home,
    root,
    routes,
    calls,
    write,
    async close() {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
      await rm(home, { recursive: true, force: true })
    },
  }
}

const post = (sessionId) => new Request(`http://127.0.0.1${PATH}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ sessionId }),
})

test('删除主会话时级联子智能体会话，分叉会话保留', async () => {
  const app = await fixture({
    snapshots: [header('root'), header('child', 'root', 'subagent'), header('fork', 'root')],
  })
  try {
    const response = await app.routes.get(PATH).fetch(post('root'))
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.deepEqual(body.subagents, ['child'])
    assert.equal(body.deleted, true)
    assert.equal(body.bytes, 'root'.length + 'child'.length)
    assert.deepEqual(await readdir(join(app.root, 'project-a')), ['fork'])
    assert.deepEqual(app.calls.unpin, ['root', 'child'])
    assert.deepEqual(app.calls.unarchive, ['root', 'child'])
    assert.equal(app.calls.audit[0].action, 'session.delete')
    assert.equal(app.calls.audit[0].references.subagents, '1')
    assert.equal(existsSync(join(app.home, '.workdsh-trash')), true)
    assert.deepEqual(await readdir(join(app.home, '.workdsh-trash')), [])
  } finally {
    await app.close()
  }
})

test('正在使用的会话拒绝删除且磁盘保持原样', async () => {
  const app = await fixture({ snapshots: [header('root')], live: ['root'] })
  try {
    const response = await app.routes.get(PATH).fetch(post('root'))
    assert.equal(response.status, 409)
    assert.equal((await response.json()).error.code, 'session/live')
    assert.deepEqual(await readdir(join(app.root, 'project-a')), ['root'])
  } finally {
    await app.close()
  }
})

test('删除后会话服务仍可见时整批回滚', async () => {
  const app = await fixture({ snapshots: [header('root')], visible: () => true })
  try {
    const response = await app.routes.get(PATH).fetch(post('root'))
    assert.equal(response.status, 500)
    assert.equal((await response.json()).error.code, 'session/delete-failed')
    assert.equal(existsSync(join(app.root, 'project-a', 'root')), true)
    assert.deepEqual(await readdir(join(app.home, '.workdsh-trash')), [])
  } finally {
    await app.close()
  }
})

test('确认弹窗读取个人/企业模式', async () => {
  const personal = await fixture({ snapshots: [] })
  const team = await fixture({ snapshots: [], enterprise: true })
  try {
    const read = async (app) => (await app.routes.get(PATH).fetch(new Request(`http://127.0.0.1${PATH}?mode=1`))).json()
    assert.deepEqual(await read(personal), { enterprise: false })
    assert.deepEqual(await read(team), { enterprise: true })
  } finally {
    await personal.close()
    await team.close()
  }
})
