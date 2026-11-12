import assert from 'node:assert/strict';
import test from 'node:test';
import { filterVisible, resolveInstallManifest } from '../dist/services/visibility.js';

const market = assetId => ({ source: 'market', assetId });
const local = { source: 'local' };

function fakeGate({ expert = true, expert_group = true, allow = [] } = {}) {
  const decisions = [];
  return {
    decisions,
    enabled(type) { return type === 'expert' ? expert : expert_group; },
    async decide(request) {
      decisions.push(request);
      return { allow: allow.includes(request.assetId) };
    },
  };
}

const subjectOf = row => ({ assetType: row.assetType, manifest: () => row.manifest });

test('闸门缺失时市场列表原样返回，不解析行也不读清单', async () => {
  let reads = 0;
  const rows = [{ id: 'a', assetType: 'expert', manifest: market('backend-a') }];
  const visible = await filterVisible(undefined, rows, row => {
    reads += 1;
    return subjectOf(row);
  });
  assert.deepEqual(visible.map(row => row.id), ['a']);
  assert.equal(reads, 0);
});

test('子闸门关闭时该类直接放行且不读清单', async () => {
  const gate = fakeGate({ expert: false, expert_group: false });
  let reads = 0;
  const rows = [{ id: 'a', assetType: 'expert', manifest: local }];
  const visible = await filterVisible(gate, rows, row => ({
    assetType: row.assetType,
    manifest: () => {
      reads += 1;
      return row.manifest;
    },
  }));
  assert.deepEqual(visible.map(row => row.id), ['a']);
  assert.equal(reads, 0);
  assert.equal(gate.decisions.length, 0);
});

test('市场列表只保留已授权专家与专家团，未授权条目不展示', async () => {
  const gate = fakeGate({ allow: ['backend-ok'] });
  const rows = [
    { id: 'expert-ok', assetType: 'expert', manifest: market('backend-ok') },
    { id: 'expert-denied', assetType: 'expert', manifest: market('backend-denied') },
    { id: 'team-ok', assetType: 'expert_group', manifest: market('backend-ok') },
    { id: 'team-denied', assetType: 'expert_group', manifest: market('backend-denied') },
  ];
  const visible = await filterVisible(gate, rows, subjectOf);
  assert.deepEqual(visible.map(row => row.id), ['expert-ok', 'team-ok']);
  assert.deepEqual(gate.decisions.map(row => [row.assetType, row.assetId]), [
    ['expert', 'backend-ok'],
    ['expert', 'backend-denied'],
    ['expert_group', 'backend-ok'],
    ['expert_group', 'backend-denied'],
  ]);
  assert.ok(gate.decisions.every(row => row.usage === 'read'));
});

test('专家团子闸门关闭时团队行不受影响', async () => {
  const gate = fakeGate({ expert: true, expert_group: false });
  const rows = [{ id: 'team', assetType: 'expert_group', manifest: local }];
  const visible = await filterVisible(gate, rows, subjectOf);
  assert.deepEqual(visible.map(row => row.id), ['team']);
  assert.equal(gate.decisions.length, 0);
});

test('团队成员解析到所属专家团的清单', () => {
  const teamManifest = { assetType: 'expert_group', assetId: 'backend-team', source: 'market', installedAt: '2026-01-01T00:00:00.000Z' };
  const parent = { installManifest: teamManifest };
  assert.deepEqual(resolveInstallManifest({ teamParentId: 'team-1' }, () => parent), teamManifest);
  const own = { assetType: 'expert', assetId: 'backend-member', source: 'market', installedAt: '2026-01-02T00:00:00.000Z' };
  assert.deepEqual(resolveInstallManifest({ installManifest: own, teamParentId: 'team-1' }, () => parent), own);
  assert.equal(resolveInstallManifest({ teamParentId: 'missing' }, () => undefined), undefined);
  assert.equal(resolveInstallManifest({}, () => parent), undefined);
  assert.equal(resolveInstallManifest(undefined, () => parent), undefined);
});
