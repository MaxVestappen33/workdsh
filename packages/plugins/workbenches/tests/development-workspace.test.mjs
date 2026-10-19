import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const { build } = createRequire(new URL('../../../../apps/web/package.json', import.meta.url))('esbuild');
const built = await build({ entryPoints: [fileURLToPath(new URL('../src/runtime/development-workspace.ts', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false });
const { ensureWorkbenchDevelopmentWorkspace: ensure } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const development = { id: 'development-1', source: { hostId: 'host', directory: '/source/quality', revision: 'source-1' }, target: { hostId: 'host' } };
test('existing project workspace is reused without changing its name', async () => {
  const workspace = { workspaceId: 'workspace-1', path: '/source/quality', title: '已有项目' };
  const ctx = { workspaceController: { create: async request => { assert.equal(request.path, development.source.directory); return { workspace, created: false }; }, rename: async () => assert.fail('existing workspace renamed') } };
  assert.equal(await ensure(ctx, development, '质量分析', () => {}), workspace);
});
test('new workspace receives a development title and revoked access stops further mutation', async () => {
  let checks = 0, renames = 0;
  const ctx = { workspaceController: { create: async () => ({ workspace: { workspaceId: 'workspace-1' }, created: true }),
    rename: async request => { renames++; return { workspace: { ...request } }; } } };
  assert.equal((await ensure(ctx, development, '质量分析', () => {})).title, '质量分析 · developm');
  await assert.rejects(ensure(ctx, development, '质量分析', () => { if (++checks === 2) throw new Error('revoked'); }), /revoked/);
  assert.equal(renames, 1);
});
