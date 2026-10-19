import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../../../../apps/web/package.json', import.meta.url));
// Execute the real bridge and Owner; only React scheduling and the public
// Session lease/input ports are fixtures. This is not browser acceptance.
const built = await require('esbuild').build({ entryPoints: [fileURLToPath(new URL('../src/client/native-session-bridge.tsx', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'native-bridge-hooks', setup(builder) {
    builder.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'native-bridge-hooks' }));
    builder.onLoad({ filter: /.*/, namespace: 'native-bridge-hooks' }, () => ({ contents: `
      export const useState=(...args)=>globalThis.__nativeBridgeHooks.useState(...args);
      export const useRef=(...args)=>globalThis.__nativeBridgeHooks.useRef(...args);
      export const useEffect=(...args)=>globalThis.__nativeBridgeHooks.useEffect(...args);
    `, loader: 'js' }));
  } }] });
const { NativeWorkbenchSessionBridge: Bridge } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);

function source() {
  let entries = [], change = { kind: 'replace' };
  const listeners = new Set();
  return {
    getSnapshot: () => ({ entries, change }),
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    append(entry) { entries = [...entries, entry]; change = { kind: 'append', entries: [entry] }; for (const listener of listeners) listener(); },
    listeners: () => listeners.size,
  };
}
function fixture({ blocked = false, readyError, draft = '' } = {}) {
  const calls = [], bindings = new Map(), leases = [];
  function binding(sessionId) {
    if (!bindings.has(sessionId)) bindings.set(sessionId, { sessionId, ctx: { sessionId }, eventSource: source(), state: { draft, attachmentIds: [], occurrences: [], phase: 'plain' } });
    return bindings.get(sessionId);
  }
  const native = {
    sessions: { retain(sessionId, options) {
      calls.push(['retain', sessionId, options.source]);
      const target = binding(sessionId); let resolve;
      const ready = readyError ? Promise.reject(readyError) : blocked ? new Promise(done => { resolve = done; }) : Promise.resolve(target);
      const lease = { sessionId, ready, resolve: () => resolve?.(target), release() { calls.push(['release', sessionId]); } };
      leases.push(lease); return lease;
    } },
    conversation: { input: {
      for(ctx) { return { state: { getSnapshot: () => binding(ctx.sessionId).state } }; },
      requestDraftInitialization(actual, options) { calls.push(['initialize', actual.sessionId, options]); actual.state = { ...actual.state, draft: options.prompt }; return 'applied'; },
    } },
  };
  return { native, calls, leases, binding };
}
function mount(initialProps) {
  const slots = [], effects = []; let props = initialProps, cursor = 0, dirty = true, tree, closed = false;
  const hooks = {
    useState(initial) { const index = cursor++; if (!slots[index]) slots[index] = { value: typeof initial === 'function' ? initial() : initial }; return [slots[index].value, next => { const value = typeof next === 'function' ? next(slots[index].value) : next; if (!Object.is(value, slots[index].value)) { slots[index].value = value; dirty = true; } }]; },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useEffect(run, deps) { const index = cursor++, previous = slots[index]; if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) effects.push(() => { previous?.cleanup?.(); slots[index] = { deps, cleanup: run() }; }); },
  };
  function render() { cursor = 0; dirty = false; const previous = globalThis.__nativeBridgeHooks; globalThis.__nativeBridgeHooks = hooks; try { tree = Bridge(props); } finally { globalThis.__nativeBridgeHooks = previous; } while (effects.length) effects.shift()(); }
  return {
    async settle() { if (closed) { await new Promise(resolve => setImmediate(resolve)); return; } for (let round = 0; round < 25; round++) { if (dirty) render(); await new Promise(resolve => setImmediate(resolve)); if (!dirty && !effects.length) return; } throw Error('bridge-did-not-settle'); },
    setProps(update) { props = { ...props, ...update }; dirty = true; },
    tree: () => tree,
    unmount() { closed = true; for (const slot of slots) slot?.cleanup?.(); },
  };
}
const request = { id: 'request-1', instruction: '分析本次检验数据' };
const result = seq => ({ type: 'event', event: { seq, type: 'tool/result', data: { message: { toolCallId: `call-${seq}` } } } });

