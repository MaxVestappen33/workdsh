import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { installability, installActionLabel, formatCapacity, modelRouteEntry, parseContextWindow } from '../dist/shared.js';
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
  assert.equal(installActionLabel(model, installability(model)), '安装');
  assert.equal(installActionLabel({ ...model, modelType: 'ASR' }, installability({ ...model, modelType: 'ASR' })), '不支持');
  assert.equal(installActionLabel({ ...model, apiProtocol: '04' }, installability({ ...model, apiProtocol: '04' })), '不支持');
  assert.equal(installActionLabel({ ...model, apiUrl: '' }, installability({ ...model, apiUrl: '' })), '待完善');
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
