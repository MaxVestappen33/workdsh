import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const require = createRequire(new URL('../../../../apps/web/package.json', import.meta.url));
const { build } = require('esbuild');
const built = await build({ entryPoints: [fileURLToPath(new URL('../src/runtime/loader-source.ts', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false });
const { resolveWorkbenchLoaderSource } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const hostBuilt = await build({ entryPoints: [fileURLToPath(new URL('../src/runtime/host-registration.ts', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false, alias: { 'workdsh-contracts': fileURLToPath(new URL('../../../contracts/src/workbenches.ts', import.meta.url)) } });
const { HostWorkbenchRegistration } = await import(`data:text/javascript;base64,${Buffer.from(hostBuilt.outputFiles[0].text).toString('base64')}`);
const { Context } = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')).href);
const harnessRequire = createRequire(require.resolve('@deepseek-ai/dsh/package.json'));
const { default: Loader } = await import(pathToFileURL(harnessRequire.resolve('@deepseek-ai/cordis-plugin-loader')).href);

test('official Loader locates actual package caller and rejects disposed contexts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workdsh-workbench-loader-'));
  const ctx = new Context();
  try {
    const directory = join(root, 'node_modules', 'quality-probe');
    await mkdir(directory, { recursive: true });
    await writeFile(join(root, 'package.json'), '{"type":"module"}');
    await writeFile(join(directory, 'package.json'), '{"name":"quality-probe","type":"module","exports":{".":"./index.js"}}');
    await writeFile(join(directory, 'index.js'), 'export function apply(ctx) { ctx.workbenchProbe.capture(ctx); }');
    let caller;
    ctx.provide('workbenchProbe', { capture(value) { caller = value; } });
    await ctx.plugin(Loader, { baseUrl: pathToFileURL(root + '/').href });
    const entryId = await ctx.loader.create({ name: 'quality-probe' });
    assert.ok(caller, 'fixture package actually activated');
    assert.deepEqual(resolveWorkbenchLoaderSource(ctx.loader, caller), { entryId, moduleName: 'quality-probe', packageName: 'quality-probe' });
    assert.throws(() => resolveWorkbenchLoaderSource(ctx.loader, ctx), /unverified-caller/);
    const descriptor = { id: 'probe.quality', title: 'Probe', description: '', protocolVersion: '1.0', layout: 'full-page', hostCompatibility: { sdk: '^1.0.0', harness: '0.2.0-rc.2' }, capabilities: [] };
    // Explicit receipt fixture tests lifecycle only, not package installation verification.
    const registry = new HostWorkbenchRegistration(ctx.loader, { async read() { return { packageName: 'quality-probe', version: '1.0.0', descriptor }; } }, async () => ({ package: { packageName: 'quality-probe', version: '1.0.0', sha256: 'a'.repeat(64) }, compatible: true, descriptor }));
    const disposeRegistration = await registry.registerManaged(caller, descriptor, 'quality-page');
    assert.equal(registry.list().length, 1);
    await caller.fiber.dispose();
    assert.deepEqual(registry.list(), [], 'official plugin disposal removes the live workbench');
    await disposeRegistration();
    assert.deepEqual(registry.list(), [], 'manual disposer remains idempotent after lifecycle cleanup');
    assert.throws(() => resolveWorkbenchLoaderSource(ctx.loader, caller), /inactive-caller/);
  } finally { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }); }
});
