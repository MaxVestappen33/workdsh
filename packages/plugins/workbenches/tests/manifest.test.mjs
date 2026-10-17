import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(new URL('../../../../apps/web/package.json', import.meta.url));
const { build } = require('esbuild');
const built = await build({ entryPoints: [fileURLToPath(new URL('../src/runtime/manifest.ts', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false, alias: { 'workdsh-contracts': fileURLToPath(new URL('../../../contracts/src/workbenches.ts', import.meta.url)) } });
const { parseInstalledWorkbenchManifest } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const descriptor = { id: 'techflag.quality-analysis', title: '质量分析', description: '', protocolVersion: '1.0', layout: 'full-page', hostCompatibility: { sdk: '^1.0.0', harness: '0.2.1-rc.1' }, capabilities: [] };
test('discover static workbench metadata independently of package code and enablement', () => {
  const manifest = { name: 'quality-workbench', version: '1.0.0', workdsh: { workbench: descriptor } };
  const result = parseInstalledWorkbenchManifest(manifest, 'quality-workbench');
  assert.equal(result.descriptor.id, descriptor.id);
  assert.equal(result.packageName, manifest.name);
  assert.equal(result.version, manifest.version);
  assert.equal(parseInstalledWorkbenchManifest({ name: 'ordinary-plugin', version: '1.0.0' }, 'ordinary-plugin'), undefined);
});
test('reject installed identity mismatch, malformed declaration and multiple workbenches', () => {
  assert.throws(() => parseInstalledWorkbenchManifest({ name: 'other-package' }, 'quality-workbench'), /package-name-mismatch/);
  assert.throws(() => parseInstalledWorkbenchManifest({ name: 'quality-workbench', version: '1.0.0', workdsh: { workbench: [descriptor, descriptor] } }, 'quality-workbench'), /one-workbench-per-package/);
  assert.throws(() => parseInstalledWorkbenchManifest({ name: 'quality-workbench', workdsh: { workbench: descriptor } }, 'quality-workbench'), /invalid-manifest/);
});
