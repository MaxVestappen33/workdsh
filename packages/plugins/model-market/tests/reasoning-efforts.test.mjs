/** 市场安装联动 reasoningEfforts 的独立回归测试：纯函数 + 归一化 + 端到端安装链路。 */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { reasoningEffortsOf, modelRouteEntry, REASONING_LEVELS } from '../dist/shared.js';
import { normalizeModel } from '../dist/market.js';
import { ModelMarketService } from '../dist/service.js';

/* ------------------------------------------------------------------ *
 * 测试数据
 * ------------------------------------------------------------------ */

/** 后台一行 AiModel 的默认字段（与 service.test.mjs 的 base 保持一致）。 */
const base = {
  provider: 'DEEPSEEK', provider_dictText: 'DeepSeek', version: 'v1.0.0', modelType: 'LLM',
  modelType_dictText: '大语言模型', contextLength: '128K', icon: '', apiProtocol: '01',
  apiProtocol_dictText: 'OpenAI 兼容', apiUrl: 'https://api.deepseek.com', owner: '管理员',
  depart_dictText: '同云数字', description: '测试模型', tag: 'deepseek,flash', status: '3',
  createTime: '2026-10-17 11:17:32', updateTime: '2026-10-17 11:17:32',
};

/** 后台推理等级表的一行；off 的 value 故意用「关闭思考」这类中文说明文字。 */
const lv = (tier, value) => ({ tier, value, description: '', rate: '' });

const levels = [
  lv('off', '关闭思考'),
  lv('low', 'low'),
  lv('medium', 'medium'),
  lv('high', 'high'),
  lv('xhigh', 'xhigh'),
  lv('max', 'max'),
];

/** 期望写入 llm-pi-ai 的档位声明：off 固定 null，其余取后台 value。 */
const EFFORTS = { off: null, low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' };

/** 走 install() 的后台原始行；reasoningLevels 可为数组或 JSON 字符串。 */
const row = (overrides = {}) => ({
  ...base,
  id: '1',
  modelName: 'DeepSeek-V4-Pro',
  modelCode: 'deepseek-v4-pro',
  isDefault: '0',
  subscribeCount: 0,
  apiKey: 'sk-1',
  reasoningLevelEnabled: true,
  reasoningLevels: levels,
  ...overrides,
});

/** 归一化后的 ModelMarketModel（纯函数 reasoningEffortsOf 的直接输入）。 */
const normalized = (overrides = {}) => ({
  id: '1', provider: 'DEEPSEEK', providerName: 'DeepSeek', modelName: 'DeepSeek-V4-Pro',
  version: 'v1.0.0', modelCode: 'deepseek-v4-pro', modelType: 'LLM', modelTypeName: '大语言模型',
  contextLength: '128K', maxOutputTokens: '', inputTypes: 'text',
  reasoningLevelEnabled: true, reasoningLevels: [],
  subscribeCount: 0, icon: '', apiProtocol: '01', apiProtocolName: 'OpenAI 兼容',
  apiUrl: 'https://api.deepseek.com', isDefault: false, description: '', tag: '', owner: '',
  depart: '', departName: '', createTime: '', updateTime: '',
  ...overrides,
});

/* ------------------------------------------------------------------ *
 * 测试夹具：settings / credentials / backend 假实现（与 service.test.mjs 同构）
 * ------------------------------------------------------------------ */

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
  const settings = {
    writable: true,
    describe() {
      return [...sections.entries()].map(([ns, item]) => ({ ns, value: structuredClone(item.value), revision: item.revision }));
    },
    async mutate(ns, ops, revision) {
      const item = sections.get(ns);
      assert.ok(item, `unknown namespace ${ns}`);
      assert.equal(revision, item.revision);
      item.value = applyOps(item.value, ops);
      item.revision += 1;
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
      if (query?.isDefault === '1') return { records: [], total: 0, pages: 0, size: 100, current: 1 };
      const found = query?.id === undefined ? undefined : models[query.id];
      if (query?.id !== undefined) {
        return { records: found ? [found] : [], total: found ? 1 : 0, pages: found ? 1 : 0, size: 1, current: 1 };
      }
      const rows = Object.values(models);
      return { records: rows, total: rows.length, pages: rows.length ? 1 : 0, size: 100, current: 1 };
    },
    async post() {},
  };
  const ctx = {
    reflect: {
      provide() {},
      get(name) { return name === 'workdshBackend' ? channel : undefined; },
    },
    effect() { return () => {}; },
    logger: { warn() {} },
    settings,
    credentials,
  };
  return { ctx, sections };
}

