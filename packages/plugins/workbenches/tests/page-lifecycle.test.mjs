import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
const require = createRequire(new URL('../../../../apps/web/package.json', import.meta.url));
const slotRequire = createRequire(new URL('../../workbench/package.json', import.meta.url));
const { SlotCore } = await import(pathToFileURL(slotRequire.resolve('@deepseek-ai/dsh-client-ui-slots')).href);
const { build } = require('esbuild');
const built = await build({ entryPoints: [fileURLToPath(new URL('../src/client/page-lifecycle.ts', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false, alias: { 'workdsh-contracts': fileURLToPath(new URL('../../../contracts/src/workbenches.ts', import.meta.url)) } });
const { WorkbenchPageLifecycle } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const descriptor = { id: 'company.quality', title: '质量分析', description: '', protocolVersion: '1.0', layout: 'full-page', hostCompatibility: { sdk: '^1.0.0', harness: '0.2.0-rc.2' }, capabilities: [] };
function fixture() {
  const slots = new SlotCore();
  slots.register({ name: 'root', children: { main: { kind: 'keyed', scope: 'root' }, 'sidebar.panellist': { kind: 'list', scope: 'root' } } }, () => null);
  let selected;
  const mounts = [];
  const ports = {
    mountPage(mount, page) { mounts.push(mount); return slots.register({ name: 'main', key: mount.panelKey }, page); },
    selectedPanel() { return selected; },
    openManager() { selected = 'workdsh-workbench-manager'; },
  };
  return { slots, ports, mounts, select(value) { selected = value; }, selected: () => selected };
}
test('two workbenches contribute independent native Slots and withdrawal leaves the other active', () => {
  const f = fixture(), lifecycle = new WorkbenchPageLifecycle(f.ports);
  const stop = lifecycle.mount(descriptor, () => null);
  lifecycle.mount({ ...descriptor, id: 'company.finance', title: '财务分析' }, () => null);
  assert.equal(f.slots.entriesOfSlot('main').length, 2);
  assert.equal(f.slots.entriesOfSlot('sidebar.panellist').length, 0);
  f.select(f.mounts[0].panelKey);
  stop();
  assert.equal(f.selected(), 'workdsh-workbench-manager');
  assert.equal(f.mounts[0].signal.aborted, true);
  assert.equal(f.mounts[1].signal.aborted, false);
  assert.equal(f.slots.entriesOfSlot('main').length, 1);
  const stopNew = lifecycle.mount(descriptor, () => null);
  stop();
  assert.equal(f.slots.entriesOfSlot('main').length, 2);
  stopNew();
  lifecycle.close();
  assert.equal(f.slots.entriesOfSlot('main').length, 0);
  assert.equal(f.slots.entriesOfSlot('sidebar.panellist').length, 0);
  assert.throws(() => lifecycle.mount(descriptor, () => null), /page-service-closed/);
});
test('page conflict preserves the existing page and cancels its lifetime', () => {
  const f = fixture(), key = `workdsh-workbench:${descriptor.id}`;
  f.slots.register({ name: 'main', key }, () => null);
  const lifecycle = new WorkbenchPageLifecycle(f.ports);
  assert.throws(() => lifecycle.mount(descriptor, () => null));
  assert.equal(f.slots.entriesOfSlot('main').length, 1);
  assert.equal(f.slots.entriesOfSlot('sidebar.panellist').length, 0);
  assert.equal(f.mounts[0].signal.aborted, true);
});
test('navigation failure during withdrawal cannot retain pages or prevent other cleanup', () => {
  const f = fixture();
  const lifecycle = new WorkbenchPageLifecycle({ ...f.ports, openManager() { throw new Error('layout-unavailable'); } });
  lifecycle.mount(descriptor, () => null);
  lifecycle.mount({ ...descriptor, id: 'company.finance' }, () => null);
  f.select(f.mounts[0].panelKey);
  assert.throws(() => lifecycle.close(), /page-cleanup-failed/);
  assert.equal(f.slots.entriesOfSlot('main').length, 0);
  assert.equal(f.slots.entriesOfSlot('sidebar.panellist').length, 0);
  assert.ok(f.mounts.every(mount => mount.signal.aborted));
  lifecycle.close();
});
test('reentrant shutdown during Slot creation immediately withdraws the just-created entry', () => {
  const f = fixture();
  let lifecycle;
  lifecycle = new WorkbenchPageLifecycle({ ...f.ports, mountPage(mount, page) {
    const dispose = f.ports.mountPage(mount, page);
    lifecycle.close();
    return dispose;
  } });
  assert.throws(() => lifecycle.mount(descriptor, () => null), /page-service-closed/);
  assert.equal(f.slots.entriesOfSlot('main').length, 0);
  assert.equal(f.slots.entriesOfSlot('sidebar.panellist').length, 0);
});
