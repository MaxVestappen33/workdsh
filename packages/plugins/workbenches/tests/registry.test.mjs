import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(new URL('../../../../apps/web/package.json', import.meta.url));
const { build } = require('esbuild');
const built = await build({ entryPoints: [fileURLToPath(new URL('../src/runtime/registry.ts', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false, alias: { 'workdsh-contracts': fileURLToPath(new URL('../../../contracts/src/workbenches.ts', import.meta.url)) } });
const { WorkbenchRegistry } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const descriptor = { id: 'techflag.quality-analysis', title: '质量分析', description: '', protocolVersion: '1.0', layout: 'full-page', hostCompatibility: { sdk: '^1.0.0', harness: '0.2.1-rc.1' }, capabilities: ['library.read', 'ai.draft'] };
const receipt = { packageName: 'quality-workbench', version: '1.0.0', sha256: 'a'.repeat(64) };

test('registration requires verified caller and exact installed declaration', () => {
  const caller = {};
  const registry = new WorkbenchRegistry(value => value === caller ? { descriptor, package: receipt, enabled: true, compatible: true } : undefined);
  assert.throws(() => registry.register({}, descriptor, 'page'), /unverified-caller/);
  assert.throws(() => registry.register(caller, { ...descriptor, capabilities: ['enterprise.quality.read'] }, 'page'), /declaration-mismatch/);
  registry.register(caller, { ...descriptor, capabilities: [...descriptor.capabilities].reverse() }, 'page');
  assert.equal(registry.list().length, 1);
  assert.throws(() => registry.register(caller, descriptor, 'other-page'), /registration-conflict/);
});
test('stale disposer cannot remove the next plugin activation', () => {
  const registry = new WorkbenchRegistry(() => ({ descriptor, package: receipt, enabled: true, compatible: true }));
  const disposeFirst = registry.register({}, descriptor, 'first');
  disposeFirst();
  const disposeSecond = registry.register({}, descriptor, 'second');
  disposeFirst();
  assert.equal(registry.list()[0].page, 'second');
  disposeSecond();
  assert.deepEqual(registry.list(), []);
});
test('disabled and incompatible packages cannot contribute live pages', () => {
  for (const [enabled, compatible, code] of [[false, true, 'package-disabled'], [true, false, 'incompatible-host']]) {
    const registry = new WorkbenchRegistry(() => ({ descriptor, package: receipt, enabled, compatible }));
    assert.throws(() => registry.register({}, descriptor, 'page'), new RegExp(code));
    assert.deepEqual(registry.list(), []);
  }
});
