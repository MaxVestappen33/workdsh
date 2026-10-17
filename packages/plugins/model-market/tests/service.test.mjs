import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ModelMarketService } from '../dist/service.js';

const base = {
  provider: 'DEEPSEEK', provider_dictText: 'DeepSeek', version: 'v1.0.0', modelType: 'LLM',
  modelType_dictText: '大语言模型', contextLength: '128K', icon: '', apiProtocol: '01',
  apiProtocol_dictText: 'OpenAI 兼容', apiUrl: 'https://api.deepseek.com', owner: '管理员',
  depart_dictText: '同云数字', description: '测试模型', tag: 'deepseek,flash', status: '3',
  createTime: '2026-10-17 11:17:32', updateTime: '2026-10-17 11:17:32',
};

function applyOps(value, ops) {
  const next = structuredClone(value ?? {});
  for (const op of ops) {
    let target = next;
    for (const key of op.path.slice(0, -1)) {
      if (!target[key] || typeof target[key] !== 'object') target[key] = {};
      target = target[key];
    }
    const last = op.path.at(-1);
    if (op.op === 'set') target[last] = structuredClone(op.value);
    else delete target[last];
  }
  return next;
}

function harness(models) {
  const sections = new Map([
    ['llm-pi-ai', { value: { providers: {} }, revision: 1 }],
    ['agent-default-model', { value: {}, revision: 1 }],
  ]);
  const secrets = new Map();
  const calls = [];
  const settings = {
    writable: true,
    describe() {
      return [...sections.entries()].map(([ns, row]) => ({ ns, value: structuredClone(row.value), revision: row.revision }));
    },
    async mutate(ns, ops, revision) {
      const row = sections.get(ns);
      assert.ok(row, `unknown namespace ${ns}`);
      assert.equal(revision, row.revision);
      row.value = applyOps(row.value, ops);
      row.revision += 1;
    },
  };
  const credentials = {
    async describe(ref) { return { configured: secrets.has(ref), writable: true }; },
    async resolve(ref) { return secrets.has(ref) ? { value: secrets.get(ref), source: 'file' } : undefined; },
    async set(ref, value) { secrets.set(ref, value); },
    async unset(ref) { secrets.delete(ref); },
  };
  const channel = {
    async available() { return true; },
    async get(_path, query) {
      const row = models[query.id];
      return { records: row ? [row] : [], total: row ? 1 : 0, pages: row ? 1 : 0, size: 1, current: 1 };
    },
    async post(_path, body) { calls.push(body.id); },
  };
  const ctx = {
    reflect: { provide() {}, get(name) { return name === 'workdshBackend' ? channel : undefined; } },
    effect() { return () => {}; },
    logger: { warn() {} },
    settings,
    credentials,
  };
  return { ctx, sections, secrets, calls };
}

test('安装按供应商聚合、写凭据并同步会话默认', async () => {
  const home = await mkdtemp(join(tmpdir(), 'workdsh-model-market-service-'));
  const previous = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  try {
    const models = {
      1: { ...base, id: '1', modelName: 'DeepSeek-V4.1-Flash', modelCode: 'deepseek-flash', isDefault: '1', apiKey: 'sk-1' },
      2: { ...base, id: '2', modelName: 'DeepSeek-R1', modelCode: 'deepseek-r1', isDefault: '0', apiKey: 'sk-1' },
    };
    const { ctx, sections, secrets, calls } = harness(models);
    const service = new ModelMarketService(ctx, {});

    const first = await service.install('1');
    assert.equal(first.route, 'workdsh-deepseek');
    const providers = () => sections.get('llm-pi-ai').value.providers;
    assert.deepEqual(providers()['workdsh-deepseek'].models.map(row => row.id), ['deepseek-flash']);
    assert.equal(providers()['workdsh-deepseek'].api, 'openai-completions');
    assert.equal(providers()['workdsh-deepseek'].apiKeyEnv, 'WORKDSH_DEEPSEEK_API_KEY');
    assert.equal(secrets.get('WORKDSH_DEEPSEEK_API_KEY'), 'sk-1');
    assert.deepEqual(sections.get('agent-default-model').value, { provider: 'workdsh-deepseek', model: 'deepseek-flash' });

    const second = await service.install('2');
    assert.equal(second.route, 'workdsh-deepseek');
    assert.deepEqual(providers()['workdsh-deepseek'].models.map(row => row.id), ['deepseek-flash', 'deepseek-r1']);
    assert.deepEqual((await service.list({})).installedIds.sort(), ['1', '2']);

    await service.uninstall('1');
    assert.deepEqual(sections.get('llm-pi-ai').value.providers['workdsh-deepseek'].models.map(row => row.id), ['deepseek-r1']);
    assert.equal(sections.get('agent-default-model').value.provider, undefined);

    await service.uninstall('2');
    assert.equal(sections.get('llm-pi-ai').value.providers['workdsh-deepseek'], undefined);
    assert.equal(secrets.has('WORKDSH_DEEPSEEK_API_KEY'), false);
    assert.deepEqual(calls, ['1', '2', '1', '2']);
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previous;
    await rm(home, { recursive: true, force: true });
  }
});

