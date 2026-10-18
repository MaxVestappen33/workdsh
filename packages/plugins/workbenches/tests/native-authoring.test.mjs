import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
const web = createRequire(new URL('../../../../apps/web/package.json', import.meta.url));
const slotRequire = createRequire(new URL('../../workbench/package.json', import.meta.url));
const react = createRequire(new URL('../../../ui/package.json', import.meta.url));
const { SlotCore } = await import(pathToFileURL(slotRequire.resolve('@deepseek-ai/dsh-client-ui-slots')).href);
const { build } = web('esbuild');
const built = await build({ entryPoints: [fileURLToPath(new URL('../src/client/native-authoring.tsx', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false, alias: { react: fileURLToPath(new URL('.', pathToFileURL(react.resolve('react')))), 'workdsh-contracts': fileURLToPath(new URL('../../../contracts/src/index.ts', import.meta.url)) } });
const { mountNativeWorkbenchAuthoring: mount, WORKBENCH_AUTHORING_PANEL: key } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
test('authoring native Slots withdraw together and active navigation returns to Conversation', () => {
 const core = new SlotCore(); core.register({ name: 'root', children: { main: { kind: 'keyed', scope: 'root' }, 'sidebar.panellist': { kind: 'list', scope: 'root' } } }, () => null);
 let activePanelId = key;
 // Hole availability is fixed in this fixture; registration uses actual SlotCore.
 const ctx = { slots: { inject: (_name, cb) => cb(), register: (...args) => core.register(...args), entriesOfSlot: name => core.entriesOfSlot(name) }, layout: { panelInfo: { getSnapshot: () => ({ activePanelId }) }, selectPanel: id => { activePanelId = id; } } };
 const stop = mount(ctx, 'org/user', () => null);
 assert.equal(core.entriesOfSlot('main').filter(entry => entry.options.key === key).length, 1);
 assert.equal(core.entriesOfSlot('sidebar.panellist').filter(entry => entry.options.id === key).length, 0);
 stop(); stop(); assert.equal(activePanelId, null); assert.equal(core.entriesOfSlot('main').length, 0); assert.equal(core.entriesOfSlot('sidebar.panellist').length, 0);
 assert.throws(() => mount(ctx, ' '), /identity-scope-unavailable/);
});
