import {preflightExternals} from './support/preflight-externals.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { realpathSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const repository = fileURLToPath(new URL('../../../../', import.meta.url));
const anchor = realpathSync(join(repository, 'apps/web/node_modules/@deepseek-ai/dsh/package.json'));
const officialRequire = createRequire(anchor);
const {build:esbuildBuild} = createRequire(join(repository, 'apps/web/package.json'))('esbuild');
const build=options=>esbuildBuild({...options,plugins:[preflightExternals,...(options.plugins??[])]});
const pnpm = join(repository, 'apps/web/node_modules/pnpm/bin/pnpm.cjs');
const official = name => import(pathToFileURL(officialRequire.resolve(name)).href);
const { runPluginCommand } = await official('@deepseek-ai/dsh-plugin-manager/operations');
const { Context } = await official('@deepseek-ai/cordis');
const { default: Storage } = await official('@deepseek-ai/dsh-storage');
const JsonStorage = await official('@deepseek-ai/dsh-storage-json');
const StorageDomain = await official('@deepseek-ai/dsh-storage-domain');

async function loadOwned(relative) {
  const output = await build({
    entryPoints: [join(repository, 'packages/plugins/workbenches/src/runtime', relative)],
    bundle: true, platform: 'node', format: 'esm', write: false,
    alias: { 'workdsh-contracts': join(repository, 'packages/contracts/src/index.ts') },
    plugins: [{ name: 'published-storage', setup(builder) {
      builder.onResolve({ filter: /^(?:@deepseek-ai\/dsh-storage-domain|@deepseek-ai\/dsh-app-boot|zod)$/ },
        args => ({ path: pathToFileURL(officialRequire.resolve(args.path)).href, external: true }));
    } }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
}
const { mountNativeWorkbenchInstallationHost } = await loadOwned('native-installation-host.ts');
const {mountWorkbenchDevelopmentTimingHost}=await loadOwned('development-timing-host.ts');
const { WorkbenchInstallationArchives } = await loadOwned('installation-archives.ts');
const { createProfileWorkbenchTarget } = await loadOwned('profile-target.ts');
const { inspectWorkbenchPackageArtifact } = await loadOwned('package-artifact.ts');

async function bootStorage(root) {
  const ctx = new Context();
  await ctx.plugin(Storage);
  await ctx.plugin(JsonStorage, { root });
  await ctx.plugin(StorageDomain, { backend: 'json' });
  return ctx;
}

async function fixture() {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'workdsh-native-installation-')));
  const directory = join(home, 'profile'), storageRoot = join(home, 'storage');
  await mkdir(directory);
  await writeFile(join(directory, 'package.json'), JSON.stringify({ name: 'isolated-native-receipt', version: '0.0.0', private: true, dsh: { bundles: [] } }));
  await writeFile(join(directory, 'pnpm-workspace.yaml'), 'packages: []\n');
  const profile = { name: 'native-receipt-test', dir: directory, home, cwd: home, installAnchor: anchor,
    packageManager: { command: process.execPath, args: [pnpm], env: {} } };
  const actor = { principalId: 'native-user', organizationId: 'personal-org', requestId: 'test', resolvedBy: 'fixture' };
  const flags = { active: true, owner: true, bound: true, revision: 'development-1', requirement: 'requirements-1',
    listReads: 0, inspections: 0, onList: undefined, onInspect: undefined, sideEffects: 0 };
  const routes = new Map(), disposers = [];
  let source, api, archives, storageContext;
  const services = {
    profileContext: profile,
    workdshIdentity: {
      resolve: async () => ({ ...actor }),
      profile: () => ({ principalId: actor.principalId, resolvedBy: actor.resolvedBy,
        organization: { id: actor.organizationId, kind: 'personal' } }),
      membership: () => ({ state: flags.active ? 'active' : 'revoked' }),
    },
    workdshAccess: { sessionOwner: () => flags.owner ? { ownerPrincipalId: actor.principalId, organizationId: actor.organizationId } : undefined },
    sessionController: { inspect: async id => {
      assert.equal(id, 'native-session-1');
      flags.inspections++;
      flags.onInspect?.(flags.inspections);
      return { meta: { cwd: source } };
    } },
    connection: { fetch: { register: route => { routes.set(route.path, route); return () => routes.delete(route.path); } } },
  };
  const ctx = {
    get: key => {
      if (/^(?:pluginManager|bundleManager|workdshWorkbenchImport)$/.test(key)) {
        flags.sideEffects++;
        throw new Error('verification-must-not-install-or-enable');
      }
      return services[key];
    },
    fiber: { assertActive() {} },
    effect: body => { const dispose = body(); disposers.push(dispose); return dispose; },
  };
  const target = await (await createProfileWorkbenchTarget(ctx))(actor);
  const developmentId = 'native-development-1';
  const key = createHash('sha256').update(JSON.stringify([actor.organizationId, actor.principalId, target.hostId, developmentId])).digest('hex');
  source = join(directory, 'workdsh-workbench-sources', key);
  await mkdir(source, { recursive: true });
  const descriptor = { id: 'workdsh.native-receipt-test', title: '原生安装核验探针', description: '', protocolVersion: '1.0', layout: 'full-page',
    hostCompatibility: { sdk: '^1.0.0', harness: target.harnessVersion }, capabilities: [] };
  const packageName = 'workdsh-native-receipt-test', version = '0.1.0';
  await writeFile(join(source, 'package.json'), JSON.stringify({ name: packageName, version, type: 'module',
    files: ['index.js', 'index.d.ts', 'client.js', 'client.d.ts', 'cordis.patch.yml'],
    exports: { '.': { default: './index.js', types: './index.d.ts' }, './client': { default: './client.js', types: './client.d.ts' } },
    dsh: { bundle: { patch: './cordis.patch.yml' }, client: { platform: 'web' } }, workdsh: { workbench: descriptor } }));
  await Promise.all(['index.js', 'client.js'].map(name => writeFile(join(source, name), 'throw new Error("fixture-entry-must-not-run");\n')));
  await Promise.all(['index.d.ts', 'client.d.ts'].map(name => writeFile(join(source, name), 'export {};\n')));
  await writeFile(join(source, 'cordis.patch.yml'), '- insert: []\n');
  await promisify(execFile)(process.execPath, [pnpm, '--dir', source, 'pack', '--pack-destination', source], { cwd: source, timeout: 15_000 });
  const archive = join(source, `${packageName}-${version}.tgz`);
  const artifact = await inspectWorkbenchPackageArtifact(archive, { packageName, version, workbenchId: descriptor.id });
  // Real published package-manager installation in an isolated Profile. No bundle
  // activation or entry evaluation; this fixture does not claim a running GUI.
  const installation = await runPluginCommand({ profile: profile.name, dir: directory, cwd: home, home, installAnchor: anchor },
    ['add', archive, '--ignore-scripts'], { ...profile.packageManager, execution: 'service', outputBytes: 16_384,
      activateNewBundles: false, lockWaitMs: 5000, idleTimeoutMs: 15_000, lookupTimeoutMs: 5000 });
  assert.equal(installation.exitCode, 0);
  const snapshot = () => ({ id: developmentId, packageName, workbenchId: descriptor.id, revision: flags.revision,
    requirementsRevision: 'requirements-1', iterationId: 'iteration-1', target,
    source: { directory: source, hostId: target.hostId, revision: 'source-1' },
    session: flags.bound ? { sessionId: 'native-session-1', hostId: target.hostId } : undefined });
  const development = { list: async () => {
    flags.listReads++;
    flags.onList?.(flags.listReads);
    return [{ title: descriptor.title, development: snapshot() }];
  } };
  const requirements = { history: async () => [{ id: flags.requirement, requirements: { title: descriptor.title } }] };
  async function mount() {
    storageContext = await bootStorage(storageRoot);
    archives = await WorkbenchInstallationArchives.open(storageContext.storageDomain, target.installationId, directory);
    const nativeApi=await mountNativeWorkbenchInstallationHost(ctx, directory, development, requirements, archives, () => true, '4.0.5');
    api=await mountWorkbenchDevelopmentTimingHost(ctx,directory,development,requirements,nativeApi);
  }
  await mount();
  return {
    directory, source, packageName, version, artifact, developmentId, target, flags,
    get api() { return api; }, get archives() { return archives; },
    request: fields => routes.get('/api/workdsh-workbench-native-installation').fetch(new Request('http://localhost/api/workdsh-workbench-native-installation',
      { method: 'POST', body: JSON.stringify(fields) })),
    timingRequest:fields=>routes.get('/api/workdsh-workbench-timing').fetch(new Request('http://localhost/api/workdsh-workbench-timing',{method:'POST',body:JSON.stringify(fields)})),
    fields: () => ({ developmentId, expectedRevision: 'development-1', version, sha256: artifact.receipt.sha256 }),
    reset() { flags.active = true; flags.owner = true; flags.bound = true; flags.revision = 'development-1'; flags.requirement = 'requirements-1';
      flags.listReads = 0; flags.inspections = 0; flags.onList = undefined; flags.onInspect = undefined; },
    async reopen() { for (const dispose of disposers.splice(0).reverse()) await dispose?.();
      await archives.close(); await storageContext.fiber.dispose(); await mount(); },
    async close() { for (const dispose of disposers.splice(0).reverse()) await dispose?.();
      await archives.close(); await storageContext.fiber.dispose(); await rm(home, { recursive: true, force: true }); },
  };
}

