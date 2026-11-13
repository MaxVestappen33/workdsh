import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { redactLogFile, redactLogLine, redactText, redactUrl } from '../dist/redact.js'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '../../../../')

const collect = async (chunks) => {
  const parts = []
  for await (const chunk of chunks) parts.push(Buffer.from(chunk))
  return Buffer.concat(parts)
}

test('令牌、Bearer、sk- 字面量都会被 [redacted] 打码', () => {
  assert.equal(redactLogLine('dsh web: http://127.0.0.1:3080/?token=SECRET123&x=1'), 'dsh web: http://127.0.0.1:3080/?token=[redacted]&x=1')
  assert.equal(redactLogLine('Authorization: Bearer abc.def'), 'Authorization: Bearer [redacted]')
  assert.equal(redactLogLine('key=sk-abcdefgh12345678'), 'key=[redacted]')
  assert.equal(redactLogLine('keyword=prompt_tokens'), 'keyword=prompt_tokens')
})

test('重复脱敏保持幂等，已打码的 token=[redacted] 不会被二次拼接', () => {
  const once = redactLogLine('dsh web: http://127.0.0.1:3080/?token=SECRET123&x=1')
  assert.equal(once, 'dsh web: http://127.0.0.1:3080/?token=[redacted]&x=1')
  assert.equal(redactLogLine(once), once)
})

test('超过 16 KB 的单行不被丢弃，只替换凭据', () => {
  const long = `prefix ${'a'.repeat(20000)} http://x/?token=SECRET123 tail`
  const out = redactLogLine(long)
  assert.equal(out.length, long.length - 'SECRET123'.length + '[redacted]'.length)
  assert.ok(out.startsWith('prefix aaaa'))
  assert.ok(out.includes('token=[redacted]'))
  assert.ok(out.includes('tail'))
  assert.ok(!out.includes('SECRET123'))
})

test('流式逐行处理：行数不丢、换行与 CRLF 原样、跨 64 KB 的多字节字符不损坏', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'diag-redact-'))
  try {
    const file = join(dir, 'host-output-2026-11-13.log')
    // 64 KB 边界前后放 CJK，构造跨 chunk 的多字节字符
    const head = 'x'.repeat(65535)
    const body = `${head}中\nline2 url=http://x/?token=SECRET123\r\n${'b'.repeat(20000)}\n`
    writeFileSync(file, body, 'utf8')
    const out = (await collect(redactLogFile(file))).toString('utf8')
    const lines = out.split('\n')
    assert.equal(lines.length, body.split('\n').length)
    assert.ok(out.includes('中'))
    assert.ok(out.includes('token=[redacted]'))
    assert.ok(!out.includes('SECRET123'))
    assert.ok(out.includes('\r\n'))
    assert.ok(out.includes('b'.repeat(20000)))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('与 bundle 的 redactText / redactUrl 逐项一致', async () => {
  const require = createRequire(join(repoRoot, 'apps/web/package.json'))
  const esbuild = require('esbuild')
  const outfile = join(tmpdir(), `http-log-${process.pid}.mjs`)
  await esbuild.build({
    entryPoints: [join(repoRoot, 'packages/bundle/src/http-log.ts')],
    outfile,
    bundle: false,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    logLevel: 'silent',
  })
  const canonical = await import(pathToFileURL(outfile).href)
  const corpus = [
    'Authorization: Bearer abc.def',
    'key=sk-abcdefgh12345678',
    'jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghij',
    'http://127.0.0.1:3080/?token=SECRET&accessKey=K&keyword=ok',
    'https://x.test/path?a=1&api_key=K&signature=S',
    'plain text with keyword=prompt_tokens',
  ]
  for (const value of corpus) {
    // 规则一致；仅占位符不同（bundle 用 ***，导出期用 [redacted]）
    assert.equal(redactText(value), canonical.redactText(value).replaceAll('***', '[redacted]'), value)
    assert.equal(redactUrl(value), canonical.redactUrl(value).replaceAll('***', '[redacted]'), value)
  }
})
