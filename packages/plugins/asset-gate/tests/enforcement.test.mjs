import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Context } from '@deepseek-ai/cordis';
import { installAssetGateEnforcement, resetEnforcementState } from '../dist/index.js';

const NOT_ENTITLED = '当前账号未获得该项资产的授权。';
const NOT_LISTED = '该资产未上架或未登记，请先提交上架申请，审批通过后从市场安装。';
const signal = { throwIfAborted() {} };

const manifest = (source, assetId) => ({ assetType: 'x', source, ...(assetId ? { assetId } : {}) });

/** 只保留判定需要的字段：name / arguments / agent / token。 */
const execution = (name, options = {}) => ({
  name,
  arguments: options.arguments ?? {},
  agent: 'agent' in options ? options.agent : { id: 'agent-1' },
  token: Symbol(name),
});

function fakeGate(types = []) {
  const gate = {
    types: new Set(types),
    entitled: new Set(),
    signature: false,
    async decide({ assetType, assetId }) {
      return gate.entitled.has(`${assetType}:${assetId}`)
        ? { allow: true, reason: 'gate/allowed-entitled', message: '当前账号已获得该项资产的授权。' }
        : { allow: false, reason: 'gate/denied-not-entitled', message: NOT_ENTITLED };
    },
    unlisted() { return { reason: 'gate/denied-not-listed', message: NOT_LISTED }; },
  };
  gate.enabled = type => gate.types.has(type);
  gate.signatureEnabled = () => gate.signature;
  return gate;
}

function harness({ gate, connectors, skills, models }) {
  const ctx = new Context();
  const guards = [];
  const reads = [];
  ctx.provide('workdshAssetGate', gate);
  ctx.provide('workdshConnectors', connectors ?? {
    connectorAssetForTool(toolName) { reads.push(`connector:${toolName}`); return { found: false }; },
  });
  ctx.provide('workdshSkills', skills ?? {
    async installManifest(name) { reads.push(`skill:${name}`); return undefined; },
  });
  if (models) ctx.provide('workdshModelMarket', models);
  ctx.provide('tools', {
    guard(guard) {
      guards.push(guard);
      return () => { const index = guards.indexOf(guard); if (index >= 0) guards.splice(index, 1); };
    },
  });
  const dispose = installAssetGateEnforcement(ctx);
  return { ctx, guards, reads, dispose };
}

const preExecute = (ctx, exec, fallback = async () => ({ kind: 'allow' })) => ctx.waterfall('tools/pre-execute', exec, fallback);
const preStep = (ctx, payload, messages) => ctx.waterfall('agent/pre-step', payload, async () => ({ kind: 'enter', messages }));
const request = (ctx, config) => ctx.waterfall('agent/request', { agent: {}, turn: 1, step: 1, signal }, async () => config);