test('bridge renders nothing and retains no Session until an authorized id is supplied', async () => {
  const f = fixture(), h = mount({ native: f.native, identityScopeKey: 'user:record' });
  try { await h.settle(); assert.equal(h.tree(), null); assert.deepEqual(f.calls, []); } finally { h.unmount(); }
});
test('bridge prepares only the native draft, retains one owner across rerenders and uses current tool callbacks', async () => {
  const f = fixture(), ready = [], oldEvents = [], newEvents = [];
  f.binding('session-1').eventSource.append(result(1));
  const h = mount({ native: f.native, sessionId: 'session-1', identityScopeKey: 'user:record', draftRequest: request, onDraftReady: id => ready.push(id), onToolSettled: event => oldEvents.push(event) });
  try {
    await h.settle(); assert.equal(h.tree(), null); assert.deepEqual(ready, [request.id]); assert.equal(oldEvents.length, 0);
    assert.deepEqual(f.calls, [['retain', 'session-1', 'workdshWorkbenchConversation'], ['initialize', 'session-1', { prompt: request.instruction, clearPreviousDraft: false }]]);
    h.setProps({ draftRequest: { ...request }, onToolSettled: event => newEvents.push(event) }); await h.settle();
    f.binding('session-1').eventSource.append(result(2));
    assert.equal(oldEvents.length, 0); assert.equal(newEvents.length, 1); assert.equal(newEvents[0].callId, 'call-2'); assert.equal(f.calls.length, 2); assert.deepEqual(ready, [request.id]);
    h.unmount(); assert.equal(newEvents[0].signal.aborted, true); assert.equal(f.binding('session-1').eventSource.listeners(), 0);
    f.binding('session-1').eventSource.append(result(3)); assert.equal(newEvents.length, 1); assert.equal(f.calls.filter(call => call[0] === 'release').length, 1);
  } finally { h.unmount(); }
});
test('switching record identity releases the old tool scope before retaining the same Session again', async () => {
  const f = fixture(), events = [], h = mount({ native: f.native, sessionId: 'session-1', identityScopeKey: 'user:record-a', onToolSettled: event => events.push(event) });
  try {
    await h.settle(); f.binding('session-1').eventSource.append(result(1)); const oldSignal = events[0].signal;
    h.setProps({ identityScopeKey: 'user:record-b' }); await h.settle();
    assert.equal(oldSignal.aborted, true); assert.deepEqual(f.calls.slice(-2), [['release', 'session-1'], ['retain', 'session-1', 'workdshWorkbenchConversation']]);
    f.binding('session-1').eventSource.append(result(2)); assert.equal(events.length, 2); assert.notEqual(events[1].signal, oldSignal); assert.equal(events[1].signal.aborted, false);
    h.setProps({ sessionId: undefined }); await h.settle(); assert.equal(events[1].signal.aborted, true); assert.equal(f.binding('session-1').eventSource.listeners(), 0); assert.equal(h.tree(), null);
  } finally { h.unmount(); }
});
test('late Session readiness cannot hand the previous record draft to the new Session', async () => {
  const f = fixture({ blocked: true }), ready = [], changed = [], h = mount({ native: f.native, sessionId: 'session-1', identityScopeKey: 'user:record-a', draftRequest: request, onDraftReady: id => ready.push(id), onSessionChange: id => changed.push(id) });
  try {
    await h.settle(); h.setProps({ sessionId: 'session-2', identityScopeKey: 'user:record-b', draftRequest: { id: 'request-2', instruction: '加工本次报告' } }); await h.settle();
    f.leases[0].resolve(); await h.settle(); assert.deepEqual(ready, []); assert.deepEqual(changed, []); assert.equal(f.calls.some(call => call[0] === 'initialize'), false);
    f.leases[1].resolve(); await h.settle(); assert.deepEqual(ready, ['request-2']); assert.deepEqual(changed, ['session-2']); assert.equal(f.binding('session-1').state.draft, ''); assert.equal(f.binding('session-2').state.draft, '加工本次报告');
  } finally { h.unmount(); }
});
test('external abort disposes the lease and suppresses deferred draft callbacks', async () => {
  const f = fixture({ blocked: true }), signal = new AbortController(), ready = [], errors = [];
  const h = mount({ native: f.native, sessionId: 'session-1', identityScopeKey: 'user:record', signal: signal.signal, draftRequest: request, onDraftReady: id => ready.push(id), onDraftError: (id, error) => errors.push([id, error]), onError: error => errors.push(error) });
  try {
    await h.settle(); signal.abort(); f.leases[0].resolve(); await h.settle();
    assert.deepEqual(ready, []); assert.deepEqual(errors, []); assert.equal(f.calls.some(call => call[0] === 'initialize'), false); assert.equal(f.calls.filter(call => call[0] === 'release').length, 1);
  } finally { h.unmount(); }
});
test('resolution failure and existing user text are reported without replacing native input or rendering fallback UI', async () => {
  for (const options of [{ readyError: new Error('session-unavailable') }, { draft: '用户正在输入' }]) {
    const f = fixture(options), errors = [], ready = [], h = mount({ native: f.native, sessionId: 'session-1', identityScopeKey: 'user:record', draftRequest: request, onDraftError: (id, error) => errors.push([id, error]), onDraftReady: id => ready.push(id), onError: () => {} });
    try {
      await h.settle(); assert.equal(h.tree(), null); assert.deepEqual(ready, []); assert.equal(errors.length, 1); assert.equal(errors[0][0], request.id); assert.match(errors[0][1].message, /session-unavailable|draft-not-empty/); assert.equal(f.calls.some(call => call[0] === 'initialize'), false); assert.equal(f.binding('session-1').state.draft, options.draft ?? '');
    } finally { h.unmount(); }
  }
});
