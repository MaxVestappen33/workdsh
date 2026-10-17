import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(new URL('../../../../apps/web/package.json', import.meta.url));
const { build } = require('esbuild');
const built = await build({ entryPoints: [fileURLToPath(new URL('../src/client/authoring-controller.ts', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false });
const { associateSavedRequirements, prepareSavedWorkbenchDevelopment } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const identity = { workbenchId: 'company.quality', packageName: 'quality-plugin' };
const saved = { id: 'req-2', developmentId: 'dev-1', parentRevisionId: 'req-1', owner: { organizationId: 'org', ownerPrincipalId: 'member' } };
const row = revision => ({ development: { id: 'dev-1', ...identity, owner: saved.owner, requirementsRevision: revision, revision: 'dev-rev' } });
test('confirmed association hands off the exact saved baseline and preserves source identity', async () => {
  const baseline = { ...saved, requirements: { title: '质量分析', scenario: '分析', users: '质量人员', dataSources: 'Office', workflow: '导入分析', firstIteration: '报告', acceptance: '可复核' } };
  const source = { hostId: 'host-1', directory: '/workspace/quality', revision: 'source-1' };
  let writes = 0;
  const client = { list: async () => [{ development: { ...row('req-2').development, source } }],
    create: async () => { writes++; assert.fail('duplicate creation'); }, advanceRequirements: async () => { writes++; assert.fail('duplicate advancement'); } };
  const handoff = await prepareSavedWorkbenchDevelopment(client, baseline, identity);
  const context = JSON.parse(handoff.instruction.slice(handoff.instruction.indexOf('{')));
  assert.equal(context.requirementsRevision, baseline.id);
  assert.deepEqual(context.source, source);
  assert.equal(context.workbenchId, identity.workbenchId);
  assert.equal(writes, 0);
  assert.ok(Object.isFrozen(handoff));
});
test('saved requirements reconcile a lost creation receipt without repeating creation', async () => {
  let stored, writes = 0;
  const client = { list: async () => stored ? [stored] : [], create: async () => { writes++; stored = row('req-2'); throw new Error('transport-lost'); }, advanceRequirements: async () => assert.fail('unexpected advance') };
  await assert.rejects(associateSavedRequirements(client, saved, identity), /transport-lost/);
  assert.equal(await associateSavedRequirements(client, saved, identity), stored);
  assert.equal(writes, 1);
});
test('advancement uses current CAS and rejects identity or nonadjacent requirements before writing', async () => {
  let stored = row('req-1'), calls = [];
  const client = { list: async () => [stored], create: async () => assert.fail('unexpected create'), advanceRequirements: async (...args) => { calls.push(args); return row('req-2'); } };
  await associateSavedRequirements(client, saved, identity);
  assert.deepEqual(calls[0].slice(0,3), ['dev-1', 'req-2', 'dev-rev']);
  stored = row('req-other');
  await assert.rejects(associateSavedRequirements(client, saved, identity), /requirements-revision-conflict/);
  stored = { development: { ...row('req-1').development, packageName: 'other-plugin' } };
  await assert.rejects(associateSavedRequirements(client, saved, identity), /development-identity-conflict/);
  assert.equal(calls.length, 1);
});
test('cancellation after reading inventory prevents a follow-up write', async () => {
  const controller = new AbortController();
  const client = { list: async () => { controller.abort(); return []; }, create: async () => assert.fail('cancelled write'), advanceRequirements: async () => assert.fail('cancelled write') };
  await assert.rejects(associateSavedRequirements(client, saved, identity, controller.signal), error => error.name === 'AbortError');
});

test('successful write cannot hand off a receipt belonging to a different member or revision', async () => {
  for (const bad of [
    { development: { ...row('req-2').development, owner: { organizationId: 'org', ownerPrincipalId: 'other' } } },
    row('req-stale'),
    { development: { ...row('req-2').development, id: 'dev-other' } },
  ]) {
    const client = { list: async () => [], create: async () => bad, advanceRequirements: async () => bad };
    await assert.rejects(associateSavedRequirements(client, saved, identity), /development-response-mismatch/);
    client.list = async () => [row('req-1')];
    await assert.rejects(associateSavedRequirements(client, saved, identity), /development-response-mismatch/);
  }
});
