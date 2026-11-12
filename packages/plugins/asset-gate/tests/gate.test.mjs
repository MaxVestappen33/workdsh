import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Context } from '@deepseek-ai/cordis';
import { AssetGateService, decide, decideTool, failClosedPolicy, parseGatePolicy, parseSnapshotResult, PolicyStore, resolveEffectivePolicy, SnapshotStore } from '../dist/index.js';

const ALL_OFF = { skill: false, mcp: false, expert: false, expert_group: false, model: false, knowledge: false, prompt: false };
const policy = (masterEnabled, assetGates = {}) => ({
  masterEnabled,
  assetGates: { ...ALL_OFF, ...assetGates },
  revision: 'r1',
});
const snapshot = (assets, staleAt = null, fetchedAt = new Date(0).toISOString()) => ({
  accountKey: 'org:user',
  revision: 'r1',
  staleAt,
  assets: { ...Object.fromEntries(Object.keys(ALL_OFF).map(type => [type, []])), ...assets },
  fetchedAt,
});
const hostile = () => new Proxy({}, { get() { throw new Error('snapshot must not be read'); } });

test('本机收紧项只能把关改成开，后台已开的不会被本机关掉', () => {
  const local = { masterEnabled: true, assetGates: { skill: true, mcp: false } };
  const tightened = resolveEffectivePolicy(undefined, local);
  assert.equal(tightened.masterEnabled, true);
  assert.equal(tightened.assetGates.skill, true);
  assert.equal(tightened.assetGates.mcp, false);

  const remote = resolveEffectivePolicy(policy(true, { skill: true }), { masterEnabled: false, assetGates: { skill: false } });
  assert.equal(remote.masterEnabled, true);
  assert.equal(remote.assetGates.skill, true);

  assert.equal(resolveEffectivePolicy(undefined, {}).masterEnabled, false);
});

test('验签项解析：缺字段按主闸门兜底，本机只能收紧不能放松', () => {
  const signaturePolicy = (masterEnabled, assetSignature) => ({ masterEnabled, assetGates: ALL_OFF, assetSignature, revision: 'r1' });

  // 后台回包：显式值优先，缺字段按主闸门值兜底（旧后台/旧缓存口径）。
  assert.equal(parseGatePolicy({ masterEnabled: true, assetGates: {}, revision: 'r' }).assetSignature, true);
  assert.equal(parseGatePolicy({ masterEnabled: false, assetGates: {}, revision: 'r' }).assetSignature, false);
  assert.equal(parseGatePolicy({ masterEnabled: true, assetGates: { assetSignature: false }, revision: 'r' }).assetSignature, false);
  assert.equal(parseGatePolicy({ masterEnabled: false, assetGates: { assetSignature: true }, revision: 'r' }).assetSignature, true);
  assert.equal(failClosedPolicy().assetSignature, true);

  // 生效值：后台 OR 本机；本机可把关改成开，关不掉后台已开的。
  assert.equal(resolveEffectivePolicy(signaturePolicy(true, undefined)).assetSignature, true);
  assert.equal(resolveEffectivePolicy(signaturePolicy(false, undefined)).assetSignature, false);
  assert.equal(resolveEffectivePolicy(undefined, { assetSignature: true }).assetSignature, true);
  assert.equal(resolveEffectivePolicy(signaturePolicy(false, false), { assetSignature: true }).assetSignature, true);
  assert.equal(resolveEffectivePolicy(signaturePolicy(true, true), { assetSignature: false }).assetSignature, true);
});

