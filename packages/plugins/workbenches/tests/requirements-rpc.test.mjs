import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(new URL('../../../../apps/web/package.json', import.meta.url));
const { build } = require('esbuild');
const built = await build({ entryPoints: [fileURLToPath(new URL('../src/runtime/requirements-rpc.ts', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false });
const { handleWorkbenchRequirementsRequest } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const request = body => new Request('http://localhost/api/workdsh-workbench-requirements', { method: 'POST', body: JSON.stringify(body) });
test('RPC rejects identity claims and excessive payloads before domain calls', async () => {
  let calls = 0;
  const service = { async history() { calls++; return []; }, async append() { calls++; return {}; } };
  const invalid = await handleWorkbenchRequirementsRequest(request({ endpoint: 'history', payload: { developmentId: 'dev', principalId: 'other-member' } }), service);
  assert.equal(invalid.status, 400);
  const oversized = await handleWorkbenchRequirementsRequest(request({ endpoint: 'append', payload: { developmentId: 'dev', requirements: 'x'.repeat(256 * 1024) } }), service);
  assert.equal(oversized.status, 413);
  assert.equal(calls, 0);
  const valid = await handleWorkbenchRequirementsRequest(request({ endpoint: 'history', payload: { developmentId: 'dev' } }), service);
  assert.deepEqual(await valid.json(), { ok: true, value: [] });
});
test('revision and access errors retain stable codes without exposing internal messages', async () => {
  for (const [code, status] of [['workbench/requirements-revision-conflict', 409], ['workbench/development-access-denied', 403], ['workbench/invalid-system-definition', 400], ['/private/host/path/token-secret', 500]]) {
    const response = await handleWorkbenchRequirementsRequest(request({ endpoint: 'append', payload: { developmentId: 'dev', requirements: {} } }), { async history() { return []; }, async append() { throw new Error(code); } });
    assert.equal(response.status, status);
    const body = await response.json();
    assert.equal(body.ok, false);
    assert.equal(body.error.code, status === 500 ? 'workbench/internal' : code);
    assert.equal(JSON.stringify(body).includes('token-secret'), false);
  }
});
