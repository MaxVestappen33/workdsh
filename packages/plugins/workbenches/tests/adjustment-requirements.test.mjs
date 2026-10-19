import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const { build } = createRequire(new URL('../../../../apps/web/package.json', import.meta.url))('esbuild');
const built = await build({ entryPoints: [fileURLToPath(new URL('../src/client/adjustment-requirements.ts', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false, alias: { 'workdsh-contracts': fileURLToPath(new URL('../../../contracts/src/index.ts', import.meta.url)) } });
const { prepareWorkbenchAdjustmentRequirements: prepare } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const baseline = { title: '质量分析', scenario: '质量异常', users: '工程师', dataSources: 'Excel', workflow: '导入、分析、导出', firstIteration: '首次分析', acceptance: '可复算', system: { schemaVersion: '1', modules: [ { id: 'analysis', title: '分析', pages: [{ id: 'overview', title: '总览' }], dependsOn: [] }, { id: 'reports', title: '报告', pages: [{ id: 'report', title: '报告' }], dependsOn: ['analysis'] } ] } };
test('local iteration persists scope without rewriting baseline resources, workflow or topology', () => {
 const next = prepare(baseline, '增加产线筛选', { moduleId: 'analysis', pageId: 'overview' });
 for (const key of ['title','scenario','users','dataSources','workflow','acceptance','system']) assert.deepEqual(next[key], baseline[key]);
 assert.match(next.firstIteration, /增加产线筛选/); assert.match(next.firstIteration, /analysis、reports/); assert.match(next.firstIteration, /overview/);
 assert.equal(baseline.firstIteration, '首次分析'); assert.equal(Object.isFrozen(next), true);
});
test('unstructured feedback remains supported and invalid module targets cannot become a saved iteration', () => {
 assert.match(prepare({ ...baseline, system: undefined }, '调整总览间距').firstIteration, /调整总览间距/);
 for (const request of ['', ' ', 'x'.repeat(7001)]) assert.throws(() => prepare(baseline, request), /invalid-adjustment/);
 assert.throws(() => prepare(baseline, '修改', { moduleId: 'foreign' }), /invalid-edit-target/);
 assert.throws(() => prepare(baseline, '修改', { moduleId: 'analysis', pageId: 'report' }), /invalid-edit-target/);
});