test('signatureEnabled 四种开关组合：主闸门关闭时验签整体不生效', async () => {
  const ctx = new Context();
  let row = { masterEnabled: false, assetGates: { assetSignature: true }, revision: 'r1' };
  ctx.provide('workdshIdentity', {
    profile() { return { principalId: 'user-a', organization: { id: 'org' } }; },
    async backendBinding() { return { url: 'http://backend.test', authorization: 'token' }; },
  });
  ctx.provide('workdshBackend', {
    async available() { return true; },
    async get(path) {
      if (path.endsWith('queryGatePolicy')) return row;
      throw new Error('unexpected request');
    },
  });
  try {
    await ctx.plugin(AssetGateService, { autoSync: false });
    assert.equal(ctx.workdshAssetGate.signatureEnabled(), false);

    // 主闸门关 + 验签开：不生效。
    await ctx.workdshAssetGate.refreshPolicy();
    assert.equal(ctx.workdshAssetGate.policy().assetSignature, true);
    assert.equal(ctx.workdshAssetGate.signatureEnabled(), false);

    // 主闸门开 + 验签关：不生效。
    row = { masterEnabled: true, assetGates: { assetSignature: false }, revision: 'r2' };
    await ctx.workdshAssetGate.refreshPolicy();
    assert.equal(ctx.workdshAssetGate.signatureEnabled(), false);

    // 主闸门开 + 验签开：生效。
    row = { masterEnabled: true, assetGates: { assetSignature: true }, revision: 'r3' };
    await ctx.workdshAssetGate.refreshPolicy();
    assert.equal(ctx.workdshAssetGate.signatureEnabled(), true);
  } finally {
    await ctx.fiber.dispose();
  }
});

test('主闸门关闭时直接放行，且不读取快照任何字段', () => {
  const result = decide({ policy: policy(false), snapshot: hostile(), assetType: 'skill', assetId: 's1', usage: 'use', now: 0 });
  assert.equal(result.allow, true);
  assert.equal(result.reason, 'gate/allowed-open');
});

test('某类子闸门关闭时该类完全不判定，也不读取快照', () => {
  const result = decide({ policy: policy(true, { model: true }), snapshot: hostile(), assetType: 'skill', assetId: 's1', usage: 'read', now: 0 });
  assert.equal(result.allow, true);
  assert.equal(result.reason, 'gate/allowed-open');
});

test('快照缺失、过期、未授权与命中授权的判定', () => {
  const open = policy(true, { skill: true });
  assert.deepEqual(
    [decide({ policy: open, assetType: 'skill', assetId: 's1', usage: 'use', now: 0 }).reason],
    ['gate/denied-no-snapshot'],
  );
  assert.equal(decide({ policy: open, snapshot: snapshot({ skill: ['s1'] }, '1970-01-01T00:00:01.000Z'), assetType: 'skill', assetId: 's1', usage: 'use', now: 2_000 }).reason, 'gate/denied-expired');
  assert.equal(decide({ policy: open, snapshot: snapshot({ skill: ['s2'] }), assetType: 'skill', assetId: 's1', usage: 'use', now: 0 }).reason, 'gate/denied-not-entitled');
  const allowed = decide({ policy: open, snapshot: snapshot({ skill: ['s1'] }, '2999-01-01T00:00:00.000Z'), assetType: 'skill', assetId: 's1', usage: 'use', now: 0 });
  assert.equal(allowed.allow, true);
  assert.equal(allowed.reason, 'gate/allowed-entitled');
  assert.equal(allowed.snapshotRevision, 'r1');
});

test('写操作受 24 小时新鲜期约束，读/用与关闸不受影响', () => {
  const open = policy(true, { skill: true });
  const now = Date.parse('2026-01-02T00:00:00.000Z');
  const at = hours => new Date(now - hours * 60 * 60 * 1000).toISOString();

  assert.equal(decide({ policy: open, snapshot: snapshot({ skill: ['s1'] }, null, at(23)), assetType: 'skill', assetId: 's1', usage: 'write', now }).allow, true);
  assert.equal(decide({ policy: open, snapshot: snapshot({ skill: ['s1'] }, null, at(24)), assetType: 'skill', assetId: 's1', usage: 'write', now }).allow, true, '恰好 24 小时仍在新鲜期内');

  const stale = snapshot({ skill: ['s1'] }, null, at(25));
  const denied = decide({ policy: open, snapshot: stale, assetType: 'skill', assetId: 's1', usage: 'write', now });
  assert.equal(denied.allow, false);
  assert.equal(denied.reason, 'gate/denied-snapshot-stale');
  assert.match(denied.message, /联网后可继续操作/);

  // 读/用只受 staleAt 约束，不受新鲜期影响。
  assert.equal(decide({ policy: open, snapshot: stale, assetType: 'skill', assetId: 's1', usage: 'read', now }).allow, true);
  assert.equal(decide({ policy: open, snapshot: stale, assetType: 'skill', assetId: 's1', usage: 'use', now }).allow, true);

  // 拉取时间不可解析：按不新鲜拒绝（fail-closed）。
  const broken = decide({ policy: open, snapshot: snapshot({ skill: ['s1'] }, null, 'not-a-time'), assetType: 'skill', assetId: 's1', usage: 'write', now });
  assert.equal(broken.reason, 'gate/denied-snapshot-stale');

  // 主闸门或该类子闸门关闭：直接放行，不读取快照。
  assert.equal(decide({ policy: policy(false), snapshot: hostile(), assetType: 'skill', assetId: 's1', usage: 'write', now }).allow, true);
  assert.equal(decide({ policy: policy(true, { model: true }), snapshot: hostile(), assetType: 'skill', assetId: 's1', usage: 'write', now }).allow, true);
});

