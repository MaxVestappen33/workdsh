import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(new URL('../../../../apps/web/package.json', import.meta.url));
const { build } = require('esbuild');
const built = await build({ entryPoints: [fileURLToPath(new URL('../src/client/development-client.ts', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false, alias: { 'workdsh-contracts': fileURLToPath(new URL('../../../contracts/src/workbenches.ts', import.meta.url)) } });
const { createWorkbenchDevelopmentClient } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const entry = () => ({ title: '质量分析', development: { id: 'dev-1', workbenchId: 'company.quality', packageName: 'quality-plugin', owner: { organizationId: 'org', ownerPrincipalId: 'member', scope: 'personal' }, revision: 'rev-1', requirementsRevision: 'req-1', iterationId: 'iteration-1', target: { hostId: 'host', installationId: 'desktop', profileId: 'default', harnessVersion: '0.2.0-rc.2' }, state: 'ready', createdAt: '2026-10-10T00:00:00.000Z', updatedAt: '2026-10-10T00:00:00.000Z' } });
const client = value => createWorkbenchDevelopmentClient(async () => Response.json({ ok: true, value }));
test('Session client sends only revision guards and requires a same-host confirmed binding', async () => {
  const row = entry(); row.development.session = { hostId: 'host', sessionId: 'session-1' };
  let payload;
  const api = createWorkbenchDevelopmentClient(async (_url, options) => { payload = JSON.parse(options.body); return Response.json({ ok: true, value: row }); });
  const result = await api.ensureSession('dev-1', 'rev-1');
  assert.deepEqual(payload, { endpoint: 'ensure-session', payload: { developmentId: 'dev-1', expectedDevelopmentRevision: 'rev-1' } });
  assert.equal(result.development.session.sessionId, 'session-1');
  assert.ok(Object.isFrozen(result.development.session));
  for (const bad of [entry(), { ...row, development: { ...row.development, id: 'other' } },
    { ...row, development: { ...row.development, session: { hostId: 'other-host', sessionId: 'session-1' } } }])
    await assert.rejects(client(bad).ensureSession('dev-1', 'rev-1'), error => error.code === 'workbench/invalid-response');
});
test('development list preserves uninstalled entries, immutable facts and excludes unrelated response data', async () => {
  const row = entry(); row.token = 'must-not-retain'; row.development.target.secret = 'must-not-retain';
  const rows = await client([row]).list();
  assert.equal(rows[0].development.installed, undefined);
  assert.equal(rows[0].development.id, 'dev-1');
  assert.equal('token' in rows[0], false);
  assert.equal('secret' in rows[0].development.target, false);
  assert.equal(Object.isFrozen(rows[0].development), true);
  for (const values of [null, {}, [entry(), entry()], [{ ...entry(), development: { ...entry().development, state: 'unknown' } }],
    [entry(), { ...entry(), development: { ...entry().development, id: 'dev-2', owner: { organizationId: 'org', ownerPrincipalId: 'other', scope: 'personal' } } }],
    [{ ...entry(), development: { ...entry().development, active: { packageName: 'other-plugin', version: '1', sha256: 'a'.repeat(64) } } }]]) {
    await assert.rejects(client(values).list(), error => error.code === 'workbench/invalid-response');
  }
});
test('development list reports authorization failures and rejects cancelled late responses', async () => {
  const forbidden = createWorkbenchDevelopmentClient(async () => Response.json({ ok: false, error: { code: 'workbench/development-access-denied' } }, { status: 403 }));
  await assert.rejects(forbidden.list(), error => error.code === 'workbench/development-access-denied' && error.status === 403);
  const controller = new AbortController();
  const late = createWorkbenchDevelopmentClient(async () => { controller.abort(); return Response.json({ ok: true, value: [entry()] }); });
  await assert.rejects(late.list(controller.signal), error => error.name === 'AbortError');
});

test('authoring calls send revision guards and reject mismatched creation and advancement receipts', async () => {
  const requests = [];
  const api = createWorkbenchDevelopmentClient(async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return Response.json({ ok: true, value: entry() });
  });
  await api.create('dev-1', 'company.quality', 'quality-plugin', 'req-1');
  await api.advanceRequirements('dev-1', 'req-1', 'rev-previous');
  assert.deepEqual(requests, [
    { endpoint: 'create', payload: { developmentId: 'dev-1', workbenchId: 'company.quality', packageName: 'quality-plugin', expectedRequirementsRevision: 'req-1' } },
    { endpoint: 'advance-requirements', payload: { developmentId: 'dev-1', expectedRequirementsRevision: 'req-1', expectedDevelopmentRevision: 'rev-previous' } },
  ]);
  await assert.rejects(api.create('dev-other', 'company.quality', 'quality-plugin', 'req-1'), error => error.code === 'workbench/invalid-response');
  await assert.rejects(api.create('dev-1', 'company.other', 'quality-plugin', 'req-1'), error => error.code === 'workbench/invalid-response');
  await assert.rejects(api.create('dev-1', 'company.quality', 'other-plugin', 'req-1'), error => error.code === 'workbench/invalid-response');
  await assert.rejects(api.advanceRequirements('dev-1', 'req-next', 'rev-1'), error => error.code === 'workbench/invalid-response');
});

test('identity scope response is immutable, excludes extra fields and rejects absent identity', async () => {
 const transport = value => async (_url, request) => {
  assert.deepEqual(JSON.parse(request.body), { endpoint: 'identity-scope', payload: {} });
  return Response.json({ ok: true, value });
 };
 const scope = await createWorkbenchDevelopmentClient(transport({ organizationId: 'org', principalId: 'user', token: 'never-copy' })).identityScope();
 assert.deepEqual(scope, { organizationId: 'org', principalId: 'user' }); assert.equal(Object.isFrozen(scope), true);
 for (const value of [null, [], {}, { organizationId: 'org', principalId: ' ' }])
  await assert.rejects(createWorkbenchDevelopmentClient(transport(value)).identityScope(), error => error.code === 'workbench/invalid-response');
});