/** 每个端到端用例独立 DSH_HOME，避免安装记录串扰。 */
async function withHome(run) {
  const home = await mkdtemp(join(tmpdir(), 'workdsh-mm-efforts-'));
  const previous = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previous;
    await rm(home, { recursive: true, force: true });
  }
}

const providersOf = (sections) => sections.get('llm-pi-ai').value.providers;
const entryOf = (sections, route = 'workdsh-deepseek') => providersOf(sections)[route].models[0];

/* ------------------------------------------------------------------ *
 * A. 纯函数 reasoningEffortsOf / modelRouteEntry
 * ------------------------------------------------------------------ */

test('纯函数：完整档位表正确映射，off 固定 null 且中文说明绝不透传', () => {
  // Arrange
  const model = normalized({ reasoningLevels: levels });
  // Act
  const efforts = reasoningEffortsOf(model);
  // Assert
  assert.deepEqual(efforts, EFFORTS);
  assert.equal(efforts.off, null, 'off 必须是 null，而不是「关闭思考」');
  assert.notEqual(typeof efforts.off, 'string');
  assert.equal(Object.values(efforts).includes('关闭思考'), false, '中文说明不得出现在任何 wire 值里');
  // minimal 也是官方已知档位，不能被误判为未知档位。
  assert.ok(REASONING_LEVELS.includes('minimal'));
  assert.deepEqual(
    reasoningEffortsOf(normalized({ reasoningLevels: [lv('off', '关闭思考'), lv('minimal', 'minimal')] })),
    { off: null, minimal: 'minimal' },
  );
});

test('纯函数：未开启推理等级返回 undefined，模型条目不写 reasoningEfforts 字段', () => {
  // Arrange：即使后台带着完整档位表，只要开关关闭就不写。
  const model = normalized({ reasoningLevelEnabled: false, reasoningLevels: levels });
  // Act / Assert
  assert.equal(reasoningEffortsOf(model), undefined);
  const entry = modelRouteEntry(model);
  assert.equal('reasoningEfforts' in entry, false, '必须彻底不写该字段，而不是写 {}');
  assert.equal(entry.reasoningEfforts, undefined);
  assert.deepEqual(Object.keys(entry).sort(), ['contextWindow', 'id', 'input', 'name']);
});

test('纯函数：开启时 modelRouteEntry 携带档位，且容量/输入类型等既有字段不受影响', () => {
  // Act
  const entry = modelRouteEntry(normalized({ reasoningLevels: levels }));
  // Assert
  assert.deepEqual(entry, {
    id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro', contextWindow: 131072,
    reasoningEfforts: EFFORTS, input: ['text'],
  });
  assert.equal('maxTokens' in entry, false, '本次修复不得改动 maxTokens');
});

test('纯函数：空表 / 只有 off / 全未知档位都降级为 undefined，不产生非法声明', () => {
  assert.equal(reasoningEffortsOf(normalized({ reasoningLevels: [] })), undefined);
  assert.equal(reasoningEffortsOf(normalized({ reasoningLevels: [lv('off', '关闭思考')] })), undefined);
  assert.equal(reasoningEffortsOf(normalized({ reasoningLevels: [lv('turbo', 'x'), lv('ultra', 'y')] })), undefined);
  // 无任何档位可用时不得抛异常。
  assert.doesNotThrow(() => reasoningEffortsOf(normalized({ reasoningLevels: [lv('off', '关闭思考')] })));
});

test('纯函数：未知档位被丢弃，非 off 档空 value 被跳过，其余有效档保留', () => {
  assert.deepEqual(
    reasoningEffortsOf(normalized({
      reasoningLevels: [lv('off', '关闭思考'), lv('turbo', 'fast'), lv('low', 'low')],
    })),
    { off: null, low: 'low' },
  );
  assert.deepEqual(
    reasoningEffortsOf(normalized({
      reasoningLevels: [lv('off', '关闭思考'), lv('low', '   '), lv('high', 'high')],
    })),
    { off: null, high: 'high' },
  );
  // 只剩 off + 空 value 时整体降级，不能写出「只有 Off」的非法声明。
  assert.equal(
    reasoningEffortsOf(normalized({ reasoningLevels: [lv('off', '关闭思考'), lv('low', '')] })),
    undefined,
  );
});

test('纯函数：重复档位取首个，tier 与 value 的前后空格被 trim 命中', () => {
  // Act
  const efforts = reasoningEffortsOf(normalized({
    reasoningLevels: [
      lv('  off  ', '关闭思考'),
      lv(' low ', ' low '),
      lv('low', 'SECOND-SHOULD-BE-IGNORED'),
      lv('  high  ', ' high '),
    ],
  }));
  // Assert
  assert.deepEqual(efforts, { off: null, low: 'low', high: 'high' });
});

