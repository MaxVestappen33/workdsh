import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(new URL('../../../../apps/web/package.json', import.meta.url));
const { build } = require('esbuild');
const built = await build({ stdin: {contents: "export * from './csv'; export * from './mapping'; export * from './statistics';", resolveDir: fileURLToPath(new URL('../src/domain/', import.meta.url)), loader: 'ts'}, bundle: true, platform: 'node', format: 'esm', write: false });
const { parseCompleteQualityCsv, mapQualityTable, calculateQualityStatistics } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const table=text=>parseCompleteQualityCsv(new TextEncoder().encode(text));
const mapping={inspectionId:'编号',inspectionDate:'日期',inspectedQuantity:'数量',nonconformingQuantity:'不合格',quantityUnit:'单位',inspectionType:'类型',productId:'产品'};
test('explicit Chinese headers map into statistics without changing IDs or inventing dimensions',()=>{
  const input=table('编号,日期,数量,不合格,单位,类型,产品\n0001,2026-10-10,100,2,piece,initial,');
  const mapped=mapQualityTable(input,'inspections',mapping);
  assert.equal(mapped.rows[0].inspectionId,'0001');
  assert.equal(mapped.rows[0].inspectedQuantity,100);
  assert.equal(mapped.rows[0].productId,undefined);
  const result=calculateQualityStatistics({sourceNamespace:'file:test',timeZone:'Asia/Shanghai',complete:true,inspections:mapped.rows,defects:[]});
  assert.equal(result.status,'complete'); assert.equal(result.summary.nonconformingRate,.02);
  assert.equal(Object.isFrozen(mapped.mapping),true);
});
test('invalid numbers are retained with data-row references and block statistics',()=>{
  for(const value of ['', 'NaN','1.2','-1',' 2','1e2','9007199254740992']){
    const mapped=mapQualityTable(table('编号,日期,数量,不合格,单位,类型,产品\n0001,2026-10-10,'+value+',0,piece,initial,p'),'inspections',mapping);
    assert.equal(mapped.rows[0].inspectedQuantity,value);
    assert.deepEqual(mapped.issues,[{row:1,field:'inspectedQuantity',code:'invalid-integer'}]);
    assert.equal(calculateQualityStatistics({sourceNamespace:'file:test',timeZone:'UTC',complete:true,inspections:mapped.rows,defects:[]}).status,'blocked');
  }
});
test('missing, reused and foreign mapping fields are rejected',()=>{
  const input=table('编号,日期,数量,不合格,单位,类型,产品');
  const {inspectionId,...missing}=mapping;
  for(const bad of [missing,{...mapping,extra:'编号'},{...mapping,inspectionId:'不存在'},{...mapping,nonconformingQuantity:'数量'}]) assert.throws(()=>mapQualityTable(input,'inspections',bad));
});
test('defect mapping links multiple defects to one inspection without multiplying denominator',()=>{
  const inspections=mapQualityTable(table('编号,日期,数量,不合格,单位,类型,产品\n0001,2026-10-10,100,2,piece,initial,p'),'inspections',mapping);
  const defects=mapQualityTable(table('id,inspection,code,label,count\nd1,0001,a,划痕,2\nd2,0001,b,凹痕,3'),'defects',{defectId:'id',inspectionId:'inspection',defectCode:'code',defectLabel:'label',occurrences:'count'});
  const result=calculateQualityStatistics({sourceNamespace:'file:test',timeZone:'UTC',complete:true,inspections:inspections.rows,defects:defects.rows});
  assert.equal(result.summary.inspectedQuantity,100);assert.equal(result.summary.defectOccurrences,5);
});
