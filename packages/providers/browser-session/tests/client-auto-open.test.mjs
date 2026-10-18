import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../package.json', import.meta.url));
const { build } = require('esbuild');
const built = await build({
  entryPoints: [fileURLToPath(new URL('../src/client.tsx', import.meta.url))],
  bundle: true, platform: 'node', format: 'esm', write: false,
});
const { apply } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const settle = () => new Promise(resolve => setImmediate(resolve));

function fixture(status) {
  const originals = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch };
  let timer, current = 'first', disposed = false;
  const opened = [], tabs = [], closed = [], cleanups = [], listeners = new Set();
  globalThis.window = { setInterval(callback) { timer = callback; return 1; }, clearInterval() {} };
  globalThis.document = { createElement: () => ({ remove() {} }), head: { append() {} } };
  globalThis.fetch = async () => { const value = await status(); return value instanceof Response ? value : Response.json(value); };
  apply({
    effect(body) { const stop = body(); if (typeof stop === 'function') cleanups.push(stop); },
    slots: { inject(_slot, body) { body(); }, register() { return () => {}; } },
    sidebarRightTabs: { register() { return () => {}; } },
    sidebarRight: {
      openTabIn(sessionId, kind) { opened.push({ sessionId, kind }); tabs.push({ sessionId, kind, tabId: `tab-${opened.length}` }); },
      closeIn(sessionId, tabId) { closed.push({ sessionId, tabId }); const at = tabs.findIndex(tab => tab.sessionId === sessionId && tab.tabId === tabId); if (at >= 0) tabs.splice(at, 1); },
      openTabs: { getSnapshot: () => tabs },
    },
    sessions: { list: { getSnapshot: () => ({ byId: { [current]: { id: current, retainedBy: { mainView: 1 } } } }), subscribe(callback) { listeners.add(callback); return () => listeners.delete(callback); } } },
  });
  return {
    opened, closed, tabs, tick: () => timer(), select(id) { current = id; for (const listener of listeners) listener(); },
    dispose() {
      if (disposed) return; disposed = true;
      for (const cleanup of cleanups.reverse()) cleanup();
      for (const [key, value] of Object.entries(originals)) {
        if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
      }
    },
  };
}

test('inactive or invalid browser status never opens a pane; real activity opens it once', async () => {
  let status = { active: false, revision: 0 };
  const f = fixture(() => status);
  try {
    await settle(); assert.deepEqual(f.opened, []);
    for (const active of [undefined, null, 1, 'true', false]) {
      status = { active, revision: 1 }; f.tick(); await settle(); assert.deepEqual(f.opened, []);
    }
    for (const revision of [undefined, -1, '1', NaN]) {
      status = { active: true, revision }; f.tick(); await settle(); assert.deepEqual(f.opened, []);
    }
    status = { active: true, revision: 2 }; f.tick(); await settle();
    assert.deepEqual(f.opened, [{ sessionId: 'first', kind: 'workdsh-managed-browser' }]);
    f.tick(); await settle(); assert.equal(f.opened.length, 1);
  } finally { f.dispose(); }
});

test('a delayed browser status cannot steal the new Session sidebar or open after disposal', async () => {
  let resolve;
  const f = fixture(() => new Promise(done => { resolve = done; }));
  try {
    await settle(); f.select('second'); resolve({ active: true, revision: 1 }); await settle();
    assert.deepEqual(f.opened, []);
    f.tick(); await settle(); f.dispose(); resolve({ active: true, revision: 1 }); await settle();
    assert.deepEqual(f.opened, []);
  } finally { f.dispose(); }
});

test('close removes only this Session browser pane and new page activity can reopen it', async () => {
  let status = { active: true, revision: 1 };
  const f = fixture(() => status);
  try {
    await settle(); assert.equal(f.opened.length, 1);
    f.tabs.push({ sessionId: 'first', tabId: 'native', kind: 'conversation' }, { sessionId: 'other', tabId: 'other-browser', kind: 'workdsh-managed-browser' });
    status = { active: false, revision: 2 }; f.tick(); await settle();
    assert.deepEqual(f.closed, [{ sessionId: 'first', tabId: 'tab-1' }]);
    assert.deepEqual(f.tabs.map(tab => tab.tabId), ['native', 'other-browser']);
    f.tick(); await settle(); assert.equal(f.closed.length, 1);
    status = { active: true, revision: 3 }; f.tick(); await settle(); assert.equal(f.opened.length, 2);
    f.tabs.splice(f.tabs.findIndex(tab => tab.tabId === 'tab-2'), 1);
    f.tick(); await settle(); assert.equal(f.opened.length, 2, 'manually closing the pane is respected for the same activity');
    status = { active: true, revision: 4 }; f.tick(); await settle(); assert.equal(f.opened.length, 3, 'new real page activity can open a new view');
  } finally { f.dispose(); }
});

test('an unused manually opened browser guide is not closed before page activity', async () => {
  const f = fixture(() => ({ active: false, revision: 0 }));
  try {
    f.tabs.push({ sessionId: 'first', tabId: 'manual-browser', kind: 'workdsh-managed-browser' });
    await settle(); f.tick(); await settle(); assert.deepEqual(f.closed, []);
  } finally { f.dispose(); }
});

test('old closed activity is consumed once and unavailable status is not a successful close', async () => {
  let status = { active: false, revision: 2 };
  const f = fixture(() => status);
  try {
    await settle(); f.tabs.push({ sessionId: 'first', tabId: 'manual', kind: 'workdsh-managed-browser' });
    f.tick(); await settle(); assert.deepEqual(f.closed, [], 'an old close does not remove a later manual guide');
    status = { active: true, revision: 3 }; f.tick(); await settle();
    status = new Response(null, { status: 404 }); f.tick(); await settle();
    assert.deepEqual(f.closed, [], 'unavailable browser status is unknown, not a fabricated close');
  } finally { f.dispose(); }
});

test('a tab closed during status lookup and a Session switched away and back stay closed', async () => {
  let response = { active: true, revision: 1 }, resolve;
  const f = fixture(() => response);
  try {
    await settle(); assert.equal(f.opened.length, 1);
    response = new Promise(done => { resolve = done; }); f.tick(); await settle();
    f.tabs.length = 0; resolve({ active: true, revision: 2 }); await settle();
    assert.equal(f.opened.length, 1, 'a manual close during the request is respected');
    response = new Promise(done => { resolve = done; }); f.tick(); await settle();
    f.select('second'); f.select('first'); resolve({ active: true, revision: 3 }); await settle();
    assert.equal(f.opened.length, 1, 'returning to the same Session does not revive its stale request');
  } finally { f.dispose(); }
});
