import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildManifest, parseManifest, crossCheckMembers, checkSessionLogHeader,
} from '../dist/manifest.js'
import { MANIFEST_SCHEMA, TRANSFER_KIND } from '../dist/types.js'

const emptyWorkspaceFiles = {
  included: false,
  policy: 'referenced-relative-only',
  excludes: ['.env', '*.pem'],
  userExcludes: [],
  files: [],
  skipped: [],
  totals: { fileCount: 0, byteLength: 0 },
}

function sampleManifest() {
  return buildManifest({
    exportedAt: '2026-01-01T00:00:00.000Z',
    client: { appVersion: '3.0.0', dshVersion: '0.2.1-rc.5', device: 'device-A', platform: 'linux' },
    sessionVersion: 4,
    workspaces: [{ id: 'w1', title: '项目 A', path: '/home/a/proj' }],
    sessions: [{
      id: 's1', title: '第一次对话', workspaceId: 'w1', version: 4,
      createdAt: 1_700_000_000_000, archived: true, attachments: ['sha256:' + 'a'.repeat(64)],
    }],
    attachments: [{
      id: 'sha256:' + 'a'.repeat(64), kind: 'image', bytes: 12,
      member: `attachments/objects/aa/${'a'.repeat(64)}`,
    }],
    missingAttachments: [],
    workspaceFiles: emptyWorkspaceFiles,
    archivePolicy: 'preserve',
  })
}

test('buildManifest writes schema 2, kind and derived log member names', () => {
  const manifest = sampleManifest()
  assert.equal(manifest.schema, MANIFEST_SCHEMA)
  assert.equal(manifest.kind, TRANSFER_KIND)
  assert.equal(manifest.format.sessionVersion, 4)
  assert.equal(manifest.format.logEncoding, 'none')
  assert.equal(manifest.sessions[0].logName, 'sessions/s1.jsonl')
  assert.equal(manifest.client.platform, 'linux')
})

test('parseManifest round-trips a well-formed manifest', () => {
  const manifest = sampleManifest()
  const parsed = parseManifest(JSON.stringify(manifest))
  assert.equal(parsed.schema, 2)
  assert.equal(parsed.sessions.length, 1)
  assert.equal(parsed.sessions[0].id, 's1')
  assert.equal(parsed.sessions[0].archived, true)
  assert.equal(parsed.attachments.length, 1)
  assert.equal(parsed.workspaceFiles.excludes.length, 2)
  assert.equal(parsed.archivePolicy, 'preserve')
})

test('parseManifest refuses newer/older schema, wrong kind and corrupt JSON', () => {
  const manifest = sampleManifest()
  assert.throws(() => parseManifest('not json'), (error) => error.code === 'transfer/invalid-package')
  assert.throws(() => parseManifest(JSON.stringify({ ...manifest, schema: 3 })),
    (error) => error.code === 'transfer/unsupported-schema')
  assert.throws(() => parseManifest(JSON.stringify({ ...manifest, schema: 1 })),
    (error) => error.code === 'transfer/invalid-package')
  assert.throws(() => parseManifest(JSON.stringify({ ...manifest, kind: 'other' })),
    (error) => error.code === 'transfer/invalid-package')
})

test('crossCheckMembers verifies every declared session, attachment and file', () => {
  const manifest = sampleManifest()
  const good = new Set([
    'manifest.json', manifest.sessions[0].logName, manifest.attachments[0].member,
  ])
  assert.doesNotThrow(() => crossCheckMembers(manifest, good))
  assert.throws(() => crossCheckMembers(manifest, new Set(['manifest.json'])),
    (error) => /缺少会话日志/u.test(error.message))
  assert.throws(() => crossCheckMembers(manifest, new Set([...good, '../evil'])),
    (error) => error.code === 'transfer/unsafe-member')
})

test('checkSessionLogHeader validates the first line of the canonical JSONL', () => {
  const manifest = sampleManifest()
  const header = JSON.stringify({ type: 'session', version: 4, id: 's1', createdAt: 1, isSeeded: false })
  assert.deepEqual(checkSessionLogHeader(`${header}\n`, manifest.sessions[0], 4), { version: 4, id: 's1' })
  assert.throws(() => checkSessionLogHeader('oops\n', manifest.sessions[0], 4),
    (error) => error.code === 'transfer/log-corrupt')
  assert.throws(() => checkSessionLogHeader(`${JSON.stringify({ version: 4, id: 'other' })}\n`, manifest.sessions[0], 4),
    (error) => error.code === 'transfer/log-corrupt')
  assert.throws(() => checkSessionLogHeader(`${JSON.stringify({ version: 5, id: 's1' })}\n`, manifest.sessions[0], 4),
    (error) => error.code === 'transfer/log-corrupt')
})
