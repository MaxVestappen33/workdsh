import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
const require = createRequire(new URL('../package.json', import.meta.url));
test('built browser module loads through native envelope and withdraws authoring Slots', async () => {
 const code = await readFile(new URL('../dist/client.browser.js', import.meta.url), 'utf8');
 let loaded;
 const events=new EventTarget(),listeners=new Set();
 runInNewContext(code, { AbortController,AbortSignal, fetch: async(path) => {assert.equal(path,'/api/workdsh-workbench-shortcuts');return {ok:true,json:async()=>({ok:true,value:{organizationId:'fixture-org',principalId:'fixture-user',ids:[]}})};}, window: {
  addEventListener:(type,listener)=>{listeners.add(listener);events.addEventListener(type,listener);},removeEventListener:(type,listener)=>{listeners.delete(listener);events.removeEventListener(type,listener);},
  __ModuleLoader__: { load(module) { assert.equal(module.id, 'workdsh-plugin-workbenches'); loaded = module.factory(id=>id==='@deepseek-ai/dsh-client-ui-primitives'?{Menu:()=>null}:require(id)); } } } });
 assert.equal(loaded.name, 'workdsh-workbenches-client');
 const rows = [], stops = []; let panel = 'workdsh-workbench-authoring';
 const ctx = { get: () => ({ locate() {}, resolve() {} }), effect: body => { const stop=body(); stops.push(stop); return stop; }, provide: (name,service) => { assert.equal(name,'workdshWorkbenchClientRegistration'); assert.equal(typeof service.registerManaged,'function'); }, slots: { inject: (_name, cb) => { const stop = cb(); stops.push(stop); return stop; }, register: (options, component) => {
  const row = { options, component }; rows.push(row); return () => { const i = rows.indexOf(row); if (i >= 0) rows.splice(i, 1); };
 }, entriesOfSlot: name => rows.filter(row => row.options.name === name) }, layout: { panelInfo: { getSnapshot: () => ({ activePanelId: panel }), subscribe: () => () => {} }, selectPanel: id => { panel = id; } }, uiWorkspace: { openSession() {} } };
 loaded.apply(ctx); assert.equal(rows.length, 4);
 assert.equal(rows.some(row => row.options.name.startsWith("workdsh.workbench.conversation:")),false);
 assert.equal(typeof loaded.NativeWorkbenchConversation, 'function');
 assert.equal(typeof loaded.handoffNativeWorkbenchDraft, 'function');
 assert.deepEqual(rows.filter(row => row.options.name === 'sidebar.panellist').map(row => row.options.label), ['工作台']);
 assert.equal(rows.filter(row => row.options.name === 'main').length, 2);
 assert.equal(rows.filter(row=>row.options.name==='sidebar.footer.action').length,0);
 assert.equal(rows.filter(row=>row.options.name==='shell.overlay').length,0);
 assert.equal(rows.some(row => row.options.children?.['conversation.header']), false, 'the SDK-owned main header is not redeclared');
 for(const stop of [...stops].reverse())stop?.(); assert.equal(rows.length, 0); assert.equal(panel, null);assert.equal(listeners.size,0);
});
