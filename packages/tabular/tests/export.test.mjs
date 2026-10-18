import {test} from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {writeWorksheetTables,readWorksheetTable} from '../dist/index.js';

test('complete typed export preserves rows, repeats and formula-like strings without mutation',async()=>{
 const tables=[{name:'数据',headers:['编号','数值','类型'],rows:[['001',-3,true],['=1+1',2,false],['@SUM(A1)',2,null],['多行\n中文',2,null]]},{name:'来源',headers:['键','值'],rows:[['origin','synthetic'],['exact','9007199254740991']]}],saved=structuredClone(tables);
 const bytes=await writeWorksheetTables(tables);assert.deepEqual(tables,saved);
 const data=await readWorksheetTable(bytes,{worksheet:'数据'});assert.deepEqual(data.headers,tables[0].headers);assert.deepEqual(data.rows,tables[0].rows);
 const w=new ExcelJS.Workbook();await w.xlsx.load(bytes);assert.equal(w.getWorksheet('数据').getCell('A3').type,ExcelJS.ValueType.String);assert.equal(w.getWorksheet('来源').getCell('B3').value,'9007199254740991');
});
test('export rejects formula objects, invalid shapes, duplicate sheet names and unsafe text',async()=>{
 const good={name:'数据',headers:['值'],rows:[[1]]};
 for(const tables of [[],[good,{...good,name:'数据'}],[{...good,name:'bad/name'}],[{...good,name:"'name"}],[{...good,extra:1}],[{...good,rows:[[1,2]]}],[{...good,rows:[[{formula:'1+1'}]]}],[{...good,rows:[[NaN]]}],[{...good,rows:[[Infinity]]}],[{...good,rows:[['\u0000']]}],[{...good,headers:['\ud800']}],[{...good,rows:[['a'.repeat(32768)]]}]])await assert.rejects(writeWorksheetTables(tables),/WORKBOOK_EXPORT/);
 const c=new AbortController();c.abort();await assert.rejects(writeWorksheetTables([good],c.signal),{name:'AbortError'});
});
test('export supports complete 10000 rows and rejects exceeding declared bounds',async()=>{
 const table={name:'结果',headers:['行','值'],rows:Array.from({length:10000},(_,i)=>[i+1,i%3])};
 const bytes=await writeWorksheetTables([table]);const w=new ExcelJS.Workbook();await w.xlsx.load(bytes);assert.equal(w.getWorksheet('结果').rowCount,10001);assert.equal(w.getWorksheet('结果').getCell('A10001').value,10000);
 await assert.rejects(writeWorksheetTables([{...table,rows:[...table.rows,[10001,0]]}]),/WORKBOOK_EXPORT_TABLE_INVALID/);
 await assert.rejects(writeWorksheetTables([{name:'large',headers:Array(21).fill('列'),rows:Array.from({length:10000},()=>Array(21).fill(1))}]),/WORKBOOK_EXPORT_CELL_LIMIT/);
 await assert.rejects(writeWorksheetTables([{name:'large text',headers:['文本'],rows:Array.from({length:300},()=>['a'.repeat(32767)])}]),/WORKBOOK_EXPORT_INPUT_BYTE_LIMIT/);
});
