import assert from 'node:assert/strict';
import test from 'node:test';
import { PromptClient, normalizePromptPage, normalizePrompt } from '../dist/market.js';
import { DEFAULT_PROMPT_PATHS } from '../dist/shared.js';

const row = {
  id: '2112849059777363969',
  name: '测试111111',
  description: '测试描述',
  content: '测试测试测试\n\n测试测试',
  mblb: 'wdzs',
};

test('归一化只保留界面需要的四个字段', () => {
  assert.deepEqual(normalizePrompt(row), {
    id: '2112849059777363969', name: '测试111111', description: '测试描述', content: '测试测试测试\n\n测试测试',
  });
});

test('缺少主键或名称与正文都为空的行被丢弃', () => {
  assert.equal(normalizePrompt({ ...row, id: '' }), undefined);
  assert.equal(normalizePrompt({ ...row, name: '', content: '   ' }), undefined);
  assert.equal(normalizePrompt(null), undefined);
});

test('分页结果按后台 pages 判定是否还有下一页', () => {
  const first = normalizePromptPage({ current: 1, pages: 2, size: 10, total: 12, records: [row] }, { page: 1, pageSize: 10 });
  assert.equal(first.page, 1);
  assert.equal(first.total, 12);
  assert.equal(first.hasMore, true);
  assert.equal(first.items.length, 1);
  const last = normalizePromptPage({ current: 2, pages: 2, size: 10, total: 12, records: [row] }, { page: 2, pageSize: 10 });
  assert.equal(last.hasMore, false);
});

test('回包不是分页结构时报可识别的错误', () => {
  assert.throws(() => normalizePromptPage({ items: [] }, { page: 1, pageSize: 10 }), /无法识别/u);
});

test('查询只带非空关键词，分页参数固定下发', async () => {
  const calls = [];
  const client = new PromptClient({
    paths: DEFAULT_PROMPT_PATHS,
    backend: {
      available: async () => true,
      get: async (path, query) => { calls.push({ path, query }); return { current: 1, pages: 1, size: 10, total: 0, records: [] }; },
    },
  });
  await client.list({ page: 1, pageSize: 10, keyword: '  ' });
  await client.list({ page: 2, pageSize: 10, keyword: '测试' });
  assert.equal(calls[0].path, DEFAULT_PROMPT_PATHS.list);
  assert.equal(calls[0].query.pageNo, 1);
  assert.equal(calls[0].query.pageSize, 10);
  assert.equal('keyword' in calls[0].query, false);
  assert.equal(calls[1].query.pageNo, 2);
  assert.equal(calls[1].query.keyword, '测试');
});

test('后台拒绝、会话失效与通道缺失分别给出独立错误码', async () => {
  const error = (code, message) => Object.assign(new Error(message), { name: 'BackendRequestError', code });
  const client = (code, message) => new PromptClient({
    paths: DEFAULT_PROMPT_PATHS,
    backend: { available: async () => true, get: async () => { throw error(code, message); } },
  });
  await assert.rejects(client('backend/unauthorized', '登录已过期，请重新登录。').list(), failure => failure.code === 'prompt/unauthorized');
  await assert.rejects(client('backend/rejected', '提示词不存在。').list(), failure => failure.code === 'prompt/rejected' && failure.message === '提示词不存在。');
  await assert.rejects(client('backend/unavailable', '未接入').list(), failure => failure.code === 'prompt/unavailable');
});
