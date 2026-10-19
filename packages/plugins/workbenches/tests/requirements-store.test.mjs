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
const built = await build({ entryPoints: [fileURLToPath(new URL('../src/runtime/requirements-store.ts', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false, alias: { 'workdsh-contracts': fileURLToPath(new URL('../../../contracts/src/index.ts', import.meta.url)) }, plugins: [{ name: 'official-runtime', setup(builder) { builder.onResolve({ filter: /^(?:@deepseek-ai\/dsh-storage-domain|zod)$/ }, args => ({ path: pathToFileURL(runtimeRequire.resolve(args.path)).href, external: true })); } }] });
const { WorkbenchRequirementsStore } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const serviceBuilt = await build({ entryPoints: [fileURLToPath(new URL('../src/runtime/requirements-service.ts', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false, alias: { 'workdsh-contracts': fileURLToPath(new URL('../../../contracts/src/index.ts', import.meta.url)) }, plugins: [{ name: 'official-runtime', setup(builder) { builder.onResolve({ filter: /^(?:@deepseek-ai\/dsh-storage-domain|zod)$/ }, args => ({ path: pathToFileURL(runtimeRequire.resolve(args.path)).href, external: true })); } }] });
const { WorkbenchRequirementsService } = await import(`data:text/javascript;base64,${Buffer.from(serviceBuilt.outputFiles[0].text).toString('base64')}`);
const hostBuilt = await build({ entryPoints: [fileURLToPath(new URL('../src/runtime/requirements-host.ts', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false, alias: { 'workdsh-contracts': fileURLToPath(new URL('../../../contracts/src/index.ts', import.meta.url)) }, plugins: [{ name: 'official-runtime', setup(builder) { builder.onResolve({ filter: /^(?:@deepseek-ai\/dsh-storage-domain|zod)$/ }, args => ({ path: pathToFileURL(runtimeRequire.resolve(args.path)).href, external: true })); } }] });
const { mountWorkbenchRequirementsHost } = await import(`data:text/javascript;base64,${Buffer.from(hostBuilt.outputFiles[0].text).toString('base64')}`);
const load = async name => import(pathToFileURL(runtimeRequire.resolve(name)).href);
const { Context } = await load('@deepseek-ai/cordis');
const { default: Storage } = await load('@deepseek-ai/dsh-storage');
const JsonStorage = await load('@deepseek-ai/dsh-storage-json');
const StorageDomain = await load('@deepseek-ai/dsh-storage-domain');
const actor = { principalId: 'member.a', organizationId: 'org', requestId: 'test', resolvedBy: 'trusted-fixture' };
const draft = { title: '质量分析', scenario: '质量问题', users: '工程师', dataSources: 'CSV', workflow: '分析并导出', firstIteration: '统计', acceptance: '复算一致' };
async function boot(root) { const ctx = new Context(); await ctx.plugin(Storage); await ctx.plugin(JsonStorage, { root }); await ctx.plugin(StorageDomain, { backend: 'json' }); return ctx; }

test('official storage restores requirement history and rejects concurrent stale revisions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workdsh-requirements-'));
  let ctx, store;
  try {
    ctx = await boot(root);
    store = await WorkbenchRequirementsStore.open(ctx.storageDomain, actor, 'development-1');
    const first = await store.append(draft);
    const results = await Promise.allSettled([store.append({ ...draft, workflow: '新增报告' }, first.id), store.append({ ...draft, workflow: '并发覆盖' }, first.id)]);
    assert.equal(results.filter(row => row.status === 'fulfilled').length, 1);
    assert.match(results.find(row => row.status === 'rejected').reason.message, /requirements-revision-conflict/);
    const history = store.history();
    history[0].requirements.title = 'mutated caller copy';
    assert.equal(store.history()[0].requirements.title, draft.title);
    await store.close(); store = undefined;
    await ctx.fiber.dispose(); ctx = await boot(root);
    store = await WorkbenchRequirementsStore.open(ctx.storageDomain, actor, 'development-1');
    assert.equal(store.history().length, 2);
    assert.equal(store.history()[1].parentRevisionId, first.id);
    const other = await WorkbenchRequirementsStore.open(ctx.storageDomain, { ...actor, principalId: 'member-a' }, 'development-1');
    assert.deepEqual(other.history(), []);
    await other.close();
    const currentId = store.history().at(-1).id;
    const abort = new AbortController(); abort.abort();
    await assert.rejects(store.append(draft, currentId, abort.signal), { name: 'AbortError' });
    assert.equal(store.history().length, 2, 'cancelled revision is never persisted');
    const acceptedWrite = store.append({ ...draft, acceptance: '退出前保存' }, currentId);
    const closing = store.close();
    await assert.rejects(store.append(draft, currentId), /development-store-closed/);
    await acceptedWrite;
    await closing;
    assert.throws(() => store.history(), /development-store-closed/);
    await store.close(); store = undefined;
    await ctx.fiber.dispose(); ctx = await boot(root);
    store = await WorkbenchRequirementsStore.open(ctx.storageDomain, actor, 'development-1');
    assert.equal(store.history().length, 3, 'close waits for the accepted write to become durable');
  } finally { await store?.close(); await ctx?.fiber.dispose(); await rm(root, { recursive: true, force: true }); }
});


test('Host service resolves identity, isolates account switches and rejects suspended membership', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workdsh-requirements-service-'));
  const ctx = await boot(root);
  let selected = actor, active = true;
  const identity = {
    id: 'trusted-fixture', async resolve() { return { ...selected }; },
    profile() { return { principalId: selected.principalId, organization: { id: selected.organizationId }, resolvedBy: selected.resolvedBy }; },
    membership() { return { state: active ? 'active' : 'suspended' }; },
  };
  const service = new WorkbenchRequirementsService(ctx.storageDomain, identity);
  try {
    await service.append('service-development', draft);
    assert.equal((await service.history('service-development')).length, 1);
    selected = { ...actor, principalId: 'another-member' };
    assert.deepEqual(await service.history('service-development'), []);
    active = false;
    await assert.rejects(service.append('service-development', draft), /development-access-denied/);
    await assert.rejects(service.history('service-development'), /development-access-denied/);
    active = true; selected = actor;
    assert.equal((await service.history('service-development')).length, 1);
    await service.close();
    await assert.rejects(service.history('service-development'), /development-service-closed/);
  } finally { await service.close(); await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }); }
});


test('Cordis Host mount registers streaming RPC and disposes route and persistent service together', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workdsh-requirements-host-'));
  const ctx = await boot(root);
  let route, service, plugin;
  ctx.provide('workdshIdentity', { id: 'trusted-fixture', async resolve() { return actor; }, profile() { return { principalId: actor.principalId, organization: { id: actor.organizationId }, resolvedBy: actor.resolvedBy }; }, membership() { return { state: 'active' }; } });
  // Connection admission is outside this test; this fixture observes route ownership.
  ctx.provide('connection', { fetch: { register(value) { route = value; return () => { route = undefined; }; } } });
  try {
    plugin = await ctx.plugin({ name: 'workbench-host-probe', apply(child) { service = mountWorkbenchRequirementsHost(child); } });
    assert.equal(route.requestBody, 'streaming');
    assert.deepEqual(route.methods, ['POST']);
    const response = await route.fetch(new Request('http://localhost' + route.path, { method: 'POST', body: JSON.stringify({ endpoint: 'append', payload: { developmentId: 'host-development', requirements: draft } }) }));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).value.requirements.title, draft.title);
    await plugin.dispose(); plugin = undefined;
    assert.equal(route, undefined);
    await assert.rejects(service.history('host-development'), /development-service-closed/);
  } finally { await plugin?.dispose(); await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }); }
});

