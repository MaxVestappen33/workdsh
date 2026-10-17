import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
const require = createRequire(new URL('../../../../apps/web/package.json', import.meta.url));
const slotRequire = createRequire(new URL('../../workbench/package.json', import.meta.url));
const { SlotCore } = await import(pathToFileURL(slotRequire.resolve('@deepseek-ai/dsh-client-ui-slots')).href);
const reactRequire = createRequire(new URL('../../../ui/package.json', import.meta.url));
const { build } = require('esbuild');
const built = await build({ entryPoints: [fileURLToPath(new URL('../src/client/native-page.tsx', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false, alias: { react: fileURLToPath(new URL('.', pathToFileURL(reactRequire.resolve('react')))), 'workdsh-contracts': fileURLToPath(new URL('../../../contracts/src/workbenches.ts', import.meta.url)) } });
const { createNativeWorkbenchPagePorts, WORKBENCH_MANAGER_PANEL } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const descriptor = { id: 'company.quality', title: '质量分析', description: '', protocolVersion: '1.0', layout: 'full-page', hostCompatibility: { sdk: '^1.0.0', harness: '0.2.0-rc.2' }, capabilities: [] };
function fixture() {
  const slots = new SlotCore();
  slots.inject = (_name, register) => register();
  slots.register({ name: 'root', children: { main: { kind: 'keyed', scope: 'root' }, 'sidebar.panellist': { kind: 'list', scope: 'root' }, 'workdsh.workbench.frame': {kind:'single',scope:'root'} } }, () => null);
  let activePanelId = null; const listeners = new Set();
  // Explicit navigation fixture. The actual layout service is browser-loaded;
  // this test verifies the owned adapter against real SlotCore, not a live renderer.
  const layout = { panelInfo: { getSnapshot: () => ({ activePanelId }), subscribe: fn => {listeners.add(fn);return () => listeners.delete(fn);} }, selectPanel(id) {
    if (id !== null && !slots.entriesOfSlot('main').some(entry => entry.options.key === id)) throw new Error('unregistered-panel');
    activePanelId = id; for(const fn of listeners)fn();
  } };
  return { slots, layout, ports: createNativeWorkbenchPagePorts({ slots, layout }) };
}
test('business navigation registers only its own main page and leaves native Conversation and Header intact',()=>{
 const {slots,ports,layout}=fixture();
 const Native=()=>null,Header=()=>null;
 slots.register({name:'main',key:'conversation',children:{'conversation.header':{kind:'single',scope:'root'}}},Native);
 slots.register({name:'conversation.header'},Header);
 const mount={descriptor,panelKey:`workdsh-workbench:${descriptor.id}`,signal:new AbortController().signal};
 const release=ports.mountPage(mount,()=>null);
 assert.equal(slots.entriesOfSlot('workdsh.workbench.frame').length,1);
 const seat=`workdsh.workbench.conversation:${mount.panelKey}`;
 assert.equal(slots.entriesOfSlot(seat).length,0);
 assert.equal(slots.entriesOfSlot('main').find(x=>x.options.key==='conversation').component,Native);
 assert.equal(slots.entriesOfSlot('conversation.header')[0].component,Header);
 assert.equal(slots.entriesOfSlot('sidebar.panellist').length,0);
 assert.equal(slots.entriesOfSlot('main').length,2);
 layout.selectPanel(mount.panelKey);assert.equal(layout.panelInfo.getSnapshot().activePanelId,null);assert.equal(ports.selectedPanel(),mount.panelKey);
 release();assert.equal(slots.entriesOfSlot(seat).length,0);assert.equal(slots.entriesOfSlot('main').length,1);
 assert.equal(slots.entriesOfSlot('main')[0].component,Native);
});
test('closing navigates to a live manager, with native Conversation fallback during manager removal', () => {
  const { slots, layout, ports } = fixture();
  const stopManager = slots.register({ name: 'main', key: WORKBENCH_MANAGER_PANEL }, () => null);
  ports.openManager();
  assert.equal(ports.selectedPanel(), WORKBENCH_MANAGER_PANEL);
  stopManager();
  ports.openManager();
  assert.equal(ports.selectedPanel(), undefined);
  assert.equal(layout.panelInfo.getSnapshot().activePanelId, null);
});
