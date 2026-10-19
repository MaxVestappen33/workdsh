import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(new URL('../../../../apps/web/package.json', import.meta.url));
const { build } = require('esbuild');
const built = await build({ entryPoints: [fileURLToPath(new URL('../src/runtime/installed-manifest-reader.ts', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false, alias: { 'workdsh-contracts': fileURLToPath(new URL('../../../contracts/src/workbenches.ts', import.meta.url)) } });
const { InstalledWorkbenchManifestReader } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const descriptor = { id: 'techflag.quality-analysis', title: '质量分析', description: '', protocolVersion: '1.0', layout: 'full-page', hostCompatibility: { sdk: '^1.0.0', harness: '0.2.1-rc.1' }, capabilities: [] };

test('read real installed package metadata without importing its executable entry', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workdsh-workbench-inventory-'));
  try {
    const directory = join(root, 'node_modules', '@company', 'quality');
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'index.js'), 'throw new Error("PACKAGE_CODE_MUST_NOT_RUN");');
    await writeFile(join(directory, 'package.json'), JSON.stringify({ name: '@company/quality', version: '1.0.0', main: 'index.js', workdsh: { workbench: descriptor } }));
    const reader = new InstalledWorkbenchManifestReader(root);
    assert.equal((await reader.read('@company/quality')).descriptor.id, descriptor.id);
    await assert.rejects(reader.read('../quality'), /invalid-package-name/);
    await writeFile(join(directory, 'package.json'), JSON.stringify({ name: 'spoofed' }));
    await assert.rejects(reader.read('@company/quality'), /package-name-mismatch/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('reject external package symlinks and oversized metadata; honour cancellation', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'workdsh-workbench-paths-'));
  const root = join(fixture, 'installation');
  try {
    const outside = join(fixture, 'outside');
    await mkdir(join(root, 'node_modules'), { recursive: true });
    await mkdir(outside);
    await writeFile(join(outside, 'package.json'), '{}');
    await symlink(outside, join(root, 'node_modules', 'outside'));
    const reader = new InstalledWorkbenchManifestReader(root);
    await assert.rejects(reader.read('outside'), /package-path-outside-installation/);
    const directory = join(root, 'node_modules', 'large');
    await mkdir(directory);
    await writeFile(join(directory, 'package.json'), ' '.repeat(256 * 1024 + 1));
    await assert.rejects(reader.read('large'), /manifest-size-limit/);
    const abort = new AbortController(); abort.abort();
    await assert.rejects(reader.read('large', abort.signal), { name: 'AbortError' });
  } finally { await rm(fixture, { recursive: true, force: true }); }
});
