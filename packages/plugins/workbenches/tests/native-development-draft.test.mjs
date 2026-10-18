import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const { build } = createRequire(new URL('../../../../apps/web/package.json', import.meta.url))('esbuild');
const built = await build({ entryPoints: [fileURLToPath(new URL('../src/client/native-development-draft.ts', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false });
const { handoffNativeWorkbenchDraft: handoff } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
// Explicit lifecycle fixture, not a browser renderer or an executing Agent.
function fixture({ draft = '', ready = Promise.resolve(), onOpen = () => {}, preset = 'cordis' } = {}) {
  const calls = [];
  const binding = {};
  let revision = 1;
  const ctx = {
    sessions: { retain(id, options) { calls.push(['retain', id, options.source]); return { ready, binding: { ctx: binding, session: { projections: { faceOf(key) { assert.equal(key, 'agentPreset'); return { getSnapshot: () => preset }; } } } }, release() { calls.push(['release']); } }; } },
    conversation: { input: { for(context) {
      assert.equal(context, binding);
      return { state: { getSnapshot: () => ({ draft, draftRev: revision }) }, setDraft(value) { draft = value; revision++; calls.push(['draft', value]); } };
    } } },
    uiWorkspace: { openSession(id) { calls.push(['open', id]); onOpen(); } },
    layout: { selectPanel(value) { calls.push(['panel', value]); } },
  };
  return { ctx, calls, draft: () => draft };
}
test('native handoff retains correct generation, opens conversation and releases after draft insertion', async () => {
  const f = fixture(); await handoff(f.ctx, 'session-1', '创建质量工作台');
  assert.deepEqual(f.calls, [['retain', 'session-1', 'workdshWorkbenchDraft'], ['draft', '创建质量工作台'], ['open', 'session-1'], ['panel', null], ['release']]);
});

test('existing non-Creator conversation stays on the original page with no draft change', async () => {
  for (const preset of ['standard', null]) {
    const f = fixture({ preset, draft: '保留我的输入' });
    await assert.rejects(handoff(f.ctx, 'session-1', '开发需求'), /development-creator-required/);
    assert.equal(f.draft(), '保留我的输入');
    assert.deepEqual(f.calls, [['retain', 'session-1', 'workdshWorkbenchDraft'], ['release']]);
  }
});
test('ready rejection, occupied draft and cancellation release without changing input', async () => {
  const failed = fixture({ ready: Promise.reject(new Error('open-failed')) });
  await assert.rejects(handoff(failed.ctx, 'session-1', '需求'), /open-failed/);
  assert.deepEqual(failed.calls.at(-1), ['release']);
  const occupied = fixture({ draft: '用户输入' });
  await assert.rejects(handoff(occupied.ctx, 'session-1', '需求'), /draft-not-empty/);
  assert.equal(occupied.draft(), '用户输入');
  assert.deepEqual(occupied.calls, [['retain', 'session-1', 'workdshWorkbenchDraft'], ['release']]);
  const controller = new AbortController();
  const cancelled = fixture({ ready: Promise.resolve().then(() => controller.abort()) });
  await assert.rejects(handoff(cancelled.ctx, 'session-1', '需求', controller.signal), { name: 'AbortError' });
  assert.equal(cancelled.draft(), '');
  assert.deepEqual(cancelled.calls.at(-1), ['release']);
});
test('navigation-triggered editor cancellation preserves the written native draft', async () => {
  const controller = new AbortController();
  const f = fixture({ onOpen: () => controller.abort() });
  await handoff(f.ctx, 'session-1', '需求', controller.signal);
  assert.equal(controller.signal.aborted, true);
  assert.equal(f.draft(), '需求');
  assert.deepEqual(f.calls, [['retain', 'session-1', 'workdshWorkbenchDraft'], ['draft', '需求'], ['open', 'session-1'], ['panel', null], ['release']]);
});
test('retry with the same native draft navigates without writing again', async () => {
  const f = fixture({ draft: '需求' });
  await handoff(f.ctx, 'session-1', '需求');
  assert.deepEqual(f.calls, [['retain', 'session-1', 'workdshWorkbenchDraft'], ['open', 'session-1'], ['panel', null], ['release']]);
});
