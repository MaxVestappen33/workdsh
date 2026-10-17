import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(new URL('../../../../apps/web/package.json', import.meta.url));
const { build } = require('esbuild');
const built = await build({ entryPoints: [fileURLToPath(new URL('../src/client/requirements-client.ts', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false, alias: { 'workdsh-contracts': fileURLToPath(new URL('../../../contracts/src/workbenches.ts', import.meta.url)) } });
const { createWorkbenchRequirementsClient } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const draft = { title: '质量', scenario: '分析', users: '工程师', dataSources: 'CSV', workflow: '导入分析', firstIteration: '指标', acceptance: '复算' };
test('client preserves optimistic revision and conflict code without retrying a write', async () => {
  const calls = [];
  const client = createWorkbenchRequirementsClient(undefined, async (url, options) => {
    calls.push({ url, options });
    return Response.json({ ok: false, error: { code: 'workbench/requirements-revision-conflict', message: '需求已有新修订' } }, { status: 409 });
  });
  await assert.rejects(client.append('development-1', draft, 'revision-1'), error => error.code === 'workbench/requirements-revision-conflict' && error.status === 409);
  assert.equal(calls.length, 1);
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.payload.expectedRevisionId, 'revision-1');
  assert.equal('principalId' in body.payload, false);
  assert.equal(calls[0].options.credentials, 'same-origin');
});
test('invalid server response does not become a successful save', async () => {
  const client = createWorkbenchRequirementsClient(undefined, async () => new Response('invalid-json', { status: 200 }));
  await assert.rejects(client.history('dev'), error => error.code === 'workbench/invalid-response');
});
const saved = (patch = {}) => ({ id: 'revision-1', developmentId: 'dev', owner: { organizationId: 'personal', ownerPrincipalId: 'member', scope: 'personal' }, createdBy: 'member', createdAt: '2026-10-10T00:00:00.000Z', requirements: draft, ...patch });
const responding = value => createWorkbenchRequirementsClient(undefined, async () => Response.json({ ok: true, value }));
test('restore validates complete history, revision chain and member consistency before rendering', async () => {
  const history = await responding([saved(), saved({ id: 'revision-2', parentRevisionId: 'revision-1' })]).history('dev');
  assert.equal(history.at(-1).id, 'revision-2');
  assert.equal(Object.isFrozen(history.at(-1).requirements), true);
  for (const value of [null, {}, [saved({ developmentId: 'another-dev' })], [saved({ createdAt: 'invalid-date' })],
    [saved(), saved()], [saved({ parentRevisionId: 'missing-parent' })],
    [saved(), saved({ id: 'revision-2', parentRevisionId: 'revision-1', owner: { organizationId: 'other', ownerPrincipalId: 'member', scope: 'personal' } })]]) {
    await assert.rejects(responding(value).history('dev'), error => error.code === 'workbench/invalid-response');
  }
});
test('append confirms returned development, parent and exact saved requirement rather than accepting an unrelated success', async () => {
  const result = await responding(saved({ id: 'revision-2', parentRevisionId: 'revision-1' })).append('dev', draft, 'revision-1');
  assert.equal(result.id, 'revision-2');
  for (const value of [saved(), saved({ id: 'revision-2', parentRevisionId: 'other-parent' }),
    saved({ id: 'revision-2', parentRevisionId: 'revision-1', requirements: { ...draft, title: 'another-workbench' } }),
    saved({ id: 'revision-2', parentRevisionId: 'revision-1', developmentId: 'other-dev' })]) {
    await assert.rejects(responding(value).append('dev', draft, 'revision-1'), error => error.code === 'workbench/invalid-response');
  }
});
test('late transport response after cancellation is not accepted as a saved revision', async () => {
  const abort = new AbortController();
  const client = createWorkbenchRequirementsClient(undefined, async () => {
    abort.abort();
    return Response.json({ ok: true, value: saved() });
  });
  await assert.rejects(client.append('dev', draft, undefined, abort.signal), error => error.name === 'AbortError');
});