test('multi-module system survives official storage cold reopen without rewriting prior requirements', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workdsh-system-requirements-'));
  let ctx, store;
  const system = { schemaVersion: '1', modules: [
    { id: 'data', title: '数据管理', pages: [{ id: 'sources', title: '数据来源' }], dependsOn: [] },
    { id: 'analysis', title: '分析任务', pages: [{ id: 'runs', title: '分析记录' }], dependsOn: ['data'] },
  ] };
  try {
    ctx = await boot(root);
    store = await WorkbenchRequirementsStore.open(ctx.storageDomain, actor, 'system-development');
    const baseline = await store.append(draft);
    await store.append({ ...draft, system }, baseline.id);
    system.modules[0].title = 'caller mutation';
    assert.equal(store.history()[1].requirements.system.modules[0].title, '数据管理');
    await store.close(); store = undefined; await ctx.fiber.dispose(); ctx = await boot(root);
    store = await WorkbenchRequirementsStore.open(ctx.storageDomain, actor, 'system-development');
    const history = store.history();
    assert.equal(history.length, 2);
    assert.equal(history[0].requirements.system, undefined);
    assert.deepEqual(history[1].requirements.system.modules[1].dependsOn, ['data']);
    assert.equal(history[1].requirements.system.modules[0].pages[0].id, 'sources');
    await assert.rejects(store.append({ ...draft, system: { schemaVersion: '1', modules: [] } }, history[1].id), /invalid-system-definition/);
    assert.equal(store.history().length, 2);
  } finally { await store?.close(); await ctx?.fiber.dispose(); await rm(root, { recursive: true, force: true }); }
});