test('非默认模型安装不会改写会话默认', async () => {
  const home = await mkdtemp(join(tmpdir(), 'workdsh-model-market-service-'));
  const previous = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  try {
    const models = {
      3: { ...base, id: '3', modelName: 'Qwen3', modelCode: 'qwen3', provider: 'QWEN', apiProtocol: '02', apiUrl: 'https://qwen.example', isDefault: '0', apiKey: 'sk-3' },
    };
    const { ctx, sections } = harness(models);
    await new ModelMarketService(ctx, {}).install('3');
    assert.deepEqual(sections.get('agent-default-model').value, {});
    const provider = sections.get('llm-pi-ai').value.providers['workdsh-qwen'];
    assert.equal(provider.api, 'anthropic-messages');
    assert.deepEqual(provider.models[0].input, ['text']);
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previous;
    await rm(home, { recursive: true, force: true });
  }
});

test('自定义模型安装、列出与卸载', async () => {
  const home = await mkdtemp(join(tmpdir(), 'workdsh-model-market-service-'));
  const previous = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  try {
    const { ctx, sections, secrets } = harness({});
    const service = new ModelMarketService(ctx, {});
    const entry = await service.customInstall({
      providerId: 'acme-gateway',
      displayName: 'Acme 网关',
      apiUrl: 'https://gateway.acme.example/v1',
      apiProtocol: 'openai-completions',
      apiKey: 'sk-custom',
      setDefault: true,
      models: [{ id: 'acme-think', name: 'Acme Think', contextWindow: 262144, maxTokens: 32768, input: ['text', 'image'] }],
    });
    assert.equal(entry.key, 'custom:acme-gateway');
    const provider = sections.get('llm-pi-ai').value.providers['acme-gateway'];
    assert.equal(provider.displayName, 'Acme 网关');
    assert.equal(provider.api, 'openai-completions');
    assert.equal(provider.baseURL, 'https://gateway.acme.example/v1');
    assert.equal(provider.apiKeyEnv, 'ACME_GATEWAY_API_KEY');
    assert.deepEqual(provider.models[0].input, ['text', 'image']);
    assert.equal(provider.models[0].maxTokens, 32768);
    assert.equal(secrets.get('ACME_GATEWAY_API_KEY'), 'sk-custom');
    assert.deepEqual(sections.get('agent-default-model').value, { provider: 'acme-gateway', model: 'acme-think' });

    const listed = await service.customList();
    assert.equal(listed.length, 1);
    assert.equal(listed[0].displayName, 'Acme 网关');
    assert.equal(listed[0].isDefault, true);
    assert.deepEqual(listed[0].models.map(model => model.id), ['acme-think']);

    await service.customUninstall('custom:acme-gateway');
    assert.equal(sections.get('llm-pi-ai').value.providers['acme-gateway'], undefined);
    assert.equal(secrets.has('ACME_GATEWAY_API_KEY'), false);
    assert.deepEqual(await service.customList(), []);
    assert.deepEqual(sections.get('agent-default-model').value, {});
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previous;
    await rm(home, { recursive: true, force: true });
  }
});
