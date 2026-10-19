import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const webRequire=createRequire(new URL('../../../../apps/web/package.json',import.meta.url));
const runtimeRequire=createRequire(new URL('../../projects/package.json',import.meta.url));
const libraryRequire=createRequire(new URL('../../library/package.json',import.meta.url));
const {build}=webRequire('esbuild');
const load=name=>import(pathToFileURL(runtimeRequire.resolve(name)).href);
const {Context}=await load('@deepseek-ai/cordis');
const {default:Storage}=await load('@deepseek-ai/dsh-storage');
const JsonStorage=await load('@deepseek-ai/dsh-storage-json');
const StorageDomain=await load('@deepseek-ai/dsh-storage-domain');
const actor={principalId:'quality.engineer',organizationId:'quality-org',requestId:'report-flow',resolvedBy:'trusted-fixture'};
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');

test('real Client → record RPC → Library CSV worker → analysis worker → edited report v1/v2 survives reopening',async t=>{
  const root=await mkdtemp(join(tmpdir(),'quality-report-flow-'));
  let ctx,service,csv,executor;
  t.after(async()=>{
    await service?.close();await csv?.close();await executor?.close();await ctx?.fiber.dispose();
    await rm(root,{recursive:true,force:true});
  });
  const compiled=await build({
    stdin:{contents:"export * from '../client/record-client';export * from './record-rpc';export * from './run-service';export * from './csv-import';export * from './analysis-executor';export {LibraryManager} from '../../../library/src/services/library-manager';",resolveDir:fileURLToPath(new URL('../src/runtime/',import.meta.url)),loader:'ts'},
    bundle:true,platform:'node',format:'esm',write:false,
    alias:{'workdsh-contracts':fileURLToPath(new URL('../../../contracts/src/index.ts',import.meta.url))},
    plugins:[{name:'published-runtime-owner',setup(builder){
      builder.onResolve({filter:/^(?:@deepseek-ai\/cordis|@deepseek-ai\/dsh-storage-domain|zod)$/},args=>({path:pathToFileURL(runtimeRequire.resolve(args.path)).href,external:true}));
      builder.onResolve({filter:/^(?:workdsh-tabular|jszip|pdfjs-dist(?:\/.*)?)$/},args=>({path:pathToFileURL(libraryRequire.resolve(args.path)).href,external:true}));
    }}],
  });
  const bundlePath=join(root,'report-flow.mjs');await writeFile(bundlePath,compiled.outputFiles[0].text);
  const {QualityAnalysisRunService,QualityCsvImporter,QualityAnalysisExecutor,LibraryManager,createQualityRecordClient,handleQualityRecordsRequest}=await import(pathToFileURL(bundlePath).href);
  const csvPath=join(root,'csv-worker.mjs'),analysisPath=join(root,'analysis-worker.mjs');
  await Promise.all([
    build({entryPoints:[fileURLToPath(new URL('../src/runtime/csv-worker.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',outfile:csvPath}),
    build({entryPoints:[fileURLToPath(new URL('../src/runtime/analysis-worker.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',outfile:analysisPath}),
  ]);
  csv=new QualityCsvImporter(pathToFileURL(csvPath));executor=new QualityAnalysisExecutor(pathToFileURL(analysisPath));
  const identity={async resolve(){return {...actor};},profile(){return {principalId:actor.principalId,organization:{id:actor.organizationId},resolvedBy:actor.resolvedBy};},membership(){return {state:'active'};}};
  async function open(){
    ctx=new Context();await ctx.plugin(Storage);await ctx.plugin(JsonStorage,{root:join(root,'storage')});await ctx.plugin(StorageDomain,{backend:'json'});
    await ctx.plugin(LibraryManager,{root:join(root,'library')});
    service=new QualityAnalysisRunService(ctx.storageDomain,identity);
  }
  await open();
  const calls=[];
  // Every request goes through the source RPC handler and real services. Only
  // HTTP transport is kept in-process; neither parsing nor analysis is replaced.
  const client=createQualityRecordClient(async(path,init)=>{
    assert.equal(path,'/api/workdsh-quality-records');assert.equal(init.method,'POST');assert.equal(init.credentials,'same-origin');
    calls.push(JSON.parse(init.body).endpoint);
    return handleQualityRecordsRequest(new Request('http://quality-fixture'+path,init),service,executor,{library:ctx.workdshLibrary,csv},ctx.workdshLibrary);
  });
  const record=await client.create('十月检验趋势','create-analysis');
  const originalBytes=new TextEncoder().encode('id,date,total,bad,unit,type\nINS-001,2026-10-10,100,5,piece,initial\nINS-002,2026-10-11,200,10,piece,initial\n');
  const source=await ctx.workdshLibrary.importAsset(actor,{name:'inspection.csv',bytes:originalBytes,operationId:'upload-inspection-csv'});
  assert.equal(source.revision.originalSha256,sha256(originalBytes));
  const imported=await client.importLibrary({
    recordId:record.id,reference:{assetId:source.asset.id,revisionId:source.revision.id},
    format:'csv',tableKind:'inspections',headerRow:1,expectedGeneration:0,
  });
  assert.equal(imported.status,'ready');assert.equal(imported.inspectionRows,2);
  assert.deepEqual(imported.inspectionHeaders,['id','date','total','bad','unit','type']);
  const sources=await client.sources(record.id);assert.equal(sources.entries[0].sourceSnapshotId,imported.sourceSnapshotId);
  const configuration={
    inspectionsMapping:{inspectionId:'id',inspectionDate:'date',inspectedQuantity:'total',nonconformingQuantity:'bad',quantityUnit:'unit',inspectionType:'type'},
    rules:{timeZone:'Asia/Shanghai',dateFormat:'yyyy-mm-dd',inspectionTypes:{initial:'initial'}},
    filter:{trendGranularity:'day'},
  };
  const configured=await client.configure(record.id,'十月检验趋势','inspection-csv',imported.sourceSnapshotId,configuration,sources.generation);
  assert.equal(configured.generation,1);
  const saved=await client.analyze(record.id,0);assert.equal(saved.status,'saved');assert.equal(saved.revision,1);
  const {runId,contentHash}=saved.run;
  const view=await client.view(record.id,runId,contentHash);
  assert.equal(view.statistics.summary.inspectedQuantity,300);assert.equal(view.statistics.summary.nonconformingQuantity,15);
  assert.equal(view.statistics.summary.conformingQuantity,285);assert.equal(1-view.statistics.summary.nonconformingRate,.95);
  assert.deepEqual(view.statistics.trend.map(day=>({date:day.date,total:day.summary.inspectedQuantity,bad:day.summary.nonconformingQuantity,rate:day.summary.nonconformingRate})),[
    {date:'2026-10-10',total:100,bad:5,rate:.05},{date:'2026-10-11',total:200,bad:10,rate:.05},
  ]);
  assert.equal(view.basis.sources.inspections.sha256,sha256(originalBytes));assert.equal(view.basis.sources.inspections.rowCount,2);
  assert.deepEqual(view.basis.sources.inspections.provenance,{kind:'library',assetId:source.asset.id,revisionId:source.revision.id});
  assert.deepEqual(await client.reportDocuments(record.id,runId,contentHash),[]);
  const firstFields={title:'检验质量报告',analysis:'两个检验日需要按各自的检验数量加权。',conclusion:'当前统计已核对，原因分析仍需补充证据。',recommendations:'核查抽样范围，并补充缺陷明细。'};
  const v1=await client.saveReportDocument(record.id,runId,contentHash,{operationId:'create-report-v1',fields:firstFields});
  assert.equal(v1.version,1);assert.deepEqual(v1.fields,firstFields);
  assert.match(v1.markdown,/固定统计：检验数量 300；不合格数量 15；合格率 95\.00%。/);
  const v1Bytes=await ctx.workdshLibrary.readOriginal(actor,v1.receipt.assetId,v1.revisionId);
  assert.equal(sha256(v1Bytes),v1.receipt.sha256);assert.equal(new TextDecoder().decode(v1Bytes),v1.markdown);
  const editedFields={...firstFields,title:'检验质量报告 · 人工复核',analysis:'两个检验日的不合格率相同。\n采用检验数量加权汇总，避免直接平均样本数。',conclusion:'已完成统计复核；现有两日样本不足以判断长期改善。',recommendations:'追加下一周期检验数据。\n缺陷原因保持待核实，不把推测写成事实。'};
  const v2=await client.saveReportDocument(record.id,runId,contentHash,{reportId:v1.reportId,expectedRevisionId:v1.revisionId,operationId:'edit-report-v2',fields:editedFields});
  assert.equal(v2.reportId,v1.reportId);assert.equal(v2.receipt.assetId,v1.receipt.assetId);assert.equal(v2.version,2);assert.notEqual(v2.revisionId,v1.revisionId);
  assert.deepEqual(v2.fields,editedFields);assert.equal(v2.versions.length,2);
  assert.match(v2.markdown,/固定统计：检验数量 300；不合格数量 15；合格率 95\.00%。/);
  assert.match(v2.markdown,/已完成统计复核/);assert.doesNotMatch(v1.markdown,/已完成统计复核/);
  assert.deepEqual((await client.view(record.id,runId,contentHash)).statistics,view.statistics);
  const reports=await client.reportDocuments(record.id,runId,contentHash);assert.equal(reports.length,1);assert.equal(reports[0].currentRevisionId,v2.revisionId);assert.equal(reports[0].version,2);
  await service.close();service=undefined;await ctx.fiber.dispose();ctx=undefined;await open();
  assert.equal((await client.list())[0].id,record.id);assert.equal((await client.runs(record.id)).entries[0].runId,runId);
  const reopened=await client.reportDocument(record.id,runId,contentHash,v1.reportId);
  assert.deepEqual(reopened.fields,editedFields);assert.equal(reopened.version,2);assert.equal(reopened.revisionId,v2.revisionId);
  const historical=await client.reportDocument(record.id,runId,contentHash,v1.reportId,v1.revisionId);
  assert.deepEqual(historical.fields,firstFields);assert.equal(historical.version,1);assert.equal(historical.currentRevisionId,v2.revisionId);assert.equal(historical.markdown,v1.markdown);
  assert.equal(sha256(await ctx.workdshLibrary.readOriginal(actor,historical.receipt.assetId,historical.revisionId)),v1.receipt.sha256);
  assert.deepEqual(await ctx.workdshLibrary.readOriginal(actor,source.asset.id,source.revision.id),originalBytes);
  assert.deepEqual((await client.view(record.id,runId,contentHash)).statistics,view.statistics);
  const changedBytes=new TextEncoder().encode('id,date,total,bad,unit,type\nINS-001,2026-10-10,100,5,piece,initial\nINS-002,2026-10-11,200,20,piece,initial\n');
  const changedSource=await ctx.workdshLibrary.saveOriginalRevision(actor,{assetId:source.asset.id,expectedRevisionId:source.revision.id,operationId:'inspection-source-v2',bytes:changedBytes});
  assert.equal(changedSource.asset.id,source.asset.id);assert.equal(changedSource.revision.number,2);
  const currentRecord=await client.get(record.id);
  const changedImport=await client.importLibrary({recordId:record.id,reference:{assetId:changedSource.asset.id,revisionId:changedSource.revision.id},format:'csv',tableKind:'inspections',headerRow:1,expectedGeneration:currentRecord.generation});
  assert.equal(changedImport.status,'ready');assert.equal(changedImport.inspectionRows,2);
  await client.configure(record.id,'十月检验趋势','inspection-csv',changedImport.sourceSnapshotId,configuration,currentRecord.generation);
  const changedAnalysis=await client.analyze(record.id,currentRecord.revision);assert.equal(changedAnalysis.status,'saved');assert.notEqual(changedAnalysis.run.contentHash,contentHash);
  const changedView=await client.view(record.id,changedAnalysis.run.runId,changedAnalysis.run.contentHash);
  assert.equal(changedView.statistics.summary.inspectedQuantity,300);assert.equal(changedView.statistics.summary.nonconformingQuantity,25);
  assert.deepEqual(changedView.statistics.trend.map(day=>day.summary.nonconformingRate),[.05,.10]);
  assert.equal(((1-changedView.statistics.summary.nonconformingRate)*100).toFixed(2),'91.67');
  assert.equal(changedView.basis.sources.inspections.sha256,sha256(changedBytes));assert.equal(changedView.basis.sources.inspections.provenance.revisionId,changedSource.revision.id);
  const preservedReport=await client.reportDocument(record.id,runId,contentHash,v1.reportId);
  assert.deepEqual(preservedReport.fields,editedFields);assert.equal(preservedReport.revisionId,v2.revisionId);
  assert.match(preservedReport.markdown,/固定统计：检验数量 300；不合格数量 15；合格率 95\.00%。/);
  assert.deepEqual((await client.reportDocument(record.id,runId,contentHash,v1.reportId,v1.revisionId)).fields,firstFields);
  assert.deepEqual((await client.view(record.id,runId,contentHash)).statistics,view.statistics);
  assert.deepEqual(await ctx.workdshLibrary.readOriginal(actor,source.asset.id,source.revision.id),originalBytes);
  assert.deepEqual(calls.slice(0,9),['create','import-library','sources','configure','analyze','run-view','report-documents','save-report-document','save-report-document']);
  assert.equal((await ctx.workdshLibrary.list(actor)).filter(entry=>entry.asset?.kind==='markdown')[0].revision.number,2);
});
