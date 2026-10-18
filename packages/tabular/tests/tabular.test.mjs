import {test} from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {extractTabularText} from '../dist/index.js';
import {parseCsv,decodeCsvBytes} from '../dist/csv.js';
test('one shared parser retains delimiter, quote/newline and decoding behavior',async()=>{
 const text='名称;备注\n客户;"多行\n内容"\n';const bytes=new Uint8Array(Buffer.concat([Buffer.from([255,254]),Buffer.from(text,'utf16le')]));
 assert.equal(decodeCsvBytes(bytes).encoding,'utf-16le');assert.equal(parseCsv(text).delimiter,';');assert.equal(parseCsv(text).rows[0][1],'多行\n内容');
 assert.match((await extractTabularText('csv',bytes)).markdown,/多行<br>内容/);
 const huge=await extractTabularText('csv',new TextEncoder().encode('a,b\n'+'v,w\n'.repeat(1600)));assert.equal(huge.warnings.length,1);
});
test('XLSX extraction reads cached values; cancellation and invalid CSV fail',async()=>{
 const workbook=new ExcelJS.Workbook(),sheet=workbook.addWorksheet('测试');sheet.getCell('A1').value={formula:'1+1',result:2};
 const result=await extractTabularText('xlsx',new Uint8Array(await workbook.xlsx.writeBuffer()));assert.match(result.markdown,/2/);assert.match(result.warnings[0],/不重新计算/);
 await assert.rejects(extractTabularText('csv',new Uint8Array([65,0,66])),/invalid-csv/);
 const controller=new AbortController();controller.abort();await assert.rejects(extractTabularText('csv',new Uint8Array(),controller.signal),{name:'AbortError'});
});
test('structured worksheet requires selection, retains typed cells and rejects prefixes',async()=>{
 const {readWorksheetTable}=await import('../dist/index.js');
 const w=new ExcelJS.Workbook(),s=w.addWorksheet('数据');s.addRow(['编号','数值','日期']);s.addRow(['001',12,new Date('2026-01-01T00:00:00Z')]);w.addWorksheet('说明').addRow(['说明']);
 const bytes=new Uint8Array(await w.xlsx.writeBuffer());
 assert.deepEqual(await readWorksheetTable(bytes),{status:'worksheet_required',worksheets:['数据','说明']});
 const table=await readWorksheetTable(bytes,{worksheet:'数据'});assert.deepEqual(table.rows,[['001',12,'2026-01-01T00:00:00.000Z']]);
 await assert.rejects(readWorksheetTable(bytes,{worksheet:'不存在'}),/WORKSHEET_NOT_FOUND/);
 await assert.rejects(readWorksheetTable(bytes,{worksheet:'数据',limits:{columns:2}}),/DATASET_LIMIT/);
});
test('structured worksheet rejects formula caches, errors and merged cells',async()=>{
 const {readWorksheetTable}=await import('../dist/index.js');
 for(const [value,error] of [[{formula:'1+1',result:2},'WORKSHEET_FORMULA'],[{error:'#DIV/0!'},'WORKSHEET_ERROR']]){
  const w=new ExcelJS.Workbook(),s=w.addWorksheet('数据');s.addRow(['值']);s.getCell('A2').value=value;
  await assert.rejects(readWorksheetTable(new Uint8Array(await w.xlsx.writeBuffer())),new RegExp(error));
 }
 const w=new ExcelJS.Workbook(),s=w.addWorksheet('数据');s.addRow(['a','b']);s.mergeCells('A2:B2');s.getCell('A2').value=1;
 await assert.rejects(readWorksheetTable(new Uint8Array(await w.xlsx.writeBuffer())),/WORKSHEET_MERGED/);
});

test('SpreadsheetML namespace prefixes retain typed values, source bytes and formula rejection',async()=>{
 const {default:JSZip}=await import('jszip');const {readWorksheetTable}=await import('../dist/index.js');
 async function prefixed(w){const zip=await JSZip.loadAsync(await w.xlsx.writeBuffer());for(const e of Object.values(zip.files)){if(e.dir||!/^xl\/.*\.xml$/.test(e.name))continue;let xml=await e.async('string');if(!xml.includes('http://schemas.openxmlformats.org/spreadsheetml/2006/main'))continue;xml=xml.replace('xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"','xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"').replace(/<(\/?)([A-Za-z_][\w.-]*)(?=[\s/>])/g,'<$1x:$2');zip.file(e.name,xml);}return new Uint8Array(await zip.generateAsync({type:'nodebuffer'}));}
 const w=new ExcelJS.Workbook();w.addWorksheet('测试&数据').addRows([['编号','值','说明'],['001',12,'A & <B>\n中文']]);const bytes=await prefixed(w),before=Buffer.from(bytes);
 assert.deepEqual((await readWorksheetTable(bytes)).rows,[['001',12,'A & <B>\n中文']]);assert.deepEqual(Buffer.from(bytes),before);
 assert.match((await extractTabularText('xlsx',bytes)).markdown,/中文/);
 const f=new ExcelJS.Workbook();f.addWorksheet('数据').addRow(['值']);f.worksheets[0].getCell('A2').value={formula:'1+1',result:2};await assert.rejects(readWorksheetTable(await prefixed(f)),/WORKSHEET_FORMULA/);
});
