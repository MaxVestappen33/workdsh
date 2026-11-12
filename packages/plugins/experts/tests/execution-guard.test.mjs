import assert from 'node:assert/strict';
import test from 'node:test';
import { Context } from '@deepseek-ai/cordis';
import { registerExpertExecutionGuard } from '../dist/index.js';

const NOT_ENTITLED = '当前账号未获得该项资产的授权。';
const NOT_LISTED = '该资产未上架或未登记，请先提交上架申请，审批通过后从市场安装。';

function fakeGate({ expert = true, expert_group = true, entitled = [] } = {}) {
  const decisions = [];
  return {
    decisions,
    enabled(type) { return type === 'expert' ? expert : expert_group; },
    async decide(request) {
      decisions.push(request);
      return { allow: entitled.includes(request.assetId), reason: 'gate/denied-not-entitled', message: NOT_ENTITLED };
    },
    unlisted() { return { reason: 'gate/denied-not-listed', message: NOT_LISTED }; },
  };
}

const agent = {
  id: 'agent-1',
  session: { header: { agentPreset: 'preset-1' } },
};

const role = {
  binding: { presetRevisionRef: 'preset-1', expertRevisionRef: { expertId: 'expert-1', revisionId: 'r1' } },
  revision: { expertId: 'expert-1', definition: {} },
  owner: {},
};

function harness({ gate, manifest, onRead } = {}) {
  const ctx = new Context();
  const reads = [];
  ctx.provide('agentTeams', { tryMembership() { return undefined; } });
  ctx.provide('workdshIdentity', { async resolve() { return { principalId: 'user-a' }; } });
  ctx.provide('workdshExperts', {
    async resolveNativeRole() { return role; },
    installManifestOf(expertId) {
      reads.push(expertId);
      onRead?.(expertId);
      return manifest;
    },
  });
  if (gate) ctx.provide('workdshAssetGate', gate);
  registerExpertExecutionGuard(ctx);
  return { ctx, reads };
}

const step = ctx => ctx.waterfall(
  'agent/pre-step',
  { agent, messages: [], turn: 1, step: 1, signal: new AbortController().signal },
  async () => ({ kind: 'enter', messages: [] }),
);

const market = assetId => ({ assetType: 'expert', assetId, source: 'market', installedAt: '2026-01-01T00:00:00.000Z' });

test('闸门缺失或两个专家子闸门都关时放行且不读清单', async () => {
  const absent = harness({ manifest: market('m1') });
  assert.equal((await step(absent.ctx)).kind, 'enter');
  assert.deepEqual(absent.reads, []);

  const gate = fakeGate({ expert: false, expert_group: false });
  const closed = harness({ gate, manifest: market('m1') });
  assert.equal((await step(closed.ctx)).kind, 'enter');
  assert.deepEqual(closed.reads, [], '子闸门关闭时不得读取清单');
  assert.deepEqual(gate.decisions, []);
});

test('市场专家按后台编号判授权，未授权拒绝该 step', async () => {
  const gate = fakeGate({ entitled: ['backend-ok'] });
  const allowed = harness({ gate, manifest: market('backend-ok') });
  assert.equal((await step(allowed.ctx)).kind, 'enter');
  assert.deepEqual(allowed.reads, ['expert-1']);
  assert.deepEqual(gate.decisions.map(row => [row.assetType, row.assetId, row.usage]), [['expert', 'backend-ok', 'use']]);

  const denied = harness({ gate, manifest: market('backend-denied') });
  await assert.rejects(
    () => step(denied.ctx),
    error => error.code === 'gate/denied-not-entitled' && error.message === NOT_ENTITLED,
  );
});

test('内置专家放行；本地与无清单专家按未登记拒绝', async () => {
  const gate = fakeGate();
  const builtin = harness({ gate, manifest: { assetType: 'expert', source: 'builtin', installedAt: '2026-01-01T00:00:00.000Z' } });
  assert.equal((await step(builtin.ctx)).kind, 'enter');

  const local = harness({ gate, manifest: { assetType: 'expert', source: 'local', installedAt: '2026-01-01T00:00:00.000Z' } });
  await assert.rejects(() => step(local.ctx), error => error.code === 'gate/denied-not-listed' && error.message === NOT_LISTED);

  const missing = harness({ gate, manifest: undefined });
  await assert.rejects(() => step(missing.ctx), error => error.code === 'gate/denied-not-listed');
});

test('清单标注为专家团时按专家团子闸门判定', async () => {
  const gate = fakeGate({ expert: true, expert_group: false });
  const team = harness({ gate, manifest: { assetType: 'expert_group', source: 'local', installedAt: '2026-01-01T00:00:00.000Z' } });
  assert.equal((await step(team.ctx)).kind, 'enter', '专家团子闸门关闭时该类不判定');
  assert.deepEqual(gate.decisions, []);
});
