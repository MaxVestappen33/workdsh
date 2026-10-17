import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const { build } = createRequire(new URL('../../../../apps/web/package.json', import.meta.url))('esbuild');
const built = await build({ entryPoints: [fileURLToPath(new URL('../src/client/development-draft.ts', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false });
const { handoffWorkbenchDevelopmentDraft: handoff } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
test('handoff targets existing session and retry preserves the same draft and navigates', async () => {
  let text = '', writes = 0, opens = 0;
  const ports = { openSession: async id => { assert.equal(id, 'session-1'); assert.equal(text, '开发需求'); opens++; }, readDraft: () => ({ text, revision: 'draft-1' }),
    writeDraft: (id, value, revision) => { assert.equal(id, 'session-1'); assert.equal(revision, 'draft-1'); text = value; writes++; } };
  await handoff(ports, 'session-1', '开发需求');
  await handoff(ports, 'session-1', '开发需求');
  assert.equal(writes, 1);
  assert.equal(opens, 2);
  text = '用户正在输入';
  await assert.rejects(handoff(ports, 'session-1', '开发需求'), /draft-not-empty/);
  assert.equal(text, '用户正在输入');
  assert.equal(opens, 2);
});
test('cancellation before or during draft read prevents writing and navigation', async () => {
  const controller = new AbortController();
  const ports = { openSession: async () => assert.fail('late navigation'), readDraft: () => { controller.abort(); return { text: '', revision: 'draft-1' }; }, writeDraft: () => assert.fail('late write') };
  await assert.rejects(handoff(ports, 'session-1', '需求', controller.signal), { name: 'AbortError' });
  await assert.rejects(handoff({ ...ports, readDraft: () => assert.fail('late read') }, 'session-1', '需求', controller.signal), { name: 'AbortError' });
});
test('navigation unmount cancellation leaves the already written draft and resolves the handoff', async () => {
  const controller = new AbortController();
  let draft = '';
  const ports = { readDraft: () => ({ text: draft, revision: 'draft-1' }), writeDraft: (_id, text) => { draft = text; },
    openSession: async () => { assert.equal(draft, '需求'); controller.abort(); } };
  await handoff(ports, 'session-1', '需求', controller.signal);
  assert.equal(controller.signal.aborted, true);
  assert.equal(draft, '需求');
});