const injection = (name, text) => ({ id: `i-${name}`, source: { kind: 'skill-invocation', form: 'instructions', name }, content: [{ type: 'text', text }] });
const catalog = (entries) => ({
  id: 'c1',
  source: { kind: 'skill-catalog', form: 'catalog', entries },
  content: [{ type: 'text', text: `<available_skills>\n${entries.map(entry => `- \`${entry.name}\`: ${entry.description}`).join('\n')}\n</available_skills>` }],
});

test('闸门关闭时不注册拦截钩子：不读清单、不建 guard，开闸后才拉起', async () => {
  resetEnforcementState();
  const gate = fakeGate();
  const { ctx, guards, reads } = harness({ gate });
  const exec = execution('mcp__server__search');
  const denied = injection('bad', 'bad body');
  const payload = { agent: {}, messages: [denied], signal };

  assert.equal(guards.length, 0);
  assert.equal((await preExecute(ctx, exec)).kind, 'allow');
  const untouched = await preStep(ctx, payload, [denied]);
  assert.deepEqual(untouched.messages.map(message => message.id), ['i-bad'], '技能过滤未注册');
  assert.deepEqual(reads, [], '闸门关闭时不得读取任何清单');

  // 只开 MCP 子闸门：注册工具钩子，但不注册技能消息过滤。
  gate.types = new Set(['mcp']);
  ctx.emit('workdsh/asset-gate/policy', {});
  assert.equal(guards.length, 1);
  const stillUntouched = await preStep(ctx, payload, [denied]);
  assert.deepEqual(stillUntouched.messages.map(message => message.id), ['i-bad']);
  assert.deepEqual(reads, [], '技能子闸门关闭时不读技能清单');
  reads.length = 0;

  // 关闸：guard 注销，回到零开销。
  gate.types = new Set();
  ctx.emit('workdsh/asset-gate/policy', {});
  assert.equal(guards.length, 0, '关闸后 guard 必须注销');
  assert.equal((await preExecute(ctx, exec)).kind, 'allow');
  assert.deepEqual(reads, []);
});

test('MCP 工具按连接器清单判定：市场编号授权、内置与残留放行、自建拒绝', async () => {
  resetEnforcementState();
  const gate = fakeGate(['mcp']);
  gate.entitled.add('mcp:a1');
  const table = {
    'mcp__allowed__search': { found: true, bundled: false, manifest: manifest('market', 'a1') },
    'mcp__denied__search': { found: true, bundled: false, manifest: manifest('market', 'a2') },
    'mcp__builtin__search': { found: true, bundled: false, manifest: manifest('builtin') },
    'mcp__bundled__search': { found: true, bundled: true },
    'mcp__local__search': { found: true, bundled: false, manifest: manifest('local') },
    'mcp__bare__search': { found: true, bundled: false },
    'mcp__gone__search': { found: false },
  };
  const { ctx } = harness({ gate, connectors: { connectorAssetForTool: name => table[name] } });

  for (const name of ['mcp__allowed__search', 'mcp__builtin__search', 'mcp__bundled__search', 'mcp__gone__search', 'other-tool']) {
    assert.equal((await preExecute(ctx, execution(name))).kind, 'allow', name);
  }
  assert.equal((await preExecute(ctx, execution('mcp__denied__search', { agent: undefined }))).kind, 'allow', 'Host 内部调用放行');

  const denied = await preExecute(ctx, execution('mcp__denied__search'));
  assert.equal(denied.kind, 'deny');
  assert.equal(denied.reason, NOT_ENTITLED, 'reason 只放中文文案');
  assert.equal(denied.info.code, 'gate/denied-not-entitled', '稳定原因码只进 info');

  for (const name of ['mcp__local__search', 'mcp__bare__search']) {
    const decision = await preExecute(ctx, execution(name));
    assert.equal(decision.kind, 'deny', name);
    assert.equal(decision.info.code, 'gate/denied-not-listed', name);
    assert.equal(decision.reason, NOT_LISTED, name);
  }
});

test('skill 工具按 arguments.name 定位清单；无 agent 与参数不合法时不读清单', async () => {
  resetEnforcementState();
  const gate = fakeGate(['skill']);
  gate.entitled.add('skill:s1');
  const manifests = {
    allowed: manifest('market', 's1'),
    denied: manifest('market', 's2'),
    builtin: manifest('builtin'),
    local: manifest('local'),
  };
  const reads = [];
  const { ctx } = harness({ gate, skills: { async installManifest(name) { reads.push(name); return manifests[name]; } } });

  assert.equal((await preExecute(ctx, execution('skill', { arguments: { name: 'allowed' } }))).kind, 'allow');
  assert.equal((await preExecute(ctx, execution('skill', { arguments: { name: 'builtin' } }))).kind, 'allow');
  assert.equal((await preExecute(ctx, execution('skill', { arguments: { name: 'local' } }))).kind, 'deny');
  assert.equal((await preExecute(ctx, execution('skill', { arguments: { name: 'denied' } }))).info.code, 'gate/denied-not-entitled');
  assert.equal((await preExecute(ctx, execution('skill', { arguments: {} }))).kind, 'allow');
  assert.equal((await preExecute(ctx, execution('skill', { arguments: { name: 'denied' }, agent: undefined }))).kind, 'allow');

  assert.deepEqual(reads, ['allowed', 'builtin', 'local', 'denied'], '无 agent 与参数缺失的调用不读清单');
});

test('调用期完整性：验签开启时市场技能比对摘要，篡改与无签名分别拒绝', async () => {
  resetEnforcementState();
  const gate = fakeGate(['skill']);
  gate.signature = true;
  gate.entitled.add('skill:s1');
  const verdicts = {
    good: { ok: true },
    tampered: { ok: false, reason: 'digest-mismatch' },
    unsigned: { ok: false, reason: 'signature-missing' },
  };
  const manifests = {
    good: manifest('market', 's1'),
    tampered: manifest('market', 's1'),
    unsigned: manifest('market', 's1'),
    builtin: manifest('builtin'),
    local: manifest('local'),
  };
  const calls = [];
  const audits = [];
  gate.auditDenied = event => audits.push(event);
  const { ctx, guards } = harness({
    gate,
    skills: {
      async installManifest(name) { return manifests[name]; },
      async verifyInstalledDigests(name) { calls.push(name); return verdicts[name]; },
    },
  });

  // 授权 + 摘要一致：放行。
  assert.equal((await preExecute(ctx, execution('skill', { arguments: { name: 'good' } }))).kind, 'allow');

  // 授权后内容被改：独立原因码，与「未授权」「无签名块」区分。
  const tamperedExec = execution('skill', { arguments: { name: 'tampered' } });
  const tampered = await preExecute(ctx, tamperedExec);
  assert.equal(tampered.kind, 'deny');
  assert.equal(tampered.info.code, 'gate/denied-integrity-broken');
  assert.match(tampered.reason, /与安装时的记录不一致/);
  assert.equal(guards[0](tamperedExec), tampered.reason, 'guard 与 pre-execute 口径一致');
  assert.deepEqual(
    audits.at(-1),
    { layer: 'call_skill', reasonCode: 'gate/denied-integrity-broken', assetType: 'skill', assetId: 's1', toolName: 'skill' },
  );

  // 装在验签关闭期（市场来源无签名块）：按重装语义拒绝，而不是「内容被改」。
  const unsigned = await preExecute(ctx, execution('skill', { arguments: { name: 'unsigned' } }));
  assert.equal(unsigned.info.code, 'gate/denied-signature-missing');

  // 内置放行；自建仍按未登记拒绝。两者都不进入摘要校验。
  assert.equal((await preExecute(ctx, execution('skill', { arguments: { name: 'builtin' } }))).kind, 'allow');
  assert.equal((await preExecute(ctx, execution('skill', { arguments: { name: 'local' } }))).info.code, 'gate/denied-not-listed');
  assert.deepEqual(calls, ['good', 'tampered', 'unsigned'], '只有市场来源且授权通过才做摘要校验');
});

test('调用期完整性：子闸门关闭、未授权、宿主未提供校验时都不读盘', async () => {
  resetEnforcementState();
  const gate = fakeGate(['skill']);
  gate.entitled.add('skill:s1');
  const manifests = { allowed: manifest('market', 's1'), denied: manifest('market', 's2'), tampered: manifest('market', 's1') };
  const calls = [];
  const skills = {
    async installManifest(name) { return manifests[name]; },
    async verifyInstalledDigests(name) { calls.push(name); return { ok: false, reason: 'digest-mismatch' }; },
  };

  // 验签子闸门关闭：完整性校验整体跳过（行为与加校验前一致）。
  const audits = [];
  gate.auditDenied = event => audits.push(event);
  let harnessed = harness({ gate, skills });
  assert.equal((await preExecute(harnessed.ctx, execution('skill', { arguments: { name: 'tampered' } }))).kind, 'allow');
  assert.deepEqual(calls, [], '验签关闭时不校验摘要');
  assert.deepEqual(audits, [], '放行路径不写审计');
  delete gate.auditDenied;

  // 验签开启但未授权：授权拒绝优先，不额外读盘。
  gate.signature = true;
  calls.length = 0;
  harnessed = harness({ gate, skills });
  assert.equal((await preExecute(harnessed.ctx, execution('skill', { arguments: { name: 'denied' } }))).info.code, 'gate/denied-not-entitled');
  assert.deepEqual(calls, [], '未授权时不进入完整性校验');

  // 宿主没有 verifyInstalledDigests：不能假装校验过，按最小权限拒绝。
  resetEnforcementState();
  harnessed = harness({ gate, skills: { async installManifest() { return manifest('market', 's1'); } } });
  const missing = await preExecute(harnessed.ctx, execution('skill', { arguments: { name: 'allowed' } }));
  assert.equal(missing.kind, 'deny');
  assert.equal(missing.info.code, 'gate/denied-integrity-broken');
});

test('调用期完整性：校验抛异常时按内容不可信拒绝，不裸抛内部错误', async () => {
  resetEnforcementState();
  const gate = fakeGate(['skill']);
  gate.signature = true;
  gate.entitled.add('skill:s1');
  const { ctx } = harness({
    gate,
    skills: {
      async installManifest() { return manifest('market', 's1'); },
      async verifyInstalledDigests() { throw new Error('disk offline'); },
    },
  });

  const decision = await preExecute(ctx, execution('skill', { arguments: { name: 'boom' } }));
  assert.equal(decision.kind, 'deny');
  assert.equal(decision.info.code, 'gate/denied-integrity-broken');
});

test('guard 单调拒绝：外层把 deny 翻成 allow 后仍然拒绝同一执行', async () => {
  resetEnforcementState();
  const gate = fakeGate(['mcp']);
  const ctx = new Context();
  const guards = [];
  ctx.provide('workdshAssetGate', gate);
  ctx.provide('workdshConnectors', {
    connectorAssetForTool: () => ({ found: true, bundled: false, manifest: manifest('local') }),
  });
  ctx.provide('workdshSkills', { async installManifest() { return undefined; } });
  ctx.provide('tools', { guard(guard) { guards.push(guard); return () => { const index = guards.indexOf(guard); if (index >= 0) guards.splice(index, 1); }; } });
  // 外层监听先注册：拿到内层结果后无条件改成 allow，模拟其他插件翻案。
  ctx.on('tools/pre-execute', async (exec, next) => { await next(); return { kind: 'allow' }; });
  installAssetGateEnforcement(ctx);

  const exec = execution('mcp__local__search');
  assert.equal((await preExecute(ctx, exec)).kind, 'allow', 'waterfall 结果被外层改写');
  assert.equal(guards.length, 1);
  assert.equal(guards[0](exec), NOT_LISTED, 'guard 仍拒绝同一执行');
});

test('工具判定抛异常时一律拒绝，guard 与 pre-execute 口径一致', async () => {
  resetEnforcementState();
  const gate = fakeGate(['skill']);
  gate.decide = async () => { throw new Error('snapshot corrupted'); };
  const { ctx, guards } = harness({ gate, skills: { async installManifest() { return manifest('market', 'a1'); } } });

  const exec = execution('skill', { arguments: { name: 'boom' } });
  const decision = await preExecute(ctx, exec);
  assert.equal(decision.kind, 'deny');
  assert.equal(decision.info.code, 'gate/denied-evaluation-error');
  assert.match(decision.reason, /判定出现异常/);
  assert.equal(guards[0](exec), decision.reason, 'guard 必须同样拒绝，不能一层拒一层放');
});

test('连接器反查抛异常时同样按判定异常拒绝', async () => {
  resetEnforcementState();
  const gate = fakeGate(['mcp']);
  const { ctx } = harness({ gate, connectors: { connectorAssetForTool() { throw new Error('lookup failed'); } } });

  const decision = await preExecute(ctx, execution('mcp__x__search'));
  assert.equal(decision.kind, 'deny');
  assert.equal(decision.info.code, 'gate/denied-evaluation-error');
});

test('模型判定抛异常时按判定异常拒绝，而不是裸抛内部错误', async () => {
  resetEnforcementState();
  const gate = fakeGate(['model']);
  gate.decide = async () => { throw new Error('snapshot corrupted'); };
  const { ctx } = harness({
    gate,
    models: { async installManifestOfModel() { return { kind: 'market', source: 'market', assetId: 'm1' }; } },
  });

  await assert.rejects(
    () => request(ctx, { provider: 'p', model: 'm' }),
    error => error.code === 'gate/denied-evaluation-error',
  );
});

test('guard 对放行的执行返回 undefined，不改变结果', async () => {
  resetEnforcementState();
  const gate = fakeGate(['mcp']);
  const { ctx, guards } = harness({
    gate,
    connectors: { connectorAssetForTool: () => ({ found: true, bundled: true }) },
  });
  const exec = execution('mcp__bundled__search');
  assert.equal((await preExecute(ctx, exec)).kind, 'allow');
  assert.equal(guards[0](exec), undefined);
});

test('pre-step 完整性：被篡改技能从斜杠注入与目录中剔除，审计走注入层', async () => {
  resetEnforcementState();
  const gate = fakeGate(['skill']);
  gate.signature = true;
  gate.entitled.add('skill:s1');
  const manifests = {
    good: manifest('market', 's1'),
    bad: manifest('market', 's1'),
    builtin: manifest('builtin'),
  };
  const calls = [];
  const audits = [];
  gate.auditDenied = event => audits.push(event);
  const { ctx } = harness({
    gate,
    skills: {
      async installManifest(name) { return manifests[name]; },
      async verifyInstalledDigests(name) {
        calls.push(name);
        return name === 'bad' ? { ok: false, reason: 'digest-mismatch' } : { ok: true };
      },
    },
  });

  const messages = [
    { id: 'u1', source: { kind: 'user' }, content: [{ type: 'text', text: '/good /bad /builtin' }] },
    injection('good', 'good body'),
    injection('bad', 'tampered body'),
    injection('builtin', 'builtin body'),
    catalog([
      { name: 'good', description: '正常技能' },
      { name: 'bad', description: '被篡改技能' },
      { name: 'builtin', description: '内置技能' },
    ]),
  ];
  const decision = await preStep(ctx, { agent: {}, messages, signal }, messages);
  assert.deepEqual(decision.messages.map(message => message.id), ['u1', 'i-good', 'i-builtin', 'c1'], '被篡改技能的注入必须剔除');
  const filtered = decision.messages.at(-1);
  assert.deepEqual(filtered.source.entries.map(entry => entry.name), ['good', 'builtin']);
  assert.equal(filtered.content[0].text.includes('`bad`'), false);
  assert.deepEqual(calls, ['good', 'bad'], '内置技能不做摘要校验');
  assert.deepEqual(audits, [{
    layer: 'call_skill_inject',
    reasonCode: 'gate/denied-integrity-broken',
    assetType: 'skill',
    assetId: 's1',
    toolName: 'bad',
  }], '注入阶段用独立 layer 与工具调用区分');
});

test('pre-step 完整性：验签关闭与内置技能都不算摘要、不写审计', async () => {
  resetEnforcementState();
  const gate = fakeGate(['skill']);
  gate.entitled.add('skill:s1');
  const calls = [];
  const audits = [];
  gate.auditDenied = event => audits.push(event);
  const manifests = { market: manifest('market', 's1'), builtin: manifest('builtin') };
  const { ctx } = harness({
    gate,
    skills: {
      async installManifest(name) { return manifests[name]; },
      async verifyInstalledDigests(name) { calls.push(name); return { ok: false, reason: 'digest-mismatch' }; },
    },
  });

  const messages = [injection('market', 'body'), injection('builtin', 'body')];
  const decision = await preStep(ctx, { agent: {}, messages, signal }, messages);
  assert.deepEqual(decision.messages.map(message => message.id), ['i-market', 'i-builtin'], '验签关闭时行为与加校验前一致');
  assert.deepEqual(calls, [], '验签关闭时零校验');

  // 验签开启后内置技能仍放行，只有市场来源才校验。
  gate.signature = true;
  const enabled = await preStep(ctx, { agent: {}, messages, signal }, messages);
  assert.deepEqual(enabled.messages.map(message => message.id), ['i-builtin'], '市场技能被拒、内置保留');
  assert.deepEqual(calls, ['market']);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].layer, 'call_skill_inject');
  assert.equal(audits[0].toolName, 'market');
});

test('pre-step：未授权技能的斜杠注入被移除，已授权保留', async () => {
  resetEnforcementState();
  const gate = fakeGate(['skill']);
  gate.entitled.add('skill:s1');
  const manifests = { good: manifest('market', 's1'), bad: manifest('market', 's2') };
  const { ctx } = harness({ gate, skills: { async installManifest(name) { return manifests[name]; } } });

  const messages = [
    { id: 'u1', source: { kind: 'user' }, content: [{ type: 'text', text: '/good /bad' }] },
    injection('good', 'good body'),
    injection('bad', 'bad body'),
  ];
  const decision = await preStep(ctx, { agent: {}, messages, signal }, messages);
  assert.deepEqual(decision.messages.map(message => message.id), ['u1', 'i-good'], '未授权技能正文不得注入');
  assert.equal(decision.messages[0].content[0].text, '/good /bad', '用户原文保留');
});

test('pre-step：技能目录按授权裁剪条目与正文行', async () => {
  resetEnforcementState();
  const gate = fakeGate(['skill']);
  gate.entitled.add('skill:s1');
  const manifests = {
    good: manifest('market', 's1'),
    bad: manifest('market', 's2'),
    standalone: manifest('builtin'),
  };
  const { ctx } = harness({ gate, skills: { async installManifest(name) { return manifests[name]; } } });

  const entries = [
    { name: 'good', description: '可用技能' },
    { name: 'bad', description: '未授权技能' },
    { name: 'standalone', description: '内置技能' },
  ];
  const message = catalog(entries);
  const decision = await preStep(ctx, { agent: {}, messages: [message], signal }, [message]);
  assert.equal(decision.messages.length, 1);
  const filtered = decision.messages[0];
  assert.deepEqual(filtered.source.entries.map(entry => entry.name), ['good', 'standalone']);
  assert.match(filtered.content[0].text, /- `good`: 可用技能/);
  assert.match(filtered.content[0].text, /- `standalone`: 内置技能/);
  assert.equal(filtered.content[0].text.includes('`bad`'), false, '正文不得残留未授权技能');
});

test('pre-step：过滤流程抛错时移除技能目录与斜杠注入，其余消息保留', async () => {
  resetEnforcementState();
  const gate = fakeGate(['skill']);
  const { ctx } = harness({ gate, skills: { async installManifest() { return manifest('market', 's2'); } } });

  const user = { id: 'u1', source: { kind: 'user' }, content: [{ type: 'text', text: '继续' }] };
  // content 不是数组会让目录重写抛错，用来触发「过滤流程自身失败」的兜底分支。
  const broken = {
    id: 'c1',
    source: { kind: 'skill-catalog', form: 'catalog', entries: [{ name: 'bad', description: '未授权' }] },
    content: 'broken',
  };
  const messages = [user, injection('bad', 'bad body'), broken];
  const decision = await preStep(ctx, { agent: {}, messages, signal }, messages);

  assert.equal(decision.kind, 'enter', '不应拒绝整个 step，普通对话仍需可继续');
  assert.deepEqual(decision.messages.map(message => message.id), ['u1'], '技能目录与斜杠注入都不得放行');
  assert.equal(decision.messages[0].content[0].text, '继续', '普通消息保留');
});

test('pre-step：上下文已有相同过滤结果时丢弃重复重发，滑出窗口时保留', async () => {
  resetEnforcementState();
  const gate = fakeGate(['skill']);
  gate.entitled.add('skill:s1');
  const { ctx } = harness({
    gate,
    skills: { async installManifest(name) { return name === 'good' ? manifest('market', 's1') : manifest('market', 's2'); } },
  });

  const entries = [{ name: 'good', description: '可用' }, { name: 'bad', description: '未授权' }];
  const kept = [entries[0]];
  const session = surface => ({
    seq: 2,
    surface: { nodes: surface },
    eventAt(index) {
      return index === 1
        ? { type: 'user/message', seq: 1, data: { source: { kind: 'skill-catalog', entries: kept } } }
        : undefined;
    },
  });
  const message = catalog(entries);
  const fresh = { id: 'u2', source: { kind: 'user' }, content: [{ type: 'text', text: '继续' }] };

  const visible = await preStep(ctx, { agent: { session: session([1]) }, messages: [fresh, message], signal }, [fresh, message]);
  assert.deepEqual(visible.messages.map(item => item.id), ['u2'], '重复的目录更新应被丢弃');

  const slid = await preStep(ctx, { agent: { session: session([]) }, messages: [fresh, message], signal }, [fresh, message]);
  assert.deepEqual(slid.messages.map(item => item.id), ['u2', 'c1'], '目录滑出窗口时必须保留新消息');
});

test('模型请求层：按 route+modelCode 判定，custom 与自填 provider 豁免', async () => {
  resetEnforcementState();
  const gate = fakeGate(['model']);
  gate.entitled.add('model:m1');
  const lookups = [];
  const table = {
    'market-route/allowed': { kind: 'market', source: 'market', assetId: 'm1' },
    'market-route/denied': { kind: 'market', source: 'market', assetId: 'm2' },
    'market-route/bare': { kind: 'market' },
    'custom-route/local': { kind: 'custom', source: 'local' },
  };
  const { ctx } = harness({
    gate,
    models: { async installManifestOfModel(route, code) { lookups.push(`${route}/${code}`); return table[`${route}/${code}`]; } },
  });

  assert.equal((await request(ctx, { provider: 'market-route', model: 'allowed' })).model, 'allowed');
  assert.equal((await request(ctx, { provider: 'custom-route', model: 'local' })).model, 'local');
  assert.equal((await request(ctx, { provider: 'manual-route', model: 'whatever' })).model, 'whatever', '查不到安装记录按自建豁免');

  await assert.rejects(
    () => request(ctx, { provider: 'market-route', model: 'denied' }),
    error => error.name === 'AssetGateModelDenied' && error.code === 'gate/denied-not-entitled' && error.message === NOT_ENTITLED,
  );
  await assert.rejects(
    () => request(ctx, { provider: 'market-route', model: 'bare' }),
    error => error.code === 'gate/denied-not-listed' && error.message === NOT_LISTED,
  );
  assert.deepEqual(lookups, [
    'market-route/allowed', 'custom-route/local', 'manual-route/whatever', 'market-route/denied', 'market-route/bare',
  ], '只按最终 provider/model 反查');
});

test('模型请求层：子闸门关闭时不注册、不反查，开闸后即时生效', async () => {
  resetEnforcementState();
  const gate = fakeGate();
  const lookups = [];
  const { ctx } = harness({
    gate,
    models: { async installManifestOfModel(route, code) { lookups.push(`${route}/${code}`); return { kind: 'market', source: 'market', assetId: 'm2' }; } },
  });

  assert.equal((await request(ctx, { provider: 'p', model: 'm' })).model, 'm');
  assert.deepEqual(lookups, [], '关闭时不得读取安装记录');

  gate.types = new Set(['model']);
  ctx.emit('workdsh/asset-gate/policy', {});
  await assert.rejects(() => request(ctx, { provider: 'p', model: 'm' }), error => error.code === 'gate/denied-not-entitled');
  assert.deepEqual(lookups, ['p/m']);

  gate.types = new Set();
  ctx.emit('workdsh/asset-gate/policy', {});
  assert.equal((await request(ctx, { provider: 'p', model: 'm' })).model, 'm', '关闸后监听器必须注销');
  assert.deepEqual(lookups, ['p/m']);
});
