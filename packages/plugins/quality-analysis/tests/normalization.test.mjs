import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(new URL('../../../../apps/web/package.json', import.meta.url));
const { build } = require('esbuild');
const built = await build({ stdin: {contents: "export * from './csv'; export * from './mapping'; export * from './statistics'; export * from './normalization';", resolveDir: fileURLToPath(new URL('../src/domain/', import.meta.url)), loader: 'ts'}, bundle: true, platform: 'node', format: 'esm', write: false });
const { parseCompleteQualityCsv, mapQualityTable, calculateQualityStatistics, normalizeQualityTable } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const input=(date,type='初检')=>({kind:'inspections',locations:[{record:2,line:2}],mapping:{},issues:[],rows:[{inspectionId:'001',inspectionDate:date,inspectionType:type,inspectedQuantity:100,nonconformingQuantity:1,quantityUnit:'piece'}]});
const rules={timeZone:'Asia/Shanghai',dateFormat:'yyyy/mm/dd',inspectionTypes:{初检:'initial',复检:'retest'}};
test('explicit date and Chinese type conversions retain immutable original and audit trail',()=>{
  const source=input('2026/10/10'); const result=normalizeQualityTable(source,rules);
  assert.equal(source.rows[0].inspectionDate,'2026/10/10');
  assert.equal(result.table.rows[0].inspectionDate,'2026-10-10');
  assert.equal(result.table.rows[0].inspectionType,'initial');
  assert.deepEqual(result.changes.map(x=>x.field),['inspectionDate','inspectionType']);
  assert.equal(result.issues.length,0); assert.equal(Object.isFrozen(result.changes[0]),true);
  assert.equal(calculateQualityStatistics({sourceNamespace:'file',timeZone:rules.timeZone,complete:true,inspections:result.table.rows,defects:[]}).status,'complete');
});
test('offset timestamps use configured business timezone across day boundaries',()=>{
  const result=normalizeQualityTable(input('2026-10-09T18:30:00Z'),{...rules,dateFormat:'iso-offset'});
  assert.equal(result.table.rows[0].inspectionDate,'2026-10-10');
  const utc=normalizeQualityTable(input('2026-10-10T01:00:00+08:00'),{...rules,timeZone:'UTC',dateFormat:'iso-offset'});
  assert.equal(utc.table.rows[0].inspectionDate,'2026-10-09');
});
test('illegal calendar, ambiguous timestamp, rollover and unknown types remain issues',()=>{
  for(const date of ['2026-02-30T12:00:00Z','2026-10-10T24:00:00Z','2026-10-10T01:00:00','2026-10-10T01:00:00+24:00']){
    const result=normalizeQualityTable(input(date,'未知'),{...rules,dateFormat:'iso-offset'});
    assert.deepEqual(result.issues.map(x=>x.code),['invalid-date','unmapped-inspection-type']);
    assert.equal(result.table.rows[0].inspectionDate,date);
  }
  assert.throws(()=>normalizeQualityTable(input('2026/10/10'),{...rules,timeZone:'invalid'}));
});
