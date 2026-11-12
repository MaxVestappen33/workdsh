// 凭据来源口径：市场条目只认 requestHeaders，建连时按 requestHeaders 还原请求头。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { requestHeadersFor } from '../dist/market.js';
import { inputHeaders } from '../dist/manager.js';

test('市场请求头：后台 JSON 字符串形态可解析（当前真实下发形态）', () => {
  const row = { requestHeaders: '[{"value":"Bearer sk-c-1","key":"Authorization"}]' };
  assert.deepEqual(requestHeadersFor(row), [{ key: 'Authorization', value: 'Bearer sk-c-1' }]);
});

test('市场请求头：数组形态原样生效，自定义头名保留', () => {
  assert.deepEqual(
    requestHeadersFor({ requestHeaders: [{ key: 'X-API-Key', value: 'k-1' }] }),
    [{ key: 'X-API-Key', value: 'k-1' }],
  );
});

test('市场请求头：requestHeaders 为非法内容时为空', () => {
  assert.deepEqual(requestHeadersFor({ requestHeaders: 'not-json' }), []);
});

test('inputHeaders：只从 requestHeaders 取值', () => {
  assert.deepEqual(
    inputHeaders({ requestHeaders: [{ key: 'Authorization', value: 'Bearer x' }] }),
    { Authorization: 'Bearer x' },
  );
});

test('inputHeaders：无 requestHeaders 视为无凭据', () => {
  assert.equal(inputHeaders({}), undefined);
  assert.equal(inputHeaders({ requestHeaders: [] }), undefined);
});
