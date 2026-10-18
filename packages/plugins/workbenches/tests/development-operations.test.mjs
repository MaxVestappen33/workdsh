import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const webRequire = createRequire(new URL('../../../../apps/web/package.json', import.meta.url));
const runtimeRequire = createRequire(new URL('../../projects/package.json', import.meta.url));
const { build } = webRequire('esbuild');
const built = await build({ entryPoints: [fileURLToPath(new URL('../src/runtime/development-operations.ts', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false, alias: { 'workdsh-contracts': fileURLToPath(new URL('../../../contracts/src/index.ts', import.meta.url)) }, plugins: [{ name: 'official-runtime', setup(builder) { builder.onResolve({ filter: /^(?:@deepseek-ai\/dsh-storage-domain|zod)$/ }, args => ({ path: pathToFileURL(runtimeRequire.resolve(args.path)).href, external: true })); } }] });
const { WorkbenchDevelopmentOperations } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const load = async name => import(pathToFileURL(runtimeRequire.resolve(name)).href);
const { Context } = await load('@deepseek-ai/cordis');
const { default: Storage } = await load('@deepseek-ai/dsh-storage');
const JsonStorage = await load('@deepseek-ai/dsh-storage-json');
const StorageDomain = await load('@deepseek-ai/dsh-storage-domain');
const actor = { principalId: 'member.a', organizationId: 'org', requestId: 'test', resolvedBy: 'trusted-fixture' };
const draft = { title: '质量分析', scenario: '质量问题', users: '工程师', dataSources: 'CSV', workflow: '分析并导出', firstIteration: '统计', acceptance: '复算一致' };
async function boot(root) { const ctx = new Context(); await ctx.plugin(Storage); await ctx.plugin(JsonStorage, { root }); await ctx.plugin(StorageDomain, { backend: 'json' }); return ctx; }

const target = { hostId: 'host', installationId: 'desktop', profileId: 'default', harnessVersion: '0.2.0-rc.2' };
const intent = { id: 'install-1', iterationId: 'iteration-1', kind: 'install', target, inputHash: 'a'.repeat(64), expectedInstalledHash: 'b'.repeat(64) };
test('durable operation identity survives unknown results and rejects changed target or input on reuse', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workdsh-development-operations-'));
  let ctx, journal;
  try {
    ctx = await boot(root);
    journal = await WorkbenchDevelopmentOperations.open(ctx.storageDomain, actor, 'dev-1');
    const created = await journal.begin(intent, actor);
    assert.equal(created.state, 'intent');
    const running = await journal.transition(created.id, created.revision, 'running');
    await journal.transition(running.id, running.revision, 'unknown');
    await journal.close(); await ctx.fiber.dispose();
    ctx = await boot(root);
    journal = await WorkbenchDevelopmentOperations.open(ctx.storageDomain, actor, 'dev-1');
    const repeated = await journal.begin(intent, { ...actor, requestId: 'recovery-request' });
    assert.equal(repeated.state, 'unknown', 'recovery must not automatically return to runnable intent');
    assert.equal(repeated.actor.requestId, actor.requestId, 'the original initiator remains in the audit record');
    assert.equal(journal.list().length, 1);
    await assert.rejects(journal.begin({ ...intent, target: { ...target, hostId: 'new-host' } }, actor), /operation-id-conflict/);
    await assert.rejects(journal.begin({ ...intent, inputHash: 'c'.repeat(64) }, actor), /operation-id-conflict/);
    await assert.rejects(journal.transition(repeated.id, repeated.revision, 'running'), /invalid-operation-transition/);
    const reconciling = await journal.transition(repeated.id, repeated.revision, 'reconciling');
    // Explicit verified-receipt fixture; no actual package installer runs here.
    const succeeded = await journal.transition(reconciling.id, reconciling.revision, 'succeeded', { receipt: { package: { packageName: 'quality-plugin', version: '0.1.1', sha256: 'd'.repeat(64) }, pendingRestart: true } });
    assert.equal(succeeded.receipt.pendingRestart, true, 'installed can still await active runtime verification');
    await assert.rejects(journal.transition(succeeded.id, succeeded.revision, 'running'), /invalid-operation-transition/);
    const another = await WorkbenchDevelopmentOperations.open(ctx.storageDomain, { ...actor, principalId: 'other-member' }, 'dev-1');
    assert.deepEqual(another.list(), []); await another.close();
  } finally { await journal?.close(); await ctx?.fiber.dispose(); await rm(root, { recursive: true, force: true }); }
});
test('operation transitions enforce CAS, correct receipt kind, cancellation and durable shutdown', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workdsh-development-operation-conflicts-'));
  const ctx = await boot(root);
  const journal = await WorkbenchDevelopmentOperations.open(ctx.storageDomain, actor, 'dev-1');
  try {
    const initial = await journal.begin({ ...intent, kind: 'create-session' }, actor);
    const results = await Promise.allSettled([journal.transition(initial.id, initial.revision, 'running'), journal.transition(initial.id, initial.revision, 'running')]);
    assert.equal(results.filter(row => row.status === 'fulfilled').length, 1);
    assert.match(results.find(row => row.status === 'rejected').reason.message, /operation-revision-conflict/);
    const running = journal.list()[0];
    await assert.rejects(journal.transition(running.id, running.revision, 'succeeded', { receipt: { package: { packageName: 'quality', version: '1', sha256: 'd'.repeat(64) }, pendingRestart: false } }), /invalid-operation-receipt/);
    await assert.rejects(journal.begin({ ...intent, id: 'other' }, { ...actor, principalId: 'other' }), /development-owner-mismatch/);
    const aborted = new AbortController(); aborted.abort();
    await assert.rejects(journal.transition(running.id, running.revision, 'unknown', {}, aborted.signal), { name: 'AbortError' });
    assert.equal(journal.list()[0].state, 'running');
    const write = journal.transition(running.id, running.revision, 'unknown');
    const close = journal.close();
    await write; await close;
    assert.throws(() => journal.list(), /development-store-closed/);
    const restored = await WorkbenchDevelopmentOperations.open(ctx.storageDomain, actor, 'dev-1');
    assert.equal(restored.list()[0].state, 'unknown'); await restored.close();
  } finally { await journal.close(); await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }); }
});
