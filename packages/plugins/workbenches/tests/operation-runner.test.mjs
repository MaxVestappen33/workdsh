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

const runnerBuilt = await build({ entryPoints: [fileURLToPath(new URL('../src/runtime/operation-runner.ts', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false });
const { WorkbenchOperationRunner } = await import(`data:text/javascript;base64,${Buffer.from(runnerBuilt.outputFiles[0].text).toString('base64')}`);
const target = { hostId: 'host', installationId: 'desktop', profileId: 'default', harnessVersion: '0.2.0-rc.2' };
const intent = { id: 'session-1', iterationId: 'iteration-1', kind: 'create-session', target, inputHash: 'a'.repeat(64) };
// Explicit executor/receipt fixtures verify orchestration only, not real native session creation.
const success = { state: 'succeeded', receipt: { sessionId: 'native-session-fixture', pendingRestart: false } };
test('runner persists running intent before execution and concurrent repeats submit exactly once', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workdsh-operation-runner-'));
  const ctx = await boot(root);
  const journal = await WorkbenchDevelopmentOperations.open(ctx.storageDomain, actor, 'dev-1');
  let submits = 0;
  try {
    const runner = new WorkbenchOperationRunner(journal, {
      async preflight() {},
      async execute() { submits++; assert.equal(journal.list()[0].state, 'running'); await new Promise(resolve => setTimeout(resolve, 5)); return 'unverified-result'; },
      async verify(operation, result) { assert.equal(result, 'unverified-result'); return success; },
      async inspect() { throw new Error('unexpected-inspection'); },
    }, () => {});
    const results = await Promise.all([runner.execute(intent, actor), runner.execute(intent, actor)]);
    assert.equal(submits, 1);
    assert.ok(results.every(result => result.state === 'succeeded'));
    assert.equal((await runner.execute(intent, actor)).state, 'succeeded');
    assert.equal(submits, 1);
  } finally { await journal.close(); await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }); }
});
test('lost receipt survives cold restart and recovery inspects without replaying the side effect', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workdsh-operation-recovery-'));
  let ctx, journal;
  let submits = 0, inspections = 0;
  try {
    ctx = await boot(root);
    journal = await WorkbenchDevelopmentOperations.open(ctx.storageDomain, actor, 'dev-1');
    const adapter = { async preflight() {}, async execute() { submits++; throw new Error('committed-but-receipt-lost'); }, async verify() { throw new Error('not-reached'); }, async inspect() { inspections++; return success; } };
    let runner = new WorkbenchOperationRunner(journal, adapter, () => {});
    assert.equal((await runner.execute(intent, actor)).state, 'unknown');
    await journal.close(); await ctx.fiber.dispose();
    ctx = await boot(root);
    journal = await WorkbenchDevelopmentOperations.open(ctx.storageDomain, actor, 'dev-1');
    runner = new WorkbenchOperationRunner(journal, adapter, () => {});
    assert.equal((await runner.execute(intent, actor)).state, 'unknown');
    assert.equal(submits, 1);
    assert.equal((await runner.reconcile(intent.id, actor)).state, 'succeeded');
    assert.equal(inspections, 1);
    assert.equal(submits, 1);
  } finally { await journal?.close(); await ctx?.fiber.dispose(); await rm(root, { recursive: true, force: true }); }
});
test('late success after cancellation remains unknown and a changed identity cannot inspect it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workdsh-operation-cancel-'));
  const ctx = await boot(root);
  const journal = await WorkbenchDevelopmentOperations.open(ctx.storageDomain, actor, 'dev-1');
  const controller = new AbortController();
  let authorized = true, inspections = 0;
  try {
    const runner = new WorkbenchOperationRunner(journal, {
      async preflight() {}, async execute() { controller.abort(); return 'possibly-committed'; },
      async verify() { return success; }, async inspect() { inspections++; return success; },
    }, () => { if (!authorized) throw new Error('workbench/development-access-denied'); });
    assert.equal((await runner.execute(intent, actor, controller.signal)).state, 'unknown');
    authorized = false;
    await assert.rejects(runner.reconcile(intent.id, actor), /development-access-denied/);
    assert.equal(inspections, 0);
    authorized = true;
    assert.equal((await runner.reconcile(intent.id, actor)).state, 'succeeded');
  } finally { await journal.close(); await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }); }
});

test('a cancelled concurrent waiter cannot receive the shared receipt or cancel the submitted operation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workdsh-operation-waiter-'));
  const ctx = await boot(root);
  const journal = await WorkbenchDevelopmentOperations.open(ctx.storageDomain, actor, 'dev-1');
  let release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  let submits = 0;
  try {
    const runner = new WorkbenchOperationRunner(journal, {
      async preflight() {}, async execute() { submits++; entered(); await gate; return 'result'; },
      async verify() { return success; }, async inspect() { return success; },
    }, () => {});
    const first = runner.execute(intent, actor);
    await started;
    const controller = new AbortController();
    const waiting = runner.execute(intent, actor, controller.signal);
    // Let the repeated request enter the runner through its durable journal read.
    await new Promise(resolve => setImmediate(resolve));
    controller.abort(); release();
    await assert.rejects(waiting, error => error.name === 'AbortError');
    assert.equal((await first).state, 'succeeded');
    assert.equal(journal.list()[0].state, 'succeeded');
    assert.equal(submits, 1);
  } finally { release?.(); await journal.close(); await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }); }
});