test('快照缓存按账号隔离，落盘内容不是明文', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'asset-gate-'));
  try {
    const store = new SnapshotStore(directory);
    const record = snapshot({ skill: ['secret-skill'] });
    await store.save(record, 'token-a');
    assert.equal(store.peek('org:user').assets.skill[0], 'secret-skill');
    assert.equal(store.peek('org:other'), undefined, '切号必须立即丢弃旧缓存');

    const [name] = await readdir(directory);
    const sealed = await readFile(join(directory, name), 'utf8');
    assert.equal(sealed.includes('secret-skill'), false);
    assert.equal(sealed.includes('org:user'), false);

    const reopened = new SnapshotStore(directory);
    assert.equal((await reopened.load('org:user', 'token-a')).assets.skill[0], 'secret-skill');
    assert.equal(await new SnapshotStore(directory).load('org:user', 'wrong-token'), undefined);
    assert.equal(await new SnapshotStore(directory).load('org:user', 'token-a'), undefined, '解密失败的缓存必须删除');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('读文件 IO 错误保留文件并记 warning，不当作损坏删除', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'asset-gate-'));
  try {
    const name = `${createHash('sha256').update('org:user').digest('hex').slice(0, 32)}.snapshot`;
    const file = join(directory, name);
    // 用同名目录制造 readFile 的 EISDIR（非 ENOENT）IO 错误。
    await mkdir(file);
    const warnings = [];
    const store = new SnapshotStore(directory, message => warnings.push(message));
    assert.equal(await store.load('org:user', 'token'), undefined);
    assert.equal(existsSync(file), true, 'IO 错误不得删除文件');
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /读取失败/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('陈旧中断临时文件会在读写入口被清理，新临时文件保留', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'asset-gate-'));
  try {
    const base = `${createHash('sha256').update('org:user').digest('hex').slice(0, 32)}.snapshot`;
    const stale = join(directory, `${base}.stale00000000.tmp`);
    const fresh = join(directory, `${base}.fresh0000000.tmp`);
    await writeFile(stale, 'partial');
    await writeFile(fresh, 'partial');
    await utimes(stale, new Date(0), new Date(0));

    const store = new SnapshotStore(directory);
    await store.load('org:user', 'token');

    assert.equal(existsSync(stale), false, '超过 5 分钟的临时文件应被清理');
    assert.equal(existsSync(fresh), true, '新临时文件可能是并发写入，不能删');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('主闸门全关时判定与同步都不解析身份、不请求快照', async () => {
  const ctx = new Context();
  const calls = { profile: 0, binding: 0, policy: 0, snapshot: 0 };
  ctx.provide('workdshIdentity', {
    profile() { calls.profile += 1; throw new Error('profile must not be read'); },
    async backendBinding() { calls.binding += 1; return { url: 'http://backend.test', authorization: 'token' }; },
  });
  ctx.provide('workdshBackend', {
    async available() { return true; },
    async get(path) {
      if (path.endsWith('queryGatePolicy')) { calls.policy += 1; return { code: 200, result: { masterEnabled: false, assetGates: {}, revision: 'r1' } }; }
      calls.snapshot += 1;
      throw new Error('snapshot must not be requested');
    },
  });
  try {
    await ctx.plugin(AssetGateService, { autoSync: false });
    const decision = await ctx.workdshAssetGate.decide({ assetType: 'skill', assetId: 's1', usage: 'use' });
    assert.equal(decision.allow, true);
    assert.equal(decision.reason, 'gate/allowed-open');
    assert.equal(calls.profile, 0);
    assert.equal(calls.binding, 0);
    assert.equal(calls.snapshot, 0);

    await ctx.workdshAssetGate.sync();
    assert.equal(calls.policy, 1);
    assert.equal(calls.profile, 0);
    assert.equal(calls.binding, 0);
    assert.equal(calls.snapshot, 0);
    assert.equal(await ctx.workdshAssetGate.refreshSnapshot(), undefined);
    assert.equal(calls.profile, 0);
    assert.equal(calls.snapshot, 0);
  } finally {
    await ctx.fiber.dispose();
  }
});

test('主闸门关闭期间只低频轮询策略，拿到开后立即恢复快照同步', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'asset-gate-'));
  const calls = { policy: 0, snapshot: 0, profile: 0 };
  let master = false;
  const ctx = new Context();
  ctx.provide('workdshIdentity', {
    profile() { calls.profile += 1; return { principalId: 'user-a', organization: { id: 'org' } }; },
    async backendBinding() { return { url: 'http://backend.test', authorization: 'token-a' }; },
  });
  ctx.provide('workdshBackend', {
    async available() { return true; },
    async get(path) {
      if (path.endsWith('queryGatePolicy')) {
        calls.policy += 1;
        return { masterEnabled: master, assetGates: { skill: true }, revision: `p${calls.policy}` };
      }
      calls.snapshot += 1;
      return {
        revision: 'r1',
        staleAt: '2999-01-01T00:00:00.000Z',
        assets: { skill: ['s1'], mcp: [], expert: [], expert_group: [], model: [], knowledge: [], prompt: [] },
      };
    },
  });
  try {
    await ctx.plugin(AssetGateService, { autoSync: false, stateDir: directory, policyPollIntervalMs: 50 });
    await ctx.workdshAssetGate.sync();
    assert.equal(calls.policy, 1);
    assert.equal(calls.snapshot, 0, '关闸期间不请求快照');
    assert.equal(calls.profile, 0, '关闸轮询不解析身份');
    assert.equal(ctx.workdshAssetGate.policy().masterEnabled, false);

    master = true;
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.ok(calls.policy >= 2, '关闸期间应按周期继续轮询策略');
    assert.equal(calls.snapshot, 1, '拿到「开」后应立即可恢复快照同步');
    assert.equal(calls.profile, 1, '开闸后才解析身份');
    assert.equal(ctx.workdshAssetGate.policy().masterEnabled, true);

    await ctx.fiber.dispose();
    const settled = calls.policy;
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.equal(calls.policy, settled, '销毁后定时器必须清理');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

const identity = () => ({
  profile: () => ({ principalId: 'user-a', organization: { id: 'org' } }),
  async backendBinding() { return { url: 'http://backend.test', authorization: 'token-a' }; },
});

const channel = ({ policyFails = false } = {}) => ({
  async available() { return true; },
  async get(path) {
    if (path.endsWith('queryGatePolicy')) {
      if (policyFails) throw new Error('policy endpoint blocked');
      return { masterEnabled: true, assetGates: { skill: true }, revision: 'p1' };
    }
    return { revision: 'r1', unchanged: true };
  },
});

test('「未登记」拒绝复用统一原因码与文案', async () => {
  const ctx = new Context();
  ctx.provide('workdshIdentity', identity());
  ctx.provide('workdshBackend', { async available() { return false; } });
  try {
    await ctx.plugin(AssetGateService, { autoSync: false });
    const denial = ctx.workdshAssetGate.unlisted();
    assert.equal(denial.reason, 'gate/denied-not-listed');
    assert.match(denial.message, /上架申请/);
  } finally {
    await ctx.fiber.dispose();
  }
});

test('策略成功拉取后落盘，重启时策略接口失败仍沿用上次结果', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'asset-gate-policy-'));
  try {
    const first = new Context();
    first.provide('workdshIdentity', identity());
    first.provide('workdshBackend', channel());
    await first.plugin(AssetGateService, { autoSync: false, policyDir: directory });
    try {
      await first.workdshAssetGate.sync();
      assert.equal(first.workdshAssetGate.policy().masterEnabled, true);
      assert.equal(first.workdshAssetGate.policy().failClosed, undefined);
    } finally {
      await first.fiber.dispose();
    }

    const restarted = new Context();
    restarted.provide('workdshIdentity', identity());
    restarted.provide('workdshBackend', channel({ policyFails: true }));
    await restarted.plugin(AssetGateService, { autoSync: false, policyDir: directory });
    try {
      assert.equal(restarted.workdshAssetGate.policy().masterEnabled, true, '初始化时就应恢复上次策略');
      await restarted.workdshAssetGate.sync();
      assert.equal(restarted.workdshAssetGate.policy().masterEnabled, true, '拉取失败沿用历史策略');
      assert.equal(
        (await restarted.workdshAssetGate.decide({ assetType: 'skill', assetId: 's1', usage: 'use' })).reason,
        'gate/denied-no-snapshot',
      );
    } finally {
      await restarted.fiber.dispose();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('从未成功拉取过策略时 fail-closed，且不请求快照', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'asset-gate-policy-'));
  const calls = { policy: 0, snapshot: 0 };
  const ctx = new Context();
  ctx.provide('workdshIdentity', identity());
  ctx.provide('workdshBackend', {
    async available() { return true; },
    async get(path) {
      if (path.endsWith('queryGatePolicy')) { calls.policy += 1; throw new Error('blocked'); }
      calls.snapshot += 1;
      return {};
    },
  });
  try {
    await ctx.plugin(AssetGateService, { autoSync: false, policyDir: directory });
    await ctx.workdshAssetGate.sync();
    const current = ctx.workdshAssetGate.policy();
    assert.equal(current.masterEnabled, true);
    assert.equal(current.failClosed, true);
    assert.equal(calls.policy, 1);
    assert.equal(calls.snapshot, 0, 'fail-closed 时不请求快照');
    const decision = await ctx.workdshAssetGate.decide({ assetType: 'skill', assetId: 's1', usage: 'read' });
    assert.equal(decision.allow, false);
    assert.equal(decision.reason, 'gate/denied-policy-unavailable');
  } finally {
    await ctx.fiber.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

test('fail-closed 判定不读取快照任何字段', () => {
  const failClosed = { masterEnabled: true, assetGates: { ...ALL_OFF, skill: true }, revision: '', failClosed: true };
  const result = decide({ policy: failClosed, snapshot: hostile(), assetType: 'skill', assetId: 's1', usage: 'use', now: 0 });
  assert.equal(result.allow, false);
  assert.equal(result.reason, 'gate/denied-policy-unavailable');
});

test('策略缓存被改写后视为无历史策略', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'asset-gate-policy-'));
  try {
    new PolicyStore(directory).save({ masterEnabled: true, assetGates: { ...ALL_OFF, skill: true }, revision: 'p1' });
    assert.equal(new PolicyStore(directory).load().masterEnabled, true);

    const file = join(directory, 'policy.json');
    const envelope = JSON.parse(readFileSync(file, 'utf8'));
    const body = JSON.parse(envelope.body);
    body.masterEnabled = false;
    envelope.body = JSON.stringify(body);
    writeFileSync(file, JSON.stringify(envelope));

    assert.equal(new PolicyStore(directory).load(), undefined);
    assert.equal(existsSync(file), false, '校验失败的文件应被删除');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('按 staleAt 接力重拉，插件销毁后定时器不再请求', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'asset-gate-'));
  const revisions = [];
  let round = 0;
  const assets = { skill: ['s1'], mcp: [], expert: [], expert_group: [], model: [], knowledge: [], prompt: [] };
  const ctx = new Context();
  ctx.provide('workdshIdentity', identity());
  ctx.provide('workdshBackend', {
    async available() { return true; },
    async get(path, query) {
      if (path.endsWith('queryGatePolicy')) return { masterEnabled: true, assetGates: { skill: true }, revision: 'p1' };
      revisions.push(query?.revision);
      round += 1;
      return round === 1
        ? { revision: 'r1', staleAt: new Date(Date.now() + 400).toISOString(), assets }
        : { revision: 'r2', staleAt: '2999-01-01T00:00:00.000Z', assets };
    },
  });
  try {
    await ctx.plugin(AssetGateService, { autoSync: false, stateDir: directory, refreshIntervalMs: 60_000 });
    await ctx.workdshAssetGate.sync();
    assert.equal(revisions.length, 1);
    assert.equal((await ctx.workdshAssetGate.decide({ assetType: 'skill', assetId: 's1', usage: 'use' })).allow, true);

    await new Promise(resolve => setTimeout(resolve, 1_200));
    assert.equal(revisions.length, 2, '到 staleAt 应接力重拉一次');
    assert.equal(revisions[1], 'r1', '接力重拉应带上上次 revision');

    await ctx.fiber.dispose();
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.equal(revisions.length, 2, '销毁后定时器必须清理');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('连接器条目解析：全量、白名单、重复合并与非法结构', () => {
  const base = { skill: [], expert: [], expert_group: [], model: [], knowledge: [], prompt: [] };
  const parse = mcp => parseSnapshotResult({ revision: 'r1', assets: { ...base, mcp } }).assets.mcp;

  assert.deepEqual(
    parse([{ id: 'b' }, { id: 'a', tools: [] }, { id: 'c', tools: ['z', 'a'] }]),
    [{ id: 'a' }, { id: 'b' }, { id: 'c', tools: ['a', 'z'] }],
    'tools 缺省或空数组都表示全部工具，工具名排序归一化',
  );
  assert.deepEqual(parse([{ id: 'a', tools: ['x'] }, { id: 'a' }]), [{ id: 'a' }], '重复条目中任一处未收窄即全量');
  assert.deepEqual(parse([{ id: 'a', tools: ['x'] }, { id: 'a', tools: ['y'] }]), [{ id: 'a', tools: ['x', 'y'] }], '重复条目白名单求并集');

  assert.throws(() => parse(['a']), /mcp/, '字符串条目不可识别');
  assert.throws(() => parse([{ tools: [] }]), /连接器编号/, '缺少 id');
  assert.throws(() => parse([{ id: 'a', tools: 'x' }]), /不是数组/, '工具清单不是数组');
  assert.throws(() => parse([{ id: 'a', tools: [''] }]), /空工具名/, '空工具名');
});

test('工具级判定：白名单外拒绝、未收窄放行、连接器未授权拒绝', () => {
  const open = policy(true, { mcp: true });
  const record = snapshot({ mcp: [{ id: 'c1', tools: ['read_doc'] }, { id: 'c2' }] }, '2999-01-01T00:00:00.000Z');
  const at = (assetId, tool, snap = record, pol = open) => decideTool({ policy: pol, snapshot: snap, assetId, tool, now: 0 });

  assert.equal(at('c1', 'read_doc').allow, true);
  const denied = at('c1', 'delete_doc');
  assert.equal(denied.allow, false);
  assert.equal(denied.reason, 'gate/denied-tool-not-entitled');
  assert.equal(at('c2', 'anything').allow, true, '未收窄的连接器全部工具可用');
  assert.equal(at('c3', 'anything').reason, 'gate/denied-not-entitled', '连接器不在快照内');

  assert.equal(decideTool({ policy: policy(false), snapshot: hostile(), assetId: 'c1', tool: 'x', now: 0 }).reason, 'gate/allowed-open');
  assert.equal(decideTool({ policy: policy(true, { skill: true }), snapshot: hostile(), assetId: 'c1', tool: 'x', now: 0 }).reason, 'gate/allowed-open');
  assert.equal(decideTool({ policy: open, assetId: 'c1', tool: 'x', now: 0 }).reason, 'gate/denied-no-snapshot');
});

test('结构不可识别的快照不撤权：保留旧快照、不写账本、不停进程', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'asset-gate-'));
  const calls = { applyGateState: 0 };
  let malformed;
  const ctx = new Context();
  ctx.provide('workdshIdentity', identity());
  ctx.provide('workdshConnectors', {
    marketAssets: () => [{ localId: 'c1', assetId: 'a1' }],
    applyGateState: () => { calls.applyGateState += 1; },
  });
  ctx.provide('workdshBackend', {
    async available() { return true; },
    async get(path) {
      if (path.endsWith('queryGatePolicy')) return { masterEnabled: true, assetGates: { mcp: true }, revision: 'p1' };
      const assets = {
        skill: [], mcp: [{ id: 'a1' }], expert: [], expert_group: [], model: [], knowledge: [], prompt: [],
      };
      if (malformed === 'entry') {
        // 条目不是对象：连接器结构不可识别。
        return { revision: 'r2', staleAt: '2999-01-01T00:00:00.000Z', assets: { ...assets, mcp: ['a1'] } };
      }
      if (malformed === 'tools') {
        // 工具清单不是数组：同样不可识别。
        return { revision: 'r2', staleAt: '2999-01-01T00:00:00.000Z', assets: { ...assets, mcp: [{ id: 'a1', tools: 'read' }] } };
      }
      if (malformed === 'assets') {
        // 整个授权集合缺失：不能当成「七类都为空」。
        return { revision: 'r2', staleAt: '2999-01-01T00:00:00.000Z', assets: {} };
      }
      return { revision: 'r1', staleAt: '2999-01-01T00:00:00.000Z', assets };
    },
  });
  try {
    await ctx.plugin(AssetGateService, { autoSync: false, stateDir: directory });
    await ctx.workdshAssetGate.sync();
    assert.equal(ctx.workdshAssetGate.snapshot().revision, 'r1');
    const appliedBefore = calls.applyGateState;
    assert.equal(appliedBefore, 1, '正常快照应完成一次对账');

    for (const mode of ['entry', 'tools', 'assets']) {
      malformed = mode;
      await ctx.workdshAssetGate.sync();
      assert.equal(ctx.workdshAssetGate.snapshot().revision, 'r1', `${mode}：必须保留上一份快照`);
      assert.equal(existsSync(join(directory, 'revocations.json')), false, `${mode}：不得写撤权账本`);
      assert.equal(calls.applyGateState, appliedBefore, `${mode}：不得停进程`);
      assert.equal(ctx.workdshAssetGate.revoked('mcp', 'a1'), false, `${mode}：不得标记撤权`);
      assert.equal(
        (await ctx.workdshAssetGate.decide({ assetType: 'mcp', assetId: 'a1', usage: 'use' })).allow,
        true,
        `${mode}：判定仍按旧快照执行`,
      );
    }
  } finally {
    await ctx.fiber.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

test('空快照且本地无已装资产：一次无副作用的空同步', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'asset-gate-'));
  const ctx = new Context();
  ctx.provide('workdshIdentity', identity());
  // 注意：applyGateState 是每次对账都会调用的幂等重算入口，不代表停了进程；
  // 这里断言的是「没有撤权标记、没有账本」。
  ctx.provide('workdshConnectors', {
    marketAssets: () => [],
    applyGateState: () => undefined,
  });
  ctx.provide('workdshBackend', {
    async available() { return true; },
    async get(path) {
      if (path.endsWith('queryGatePolicy')) return { masterEnabled: true, assetGates: { mcp: true }, revision: 'p1' };
      return {
        revision: 'r1', staleAt: '2999-01-01T00:00:00.000Z',
        assets: { skill: [], mcp: [], expert: [], expert_group: [], model: [], knowledge: [], prompt: [] },
      };
    },
  });
  try {
    await ctx.plugin(AssetGateService, { autoSync: false, stateDir: directory });
    await ctx.workdshAssetGate.sync();
    assert.equal(ctx.workdshAssetGate.snapshot().revision, 'r1', '空快照是合法快照，必须被接受');
    assert.equal(ctx.workdshAssetGate.revoked('mcp', 'a1'), false, '不得凭空产生撤权标记');
    assert.equal(existsSync(join(directory, 'revocations.json')), false, '没有已装资产时不得生成撤权账本');
  } finally {
    await ctx.fiber.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

test('七类齐全的空快照是合法撤权，与「读不懂」分开处理', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'asset-gate-'));
  let empty = false;
  const calls = { applyGateState: 0 };
  const ctx = new Context();
  ctx.provide('workdshIdentity', identity());
  ctx.provide('workdshConnectors', {
    marketAssets: () => [{ localId: 'c1', assetId: 'a1' }],
    applyGateState: () => { calls.applyGateState += 1; },
  });
  ctx.provide('workdshBackend', {
    async available() { return true; },
    async get(path) {
      if (path.endsWith('queryGatePolicy')) return { masterEnabled: true, assetGates: { mcp: true }, revision: 'p1' };
      const assets = { skill: [], mcp: empty ? [] : [{ id: 'a1' }], expert: [], expert_group: [], model: [], knowledge: [], prompt: [] };
      return { revision: empty ? 'r2' : 'r1', staleAt: '2999-01-01T00:00:00.000Z', assets };
    },
  });
  try {
    await ctx.plugin(AssetGateService, { autoSync: false, stateDir: directory });
    await ctx.workdshAssetGate.sync();
    assert.equal(ctx.workdshAssetGate.revoked('mcp', 'a1'), false);

    empty = true;
    await ctx.workdshAssetGate.sync();
    assert.equal(ctx.workdshAssetGate.snapshot().revision, 'r2', '合法空快照必须被接受');
    assert.equal(ctx.workdshAssetGate.revoked('mcp', 'a1'), true, '真实撤权仍需标记');
    assert.equal(calls.applyGateState, 2, '撤权后需要重算运行态');
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(existsSync(join(directory, 'revocations.json')), true, '真实撤权应落账本');
  } finally {
    await ctx.fiber.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

test('闸门开启后同步策略与快照，按账号隔离并复用加密磁盘缓存', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'asset-gate-'));
  const calls = { revisions: [] };
  let principal = 'user-a';
  const provide = ctx => {
    ctx.provide('workdshIdentity', {
      profile: () => ({ principalId: principal, organization: { id: 'org' } }),
      async backendBinding() { return { url: 'http://backend.test', authorization: 'token-a' }; },
    });
    ctx.provide('workdshBackend', {
      async available() { return true; },
      async get(path, query) {
        if (path.endsWith('queryGatePolicy')) {
          return { masterEnabled: true, assetGates: { skill: true }, revision: 'p1' };
        }
        calls.revisions.push(query?.revision);
        if (query?.revision === 'r1') return { revision: 'r1', unchanged: true };
        return {
          revision: 'r1',
          staleAt: '2999-01-01T00:00:00.000Z',
          assets: { skill: ['s1'], mcp: [], expert: [], expert_group: [], model: [], knowledge: [], prompt: [] },
        };
      },
    });
  };

  try {
    const ctx = new Context();
    provide(ctx);
    await ctx.plugin(AssetGateService, { autoSync: false, stateDir: directory });
    try {
      await ctx.workdshAssetGate.sync();
      assert.equal((await ctx.workdshAssetGate.decide({ assetType: 'skill', assetId: 's1', usage: 'use' })).allow, true);
      assert.equal((await ctx.workdshAssetGate.decide({ assetType: 'skill', assetId: 's2', usage: 'use' })).reason, 'gate/denied-not-entitled');
      // 子闸门关闭的类型不判定：model 未开启时即使没有授权也放行。
      assert.equal((await ctx.workdshAssetGate.decide({ assetType: 'model', assetId: 'm1', usage: 'use' })).allow, true);
    } finally {
      await ctx.fiber.dispose();
    }

    // 模拟重启：先从加密磁盘恢复快照，再带 revision 命中后台，不重新拉全量。
    const restarted = new Context();
    provide(restarted);
    await restarted.plugin(AssetGateService, { autoSync: false, stateDir: directory });
    try {
      await restarted.workdshAssetGate.sync();
      assert.equal(calls.revisions.at(-1), 'r1');
      assert.equal((await restarted.workdshAssetGate.decide({ assetType: 'skill', assetId: 's1', usage: 'use' })).allow, true);

      // 切号后不得复用上一账号的 revision 或内存/磁盘快照。
      principal = 'user-b';
      await restarted.workdshAssetGate.sync();
      assert.equal(calls.revisions.at(-1), undefined);
    } finally {
      await restarted.fiber.dispose();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
