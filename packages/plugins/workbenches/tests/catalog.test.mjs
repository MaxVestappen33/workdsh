import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(new URL('../../../../apps/web/package.json', import.meta.url));
const { build } = require('esbuild');
const built = await build({ entryPoints: [fileURLToPath(new URL('../src/runtime/catalog.ts', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false });
const { readWorkbenchCatalog } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);

test('disabled workbenches remain visible and all conflicting ids are marked', async () => {
  const rows = await readWorkbenchCatalog({ async read(packageName) {
    if (packageName === 'ordinary') return undefined;
    if (packageName === 'broken') throw new Error('/private/installation/package.json unreadable');
    return { packageName, version: '1.0.0', descriptor: { id: 'same.workbench' } };
  } }, [
    { packageName: 'enabled', enabled: true }, { packageName: 'disabled', enabled: false },
    { packageName: 'ordinary', enabled: true }, { packageName: 'broken', enabled: false },
  ]);
  assert.equal(rows.length, 3);
  assert.equal(rows[1].enabled, false);
  assert.equal(rows[0].errorCode, 'workbench/duplicate-workbench-id');
  assert.equal(rows[1].errorCode, 'workbench/duplicate-workbench-id');
  assert.equal(rows[2].errorCode, 'workbench/manifest-unavailable');
  assert.equal(JSON.stringify(rows).includes('/private'), false);
});
test('cancelled inventory is not returned as a partial successful catalog', async () => {
  const abort = new AbortController();
  const reader = { async read() { abort.abort(); throw new Error('read interrupted'); } };
  await assert.rejects(readWorkbenchCatalog(reader, [{ packageName: 'first', enabled: true }], abort.signal), { name: 'AbortError' });
  await assert.rejects(readWorkbenchCatalog(reader, Array.from({ length: 1001 }, (_, i) => ({ packageName: `package-${i}`, enabled: true }))), /inventory-limit/);
  await assert.rejects(readWorkbenchCatalog(reader, [{ packageName: 'same', enabled: true }, { packageName: 'same', enabled: false }]), /duplicate-package-selection/);
});
