import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(new URL('../../../../apps/web/package.json', import.meta.url));
const { build } = require('esbuild');
const built = await build({ stdin:{contents:"export * from './library-source';export * from './xlsx-import';export * from './analysis-run';",resolveDir:fileURLToPath(new URL('../src/runtime/',import.meta.url)),loader:'ts'}, bundle: true, platform: 'node', format: 'esm', write: false });
const { importQualityLibraryXlsx,QualityXlsxImporter,createQualityAnalysisRun } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
const tabularRequire=createRequire(new URL('../../../tabular/package.json',import.meta.url));
const {writeWorksheetTables}=await import(new URL('../../../tabular/dist/index.js',import.meta.url));
const mapping={inspectionId:'id',inspectionDate:'date',inspectedQuantity:'total',nonconformingQuantity:'bad',quantityUnit:'unit',inspectionType:'type'};
test('real XLSX worker preserves typed cells and feeds quality statistics with explicit sheet/header',async()=>{
 const root=await mkdtemp(join(tmpdir(),'quality-xlsx-'));const path=join(root,'worker.mjs');
 await build({entryPoints:[fileURLToPath(new URL('../src/runtime/xlsx-worker.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',outfile:path,plugins:[{name:'published-tabular',setup(builder){builder.onResolve({filter:/^workdsh-tabular$/},()=>({path:new URL('../../../tabular/dist/index.js',import.meta.url).href,external:true}));}}]});
 const importer=new QualityXlsxImporter(pathToFileURL(path));
 try{
 const table={name:'检验',headers:['id','date','total','bad','unit','type'],rows:[['001','2026-10-10',100,2,'piece','initial']]};
 const bytes=await writeWorksheetTables([table,{...table,name:'其他'}]);
 const needed=await importer.import({bytes,headerRow:1});assert.equal(needed.status,'worksheet_required');
 const result=await importer.import({bytes,worksheet:'检验',headerRow:1});
 assert.equal(result.status,'ready');assert.equal(result.imported.table.rows[0][2],100);assert.equal(result.imported.table.rows[0][0],'001');
 assert.equal(result.imported.sha256,createHash('sha256').update(bytes).digest('hex'));
 assert.equal(Object.isFrozen(result.imported.table.rows[0]),true);
 const run=createQualityAnalysisRun({runId:'xlsx',createdAt:'2026-10-10T00:00:00Z',sourceNamespace:'xlsx',rules:{timeZone:'UTC',dateFormat:'yyyy-mm-dd',inspectionTypes:{initial:'initial'}},inspections:{...result,mapping}});
 assert.equal(run.status,'complete');assert.equal(run.content.statistics.summary.nonconformingRate,.02);
 assert.equal(run.content.sources.inspections.format.worksheet,'检验');
 const ExcelJS=tabularRequire('exceljs');const workbook=new ExcelJS.Workbook();const sheet=workbook.addWorksheet('formula');sheet.addRow(['id']);sheet.getCell('A2').value={formula:'1+1',result:2};
 await assert.rejects(importer.import({bytes:new Uint8Array(await workbook.xlsx.writeBuffer()),worksheet:'formula',headerRow:1}),/WORKSHEET_FORMULA/);
 }finally{await importer.close();await rm(root,{recursive:true,force:true});}
});

test('real LibraryManager XLSX source preserves exact revision, sheet selection and late authorization',async()=>{
 const runtimeRequire=createRequire(new URL('../../projects/package.json',import.meta.url));
 const serviceBuilt=await build({stdin:{contents:"export * from './run-service';export * from './record-rpc';export * from '../client/record-client';",resolveDir:fileURLToPath(new URL('../src/runtime/',import.meta.url)),loader:'ts'},bundle:true,platform:'node',format:'esm',write:false,alias:{'workdsh-contracts':fileURLToPath(new URL('../../../contracts/src/index.ts',import.meta.url))},plugins:[{name:'official-runtime',setup(builder){builder.onResolve({filter:/^(?:@deepseek-ai\/dsh-storage-domain|zod)$/},args=>({path:pathToFileURL(runtimeRequire.resolve(args.path)).href,external:true}));}}]});
 const {QualityAnalysisRunService,handleQualityRecordsRequest,createQualityRecordClient}=await import(`data:text/javascript;base64,${Buffer.from(serviceBuilt.outputFiles[0].text).toString('base64')}`);
 const load=async name=>import(pathToFileURL(runtimeRequire.resolve(name)).href);
 const {Context}=await load('@deepseek-ai/cordis'),{default:Storage}=await load('@deepseek-ai/dsh-storage'),JsonStorage=await load('@deepseek-ai/dsh-storage-json'),StorageDomain=await load('@deepseek-ai/dsh-storage-domain');
 const {LibraryManager}=await import(new URL('../../library/dist/index.js',import.meta.url));
 const root=await mkdtemp(join(tmpdir(),'quality-library-xlsx-')),ctx=new Context(),path=join(root,'worker.mjs');
 const actor={principalId:'member',organizationId:'org',requestId:'test',resolvedBy:'trusted-fixture'};
 await build({entryPoints:[fileURLToPath(new URL('../src/runtime/xlsx-worker.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',outfile:path,plugins:[{name:'local-tabular',setup(builder){builder.onResolve({filter:/^workdsh-tabular$/},()=>({path:new URL('../../../tabular/dist/index.js',import.meta.url).href,external:true}));}}]});
 const importer=new QualityXlsxImporter(pathToFileURL(path));let service;
 try{
  await ctx.plugin(Storage);await ctx.plugin(JsonStorage,{root:join(root,'storage')});await ctx.plugin(StorageDomain,{backend:'json'});await ctx.plugin(LibraryManager,{root:join(root,'library')});
  const bytes=await writeWorksheetTables([{name:'检验',headers:['id','date','total','bad','unit','type'],rows:[['001','2026-10-10',100,2,'piece','initial']]},{name:'说明',headers:['说明'],rows:[['示例']]}]);
  const asset=await ctx.workdshLibrary.importAsset(actor,{name:'quality.xlsx',bytes,operationId:'xlsx-original'});
  const ref={assetId:asset.asset.id,revisionId:asset.revision.id};
  const identity={async resolve(){return {...actor};},profile(){return {principalId:actor.principalId,organization:{id:actor.organizationId},resolvedBy:actor.resolvedBy};},membership(){return {state:'active'};}};
  service=new QualityAnalysisRunService(ctx.storageDomain,identity);const record=await service.createRecord('Excel分析','xlsx-record');
  const client=createQualityRecordClient(async(path,init)=>handleQualityRecordsRequest(new Request('http://fixture'+path,init),service,undefined,{library:ctx.workdshLibrary,xlsx:importer}));
  const request={recordId:record.id,reference:ref,format:'xlsx',tableKind:'inspections',headerRow:1,expectedGeneration:0};
  const choose=await client.importLibrary(request);assert.equal(choose.status,'worksheet_required');assert.deepEqual(choose.worksheets,['检验','说明']);assert.equal('sourceSnapshotId' in choose,false);
  const admitted=await client.importLibrary({...request,worksheet:'检验'});assert.equal(admitted.status,'ready');assert.equal(admitted.inspectionRows,1);assert.deepEqual(admitted.inspectionHeaders,['id','date','total','bad','unit','type']);
  await client.configure(record.id,'Excel分析','fixture',admitted.sourceSnapshotId,{inspectionsMapping:mapping,rules:{timeZone:'UTC',dateFormat:'yyyy-mm-dd',inspectionTypes:{initial:'initial'}},filter:{}},0);
  const saved=await client.configuration(record.id);assert.equal(saved.inspections.format.worksheet,'检验');assert.equal(saved.inspections.provenance.revisionId,ref.revisionId);assert.equal(saved.inspections.sha256,createHash('sha256').update(bytes).digest('hex'));
  await assert.rejects(client.importLibrary({...request,worksheet:'missing',expectedGeneration:1}),error=>error.status===400);

  const needed=await importQualityLibraryXlsx(ctx.workdshLibrary,importer,actor,ref,{headerRow:1},()=>{});assert.equal(needed.status,'worksheet_required');assert.equal('imported' in needed,false);
  const result=await importQualityLibraryXlsx(ctx.workdshLibrary,importer,actor,ref,{headerRow:1,worksheet:'检验'},()=>{});
  assert.equal(result.status,'ready');assert.equal(result.provenance.revisionId,ref.revisionId);assert.equal(result.format.worksheet,'检验');assert.equal(result.imported.sha256,createHash('sha256').update(bytes).digest('hex'));
  const run=createQualityAnalysisRun({runId:'library-xlsx',createdAt:'2026-10-10T00:00:00Z',sourceNamespace:'fixture',rules:{timeZone:'UTC',dateFormat:'yyyy-mm-dd',inspectionTypes:{initial:'initial'}},inspections:{...result,mapping}});assert.equal(run.content.sources.inspections.provenance.assetId,ref.assetId);
  await assert.rejects(importQualityLibraryXlsx(ctx.workdshLibrary,importer,actor,{...ref,revisionId:'missing'},{headerRow:1,worksheet:'检验'},()=>{}),/not-found/);
  const second=await ctx.workdshLibrary.importAsset(actor,{name:'another.xlsx',bytes,operationId:'xlsx-second'});
  await assert.rejects(importQualityLibraryXlsx(ctx.workdshLibrary,importer,actor,{...ref,revisionId:second.revision.id},{headerRow:1,worksheet:'检验'},()=>{}),/revision-asset-mismatch/);
  await assert.rejects(importQualityLibraryXlsx(ctx.workdshLibrary,importer,{...actor,principalId:'other'},ref,{headerRow:1,worksheet:'检验'},()=>{}),/not-found/);
  let authorized=true;const delayed={async import(input,signal){const value=await importer.import(input,signal);authorized=false;return value;}};
  await assert.rejects(importQualityLibraryXlsx(ctx.workdshLibrary,delayed,actor,ref,{headerRow:1,worksheet:'检验'},()=>{if(!authorized)throw new Error('revoked');}),/revoked/);
 }finally{await service?.close();await importer.close();await ctx.fiber.dispose();await rm(root,{recursive:true,force:true});}
});

test('real Excel directory/header failures reach RPC clients without replacing pinned inspection sources',async()=>{
 const runtimeRequire=createRequire(new URL('../../projects/package.json',import.meta.url));
 const serviceBuilt=await build({stdin:{contents:"export * from './run-service';export * from './record-rpc';export * from '../client/record-client';",resolveDir:fileURLToPath(new URL('../src/runtime/',import.meta.url)),loader:'ts'},bundle:true,platform:'node',format:'esm',write:false,alias:{'workdsh-contracts':fileURLToPath(new URL('../../../contracts/src/index.ts',import.meta.url))},plugins:[{name:'official-runtime',setup(builder){builder.onResolve({filter:/^(?:@deepseek-ai\/dsh-storage-domain|zod)$/},args=>({path:pathToFileURL(runtimeRequire.resolve(args.path)).href,external:true}));}}]});
 const {QualityAnalysisRunService,handleQualityRecordsRequest,createQualityRecordClient}=await import(`data:text/javascript;base64,${Buffer.from(serviceBuilt.outputFiles[0].text).toString('base64')}`);
 const load=async name=>import(pathToFileURL(runtimeRequire.resolve(name)).href);
 const {Context}=await load('@deepseek-ai/cordis'),{default:Storage}=await load('@deepseek-ai/dsh-storage'),JsonStorage=await load('@deepseek-ai/dsh-storage-json'),StorageDomain=await load('@deepseek-ai/dsh-storage-domain');
 const {LibraryManager}=await import(new URL('../../library/dist/index.js',import.meta.url));
 const root=await mkdtemp(join(tmpdir(),'quality-xlsx-errors-')),ctx=new Context(),path=join(root,'worker.mjs');
 const actor={principalId:'member',organizationId:'org',requestId:'test',resolvedBy:'trusted-fixture'};
 await build({entryPoints:[fileURLToPath(new URL('../src/runtime/xlsx-worker.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',outfile:path,plugins:[{name:'local-tabular',setup(builder){builder.onResolve({filter:/^workdsh-tabular$/},()=>({path:new URL('../../../tabular/dist/index.js',import.meta.url).href,external:true}));}}]});
 const importer=new QualityXlsxImporter(pathToFileURL(path));let service;
 try{
  await ctx.plugin(Storage);await ctx.plugin(JsonStorage,{root:join(root,'storage')});await ctx.plugin(StorageDomain,{backend:'json'});await ctx.plugin(LibraryManager,{root:join(root,'library')});
  // Entirely synthetic workbook: no user financial file or values are read here.
  const ExcelJS=tabularRequire('exceljs'),workbook=new ExcelJS.Workbook(),headers=['id','date','total','bad','unit','type'],row=['001','2026-10-10',100,2,'piece','initial'];
  const directory=workbook.addWorksheet('底稿目录');directory.mergeCells('A1:F1');directory.getCell('A1').value='检验资料目录';directory.getCell('A2').value='请查看明细';
  const details=workbook.addWorksheet('检验明细');details.addRow(['检验明细说明']);details.addRow([]);details.addRow(headers);details.addRow(row);
  workbook.addWorksheet('缺失列名').addRows([['id','',...headers.slice(2)],row]);
  workbook.addWorksheet('重复列名').addRows([['id','id',...headers.slice(2)],row]);
  const blankHeader=workbook.addWorksheet('空白表头');blankHeader.getCell('A2').value='001';blankHeader.getCell('B2').value='2026-10-10';
  workbook.addWorksheet('只有表头').addRow(headers);
  workbook.addWorksheet('全空数据').addRows([headers,Array(6).fill(null)]);
  workbook.addWorksheet('空工作表');
  const formula=workbook.addWorksheet('含公式');formula.addRow(headers);formula.addRow(row);formula.getCell('C2').value={formula:'50+50',result:100};
  workbook.addWorksheet('过多列').addRows([Array.from({length:51},(_,i)=>`column${i+1}`),Array(51).fill('value')]);
  const bytes=new Uint8Array(await workbook.xlsx.writeBuffer()),originalHash=createHash('sha256').update(bytes).digest('hex');
  const asset=await ctx.workdshLibrary.importAsset(actor,{name:'synthetic-inspections.xlsx',bytes,operationId:'xlsx-errors-original'}),ref={assetId:asset.asset.id,revisionId:asset.revision.id};
  // A newer version deliberately has no directory/detail sheets. Import must
  // still read the selected original revision, never substitute the latest.
  const newerBytes=await writeWorksheetTables([{name:'新版检验',headers,rows:[['999','2026-10-10',900,90,'piece','initial']]}]);
  const newer=await ctx.workdshLibrary.saveOriginalRevision(actor,{assetId:ref.assetId,expectedRevisionId:ref.revisionId,bytes:newerBytes,operationId:'xlsx-errors-newer'});assert.notEqual(newer.revision.id,ref.revisionId);
  const identity={async resolve(){return {...actor};},profile(){return {principalId:actor.principalId,organization:{id:actor.organizationId},resolvedBy:actor.resolvedBy};},membership(){return {state:'active'};}};
  service=new QualityAnalysisRunService(ctx.storageDomain,identity);const record=await service.createRecord('表头核对测试','xlsx-errors-record');
  const client=createQualityRecordClient(async(path,init)=>handleQualityRecordsRequest(new Request('http://fixture'+path,init),service,undefined,{library:ctx.workdshLibrary,xlsx:importer}));
  const request={recordId:record.id,reference:ref,format:'xlsx',tableKind:'inspections',headerRow:1,expectedGeneration:0};
  const rejectWithoutChanges=async(selection,code,status=400)=>{
   const beforeSources=await client.sources(record.id);
   await assert.rejects(client.importLibrary({...request,...selection}),error=>{assert.equal(error.code,`quality/source/${code}`);assert.equal(error.status,status);return true;});
   assert.deepEqual(await client.sources(record.id),beforeSources);
  };
  await rejectWithoutChanges({worksheet:'底稿目录'},'merged-cells');assert.equal((await client.sources(record.id)).entries.length,0);
  const admitted=await client.importLibrary({...request,worksheet:'检验明细',headerRow:3});assert.equal(admitted.status,'ready');assert.equal(admitted.inspectionRows,1);assert.deepEqual(admitted.inspectionHeaders,headers);
  await client.configure(record.id,'表头核对测试','fixture',admitted.sourceSnapshotId,{inspectionsMapping:mapping,rules:{timeZone:'UTC',dateFormat:'yyyy-mm-dd',inspectionTypes:{initial:'initial'}},filter:{}},0);request.expectedGeneration=1;
  const configured=await client.configuration(record.id);assert.equal(configured.inspections.format.worksheet,'检验明细');assert.equal(configured.inspections.format.headerRow,3);assert.equal(configured.inspections.provenance.revisionId,ref.revisionId);assert.equal(configured.inspections.sha256,originalHash);assert.equal(configured.inspections.rowCount,1);
  const rows=await client.cleaningRows(record.id,'inspections',0,1);assert.deepEqual(rows.rows[0].values,row);assert.deepEqual(rows.rows[0].location,{record:4,line:4});
  for(const [selection,code,status] of [
   [{worksheet:'底稿目录'},'merged-cells',400],
   [{worksheet:'缺失列名'},'header-missing',400],
   [{worksheet:'重复列名'},'header-duplicate',400],
   [{worksheet:'空白表头'},'header-missing',400],
   [{worksheet:'只有表头'},'worksheet-empty',400],
   [{worksheet:'全空数据'},'worksheet-empty',400],
   // The shared reader currently rejects an entirely empty sheet at its header
   // bounds check; this remains distinct from a valid header with no data.
   [{worksheet:'空工作表'},'header-row-invalid',400],
   [{worksheet:'检验明细',headerRow:99},'header-row-invalid',400],
   [{worksheet:'不存在'},'worksheet-not-found',400],
   [{worksheet:'含公式'},'formula-values-required',400],
   [{worksheet:'过多列'},'size-limit',413]
  ])await rejectWithoutChanges(selection,code,status);
  assert.deepEqual(await client.configuration(record.id),configured);
  assert.deepEqual(await ctx.workdshLibrary.readOriginal(actor,ref.assetId,ref.revisionId),bytes);
  await assert.rejects(importer.import({bytes,worksheet:'检验明细',headerRow:0}),error=>error.code==='invalid-header-row');
 }finally{await service?.close();await importer.close();await ctx.fiber.dispose();await rm(root,{recursive:true,force:true});}
});
