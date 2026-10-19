import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { installability, installActionLabel, formatCapacity, mergeDiscoveredModels, modelRouteEntry, parseContextWindow } from '../dist/shared.js';
import { normalizeModel } from '../dist/market.js';
import { readMarketRecords, writeMarketRecords } from '../dist/records.js';

const model = {
  id: '1', provider: 'DEEPSEEK', providerName: 'DeepSeek', modelName: 'DeepSeek-V4.1-Flash', version: 'v1.0.0',
  modelCode: 'deepseek-flash', modelType: 'LLM', modelTypeName: '大语言模型', contextLength: '128K', icon: '',
  apiProtocol: '01', apiProtocolName: 'OpenAI 兼容', apiUrl: 'https://api.deepseek.com', isDefault: true,
  description: '', tag: '', owner: '', depart: '', departName: '', createTime: '', updateTime: '',
};

test('上下文长度按 K/M 归一化为 token 数', () => {
  assert.equal(parseContextWindow('128K'), 131072);
  assert.equal(parseContextWindow('1M'), 1048576);
  assert.equal(parseContextWindow('131,072'), 131072);
  assert.equal(parseContextWindow('未知'), undefined);
  assert.equal(parseContextWindow(undefined), undefined);
  assert.equal(formatCapacity(262144), '256K');
  assert.equal(formatCapacity(1048576), '1M');
  assert.equal(formatCapacity(32768), '32K');
  assert.equal(formatCapacity(undefined), '');
});

test('对话模型可以安装，非对话模型与不支持的协议被拒绝', () => {
  assert.deepEqual(installability(model), { installable: true });
  assert.equal(installability({ ...model, modelType: 'ASR' }).installable, false);
  assert.equal(installability({ ...model, apiProtocol: '04' }).installable, false);
  assert.equal(installability({ ...model, apiUrl: '' }).installable, false);
});

test('不可安装时区分「不支持」与后台数据待完善', () => {
  assert.equal(installActionLabel(model, installability(model)), '添加');
  assert.equal(installActionLabel({ ...model, modelType: 'ASR' }, installability({ ...model, modelType: 'ASR' })), '不支持');
  assert.equal(installActionLabel({ ...model, apiProtocol: '04' }, installability({ ...model, apiProtocol: '04' })), '不支持');
  assert.equal(installActionLabel({ ...model, apiUrl: '' }, installability({ ...model, apiUrl: '' })), '待完善');
});

test('重新获取可用模型时按 id 合并：新增追加、同 id 更新、未选中的条目保留', () => {
  const current = [
    { id: 'a', name: 'A', context: '128K', maxTokens: '32K', text: true, image: false, expanded: true },
    { id: 'manual', name: '手工模型', context: '', maxTokens: '', text: true, image: false, expanded: false },
  ];
  const additions = [
    { id: 'a', name: 'A2', context: '256K', maxTokens: '32K', text: true, image: false, expanded: true },
    { id: 'b', name: 'B', context: '1M', maxTokens: '384K', text: true, image: false, expanded: true },
  ];
  const merge = (existing, addition) => {
    const merged = { ...existing, ...addition, expanded: existing.expanded };
    return merged.name === existing.name && merged.context === existing.context ? existing : merged;
  };
  const result = mergeDiscoveredModels(current, additions, merge);
  assert.equal(result.added, 1);
  assert.equal(result.updated, 1);
  assert.deepEqual(result.rows.map(row => row.id), ['a', 'manual', 'b']);
  assert.equal(result.rows[0].name, 'A2');
  assert.equal(result.rows[0].expanded, true);

  // 内容没有变化时不产生“更新”计数，界面可以据此提示“均已在列表中”。
  const unchanged = mergeDiscoveredModels(current, [current[0]], merge);
  assert.equal(unchanged.added, 0);
  assert.equal(unchanged.updated, 0);
  assert.deepEqual(unchanged.rows, current);
});

test('pi-ai 模型条目携带容量与输入类型', () => {
  assert.deepEqual(modelRouteEntry(model), {
    id: 'deepseek-flash', name: 'DeepSeek-V4.1-Flash', contextWindow: 131072, input: ['text'],
  });
  assert.deepEqual(modelRouteEntry({ ...model, modelType: 'MLLM' }).input, ['text', 'image']);
});

test('列表模型不包含 apiKey', () => {
  const normalized = normalizeModel({ ...model, apiKey: 'sk-secret' });
  assert.ok(normalized);
  assert.equal('apiKey' in normalized, false);
});

test('安装记录落盘后不包含密钥字段', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'workdsh-model-market-'));
  try {
    const file = join(directory, 'records.json');
    await writeMarketRecords({
      version: 1,
      installs: {
        1: { route: 'workdsh-deepseek', modelCode: 'deepseek-flash', groupHash: 'hash', credentialRef: 'WORKDSH_DEEPSEEK_API_KEY', installedAt: '2026-10-17T00:00:00.000Z' },
      },
      handledDefaults: ['1'],
      dismissedDefaults: [],
    }, file);
    const raw = await readFile(file, 'utf8');
    assert.equal(raw.includes('sk-'), false);
    const parsed = await readMarketRecords(file);
    assert.equal(parsed.installs['1']?.route, 'workdsh-deepseek');
    assert.deepEqual(parsed.handledDefaults, ['1']);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
