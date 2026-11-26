import test from 'node:test'
import assert from 'node:assert/strict'
import {
  checkMember, stripCommonWrapper, normalizeRelative, relativeToWorkspace,
  rewriteCwd, defaultWorkspaceRoot, attachmentMember, sessionLogMember,
  isExcluded, matchesExcludeRule,
} from '../dist/paths.js'
import { BASE_EXCLUDE_DIRECTORIES, BUILTIN_EXCLUDES } from '../dist/constants.js'

test('checkMember rejects zip-slip / absolute / windows-unsafe names', () => {
  assert.equal(checkMember('sessions/s1.jsonl').safe, true)
  assert.equal(checkMember('a/./b').normalized, 'a/b')
  for (const unsafe of ['../evil', '/abs', 'C:\\x', 'a/../../b', '', 'a\\b', 'a//b\x00', 'CON', 'a/CON.txt']) {
    assert.equal(checkMember(unsafe).safe, false, `should reject ${JSON.stringify(unsafe)}`)
  }
  assert.equal(checkMember('a//b').normalized, 'a/b')
})

test('stripCommonWrapper only strips a truly shared top-level folder', () => {
  assert.deepEqual(stripCommonWrapper(['pkg/manifest.json', 'pkg/sessions/a.jsonl']), {
    prefix: 'pkg/', names: ['manifest.json', 'sessions/a.jsonl'],
  })
  assert.deepEqual(stripCommonWrapper(['a.jsonl', 'b.jsonl']), { prefix: '', names: ['a.jsonl', 'b.jsonl'] })
  assert.deepEqual(stripCommonWrapper(['pkg/a', 'other/b']), { prefix: '', names: ['pkg/a', 'other/b'] })
})

test('normalizeRelative and relativeToWorkspace stay inside the workspace root', () => {
  assert.equal(normalizeRelative('./src/../a/b.txt'), 'a/b.txt')
  assert.equal(normalizeRelative('../outside'), undefined)
  assert.equal(normalizeRelative('C:\\Users\\a'), undefined)
  assert.equal(relativeToWorkspace('/ws/src/a.txt', '/ws'), 'src/a.txt')
  assert.equal(relativeToWorkspace('/ws', '/ws'), undefined)
  assert.equal(relativeToWorkspace('/other/a.txt', '/ws'), undefined)
})

test('rewriteCwd maps source workspace prefix to the local target path', () => {
  assert.equal(rewriteCwd('/ws', '/ws', '/home/u/proj'), '/home/u/proj')
  assert.equal(rewriteCwd('/ws/sub/dir', '/ws', '/home/u/proj'), '/home/u/proj/sub/dir')
  assert.equal(rewriteCwd('/elsewhere', '/ws', '/home/u/proj'), '/home/u/proj')
  assert.equal(rewriteCwd(undefined, '/ws', '/home/u/proj'), '/home/u/proj')
  assert.equal(rewriteCwd('C:\\ws\\sub', 'C:\\ws', 'D:\\proj'), 'D:\\proj/sub')
})

test('defaultWorkspaceRoot is platform neutral and never hardcodes a user or drive', () => {
  assert.equal(defaultWorkspaceRoot('linux', '/home/u/', '我的工作区'), '/home/u/Documents/我的工作区')
  assert.equal(defaultWorkspaceRoot('win32', 'C:\\Users\\u', 'proj'), 'C:\\Users\\u\\Documents\\proj')
  assert.equal(defaultWorkspaceRoot('darwin', '/Users/u', 'a/b'), '/Users/u/Documents/a_b')
})

test('attachment and session member names avoid the colon in sha256 refs', () => {
  const sha = 'a'.repeat(64)
  assert.equal(attachmentMember(`sha256:${sha}`, 'image'), `attachments/objects/aa/${sha}`)
  assert.equal(attachmentMember(`sha256:${sha}`, 'file'), `attachments/file-objects/aa/${sha}`)
  assert.equal(sessionLogMember('s-1'), 'sessions/s-1.jsonl')
  for (const member of [attachmentMember(`sha256:${sha}`, 'image'), sessionLogMember('s-1')]) {
    assert.equal(checkMember(member).safe, true)
  }
})

test('exclude rules cover built-in directories and secret-like filenames', () => {
  assert.equal(isExcluded('node_modules/pkg/a.js', BASE_EXCLUDE_DIRECTORIES, BUILTIN_EXCLUDES), true)
  assert.equal(isExcluded('src/.env', BASE_EXCLUDE_DIRECTORIES, BUILTIN_EXCLUDES), true)
  assert.equal(isExcluded('certs/server.key', BASE_EXCLUDE_DIRECTORIES, BUILTIN_EXCLUDES), true)
  assert.equal(isExcluded('src/index.ts', BASE_EXCLUDE_DIRECTORIES, BUILTIN_EXCLUDES), false)
  assert.equal(matchesExcludeRule('build/out.o', 'build/'), true)
  assert.equal(matchesExcludeRule('logs/debug.log', '*.log'), true)
})