test('native installation reconciles actual bytes under bound development ownership', async t => {
  const f = await fixture();
  const beforeProfile = await readFile(join(f.directory, 'package.json'), 'utf8');
  try {
    await t.test('native context reads candidates; verification retains exact bytes without installing or enabling', async () => {
      const context = await f.api.readContext('native-session-1');
      assert.equal(context.development.id, f.developmentId);
      assert.equal(context.requirements.id, 'requirements-1');
      assert.deepEqual(context.candidates[0].candidate.package, f.artifact.receipt);
      const result = await f.api.verifyNativeInstallation('native-session-1', { version: f.version, sha256: f.artifact.receipt.sha256 });
      assert.deepEqual(result.package, f.artifact.receipt);
      assert.equal(result.installedVerified, true);
      assert.equal(result.activationVerified, false);
      assert.equal(result.activation.status,'not-checked');assert.equal(result.activation.reason,'verification-only');
      assert.match(result.activation.explanation,/不表示.*启用失败/);
      assert.deepEqual(result.nextStep.ifActivationAuthorized.inspect,{tool:'plugin_manager',arguments:{action:'list_bundles',offset:0,limit:100}});
      assert.deepEqual(result.nextStep.ifActivationAuthorized.enable,{tool:'plugin_manager',arguments:{action:'set_bundle',target:f.packageName,enabled:true}});
      assert.equal(result.nextStep.ifActivationAuthorized.matchPackageName,f.packageName);
      assert.match(result.nextStep.ifActivationNotAuthorized,/用户在工作台列表/);
      assert.equal(result.clientPage.status,'not-checked');assert.equal(result.clientPage.requiredSurface,'authenticated-host-application');
      assert.match(result.nextStep.pageAcceptance,/Desktop.*WebView.*Web.*当前已登录/);
      assert.match(result.nextStep.authenticationBoundary,/401/);assert.match(result.nextStep.authenticationBoundary,/不得探查、复制/);
      assert.deepEqual(result,JSON.parse(JSON.stringify(result)),'extended receipt remains lossless official Tool JSON');
      assert.equal(f.flags.sideEffects, 0);
      assert.equal(await readFile(join(f.directory, 'package.json'), 'utf8'), beforeProfile);
    });
    await t.test('a different hash or modified installed entry cannot produce a verified result', async () => {
      f.reset();
      await assert.rejects(f.api.verifyNativeInstallation('native-session-1', { version: f.version, sha256: '0'.repeat(64) }), /candidate-missing/);
      const entry = join(f.directory, 'node_modules', f.packageName, 'index.js');
      const original = await readFile(entry);
      await writeFile(entry, 'modified installed bytes');
      try { await assert.rejects(f.api.verifyNativeInstallation('native-session-1', { version: f.version, sha256: f.artifact.receipt.sha256 }), /installed-file-mismatch/); }
      finally { await writeFile(entry, original); }
    });
    await t.test('foreign development and missing Session binding are rejected before native inspection', async () => {
      f.reset();
      const foreign = await f.request({ ...f.fields(), developmentId: 'foreign-development' });
      assert.equal(foreign.status, 403);
      f.flags.bound = false;
      await assert.rejects(f.api.readContext('native-session-1'), /development-owner-mismatch/);
      assert.equal(f.flags.inspections, 0);
      f.reset(); f.flags.owner = false;
      await assert.rejects(f.api.readContext('native-session-1'), /development-access-denied/);
      assert.equal(f.flags.inspections, 0);
    });
    await t.test('saved requirements and development revision are rechecked across asynchronous candidate reads', async () => {
      f.reset(); f.flags.requirement = 'requirements-2';
      await assert.rejects(f.api.verifyNativeInstallation('native-session-1', { version: f.version, sha256: f.artifact.receipt.sha256 }), /requirements-revision-conflict/);
      f.reset(); f.flags.onList = reads => { if (reads >= 3) f.flags.revision = 'development-2'; };
      await assert.rejects(f.api.verifyNativeInstallation('native-session-1', { version: f.version, sha256: f.artifact.receipt.sha256 }), /development-revision-conflict/);
    });
    await t.test('membership revoked during native metadata inspection prevents late verification', async () => {
      f.reset(); f.flags.onInspect = () => { f.flags.active = false; };
      await assert.rejects(f.api.verifyNativeInstallation('native-session-1', { version: f.version, sha256: f.artifact.receipt.sha256 }), /development-access-denied/);
    });
    await t.test('revision or requirements changing in the final native inspection cannot escape the last guard', async () => {
      for (const [field, value, error] of [['revision', 'development-2', /development-revision-conflict/],
        ['requirement', 'requirements-2', /requirements-revision-conflict/]]) {
        f.reset(); f.flags.onInspect = count => { if (count === 5) f.flags[field] = value; };
        await assert.rejects(f.api.verifyNativeInstallation('native-session-1', { version: f.version, sha256: f.artifact.receipt.sha256 }), error);
        assert.equal(f.flags.inspections, 5, 'the mutation occurs at the last native metadata await');
      }
    });
    await t.test('RPC accepts exactly four facts and refuses paths or caller identities', async () => {
      f.reset();
      for (const fields of [{ ...f.fields(), path: '/private/untrusted.tgz' }, { ...f.fields(), actor: {} },
        { developmentId: f.developmentId, version: f.version, sha256: f.artifact.receipt.sha256 }, null, []]) {
        const response = await f.request(fields);
        assert.equal(response.status, 400);
        assert.equal((await response.json()).error.code, 'workbench/invalid-request');
      }
      assert.equal(f.flags.listReads, 0);
      const stale = await f.request({ ...f.fields(), expectedRevision: 'old-development' });
      assert.equal(stale.status, 409);
      assert.equal((await stale.json()).error.code, 'workbench/development-revision-conflict');
      const accepted = await f.request(f.fields());
      assert.equal(accepted.status, 200);
      assert.equal((await accepted.json()).value.activationVerified, false);
    });
    await t.test('rejected exact candidate reports the inspection cause instead of missing candidate', async () => {
      f.reset(); const bytes=Buffer.from('invalid archive for regression');
      const hash=createHash('sha256').update(bytes).digest('hex');
      await writeFile(join(f.source,'invalid.tgz'),bytes);
      try { await assert.rejects(f.api.verifyNativeInstallation('native-session-1',{version:f.version,sha256:hash}),/workbench\/invalid-package-archive/); }
      finally { await rm(join(f.source,'invalid.tgz')); }
      assert.equal(f.flags.sideEffects,0);
    });
    await t.test('missing installation is an explicit recovery result and never installs',async()=>{
      f.reset();const path=join(f.directory,'node_modules',f.packageName);
      await rename(path,path+'.held');
      try {const response=await f.request(f.fields());assert.equal(response.status,409);assert.equal((await response.json()).error.code,'workbench/native-installation-not-present');assert.equal(f.flags.sideEffects,0);}
      finally {await rename(path+'.held',path);}
    });
    await t.test('retained installation archive survives official StorageDomain close and cold reopen', async () => {
      f.reset();
      const retained = f.archives.resolve(f.packageName, f.version);
      await f.reopen();
      assert.deepEqual(f.archives.resolve(f.packageName, f.version), retained);
      assert.equal((await f.api.verifyNativeInstallation('native-session-1', { version: f.version, sha256: f.artifact.receipt.sha256 })).installedVerified, true);
      assert.equal(f.flags.sideEffects, 0);
      assert.equal(await readFile(join(f.directory, 'package.json'), 'utf8'), beforeProfile);
    });
  } finally { await f.close(); }
});


test('mounted Host timing route records bound tools, rejects foreign records and survives reopening',async()=>{
 const f=await fixture();try{
  const scope=await f.api.resolveTimingScope('native-session-1'),end=await f.api.timing.begin(scope,'coding');await end(false);
  const response=await f.timingRequest({developmentId:f.developmentId});assert.equal(response.status,200);const report=(await response.json()).value;assert.equal(report.measurement,'tool-dispatch-only');assert.equal(report.events[0].status,'passed');
  assert.equal((await f.timingRequest({developmentId:'foreign'})).status,409);
  await f.api.timing.begin(scope,'installation');await f.reopen();const reopened=await (await f.timingRequest({developmentId:f.developmentId})).json();assert.equal(reopened.value.events.at(-1).status,'interrupted');
  f.flags.active=false;assert.equal((await f.timingRequest({developmentId:f.developmentId})).status,409);
 }finally{await f.close();}
});
