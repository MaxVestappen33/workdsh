import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(new URL('../../../../apps/web/package.json', import.meta.url));
const { build } = require('esbuild');
const built = await build({ entryPoints: [fileURLToPath(new URL('../src/domain/statistics.ts', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false });
const { calculateQualityStatistics } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const inspection = (id, patch = {}) => ({ inspectionId: id, productId: 'a', batchId: 'batch', lineId: 'line', inspectionDate: '2026-09-01', inspectedQuantity: 100, nonconformingQuantity: 10, quantityUnit: 'piece', inspectionType: 'initial', ...patch });
const defect = (id, inspectionId, patch = {}) => ({ defectId: id, inspectionId, defectCode: 'scratch', defectLabel: '划痕', occurrences: 1, ...patch });
const dataset = (inspections, defects = []) => ({ sourceNamespace: 'fixture', complete: true, timeZone: 'Asia/Shanghai', inspections, defects });
test('weighted totals count inspections once, defects independently and propagate product filters to both tables', () => {
  const data = dataset([inspection('0001'), inspection('0002', { productId: 'b', inspectedQuantity: 900, nonconformingQuantity: 0 })],
    [defect('d1', '0001', { occurrences: 30 }), defect('d2', '0001', { defectCode: 'dent', defectLabel: '凹痕', occurrences: 20 }), defect('d3', '0002', { occurrences: 50 })]);
  const all = calculateQualityStatistics(data);
  assert.equal(all.status, 'complete');
  assert.equal(all.summary.inspectedQuantity, 1000);
  assert.equal(all.summary.nonconformingRate, .01);
  assert.equal(all.summary.defectOccurrences, 100);
  assert.deepEqual(all.pareto.map(row => row.occurrences), [80, 20]);
  assert.equal(all.pareto.at(-1).cumulativeRate, 1);
  assert.equal(all.trend[0].summary.inspectedQuantity, 1000);
  const selected = calculateQualityStatistics(data, { productIds: ['a'] });
  assert.equal(selected.summary.inspectedQuantity, 100);
  assert.equal(selected.summary.defectOccurrences, 50, 'defects can exceed nonconforming pieces');
  assert.deepEqual(selected.includedInspectionIds, ['0001']);
  assert.equal(selected.pareto[0].cumulativeRate, .6);
  assert.equal(Object.isFrozen(selected.summary), true);
});
test('invalid, duplicate, orphan and mismatched namespace inputs block formal statistics with row references', () => {
  for (const [data, code] of [[{ ...dataset([]), complete: false }, 'incomplete-source'],
    [dataset([inspection('1'), inspection('1')]), 'duplicate-inspection-id'],
    [dataset([inspection('1', { inspectedQuantity: '100' })]), 'invalid-inspection'],
    [dataset([inspection('1', { inspectionDate: '2026-02-30' })]), 'invalid-inspection'],
    [dataset([inspection('1', { nonconformingQuantity: 101 })]), 'invalid-inspection'],
    [dataset([inspection('1')], [defect('d', 'missing')]), 'orphan-defect'],
    [dataset([inspection('1')], [defect('d', '1'), defect('d', '1')]), 'duplicate-defect-id'],
    [dataset([inspection('1', { sourceNamespace: 'other' })]), 'source-namespace-mismatch'],
    [dataset([inspection('1'), inspection('2', { quantityUnit: 'batch' })]), 'mixed-quantity-units']]) {
    const result = calculateQualityStatistics(data);
    assert.equal(result.status, 'blocked');
    assert.ok(result.issues.some(issue => issue.code === code));
    assert.equal('summary' in result, false);
  }
});
test('zero denominators remain unavailable, retests require an explicit rule and quantity overflow is rejected', () => {
  const zero = calculateQualityStatistics(dataset([inspection('0', { inspectedQuantity: 0, nonconformingQuantity: 0 })], [defect('d', '0', { occurrences: 0 })]));
  assert.equal(zero.summary.nonconformingRate, null);
  assert.equal(zero.pareto[0].cumulativeRate, null);
  const retest = dataset([inspection('1'), inspection('2', { inspectionType: 'retest' })]);
  assert.equal(calculateQualityStatistics(retest).status, 'blocked');
  assert.equal(calculateQualityStatistics(retest, { retestPolicy: 'exclude' }).summary.inspectedQuantity, 100);
  assert.equal(calculateQualityStatistics(retest, { retestPolicy: 'include-separately' }).summary.inspectedQuantity, 200);
  const overflow = calculateQualityStatistics(dataset([inspection('1', { inspectedQuantity: Number.MAX_SAFE_INTEGER }), inspection('2')]));
  assert.equal(overflow.status, 'blocked');
  assert.equal(overflow.issues[0].code, 'quantity-overflow');
});
test('statistics remain deterministic when input order changes', () => {
  const inspections = [inspection('2', { inspectionDate: '2026-09-02', productId: 'b' }), inspection('1')];
  const defects = [defect('2', '2', { defectCode: 'b', defectLabel: 'B' }), defect('1', '1', { defectCode: 'a', defectLabel: 'A' })];
  assert.deepEqual(calculateQualityStatistics(dataset(inspections, defects)), calculateQualityStatistics(dataset([...inspections].reverse(), [...defects].reverse())));
});
test('missing optional dimensions stay unidentified rather than blocking totals or inventing a product', () => {
  const row = inspection('001'); delete row.productId; delete row.lineId; delete row.batchId;
  const result = calculateQualityStatistics(dataset([row]));
  assert.equal(result.status, 'complete');
  assert.equal(result.summary.inspectedQuantity, 100);
  assert.equal(result.products[0].productId, null);
  assert.equal(calculateQualityStatistics(dataset([row]), { productIds: ['a'] }).summary.inspectedQuantity, 0);
});

test('weekly and monthly trends use business calendar starts and weighted quantities across year boundaries',()=>{
 const data=dataset([inspection('a',{inspectionDate:'2025-12-31',inspectedQuantity:10,nonconformingQuantity:2}),inspection('b',{inspectionDate:'2026-01-01',inspectedQuantity:90,nonconformingQuantity:0}),inspection('c',{inspectionDate:'2026-01-05',inspectedQuantity:50,nonconformingQuantity:5})],[defect('d','a',{occurrences:7})]);
 const week=calculateQualityStatistics(data,{trendGranularity:'week'});assert.equal(week.status,'complete');assert.equal(week.trendGranularity,'week');assert.deepEqual(week.trend.map(row=>row.date),['2025-12-29','2026-01-05']);assert.equal(week.trend[0].summary.nonconformingRate,.02);assert.equal(week.trend[0].summary.defectOccurrences,7);
 const month=calculateQualityStatistics(data,{trendGranularity:'month'});assert.deepEqual(month.trend.map(row=>row.date),['2025-12-01','2026-01-01']);assert.equal(month.trend[1].summary.inspectedQuantity,140);assert.equal(month.summary.inspectedQuantity,week.summary.inspectedQuantity);
 const filtered=calculateQualityStatistics(data,{trendGranularity:'week',dateFrom:'2026-01-01',dateTo:'2026-01-04'});assert.equal(filtered.trend[0].date,'2025-12-29');assert.equal(filtered.trend[0].summary.inspectedQuantity,90);assert.equal(filtered.trend[0].summary.defectOccurrences,0);
 assert.deepEqual(calculateQualityStatistics(data,{trendGranularity:'week'}),calculateQualityStatistics({...data,inspections:[...data.inspections].reverse()},{trendGranularity:'week'}));
 assert.equal(calculateQualityStatistics(data,{trendGranularity:'quarter'}).status,'blocked');
});
