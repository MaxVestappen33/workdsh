import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { REVOCATION_CAUSE, RevocationLedger, reconcileRevocations } from '../dist/index.js';

const row = (...assetIds) => assetIds;

test('撤权只标记「已安装且不在快照」的资产，按类型隔离', () => {
  const ledger = new RevocationLedger();
  const result = reconcileRevocations(ledger, 'skill', row('a'), row('a', 'b'));
  assert.deepEqual(result.revoked, ['b']);
  assert.equal(result.changed, true);
  assert.equal(ledger.isRevoked('skill', 'b'), true);
  assert.equal(ledger.isRevoked('skill', 'a'), false);
  // 其他类型不受影响
  assert.equal(ledger.isRevoked('mcp', 'b'), false);
  assert.equal(ledger.revoked('skill')[0], 'b');
});

test('同一份快照重复重算不产生变化，恢复授权后只清除账本项', () => {
  const ledger = new RevocationLedger();
  reconcileRevocations(ledger, 'mcp', row(), row('x'));
  const again = reconcileRevocations(ledger, 'mcp', row(), row('x'));
  assert.equal(again.changed, false);

  const restored = reconcileRevocations(ledger, 'mcp', row('x'), row('x'));
  assert.deepEqual(restored.restored, ['x']);
  assert.equal(restored.changed, true);
  assert.equal(ledger.isRevoked('mcp', 'x'), false);
});

test('账本中的历史编号只在资产仍已安装且回到快照时才恢复', () => {
  const ledger = new RevocationLedger();
  reconcileRevocations(ledger, 'expert', row(), row('e1', 'e2'));
  // e2 已被用户卸载：即使快照重新包含它，也不应凭空恢复账本项
  const result = reconcileRevocations(ledger, 'expert', row('e1', 'e2'), row('e1'));
  assert.deepEqual(result.restored, ['e1']);
  assert.equal(ledger.isRevoked('expert', 'e2'), true);
});

test('用户手动启用/卸载后清除标记，之后不再被自动恢复', () => {
  const ledger = new RevocationLedger();
  reconcileRevocations(ledger, 'skill', row(), row('s1'));
  assert.equal(ledger.clear('skill', 's1'), true);
  assert.equal(ledger.clear('skill', 's1'), false);
  const later = reconcileRevocations(ledger, 'skill', row('s1'), row('s1'));
  assert.equal(later.changed, false);
  assert.equal(later.restored.length, 0);
});

test('按账号目录隔离：两个账本互不影响', async () => {
  const first = await mkdtemp(join(tmpdir(), 'gate-ledger-a-'));
  const second = await mkdtemp(join(tmpdir(), 'gate-ledger-b-'));
  try {
    const a = new RevocationLedger(first);
    const b = new RevocationLedger(second);
    reconcileRevocations(a, 'skill', row(), row('shared'));
    await a.save();

    b.load();
    assert.equal(b.isRevoked('skill', 'shared'), false);

    a.clearAccount();
    assert.equal(a.isRevoked('skill', 'shared'), false);
    // 磁盘仍是旧账号的数据，重新加载后恢复；新账号目录不受影响
    const reloaded = new RevocationLedger(first);
    reloaded.load();
    assert.equal(reloaded.isRevoked('skill', 'shared'), true);
  } finally {
    await rm(first, { recursive: true, force: true });
    await rm(second, { recursive: true, force: true });
  }
});

test('账本落盘包含来源标记，损坏文件按空账本处理', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gate-ledger-')); 
  try {
    const ledger = new RevocationLedger(directory);
    reconcileRevocations(ledger, 'expert_group', row(), row('g1'));
    await ledger.save();
    const payload = JSON.parse(await readFile(join(directory, 'revocations.json'), 'utf8'));
    assert.equal(payload.entries.expert_group.g1.cause, REVOCATION_CAUSE);
    assert.equal(typeof payload.entries.expert_group.g1.disabledAt, 'string');

    const reloaded = new RevocationLedger(directory);
    reloaded.load();
    assert.equal(reloaded.isRevoked('expert_group', 'g1'), true);

    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(directory, 'revocations.json'), '{ not json');
    const broken = new RevocationLedger(directory);
    broken.load();
    assert.deepEqual(broken.revoked('expert_group'), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
