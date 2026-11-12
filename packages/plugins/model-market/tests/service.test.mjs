import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ModelMarketService } from '../dist/service.js';

async function until(check, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    if (await check()) return;
    if (Date.now() > deadline) throw new Error('等待条件超时');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

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

function harness(models, options = {}) {
  const defaults = options.defaults ?? [];
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
      // isDefault=1 的列表查询由 ensureDefaults 的种子流程使用。
      if (query?.isDefault === '1') {
        return { records: defaults, total: defaults.length, pages: defaults.length ? 1 : 0, size: 100, current: 1 };
      }
      const row = query?.id === undefined ? undefined : models[query.id];
      if (query?.id !== undefined) {
        return { records: row ? [row] : [], total: row ? 1 : 0, pages: row ? 1 : 0, size: 1, current: 1 };
      }
      const rows = Object.values(models);
      return { records: rows, total: rows.length, pages: rows.length ? 1 : 0, size: 100, current: 1 };
    },
    async post(path, body) { calls.push({ path, body }); },
  };
  const ctx = {
    reflect: {
      provide() {},
      get(name) {
        if (name === 'workdshBackend') return channel;
        if (name === 'workdshAssetGate') return options.gate;
        return undefined;
      },
    },
    effect() { return () => {}; },
    logger: { warn() {} },
    settings,
    credentials,
  };
  return { ctx, sections, secrets, calls };
}

test('资产闸门开启时过滤未授权模型并拒绝未授权安装', async () => {
  const home = await mkdtemp(join(tmpdir(), 'workdsh-model-market-service-'));
  const previous = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  try {
    const models = {
      1: { ...base, id: '1', modelName: 'DeepSeek-V4.1-Flash', modelCode: 'deepseek-flash', isDefault: '0', apiKey: 'sk-1' },
      2: { ...base, id: '2', modelName: 'DeepSeek-R1', modelCode: 'deepseek-r1', isDefault: '0', apiKey: 'sk-1' },
    };
    const gate = {
      enabled: type => type === 'model',
      async decide({ assetId }) {
        return assetId === '1'
          ? { allow: true, reason: 'gate/allowed-entitled', message: '已授权。' }
          : { allow: false, reason: 'gate/denied-not-entitled', message: '当前账号未获得该项资产的授权。' };
      },
    };
    const { ctx } = harness(models, { gate });
    const service = new ModelMarketService(ctx, {});

    assert.deepEqual((await service.list({})).records.map(row => row.id), ['1']);
    await assert.rejects(() => service.install('2'), error => error.code === 'gate/denied-not-entitled');
    // 已授权模型可安装，卸载始终放行。
    await service.install('1');
    await service.uninstall('1');
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previous;
    await rm(home, { recursive: true, force: true });
  }
});

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
    // clientId 来自插件配置（宿主从 server.appId 注入），不再取设备标识。
    const service = new ModelMarketService(ctx, { clientId: 'police-assistant' });

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

    // 已安装的模型再次点击添加属于覆盖安装：不产生新的 install 上报。
    await service.install('1');
    assert.equal(calls.filter(call => call.body.assetId === '1' && call.body.operationType === 'install').length, 1);

    await service.uninstall('1');
    assert.deepEqual(sections.get('llm-pi-ai').value.providers['workdsh-deepseek'].models.map(row => row.id), ['deepseek-r1']);
    assert.equal(sections.get('agent-default-model').value.provider, undefined);

    await service.uninstall('2');
    assert.equal(sections.get('llm-pi-ai').value.providers['workdsh-deepseek'], undefined);
    assert.equal(secrets.has('WORKDSH_DEEPSEEK_API_KEY'), false);

    // 安装/卸载都实时上报到统一接口，一次一条且不带旧 useModel/unUseModel 路径。
    assert.deepEqual(
      calls.map(call => [call.path, call.body.assetType, call.body.assetId, call.body.operationType, call.body.operationResult]),
      [
        ['/desktop-client/asset/operation/report', 'model', '1', 'install', 'success'],
        ['/desktop-client/asset/operation/report', 'model', '2', 'install', 'success'],
        ['/desktop-client/asset/operation/report', 'model', '1', 'uninstall', 'success'],
        ['/desktop-client/asset/operation/report', 'model', '2', 'uninstall', 'success'],
      ],
    );
    assert.equal(calls[0].body.clientId, 'police-assistant');
    assert.match(calls[0].body.operationTime, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u);
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previous;
    await rm(home, { recursive: true, force: true });
  }
});

