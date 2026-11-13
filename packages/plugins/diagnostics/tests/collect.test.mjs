import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { planDiagnostics, WINDOW_MS } from '../dist/collect.js';

const DAY = 24 * 60 * 60 * 1000;

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'workdsh-diag-'));
  const logs = join(root, 'logs');
  const profile = join(root, 'profiles', 'workdsh');
  await mkdir(logs, { recursive: true });
  await mkdir(profile, { recursive: true });
  const now = Date.now();
  const write = async (directory, name, body, ageMs) => {
    const path = join(directory, name);
    await writeFile(path, body);
    if (ageMs) {
      const stamp = new Date(now - ageMs);
      await utimes(path, stamp, stamp);
    }
  };
  await write(logs, 'host-http-2026-11-13.log', 'x'.repeat(10), 0);
  await write(logs, 'host-output-2026-11-13.log', 'y'.repeat(5), 0);
  await write(logs, 'runtime-failure.log', 'boom', 0);
  await write(logs, 'runtime-failure-retry-2.log', 'boom2', 0);
  await write(logs, 'update-2026-11-10.log', 'old', 3 * DAY);
  await write(logs, 'account-session.bin', 'secret', 0);
  await write(logs, 'account-auth.json', 'secret', 0);
  await write(logs, 'unrelated.txt', 'noise', 0);
  await write(profile, 'package.json', '{"name":"workdsh"}', 0);
  await write(profile, 'cordis.patch.yml', '- insert: []', 0);
  return { root, logs, profile, now };
}

test('只收 24 小时窗口内的滚动日志与启动失败记录', async () => {
  const { root, logs, profile, now } = await fixture();
  try {
    const plan = planDiagnostics({ logDirectory: logs, profileDirectory: profile, now });
    const names = plan.files.map((file) => file.archivePath);
    assert.deepEqual(names, [
      'diagnostics/logs/host-http-2026-11-13.log',
      'diagnostics/logs/host-output-2026-11-13.log',
      'diagnostics/logs/runtime-failure-retry-2.log',
      'diagnostics/logs/runtime-failure.log',
      'diagnostics/profile/package.json',
      'diagnostics/profile/cordis.patch.yml',
    ]);
    assert.equal(plan.totalBytes, 10 + 5 + 5 + 4 + 13 + 17);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('凭据文件与非日志文件永不入包', async () => {
  const { root, logs, profile, now } = await fixture();
  try {
    const plan = planDiagnostics({ logDirectory: logs, profileDirectory: profile, now });
    const joined = plan.files.map((file) => file.archivePath).join('\n');
    assert.equal(joined.includes('account-session.bin'), false);
    assert.equal(joined.includes('account-auth.json'), false);
    assert.equal(joined.includes('unrelated.txt'), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('窗口边界：超过 24 小时的日志被排除，Profile 证据始终保留', async () => {
  const { root, logs, profile, now } = await fixture();
  try {
    const plan = planDiagnostics({ logDirectory: logs, profileDirectory: profile, now: now + WINDOW_MS + 5000 });
    assert.deepEqual(plan.files.map((file) => file.archivePath), [
      'diagnostics/profile/package.json',
      'diagnostics/profile/cordis.patch.yml',
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('目录缺失时返回空计划，不抛错', () => {
  const plan = planDiagnostics({ logDirectory: '/nonexistent/logs', profileDirectory: '/nonexistent/profile' });
  assert.deepEqual(plan, { files: [], totalBytes: 0 });
});
