import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { installHttpLog } from '../dist/http-log.js'

const wait = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms))

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
})

const today = () => {
  const now = new Date()
  const pad = value => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/** 安装日志、替换全局 fetch，结束后完整还原。 */
async function withLog(options, run) {
  const directory = await mkdtemp(join(tmpdir(), 'workdsh-http-log-'))
  const original = globalThis.fetch
  let respond = async () => json({ ok: true })
  globalThis.fetch = (...args) => respond(...args)
  const uninstall = installHttpLog(directory, options)
  const read = async () => {
    try {
      return await readFile(join(directory, `host-http-${today()}.log`), 'utf8')
    } catch {
      return ''
    }
  }
  try {
    await run({ read, respond: next => { respond = next } })
  } finally {
    uninstall()
    globalThis.fetch = original
    await rm(directory, { recursive: true, force: true })
  }
}

test('请求行在发请求前落盘，响应到达后补记', async () => {
  await withLog({}, async ({ read, respond }) => {
    let release
    respond(() => new Promise(resolve => { release = () => resolve(json({ ok: true })) }))
    const pending = globalThis.fetch('http://127.0.0.1:18080/ytsj-ai/desktop-client/asset/queryGatePolicy')
    await wait(10)
    const early = await read()
    assert.match(early, /#1 -> GET .*queryGatePolicy/u)
    assert.doesNotMatch(early, /#1 <- /u)
    release()
    await pending
    await wait(20)
    assert.match(await read(), /#1 <- 200 application\/json/u)
  })
})

test('/auth/me 按窗口采样且记录完整，其他接口逐条记录', async () => {
  await withLog({}, async ({ read }) => {
    for (let index = 0; index < 4; index += 1) await globalThis.fetch('http://127.0.0.1:58817/auth/me')
    await globalThis.fetch('http://127.0.0.1:18080/ytsj-ai/desktop-client/asset/queryGatePolicy')
    await globalThis.fetch('http://127.0.0.1:18080/ytsj-ai/desktop-client/asset/queryGatePolicy')
    await wait(30)
    const text = await read()
    assert.equal((text.match(/ -> GET \S*\/auth\/me$/gmu) ?? []).length, 1)
    assert.equal((text.match(/ <- 200 application\/json/gmu) ?? []).length, 3)
    assert.match(text, /#1 -> GET \S*\/auth\/me\n {2}headers: /u)
    assert.match(text, /#1 <- 200 application\/json · \d+ms\n {2}headers: [^\n]+\n {2}body: \{"ok":true\}/u)
    assert.equal((text.match(/ -> GET \S*queryGatePolicy$/gmu) ?? []).length, 2)
  })
})

test('超过慢阈值的响应标记告警', async () => {
  await withLog({ slowMs: 20 }, async ({ read, respond }) => {
    respond(async () => {
      await wait(60)
      return json({ ok: true })
    })
    await globalThis.fetch('http://127.0.0.1:18080/ytsj-ai/desktop-client/asset/queryGatePolicy')
    await wait(80)
    assert.match(await read(), /⚠ 慢请求\(>20ms\)/u)
  })
})

test('失败请求同时留下请求行与错误信息', async () => {
  await withLog({}, async ({ read, respond }) => {
    respond(async () => { throw new TypeError('fetch failed') })
    await assert.rejects(globalThis.fetch('http://127.0.0.1:18080/ytsj-ai/desktop-client/asset/queryGatePolicy'))
    await wait(20)
    const text = await read()
    assert.match(text, /#1 -> GET .*queryGatePolicy/u)
    assert.match(text, /#1 !! GET .*queryGatePolicy · \d+ms/u)
    assert.match(text, /^ {2}error: TypeError: fetch failed$/mu)
  })
})
