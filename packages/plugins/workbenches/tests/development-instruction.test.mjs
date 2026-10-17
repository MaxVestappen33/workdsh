import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(new URL('../../../../apps/web/package.json', import.meta.url));
const { build } = require('esbuild');
const result = await build({ entryPoints: [fileURLToPath(new URL('../src/client/development-instruction.ts', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false });
const { createWorkbenchDevelopmentInstruction: instruction } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
const owner = { organizationId: 'org', ownerPrincipalId: 'member' };
const saved = { id: 'req-1', developmentId: 'dev-1', owner, requirements: {
  title: '质量', scenario: '分析', users: '人员', dataSources: 'Office', workflow: '导入分析', firstIteration: '报告', acceptance: '可核对',
  system: { schemaVersion: '1', modules: [
    { id: 'data', title: '数据', pages: [{ id: 'sources', title: '来源' }], dependsOn: [] },
    { id: 'report', title: '报告', pages: [{ id: 'reports', title: '报告' }], dependsOn: ['data'] },
  ] },
} };
const development = { id: 'dev-1', owner, requirementsRevision: 'req-1', revision: 'dev-rev', workbenchId: 'quality', packageName: 'quality-plugin' };
test('instruction carries stable identity and module impact without inventing source or API', () => {
  const text = instruction(saved, development, { target: { moduleId: 'data', pageId: 'sources' }, request: '增加筛选' });
  const context = JSON.parse(text.slice(text.indexOf('{')));
  assert.equal(context.packageName, 'quality-plugin');
  assert.equal(context.source, null);
  assert.deepEqual(context.adjustment.affectedModuleIds, ['data', 'report']);
  assert.equal(context.requirementsRevision, 'req-1');
  assert.match(text, /cordis-plugin-development/);
  assert.match(text, /workdsh-workbench-dev/);
  assert.match(text, /官方创造模式/);
  assert.ok(text.length < 3000, 'handoff references packaged rules instead of copying them into a huge prompt');
});
test('stale, foreign and unbound edits cannot generate a development handoff', () => {
  for (const change of [{ requirementsRevision: 'req-2' }, { id: 'other' }, { owner: { ...owner, ownerPrincipalId: 'other' } }])
    assert.throws(() => instruction(saved, { ...development, ...change }), /response-mismatch/);
  assert.throws(() => instruction(saved, development, { target: { moduleId: 'data', pageId: 'reports' }, request: '修改' }), /invalid-edit-target/);
  assert.throws(() => instruction(saved, development, { target: { moduleId: 'data' }, request: ' ' }), /invalid-adjustment/);
});
