import {preflightExternals} from './support/preflight-externals.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const official = createRequire(realpathSync(join(root, 'apps/web/node_modules/@deepseek-ai/dsh/package.json')));
const {build:esbuildBuild} = createRequire(join(root, 'apps/web/package.json'))('esbuild');
const build=options=>esbuildBuild({...options,plugins:[preflightExternals,...(options.plugins??[])]});

// Run the actual import Host and durable official JSON journal. Package execution
// is a fixture: this tests authorization/iteration ordering, not installed bytes.
const built = await build({ entryPoints: [join(root, 'packages/plugins/workbenches/src/runtime/profile-import-host.ts')], bundle: true, platform: 'node', format: 'esm', write: false,
  alias: { 'workdsh-contracts': join(root, 'packages/contracts/src/index.ts') },
  plugins: [{ name: 'iteration-install-fixture', setup(builder) {
    builder.onResolve({ filter: /^\.\/profile-target\.js$/ }, () => ({ path: 'target', namespace: 'iteration-fixture' }));
    builder.onResolve({ filter: /^\.\/profile-installer\.js$/ }, () => ({ path: 'installer', namespace: 'iteration-fixture' }));
    builder.onResolve({ filter: /^\.\/import-operation\.js$/ }, () => ({ path: 'adapter', namespace: 'iteration-fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'iteration-fixture' }, args => ({ contents: args.path === 'target' ? `
      export async function createProfileWorkbenchTarget(){return async()=>({...globalThis.__iterationImportFixture.target});}
    ` : args.path === 'installer' ? `
      export async function createProfileWorkbenchInstaller(){return async(_path,_signal,beforeInstall)=>{
        await globalThis.__iterationImportFixture.beforeLock?.();
        await beforeInstall?.();
        globalThis.__iterationImportFixture.installs++;
        if(globalThis.__iterationImportFixture.loseReply)throw Error('lost-reply');
        return {exitCode:0};
      };}
    ` : `
      export function createWorkbenchImportOperationAdapter(input){
        const verify=async()=>({state:'succeeded',receipt:{package:{packageName:input.expected.packageName,version:input.expected.version,sha256:input.expected.sha256},pendingRestart:false}});
        return {
          async preflight(operation,signal){await globalThis.__iterationImportFixture.beforePreflight?.();await input.checkInstalledBaseline?.(operation,signal);},
          async execute(operation,signal){return input.install('fixture-archive',signal,()=>input.checkInstalledBaseline?.(operation,signal));},
          verify,
          async inspect(){globalThis.__iterationImportFixture.inspections++;return verify();},
        };
      }
    `, loader: 'js' }));
    builder.onResolve({ filter: /^(?:@deepseek-ai\/dsh-storage-domain|@deepseek-ai\/dsh-app-boot|zod)$/ }, args => ({ path: pathToFileURL(official.resolve(args.path)).href, external: true }));
  } }],
});
const { mountProfileWorkbenchImportHost } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const loadOfficial = async name => import(pathToFileURL(official.resolve(name)).href);
const { Context } = await loadOfficial('@deepseek-ai/cordis');
const { default: Storage } = await loadOfficial('@deepseek-ai/dsh-storage');
const JsonStorage = await loadOfficial('@deepseek-ai/dsh-storage-json');
const StorageDomain = await loadOfficial('@deepseek-ai/dsh-storage-domain');
const actor = { principalId: 'user', organizationId: 'personal', requestId: 'request', resolvedBy: 'fixture' };
const target = { hostId: 'host', installationId: 'web', profileId: 'preview', harnessVersion: '0.2.1-rc.1' };
const expected = { packageName: 'quality-plugin', workbenchId: 'company.quality', version: '0.2.0', sha256: 'a'.repeat(64) };

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'workdsh-import-iteration-'));
  const storage = new Context(); await storage.plugin(Storage); await storage.plugin(JsonStorage, { root: join(dir, 'storage') }); await storage.plugin(StorageDomain, { backend: 'json' });
  const disposers = [], provided = new Map();
  let current = { id: 'dev', workbenchId: expected.workbenchId, packageName: expected.packageName, target, iterationId: 'iteration-1', requirementsRevision: 'req-1' };
  const state = { target, installs: 0, inspections: 0 }; const previous = globalThis.__iterationImportFixture; globalThis.__iterationImportFixture = state;
  const identity = { async resolve() { return actor; }, profile() { return { principalId: actor.principalId, organization: { id: actor.organizationId }, resolvedBy: actor.resolvedBy }; }, membership() { return { state: 'active' }; } };
  const profile = { name: 'preview', dir };
  provided.set('workdshIdentity', identity); provided.set('storageDomain', storage.storageDomain); provided.set('profileContext', profile);
  const ctx = { get: key => provided.get(key), provide: (key, value) => provided.set(key, value), fiber: { assertActive() {} }, effect: run => { disposers.push(run()); } };
  const service = await mountProfileWorkbenchImportHost(ctx, { list: async () => [{ title: '质量分析', development: structuredClone(current) }] }, () => true, '4.0.5', {});
  const request = { developmentId: 'dev', expected, archivePath: 'fixture-archive', intent: { id: 'operation-1', iterationId: 'iteration-1', kind: 'install', inputHash: expected.sha256, target } };
  return { service, state, request, change: updates => { current = { ...current, ...updates }; },
    async cleanup() { for (const dispose of disposers.reverse()) await dispose?.(); await storage.fiber.dispose(); globalThis.__iterationImportFixture = previous; await rm(dir, { recursive: true, force: true }); },
  };
}

test('Host rejects an arbitrary or stale AI iteration before journaling or submitting installation', async () => {
  const f = await fixture();
  try {
    await assert.rejects(f.service.run({ ...f.request, intent: { ...f.request.intent, iterationId: 'invented-iteration' } }), /operation-iteration-conflict/);
    f.change({ iterationId: 'iteration-2', requirementsRevision: 'req-2' });
    await assert.rejects(f.service.run(f.request), /operation-iteration-conflict/);
    assert.equal(f.state.installs, 0); assert.deepEqual(await f.service.list('dev'), []);
  } finally { await f.cleanup(); }
});

test('requirements change during preflight or waiting for the installation lock prevents package mutation', async () => {
  for (const point of ['beforePreflight', 'beforeLock']) {
    const f = await fixture();
    try {
      f.state[point] = async () => f.change({ iterationId: 'iteration-2', requirementsRevision: 'req-2' });
      if (point === 'beforePreflight') await assert.rejects(f.service.run(f.request), /operation-iteration-conflict/);
      else assert.equal((await f.service.run(f.request)).state, 'unknown', 'late executor rejection keeps an uncertain operation for inspection');
      assert.equal(f.state.installs, 0);
      await assert.rejects(f.service.run({ ...f.request, intent: { ...f.request.intent, id: 'stale-new-operation' } }), /operation-iteration-conflict/);
    } finally { await f.cleanup(); }
  }
});

test('new requests retain the current saved iteration and historical unknown operations reconcile after the next requirements revision without another install', async () => {
  const f = await fixture();
  try {
    f.state.loseReply = true;
    const unknown = await f.service.run(f.request); assert.equal(unknown.state, 'unknown'); assert.equal(unknown.iterationId, 'iteration-1');
    f.change({ iterationId: 'iteration-2', requirementsRevision: 'req-2' });
    const recovered = await f.service.run({ ...f.request, recover: true });
    assert.equal(recovered.state, 'succeeded'); assert.equal(recovered.iterationId, 'iteration-1'); assert.equal(f.state.installs, 1); assert.equal(f.state.inspections, 1);
    await assert.rejects(f.service.run({ ...f.request, recover: true, intent: { ...f.request.intent, iterationId: 'iteration-2' } }), /operation-input-conflict/);
    f.state.loseReply = false;
    const next = await f.service.run({ ...f.request, intent: { ...f.request.intent, id: 'operation-2', iterationId: 'iteration-2' } });
    assert.equal(next.state, 'succeeded'); assert.equal(next.developmentId, recovered.developmentId); assert.equal(next.iterationId, 'iteration-2'); assert.equal(f.state.installs, 2);
    assert.deepEqual((await f.service.list('dev')).map(row => row.iterationId), ['iteration-1', 'iteration-2']);
  } finally { await f.cleanup(); }
});
