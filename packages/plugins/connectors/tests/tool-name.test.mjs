// 公共工具名推导的向量锁：规则必须与官方 dsh-mcp-client 保持一致。
// 说明：官方明确「公共名不用于还原原始名」，这里只验证正向推导（原始名 → 公共名），
// 它是工具白名单构造允许集合的唯一依据。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { publicToolName } from '../dist/manager.js';

test('公共工具名：无损名字直接拼接', () => {
  assert.equal(publicToolName('github', 'create_issue'), 'mcp__github__create_issue');
});

test('公共工具名：非法字符归一化后追加短哈希', () => {
  // 期望值独立用 node:crypto 计算：sha256('gh\0a.b') 前 12 位。
  assert.equal(publicToolName('gh', 'a.b'), 'mcp__gh__a_b_506b5e9b51cb');
});

test('公共工具名：超 64 字符截断后追加短哈希', () => {
  const raw = 'x'.repeat(80);
  // 归一化结果是 mcp__s1__ + 80 个 x（89 字符），截到 64-12-1=51 位后接 _ + 哈希前 12 位。
  const expected = `${'mcp__s1__'}${'x'.repeat(51 - 'mcp__s1__'.length)}_ee6bf0aada4b`;
  const name = publicToolName('s1', raw);
  assert.equal(name, expected);
  assert.ok(name.length <= 64, '公共名不得超过 64 字符');
});

test('公共工具名：同一输入稳定、不同名字不碰撞到同一公共名', () => {
  assert.equal(publicToolName('s', 'a.b'), publicToolName('s', 'a.b'));
  assert.notEqual(publicToolName('s', 'a.b'), publicToolName('s', 'a-c'));
});
