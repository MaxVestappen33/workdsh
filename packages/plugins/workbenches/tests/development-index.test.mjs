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
const built = await build({ entryPoints: [fileURLToPath(new URL('../src/runtime/development-index.ts', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false, alias: { 'workdsh-contracts': fileURLToPath(new URL('../../../contracts/src/index.ts', import.meta.url)) }, plugins: [{ name: 'official-runtime', setup(builder) { builder.onResolve({ filter: /^(?:@deepseek-ai\/dsh-storage-domain|zod)$/ }, args => ({ path: pathToFileURL(runtimeRequire.resolve(args.path)).href, external: true })); } }] });
const { WorkbenchDevelopmentIndex } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const development_serviceBuilt = await build({ entryPoints: [fileURLToPath(new URL('../src/runtime/development-service.ts', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false, alias: { 'workdsh-contracts': fileURLToPath(new URL('../../../contracts/src/index.ts', import.meta.url)) }, plugins: [{ name: 'official-runtime', setup(builder) { builder.onResolve({ filter: /^(?:@deepseek-ai\/dsh-storage-domain|zod)$/ }, args => ({ path: pathToFileURL(runtimeRequire.resolve(args.path)).href, external: true })); } }] });
const { WorkbenchDevelopmentService } = await import(`data:text/javascript;base64,${Buffer.from(development_serviceBuilt.outputFiles[0].text).toString('base64')}`);
const requirements_serviceBuilt = await build({ entryPoints: [fileURLToPath(new URL('../src/runtime/requirements-service.ts', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false, alias: { 'workdsh-contracts': fileURLToPath(new URL('../../../contracts/src/index.ts', import.meta.url)) }, plugins: [{ name: 'official-runtime', setup(builder) { builder.onResolve({ filter: /^(?:@deepseek-ai\/dsh-storage-domain|zod)$/ }, args => ({ path: pathToFileURL(runtimeRequire.resolve(args.path)).href, external: true })); } }] });
const { WorkbenchRequirementsService } = await import(`data:text/javascript;base64,${Buffer.from(requirements_serviceBuilt.outputFiles[0].text).toString('base64')}`);
const development_hostBuilt = await build({ entryPoints: [fileURLToPath(new URL('../src/runtime/development-host.ts', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false, alias: { 'workdsh-contracts': fileURLToPath(new URL('../../../contracts/src/index.ts', import.meta.url)) }, plugins: [{ name: 'official-runtime', setup(builder) { builder.onResolve({ filter: /^(?:@deepseek-ai\/dsh-storage-domain|zod)$/ }, args => ({ path: pathToFileURL(runtimeRequire.resolve(args.path)).href, external: true })); } }] });
const { mountWorkbenchDevelopmentHost } = await import(`data:text/javascript;base64,${Buffer.from(development_hostBuilt.outputFiles[0].text).toString('base64')}`);
const requirements_hostBuilt = await build({ entryPoints: [fileURLToPath(new URL('../src/runtime/requirements-host.ts', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false, alias: { 'workdsh-contracts': fileURLToPath(new URL('../../../contracts/src/index.ts', import.meta.url)) }, plugins: [{ name: 'official-runtime', setup(builder) { builder.onResolve({ filter: /^(?:@deepseek-ai\/dsh-storage-domain|zod)$/ }, args => ({ path: pathToFileURL(runtimeRequire.resolve(args.path)).href, external: true })); } }] });
const { mountWorkbenchRequirementsHost } = await import(`data:text/javascript;base64,${Buffer.from(requirements_hostBuilt.outputFiles[0].text).toString('base64')}`);
const authoringBuilt = await build({ entryPoints: [fileURLToPath(new URL('../src/runtime/authoring-host.ts', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false, alias: { 'workdsh-contracts': fileURLToPath(new URL('../../../contracts/src/index.ts', import.meta.url)) }, plugins: [{ name: 'official-runtime', setup(builder) { builder.onResolve({ filter: /^(?:@deepseek-ai\/dsh-storage-domain|zod)$/ }, args => ({ path: pathToFileURL(runtimeRequire.resolve(args.path)).href, external: true })); } }] });
const { mountWorkbenchAuthoringHost } = await import(`data:text/javascript;base64,${Buffer.from(authoringBuilt.outputFiles[0].text).toString('base64')}`);
const load = async name => import(pathToFileURL(runtimeRequire.resolve(name)).href);
const { Context } = await load('@deepseek-ai/cordis');
const { default: Storage } = await load('@deepseek-ai/dsh-storage');
const JsonStorage = await load('@deepseek-ai/dsh-storage-json');
const StorageDomain = await load('@deepseek-ai/dsh-storage-domain');
const actor = { principalId: 'member.a', organizationId: 'org', requestId: 'test', resolvedBy: 'trusted-fixture' };
const draft = { title: '质量分析', scenario: '质量问题', users: '工程师', dataSources: 'CSV', workflow: '分析并导出', firstIteration: '统计', acceptance: '复算一致' };
async function boot(root) { const ctx = new Context(); await ctx.plugin(Storage); await ctx.plugin(JsonStorage, { root }); await ctx.plugin(StorageDomain, { backend: 'json' }); return ctx; }

const target = { hostId: 'host', installationId: 'desktop', profileId: 'default', harnessVersion: '0.2.0-rc.2' };
const requirement = (patch = {}) => ({ id: 'req-1', developmentId: 'dev-1', owner: { organizationId: actor.organizationId, ownerPrincipalId: actor.principalId, scope: 'personal' }, requirements: draft, createdBy: actor.principalId, createdAt: '2026-10-10T00:00:00.000Z', ...patch });
test('native development Session survives cold reopen and cannot be silently replaced', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workdsh-dev-session-'));
  let ctx, index;
  try {
    ctx = await boot(root); index = await WorkbenchDevelopmentIndex.open(ctx.storageDomain, actor);
    const first = await index.create(requirement(), 'company.quality', 'quality-plugin', target);
    const bound = await index.bindSession('dev-1', first.development.revision, { hostId: target.hostId, sessionId: 'session-1' });
    await assert.rejects(index.bindSession('dev-1', first.development.revision, { hostId: target.hostId, sessionId: 'session-1' }), /revision-conflict/);
    assert.equal((await index.bindSession('dev-1', bound.development.revision, bound.development.session)).development.revision, bound.development.revision);
    await assert.rejects(index.bindSession('dev-1', bound.development.revision, { hostId: target.hostId, sessionId: 'session-2' }), /session-conflict/);
    await assert.rejects(index.bindSession('dev-1', bound.development.revision, { hostId: 'other-host', sessionId: 'session-1' }), /session-host-mismatch/);
    await index.close(); index = undefined; await ctx.fiber.dispose(); ctx = await boot(root);
    index = await WorkbenchDevelopmentIndex.open(ctx.storageDomain, actor);
    assert.deepEqual(index.find('dev-1').development.session, { hostId: target.hostId, sessionId: 'session-1' });
  } finally { await index?.close(); await ctx?.fiber.dispose(); await rm(root, { recursive: true, force: true }); }
});
test('development remains discoverable after cold restart without an installed plugin or original chat', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workdsh-development-index-'));
  let ctx, index;
  try {
    ctx = await boot(root);
    index = await WorkbenchDevelopmentIndex.open(ctx.storageDomain, actor);
    const first = await index.create(requirement(), 'company.quality', 'quality-plugin', target);
    assert.equal(first.development.state, 'ready');
    assert.equal(first.development.installed, undefined);
    assert.equal(first.development.source, undefined, 'index does not invent a source directory');
    const repeated = await index.create(requirement(), 'company.quality', 'quality-plugin', target);
    assert.equal(repeated.development.iterationId, first.development.iterationId);
    assert.equal(index.list().length, 1);
    first.development.target.profileId = 'mutated';
    assert.equal(index.find('dev-1').development.target.profileId, 'default');
    await index.close(); await ctx.fiber.dispose();
    ctx = await boot(root);
    index = await WorkbenchDevelopmentIndex.open(ctx.storageDomain, actor);
    assert.equal(index.list().length, 1);
    assert.equal(index.find('dev-1').development.requirementsRevision, 'req-1');
    const other = await WorkbenchDevelopmentIndex.open(ctx.storageDomain, { ...actor, principalId: 'member-a' });
    assert.deepEqual(other.list(), []);
    await other.close();
    await assert.rejects(index.create(requirement({ developmentId: 'dev-2' }), 'company.quality', 'other-plugin', target), /development-identity-conflict/);
    await assert.rejects(index.create(requirement(), 'company.quality', 'quality-plugin', { ...target, hostId: 'other-host' }), /development-conflict/);
    await assert.rejects(index.create(requirement({ createdBy: 'other-member' }), 'company.quality', 'quality-plugin', target), /development-owner-mismatch/);
  } finally { await index?.close(); await ctx?.fiber.dispose(); await rm(root, { recursive: true, force: true }); }
});
test('requirements updates detect concurrent revisions and shutdown preserves an already accepted write', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workdsh-development-index-revisions-'));
  const ctx = await boot(root);
  const index = await WorkbenchDevelopmentIndex.open(ctx.storageDomain, actor);
  try {
    const first = await index.create(requirement(), 'company.quality', 'quality-plugin', target);
    const next = requirement({ id: 'req-2', parentRevisionId: 'req-1', requirements: { ...draft, title: '质量分析新版' } });
    const results = await Promise.allSettled([index.advanceRequirements(next, first.development.revision), index.advanceRequirements(next, first.development.revision)]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.match(results.find(result => result.status === 'rejected').reason.message, /development-revision-conflict/);
    const current = index.find('dev-1');
    assert.equal(current.title, '质量分析新版');
    assert.notEqual(current.development.iterationId, first.development.iterationId, 'a saved requirements revision starts a new iteration');
    const repeated = await index.advanceRequirements(next, current.development.revision);
    assert.equal(repeated.development.iterationId, current.development.iterationId, 'same requirements retry preserves the confirmed iteration');
    assert.equal(repeated.development.revision, current.development.revision);
    await assert.rejects(index.advanceRequirements(requirement({ id: 'req-4', parentRevisionId: 'req-3' }), current.development.revision), /requirements-revision-conflict/);
    const aborted = new AbortController(); aborted.abort();
    await assert.rejects(index.create(requirement({ developmentId: 'dev-2' }), 'company.finance', 'finance-plugin', target, aborted.signal), { name: 'AbortError' });
    assert.equal(index.list().length, 1);
    const write = index.create(requirement({ developmentId: 'dev-2' }), 'company.finance', 'finance-plugin', target);
    const close = index.close();
    await assert.rejects(index.create(requirement({ developmentId: 'dev-3' }), 'company.other', 'other-plugin', target), /development-store-closed/);
    await write; await close;
    assert.throws(() => index.list(), /development-store-closed/);
    const restored = await WorkbenchDevelopmentIndex.open(ctx.storageDomain, actor);
    assert.equal(restored.list().length, 2);
    await restored.close();
  } finally { await index.close(); await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }); }
});
test('Host development service reads saved requirements and isolates member switches and revoked access', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workdsh-development-service-'));
  const ctx = await boot(root);
  let selected = actor, active = true, switchDuringTarget = false;
  const identity = {
    async resolve() { return { ...selected }; },
    profile() { return { principalId: selected.principalId, organization: { id: selected.organizationId }, resolvedBy: selected.resolvedBy }; },
    membership() { return { state: active ? 'active' : 'suspended' }; },
  };
  const requirements = new WorkbenchRequirementsService(ctx.storageDomain, identity);
  const service = new WorkbenchDevelopmentService(ctx.storageDomain, identity, requirements, async () => {
    if (switchDuringTarget) selected = { ...actor, principalId: 'other-member' };
    return { ...target };
  });
  try {
    assert.deepEqual(await service.identityScope(), { organizationId: actor.organizationId, principalId: actor.principalId });
    const first = await requirements.append('dev-1', draft);
    await assert.rejects(service.create('dev-1', 'company.quality', 'quality-plugin', 'fake-revision'), /requirements-revision-conflict/);
    assert.deepEqual(await service.list(), []);
    const created = await service.create('dev-1', 'company.quality', 'quality-plugin', first.id);
    assert.equal(created.development.target.hostId, target.hostId);
    const next = await requirements.append('dev-1', { ...draft, title: '调整质量工作台' }, first.id);
    const updated = await service.advanceRequirements('dev-1', next.id, created.development.revision);
    assert.equal(updated.title, '调整质量工作台');
    let sessionVerifierCalls = 0;
    await assert.rejects(service.bindVerifiedSession('dev-1', 'stale', async () => {
      sessionVerifierCalls++; return { hostId: target.hostId, sessionId: 'session-1' };
    }), /development-revision-conflict/);
    assert.equal(sessionVerifierCalls, 0);
    await assert.rejects(service.bindVerifiedSession('dev-1', updated.development.revision, async (resolved, development) => {
      assert.equal(resolved.principalId, actor.principalId);
      assert.equal(development.id, 'dev-1');
      active = false;
      return { hostId: target.hostId, sessionId: 'session-1' };
    }), /development-access-denied/);
    active = true;
    assert.equal((await service.list())[0].development.session, undefined, 'revocation during verification cannot persist a Session binding');
    let verifierCalls = 0;
    await assert.rejects(service.bindVerifiedSource('dev-1', 'stale', async()=>{verifierCalls++;return {hostId:'host',directory:root,revision:'source-1'};}), /development-revision-conflict/);
    assert.equal(verifierCalls,0);
    const bound = await service.bindVerifiedSource('dev-1',updated.development.revision,async(owner,development)=>{
      assert.equal(owner.principalId,actor.principalId);assert.equal(development.packageName,'quality-plugin');
      return {hostId:'host',directory:root,revision:'source-1'};
    });
    assert.equal(bound.development.source.directory,root);
    await assert.rejects(service.bindVerifiedSource('dev-1',bound.development.revision,async()=>{
      selected={...actor,principalId:'other-member'};
      return {hostId:'host',directory:root,revision:'source-2'};
    }),/development-access-denied/);
    selected=actor;
    assert.equal((await service.list())[0].development.source.revision,'source-1');

    selected = { ...actor, principalId: 'other-member' };
    assert.deepEqual(await service.list(), []);
    await assert.rejects(service.create('dev-1', 'company.quality', 'quality-plugin', next.id), /requirements-revision-conflict/);
    active = false;
    await assert.rejects(service.list(), /development-access-denied/);
    active = true; selected = actor;
    assert.equal((await service.list()).length, 1);
    const pending = await requirements.append('dev-2', draft);
    switchDuringTarget = true;
    await assert.rejects(service.create('dev-2', 'company.finance', 'finance-plugin', pending.id), /development-access-denied/);
    selected = actor;
    await assert.rejects(service.list(),/development-access-denied/,'runtime migration must recheck identity after resolving its target');
    switchDuringTarget=false;selected=actor;
    assert.equal((await service.list()).length, 1, 'identity changed during target resolution cannot create a record');
    await service.close();
    await assert.rejects(service.list(), /development-service-closed/);
  } finally { await service.close(); await requirements.close(); await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }); }
});
test('Host authoring mount owns both streaming routes and closes indexes on plugin unload', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workdsh-authoring-host-'));
  const ctx = await boot(root);
  const routes = new Map();
  let plugin, requirements, developments;
  ctx.provide('workdshIdentity', { async resolve() { return actor; }, profile() { return { principalId: actor.principalId, organization: { id: actor.organizationId }, resolvedBy: actor.resolvedBy }; }, membership() { return { state: 'active' }; } });
  // Observes connection route lifetime; this is not actual network admission testing.
  ctx.provide('connection', { fetch: { register(route) {
    assert.equal(route.requestBody, 'streaming');
    assert.deepEqual(route.methods, ['POST']);
    assert.equal(routes.has(route.path), false);
    routes.set(route.path, route);
    return () => routes.delete(route.path);
  } } });
  const invoke = async (path, endpoint, payload) => {
    const response = await routes.get(path).fetch(new Request('http://localhost' + path, { method: 'POST', body: JSON.stringify({ endpoint, payload }) }));
    assert.equal(response.status, 200);
    return (await response.json()).value;
  };
  try {
    plugin = await ctx.plugin({ name: 'workbench-authoring-host-probe', apply(child) {
      const mounted = mountWorkbenchAuthoringHost(child, async () => ({ ...target }));
      requirements = mounted.requirements;
      developments = mounted.development;
    } });
    const saved = await invoke('/api/workdsh-workbench-requirements', 'append', { developmentId: 'dev-1', requirements: draft });
    const created = await invoke('/api/workdsh-workbench-development', 'create', { developmentId: 'dev-1', workbenchId: 'company.quality', packageName: 'quality-plugin', expectedRequirementsRevision: saved.id });
    assert.equal(created.development.requirementsRevision, saved.id);
    assert.equal((await invoke('/api/workdsh-workbench-development', 'list', {})).length, 1);
    await plugin.dispose(); plugin = undefined;
    assert.equal(routes.size, 0);
    await assert.rejects(developments.list(), /development-service-closed/);
    await assert.rejects(requirements.history('dev-1'), /development-service-closed/);
  } finally { await plugin?.dispose(); await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }); }
});

test('Host source binding survives restart and rejects stale revisions and other hosts', async()=>{
 const root=await mkdtemp(join(tmpdir(),'workdsh-source-binding-'));let ctx,index;
 try{
  ctx=await boot(root);index=await WorkbenchDevelopmentIndex.open(ctx.storageDomain,actor);
  const entry=await index.create(requirement(),'company.quality','quality-plugin',target);
  await assert.rejects(index.bindSource('dev-1',entry.development.revision,{hostId:'other',directory:root,revision:'source-1'}),/source-host-mismatch/);
  await assert.rejects(index.bindSource('dev-1',entry.development.revision,{hostId:'host',directory:'relative',revision:'source-1'}));
  const source={hostId:'host',directory:root,revision:'source-1'};
  const saved=await index.bindSource('dev-1',entry.development.revision,source);
  source.directory='/mutated';assert.equal(saved.development.source.directory,root);
  await assert.rejects(index.bindSource('dev-1',entry.development.revision,source),/development-revision-conflict/);
  await index.close();await ctx.fiber.dispose();ctx=await boot(root);index=await WorkbenchDevelopmentIndex.open(ctx.storageDomain,actor);
  assert.equal(index.find('dev-1').development.source.directory,root);
  assert.equal(index.find('dev-1').development.source.revision,'source-1');
 }finally{await index?.close();await ctx?.fiber.dispose();await rm(root,{recursive:true,force:true});}
});

test('ensure Session persists prepared source before native launch and resumes after launch failure', async () => {
 const root = await mkdtemp(join(tmpdir(), 'workdsh-source-session-')); const ctx = await boot(root);
 const identity = { async resolve() { return actor; }, profile() { return { principalId: actor.principalId, organization: { id: actor.organizationId }, resolvedBy: actor.resolvedBy }; }, membership() { return { state: 'active' }; } };
 const requirements = new WorkbenchRequirementsService(ctx.storageDomain, identity);
 let fail = true, prepares = 0;
 const service = new WorkbenchDevelopmentService(ctx.storageDomain, identity, requirements, async () => target,
  async (_actor, development) => { assert.equal(development.source.directory, root); if (fail) throw new Error('native-launch-failed'); return { hostId: target.hostId, sessionId: 'session-1' }; },
  async () => { prepares++; return { hostId: target.hostId, directory: root, revision: 'source-1' }; });
 try {
  const saved = await requirements.append('dev-1', draft); const created = await service.create('dev-1', 'company.quality', 'quality-plugin', saved.id);
  await assert.rejects(service.ensureSession('dev-1', 'stale'), /development-revision-conflict/); assert.equal(prepares, 0);
  await assert.rejects(service.ensureSession('dev-1', created.development.revision), /native-launch-failed/);
  const prepared = (await service.list())[0]; assert.equal(prepared.development.source.directory, root); assert.equal(prepared.development.session, undefined);
  fail = false; const launched = await service.ensureSession('dev-1', prepared.development.revision); assert.equal(launched.development.session.sessionId, 'session-1');
  const repeated = await service.ensureSession('dev-1', launched.development.revision); assert.equal(repeated.development.revision, launched.development.revision);
  await requirements.append('dev-1', { ...draft, scenario: '新的需求尚未关联' }, saved.id);
  const beforeConflict = prepares;
  await assert.rejects(service.ensureSession('dev-1', launched.development.revision), /requirements-revision-conflict/);
  assert.equal(prepares, beforeConflict, 'outdated requirement must not prepare source or launch a Session');
 } finally { await service.close(); await requirements.close(); await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }); }
});

test('requirement changes during source preparation prevent native Session launch', async () => {
 const root = await mkdtemp(join(tmpdir(), 'workdsh-baseline-launch-')); const ctx = await boot(root);
 const identity = { async resolve() { return actor; }, profile() { return { principalId: actor.principalId, organization: { id: actor.organizationId }, resolvedBy: actor.resolvedBy }; }, membership() { return { state: 'active' }; } };
 const requirements = new WorkbenchRequirementsService(ctx.storageDomain, identity);
 let launched = 0, saved;
 const service = new WorkbenchDevelopmentService(ctx.storageDomain, identity, requirements, async () => target,
  async () => { launched++; return { hostId: target.hostId, sessionId: 'session-old' }; },
  async () => { await requirements.append('dev-1', { ...draft, scenario: '准备源码时更新需求' }, saved.id); return { hostId: target.hostId, directory: root, revision: 'source-1' }; });
 try {
  saved = await requirements.append('dev-1', draft); const entry = await service.create('dev-1', 'company.quality', 'quality-plugin', saved.id);
  await assert.rejects(service.ensureSession('dev-1', entry.development.revision), /requirements-revision-conflict/);
  assert.equal(launched, 0); assert.equal((await service.list())[0].development.session, undefined);
 } finally { await service.close(); await requirements.close(); await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }); }
});

test('source revision changes retain native Session workspace and reject redirection',async()=>{
 const root=await mkdtemp(join(tmpdir(),'workdsh-source-session-guard-'));let ctx,index;
 try{
  ctx=await boot(root);index=await WorkbenchDevelopmentIndex.open(ctx.storageDomain,actor);
  const created=await index.create(requirement(),'company.quality','quality-plugin',target);
  const sourced=await index.bindSource('dev-1',created.development.revision,{hostId:'host',directory:root,revision:'source-old'});
  const bound=await index.bindSession('dev-1',sourced.development.revision,{hostId:'host',sessionId:'native-session'});
  await assert.rejects(index.bindSource('dev-1',bound.development.revision,{hostId:'host',directory:join(root,'candidate'),revision:'source-restored'}),/source-identity-mismatch/);
  assert.equal(index.find('dev-1').development.revision,bound.development.revision);
  const restored=await index.bindSource('dev-1',bound.development.revision,{hostId:'host',directory:root,revision:'source-restored'});
  assert.equal(restored.development.session.sessionId,'native-session');assert.equal(restored.development.source.directory,root);
  await index.close();await ctx.fiber.dispose();ctx=await boot(root);index=await WorkbenchDevelopmentIndex.open(ctx.storageDomain,actor);
  assert.equal(index.find('dev-1').development.source.revision,'source-restored');assert.equal(index.find('dev-1').development.session.sessionId,'native-session');
 }finally{await index?.close();await ctx?.fiber.dispose();await rm(root,{recursive:true,force:true});}
});

test('recovery preparer rejects stale development and revoked authority without accepting a receipt',async()=>{
 const root=await mkdtemp(join(tmpdir(),'workdsh-recovery-authority-')),ctx=await boot(root);let active=true,calls=0,revoke=false;
 const identity={async resolve(){return actor;},profile(){return {principalId:actor.principalId,organization:{id:actor.organizationId},resolvedBy:actor.resolvedBy};},membership(){return {state:active?'active':'revoked'};}};
 const requirements=new WorkbenchRequirementsService(ctx.storageDomain,identity);
 const service=new WorkbenchDevelopmentService(ctx.storageDomain,identity,requirements,async()=>target,undefined,undefined,undefined,undefined,async(_development,hash,check)=>{calls++;if(revoke)active=false;check();return {journalId:'operation',beforeSha256:hash,targetSha256:hash,state:'prepared'};});
 try{
  const saved=await requirements.append('dev-1',draft),created=await service.create('dev-1','company.quality','quality-plugin',saved.id),hash='a'.repeat(64);
  const bound=await service.bindVerifiedSource('dev-1',created.development.revision,async()=>({hostId:'host',directory:root,revision:'source-sha256:'+hash}));
  await assert.rejects(service.prepareSourceRecovery('dev-1','stale',hash),/development-revision-conflict/);assert.equal(calls,0);
  assert.equal((await service.prepareSourceRecovery('dev-1',bound.development.revision,hash)).state,'prepared');assert.equal(calls,1);
  revoke=true;await assert.rejects(service.prepareSourceRecovery('dev-1',bound.development.revision,hash),/development-access-denied/);assert.equal(calls,2);
 }finally{await service.close();await requirements.close();await ctx.fiber.dispose();await rm(root,{recursive:true,force:true});}
});

test('cold continuation preserves requirement/source/Session and rejects moved installation before touching files',async()=>{
 const root=await mkdtemp(join(tmpdir(),'workdsh-cold-continuation-'));let ctx,requirements,service;let moved=false,sourceCalls=0,sessionCalls=0;
 const identity={async resolve(){return actor;},profile(){return {principalId:actor.principalId,organization:{id:actor.organizationId},resolvedBy:actor.resolvedBy};},membership(){return {state:'active'};}};
 async function reopen(){
  ctx=await boot(root);requirements=new WorkbenchRequirementsService(ctx.storageDomain,identity);
  service=new WorkbenchDevelopmentService(ctx.storageDomain,identity,requirements,async()=>moved?{...target,installationId:'another-installation'}:target,
   async(_actor,development)=>{sessionCalls++;if(development.session)assert.equal(development.session.sessionId,'same-session');return {hostId:target.hostId,sessionId:'same-session'};},
   async(_actor,development)=>{sourceCalls++;if(development.source)assert.equal(development.source.directory,root);return {hostId:target.hostId,directory:root,revision:'source-1'};});
 }
 try{
  await reopen();const saved=await requirements.append('dev-1',draft),created=await service.create('dev-1','company.quality','quality-plugin',saved.id);
  const first=await service.ensureSession('dev-1',created.development.revision);
  await service.close();await requirements.close();await ctx.fiber.dispose();await reopen();
  const reopened=(await service.list())[0],resumed=await service.ensureSession('dev-1',reopened.development.revision);
  assert.equal(resumed.development.id,first.development.id);assert.equal(resumed.development.session.sessionId,'same-session');assert.equal(resumed.development.requirementsRevision,saved.id);assert.equal(resumed.development.source.directory,root);
  const before=[sourceCalls,sessionCalls];moved=true;
  await assert.rejects(service.ensureSession('dev-1',resumed.development.revision),/installation-target-changed/);
  assert.deepEqual([sourceCalls,sessionCalls],before);assert.equal((await service.list())[0].development.revision,resumed.development.revision);
 }finally{await service?.close();await requirements?.close();await ctx?.fiber.dispose();await rm(root,{recursive:true,force:true});}
});

test('Host runtime upgrade preserves source/session and requirements, starts a new unchecked iteration, and rejects other installations or downgrade',async()=>{
 const root=await mkdtemp(join(tmpdir(),'workdsh-runtime-migration-'));let ctx,index;
 try{
  ctx=await boot(root);index=await WorkbenchDevelopmentIndex.open(ctx.storageDomain,actor);
  const first=await index.create(requirement(),'company.quality','quality-plugin',{...target,harnessVersion:'0.2.1-alpha.2'});
  const bound=await index.bindSession('dev-1',first.development.revision,{hostId:target.hostId,sessionId:'original-session'});
  const migrated=await index.upgradeRuntime('dev-1',bound.development.revision,{...target,harnessVersion:'0.2.1-rc.1'});
  assert.equal(migrated.development.session.sessionId,'original-session');assert.equal(migrated.development.requirementsRevision,bound.development.requirementsRevision);
  assert.notEqual(migrated.development.iterationId,bound.development.iterationId);assert.equal(migrated.development.state,'changes-requested');
  assert.equal((await index.upgradeRuntime('dev-1',migrated.development.revision,migrated.development.target)).development.revision,migrated.development.revision);
  await assert.rejects(index.upgradeRuntime('dev-1',migrated.development.revision,{...target,hostId:'other',harnessVersion:'0.2.1-rc.1'}),/target-changed/);
  await assert.rejects(index.upgradeRuntime('dev-1',migrated.development.revision,{...target,harnessVersion:'0.2.1-alpha.2'}),/downgrade/);
 }finally{await index?.close();await ctx?.fiber.dispose();await rm(root,{recursive:true,force:true});}
});