test('安装失败上报 failed 与失败码，且失败不影响原有安装记录', async () => {
  const home = await mkdtemp(join(tmpdir(), 'workdsh-model-market-service-'));
  const previous = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  try {
    const models = {
      9: { ...base, id: '9', modelName: '缺密钥模型', modelCode: 'no-key', apiKey: '' },
    };
    const { ctx, calls } = harness(models);
    await assert.rejects(new ModelMarketService(ctx, { clientId: 'police-assistant' }).install('9'));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].path, '/desktop-client/asset/operation/report');
    assert.equal(calls[0].body.assetType, 'model');
    assert.equal(calls[0].body.assetId, '9');
    assert.equal(calls[0].body.operationType, 'install');
    assert.equal(calls[0].body.operationResult, 'failed');
    assert.equal(calls[0].body.failReason, 'other');
    assert.match(calls[0].body.failDetail, /访问密钥/u);
    assert.equal(calls[0].body.clientId, 'police-assistant');
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

test('执行期反查按 route + modelCode 命中，且按账号隔离', async () => {
  const home = await mkdtemp(join(tmpdir(), 'workdsh-model-market-lookup-'));
  const previous = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  try {
    const models = {
      1: { ...base, id: '1', modelName: 'DeepSeek-V4.1-Flash', modelCode: 'deepseek-flash', isDefault: '1', apiKey: 'sk-1' },
    };
    const accountA = join(home, 'accounts', 'member-a');
    const accountB = join(home, 'accounts', 'member-b');
    const serviceA = new ModelMarketService(harness(models).ctx, { stateDir: accountA });
    await serviceA.install('1');

    assert.deepEqual(await serviceA.installManifestOfModel('workdsh-deepseek', 'deepseek-flash'), {
      kind: 'market', source: 'market', assetId: '1',
    });
    assert.equal(await serviceA.installManifestOfModel('workdsh-deepseek', 'deepseek-r1'), undefined);
    assert.equal(await serviceA.installManifestOfModel('other-route', 'deepseek-flash'), undefined, 'route 不匹配不得命中');
    assert.equal(await serviceA.installManifestOfModel('', 'deepseek-flash'), undefined);

    const serviceB = new ModelMarketService(harness(models).ctx, { stateDir: accountB });
    assert.equal(await serviceB.installManifestOfModel('workdsh-deepseek', 'deepseek-flash'), undefined, '反查必须按账号隔离');

    await serviceA.customInstall({
      providerId: 'acme-gateway', displayName: 'Acme', apiUrl: 'https://gw.example/v1',
      apiProtocol: 'openai-completions', apiKey: 'sk-custom',
      models: [{ id: 'acme-think', name: 'Acme Think', input: ['text'] }],
    });
    assert.deepEqual(await serviceA.installManifestOfModel('acme-gateway', 'acme-think'), { kind: 'custom', source: 'local' });

    await serviceA.uninstall('1');
    assert.equal(await serviceA.installManifestOfModel('workdsh-deepseek', 'deepseek-flash'), undefined);
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
      defaultReasoning: 'high',
      models: [{
        id: 'acme-think', name: 'Acme Think', contextWindow: 262144, maxTokens: 32768, input: ['text', 'image'],
        reasoningEfforts: { off: null, low: 'low', high: 'high' },
      }],
    });
    assert.equal(entry.key, 'custom:acme-gateway');
    const provider = sections.get('llm-pi-ai').value.providers['acme-gateway'];
    assert.equal(provider.displayName, 'Acme 网关');
    assert.equal(provider.api, 'openai-completions');
    assert.equal(provider.baseURL, 'https://gateway.acme.example/v1');
    assert.equal(provider.apiKeyEnv, 'ACME_GATEWAY_API_KEY');
    assert.equal(provider.reasoning, 'high');
    assert.deepEqual(provider.models[0].input, ['text', 'image']);
    assert.equal(provider.models[0].maxTokens, 32768);
    assert.deepEqual(provider.models[0].reasoningEfforts, { off: null, low: 'low', high: 'high' });
    assert.equal(secrets.get('ACME_GATEWAY_API_KEY'), 'sk-custom');
    assert.deepEqual(sections.get('agent-default-model').value, { provider: 'acme-gateway', model: 'acme-think' });

    const listed = await service.customList();
    assert.equal(listed.length, 1);
    assert.equal(listed[0].displayName, 'Acme 网关');
    assert.equal(listed[0].isDefault, true);
    assert.equal(listed[0].defaultReasoning, 'high');
    assert.deepEqual(listed[0].models.map(model => model.id), ['acme-think']);
    assert.deepEqual(listed[0].models[0].reasoningEfforts, { off: null, low: 'low', high: 'high' });

    // 清空默认档位时删除 provider 的 reasoning 字段，回到「跟随供应商默认」。
    await service.customUpdate('custom:acme-gateway', {
      providerId: 'acme-gateway',
      displayName: 'Acme 网关',
      apiUrl: 'https://gateway.acme.example/v1',
      apiProtocol: 'openai-completions',
      apiKey: '',
      models: [{ id: 'acme-think', name: 'Acme Think', input: ['text'], reasoningEfforts: { off: null, high: 'high' } }],
    });
    assert.equal(sections.get('llm-pi-ai').value.providers['acme-gateway'].reasoning, undefined);

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

test('推理档位声明会被校验：空参数值与只有 Off 均被拒绝', async () => {
  const home = await mkdtemp(join(tmpdir(), 'workdsh-model-market-reasoning-'));
  const previous = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  try {
    const { ctx, sections } = harness({});
    const service = new ModelMarketService(ctx, {});
    const draft = (reasoningEfforts) => ({
      providerId: 'acme-reasoning',
      displayName: 'Acme Reasoning',
      apiUrl: 'https://gateway.acme.example/v1',
      apiProtocol: 'openai-completions',
      apiKey: 'sk-custom',
      models: [{ id: 'acme-think', name: 'Acme Think', input: ['text'], reasoningEfforts }],
    });
    await assert.rejects(service.customInstall(draft({ low: '' })), /需要填写 API 参数值/u);
    await assert.rejects(service.customInstall(draft({ off: null })), /至少添加一个 Off 以外的档位/u);
    await assert.rejects(
      service.customInstall({ ...draft({ low: 'low' }), defaultReasoning: 'high' }),
      /未在任何模型的推理档位中声明/u,
    );
    assert.equal(sections.get('llm-pi-ai').value.providers?.['acme-reasoning'], undefined);
    // 去掉推理档位仍然可以正常安装。
    await service.customInstall({
      ...draft(undefined),
      models: [{ id: 'acme-think', name: 'Acme Think', input: ['text'] }],
    });
    assert.equal(sections.get('llm-pi-ai').value.providers['acme-reasoning'].models[0].reasoningEfforts, undefined);
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previous;
    await rm(home, { recursive: true, force: true });
  }
});

test('默认模型首次安装、卸载后不再装回，只补齐新增默认模型', async () => {
  const home = await mkdtemp(join(tmpdir(), 'workdsh-model-market-defaults-'));
  try {
    // 按账号注入的独立状态目录；不依赖 DSH_HOME。
    const stateDir = join(home, 'accounts', 'member-1');
    const defaults = [
      { ...base, id: '1', modelName: '默认一', modelCode: 'seed-a', isDefault: '1', apiKey: 'sk-1' },
      { ...base, id: '2', modelName: '默认二', modelCode: 'seed-b', isDefault: '1', apiKey: 'sk-1' },
    ];
    const models = Object.fromEntries(defaults.map(row => [row.id, row]));
    const { ctx, sections, calls } = harness(models, { defaults });
    const providers = () => sections.get('llm-pi-ai').value.providers;
    const seedModels = () => (providers()['workdsh-deepseek']?.models ?? []).map(row => row.id);

    // 打开模型市场页会触发默认模型种子。
    const service = new ModelMarketService(ctx, { stateDir, clientId: 'police-assistant' });
    await service.list({});
    await until(() => Promise.resolve(existsSync(join(stateDir, 'defaults-ready.json'))));

    assert.deepEqual(seedModels(), ['seed-a', 'seed-b']);
    assert.deepEqual(sections.get('agent-default-model').value, { provider: 'workdsh-deepseek', model: 'seed-a' });
    assert.deepEqual((await service.list({})).installedIds.sort(), ['1', '2']);

    // 用户移除第二个默认模型，后台随后新增第三个默认模型。
    await service.uninstall('2');
    const added = { ...base, id: '3', modelName: '默认三', modelCode: 'seed-c', isDefault: '1', apiKey: 'sk-1' };
    defaults.push(added);
    models['3'] = added;

    // 第二次启动：已安装的 1 跳过，卸载过的 2 不再装回，只安装新增的 3。
    const restarted = new ModelMarketService(ctx, { stateDir, clientId: 'police-assistant' });
    await restarted.list({});
    await until(() => Promise.resolve(seedModels().includes('seed-c')));

    assert.deepEqual(seedModels(), ['seed-a', 'seed-c']);
    const records = JSON.parse(await readFile(join(stateDir, 'market-installs.json'), 'utf8'));
    assert.deepEqual(records.handledDefaults.sort(), ['1', '2', '3']);
    assert.deepEqual(records.dismissedDefaults, ['2']);
    assert.deepEqual(
      calls.map(call => [call.body.assetId, call.body.operationType, call.body.operationResult]),
      [
        ['1', 'install', 'success'],
        ['2', 'install', 'success'],
        ['2', 'uninstall', 'success'],
        ['3', 'install', 'success'],
      ],
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