test('纯函数：向后兼容，不带推理字段的模型输出与旧版完全一致', () => {
  // Arrange：模拟旧版本归一化结果里完全没有这两个字段。
  const legacy = normalized();
  delete legacy.reasoningLevelEnabled;
  delete legacy.reasoningLevels;
  // Act / Assert：不能因为读取 undefined.reasoningLevels 而抛错。
  assert.doesNotThrow(() => reasoningEffortsOf(legacy));
  assert.equal(reasoningEffortsOf(legacy), undefined);
  assert.deepEqual(modelRouteEntry(legacy), {
    id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro', contextWindow: 131072, input: ['text'],
  });
});

/* ------------------------------------------------------------------ *
 * B. 后台归一化入口：reasoningLevels 同时接受 JSON 字符串与数组
 * ------------------------------------------------------------------ */

test('归一化：推理等级表支持 JSON 字符串与数组，缺字段行/非法数据安全丢弃', () => {
  const raw = (reasoningLevels) => ({ ...base, id: '1', modelName: 'X', modelCode: 'x', reasoningLevelEnabled: true, reasoningLevels });
  const fromString = normalizeModel(raw(JSON.stringify(levels)));
  const fromArray = normalizeModel(raw(levels));
  assert.ok(fromString && fromArray);
  assert.equal(fromString.reasoningLevelEnabled, true);
  assert.deepEqual(fromString.reasoningLevels, fromArray.reasoningLevels, '两种形态必须归一化出相同结果');
  assert.equal(fromString.reasoningLevels.length, 6);
  // 归一化结果再喂给纯函数，链路前半段打通。
  assert.deepEqual(reasoningEffortsOf(fromString), EFFORTS);

  // 脏数据：非法 JSON、null、非数组对象都按「没有档位」处理。
  assert.deepEqual(normalizeModel(raw('{not-json')).reasoningLevels, []);
  assert.deepEqual(normalizeModel(raw(null)).reasoningLevels, []);
  assert.deepEqual(normalizeModel(raw({ low: 'low' })).reasoningLevels, []);
  // 缺 tier/value 的行被丢弃，只有单字段的行保留（value 为空由纯函数跳过）。
  assert.deepEqual(
    normalizeModel(raw([{ tier: '', value: '' }, { tier: 'low', value: 'low' }])).reasoningLevels,
    [{ tier: 'low', value: 'low', description: '', rate: '' }],
  );
});

/* ------------------------------------------------------------------ *
 * C. 端到端：走 install() 断言 providers[route].models[].reasoningEfforts
 * ------------------------------------------------------------------ */

test('端到端（核心验收）：install() 把 JSON 字符串形态的档位表写进 pi-ai 配置', async () => {
  await withHome(async () => {
    // Arrange：后台以 JSON 字符串返回推理等级表。
    const models = { 1: row({ reasoningLevels: JSON.stringify(levels) }) };
    const { ctx, sections } = harness(models);
    // Act
    const result = await new ModelMarketService(ctx, {}).install('1');
    // Assert
    assert.equal(result.route, 'workdsh-deepseek');
    const entry = entryOf(sections);
    assert.deepEqual(entry.reasoningEfforts, EFFORTS);
    assert.equal(entry.reasoningEfforts.off, null, 'off 必须是 null');
    assert.equal(Object.values(entry.reasoningEfforts).includes('关闭思考'), false);
    // 用户边界：不改 maxTokens、不写 provider 级默认推理档位。
    assert.equal('maxTokens' in entry, false);
    assert.equal(providersOf(sections)['workdsh-deepseek'].reasoning, undefined);
  });
});

test('端到端：数组形态的推理等级表同样能打通安装链路', async () => {
  await withHome(async () => {
    const models = { 1: row({ reasoningLevels: levels }) };
    const { ctx, sections } = harness(models);
    await new ModelMarketService(ctx, {}).install('1');
    assert.deepEqual(entryOf(sections).reasoningEfforts, EFFORTS);
    assert.equal(entryOf(sections).reasoningEfforts.off, null);
  });
});

test('端到端：后台未开启推理等级时，模型条目没有 reasoningEfforts 字段', async () => {
  await withHome(async () => {
    // Arrange：开关关闭但仍携带档位表，验证「开关优先」。
    const models = { 1: row({ reasoningLevelEnabled: '0', reasoningLevels: levels }) };
    const { ctx, sections } = harness(models);
    // Act
    const result = await new ModelMarketService(ctx, {}).install('1');
    // Assert
    assert.equal(result.installed, true);
    const entry = entryOf(sections);
    assert.equal('reasoningEfforts' in entry, false, '不是 {}，而是彻底不写');
    assert.equal(entry.reasoningEfforts, undefined);
  });
});

test('端到端：后台关闭推理等级后同 id 重装，旧档位残留被清除', async () => {
  await withHome(async () => {
    // Arrange：先安装一个带完整档位的模型。
    const models = { 1: row({ reasoningLevels: JSON.stringify(levels) }) };
    const { ctx, sections } = harness(models);
    const service = new ModelMarketService(ctx, {});
    await service.install('1');
    assert.deepEqual(entryOf(sections).reasoningEfforts, EFFORTS, '前置条件：旧档位已写入');

    // Act：后台随后关闭推理等级，用户对同一个 id 重新点击安装。
    models['1'] = row({ reasoningLevelEnabled: '0', reasoningLevels: [] });
    const again = await service.install('1');

    // Assert：覆盖安装必须复用 route、不重复追加，并 delete 掉旧档位。
    assert.equal(again.route, 'workdsh-deepseek');
    const provider = providersOf(sections)['workdsh-deepseek'];
    assert.equal(provider.models.length, 1, '覆盖安装不得重复追加模型条目');
    assert.equal('reasoningEfforts' in provider.models[0], false, 'service.ts 的 delete 必须清掉旧残留');
    assert.equal(provider.models[0].id, 'deepseek-v4-pro');
  });
});

test('端到端：覆盖安装时后台换成新档位表，写入的是新值而非保留旧值', async () => {
  await withHome(async () => {
    const models = { 1: row({ reasoningLevels: JSON.stringify(levels) }) };
    const { ctx, sections } = harness(models);
    const service = new ModelMarketService(ctx, {});
    await service.install('1');
    assert.deepEqual(entryOf(sections).reasoningEfforts, EFFORTS);

    // Act：后台只保留 off + high，同 id 重装。
    models['1'] = row({ reasoningLevels: [lv('off', '关闭思考'), lv('high', 'high')] });
    await service.install('1');

    // Assert：merged 用新 entry 覆盖，旧的中/低/xhigh/max 档位一并消失。
    assert.deepEqual(entryOf(sections).reasoningEfforts, { off: null, high: 'high' });
    assert.equal(providersOf(sections)['workdsh-deepseek'].models.length, 1);
  });
});

test('端到端：脏数据安装不抛异常、不写非法字段；普通模型安装行为不变', async () => {
  await withHome(async () => {
    // Arrange：覆盖非法 JSON / 空数组 / 只有 off / 未知档位 / 空 value / 非数组对象。
    const dirty = [
      ['非法 JSON', '{not-json'],
      ['空数组', []],
      ['只有 off', [lv('off', '关闭思考')]],
      ['未知档位', [lv('turbo', 'turbo')]],
      ['空 value', [lv('off', '关闭思考'), lv('low', '   ')]],
      ['非数组对象', { low: 'low' }],
    ];
    const models = Object.fromEntries(dirty.map(([label, reasoningLevels], index) => [
      String(index + 1),
      row({ id: String(index + 1), modelName: label, modelCode: `dirty-${index + 1}`, reasoningLevels }),
    ]));
    // 完全不带 reasoningLevelEnabled / reasoningLevels 的普通模型（向后兼容）。
    models['99'] = {
      ...base, id: '99', modelName: '普通模型', modelCode: 'plain',
      isDefault: '0', subscribeCount: 0, apiKey: 'sk-1',
    };
    const { ctx, sections } = harness(models);
    const service = new ModelMarketService(ctx, {});

    // Act：每一个都必须安装成功，不抛异常。
    const ids = [...dirty.map((_, index) => String(index + 1)), '99'];
    for (const id of ids) {
      await assert.doesNotReject(() => service.install(id), `id=${id} 的脏数据不得让安装失败`);
    }

    // Assert：所有条目都不含 reasoningEfforts，且不产生非法声明。
    const installed = providersOf(sections)['workdsh-deepseek'].models;
    const codes = [...dirty.map((_, index) => `dirty-${index + 1}`), 'plain'];
    for (const code of codes) {
      const item = installed.find(model => model.id === code);
      assert.ok(item, `模型 ${code} 应安装成功`);
      assert.equal('reasoningEfforts' in item, false, `${code} 不应写入档位声明`);
    }
  });
});
