import test from 'node:test';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const webRequire = createRequire(new URL('../../../../apps/web/package.json', import.meta.url));
const runtimeRequire = createRequire(new URL('../../projects/package.json', import.meta.url));
const qualityRequire = createRequire(new URL('../package.json', import.meta.url));
const { build } = webRequire('esbuild');
const built = await build({ stdin:{contents:"export * from '../client/record-controller';export * from '../client/record-client';export * from './csv-import';export * from './records-host';export * from './record-rpc';export * from './run-store';export * from './expert-tasks'; export * from './analysis-run';export * from './run-service';export * from './analysis-executor';export * from './artifact-executor';",resolveDir:fileURLToPath(new URL('../src/runtime/',import.meta.url)),loader:'ts'}, bundle: true, platform: 'node', format: 'esm', write: false, alias: { 'workdsh-contracts': fileURLToPath(new URL('../../../contracts/src/index.ts', import.meta.url)) }, plugins: [{ name: 'official-runtime', setup(builder) { builder.onResolve({ filter: /^(?:@deepseek-ai\/dsh-storage-domain|zod)$/ }, args => ({ path: pathToFileURL(runtimeRequire.resolve(args.path)).href, external: true }));builder.onResolve({filter:/^@deepseek-ai\/dsh-tools$/},args=>({path:pathToFileURL(qualityRequire.resolve(args.path)).href,external:true})); } }] });
const { QualityCsvImporter,QualityRecordController,mountQualityRecordsHost,createQualityRecordClient,QualityRecordRequestError,handleQualityRecordsRequest,QualityAnalysisRunStore,createQualityAnalysisRun,QualityAnalysisRunService,QualityAnalysisExecutor,QualityArtifactExecutor,createQualityExpertTasks } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const load = async name => import(pathToFileURL(runtimeRequire.resolve(name)).href);
const { Context } = await load('@deepseek-ai/cordis');
const { default: Storage } = await load('@deepseek-ai/dsh-storage');
const JsonStorage = await load('@deepseek-ai/dsh-storage-json');
const StorageDomain = await load('@deepseek-ai/dsh-storage-domain');
const actor = { principalId: 'member.a', organizationId: 'org', requestId: 'test', resolvedBy: 'trusted-fixture' };
async function boot(root) { const ctx = new Context(); await ctx.plugin(Storage); await ctx.plugin(JsonStorage, { root }); await ctx.plugin(StorageDomain, { backend: 'json' }); return ctx; }

const run=()=>createQualityAnalysisRun({runId:'r1',createdAt:'2026-10-10T00:00:00Z',sourceNamespace:'fixture',rules:{timeZone:'UTC',dateFormat:'yyyy-mm-dd',inspectionTypes:{initial:'initial'}},inspections:{mapping:{inspectionId:'id',inspectionDate:'date',inspectedQuantity:'total',nonconformingQuantity:'bad',quantityUnit:'unit',inspectionType:'type'},imported:{sha256:'a'.repeat(64),table:{complete:true,encoding:'utf-8',byteLength:1,headers:['id','date','total','bad','unit','type'],rows:[['001','2026-10-10','100','1','piece','initial']],locations:[{record:2,line:2}],ignoredBlankRecords:0}}}});
test('official storage restores runs, isolates owner and rejects conflicting writes',async()=>{
 const root=await mkdtemp(join(tmpdir(),'quality-store-'));let ctx,store;
 try{
 ctx=await boot(root);store=await QualityAnalysisRunStore.open(ctx.storageDomain,actor,'record1');
 await store.configure({title:'质量',sourceNamespace:'fixture',timeZone:'UTC',mappingRevision:'m1',sourceSnapshotId:'s1'},0,()=>{});
 const first=run();assert.equal(await store.append(first,0,()=>{}),1);
 const sources={inspections:{imported:structuredClone(first.content.sources.inspections.imported)}};
 const sourceReceipt=await store.stageSources(sources,1,()=>{});assert.equal(sourceReceipt.inspectionRows,1);assert.equal(sourceReceipt.defectRows,null);assert.deepEqual(await store.stageSources(sources,1,()=>{}),sourceReceipt);
 const beforeSourceViews=store.sourceViews();assert.equal(beforeSourceViews.entries.length,1);assert.equal('rows' in beforeSourceViews.entries[0].inspections,false);
 sources.inspections.imported.table.rows[0][2]='999';assert.equal(store.readSources(sourceReceipt.sourceSnapshotId).inspections.imported.table.rows[0][2],'100');
 await assert.rejects(store.stageSources(sources,0,()=>{}),/generation-conflict/);await assert.rejects(store.stageSources(sources,1,()=>{throw new Error('revoked');}),/revoked/);
 await assert.rejects(store.stageSources({inspections:{imported:{...sources.inspections.imported,table:{...sources.inspections.imported.table,complete:false}}}},1,()=>{}));
 const summary=store.listRuns(0,1);assert.equal(summary.entries[0].contentHash,first.contentHash);assert.equal(summary.entries[0].inspectedQuantity,100);assert.equal('content' in summary.entries[0],false);assert.throws(()=>store.listRuns(0,21),/invalid/);assert.throws(()=>store.listRuns(0,1,0),/revision-conflict/);
 assert.equal(await store.append(first,0,()=>{}),1);
 const changed=structuredClone(run());changed.runId='r2';
 await assert.rejects(store.append(changed,0,()=>{}),/revision-conflict/);
 await assert.rejects(store.append(changed,1,()=>{throw new Error('revoked');}),/revoked/);
 const copy=store.history();copy.runs[0].content.statistics.summary.inspectedQuantity=9;
 assert.equal(store.history().runs[0].content.statistics.summary.inspectedQuantity,100);
 await store.close();await ctx.fiber.dispose();ctx=await boot(root);
 store=await QualityAnalysisRunStore.open(ctx.storageDomain,actor,'record1');assert.equal(store.history().runs.length,1);assert.equal(store.context().generation,1);assert.equal(store.context().configuration.title,'质量');assert.equal(store.readSources(sourceReceipt.sourceSnapshotId).inspections.imported.table.rows[0][0],'001');
 assert.deepEqual(store.sourceViews(),beforeSourceViews);
 const other=await QualityAnalysisRunStore.open(ctx.storageDomain,{...actor,principalId:'other'},'record1');assert.equal(other.history().runs.length,0);assert.deepEqual(other.sourceViews().entries,[]);assert.throws(()=>other.readSources(sourceReceipt.sourceSnapshotId),/source-not-found/);await other.close();
 const largeMetadata=structuredClone(sources);largeMetadata.inspections.imported.table.headers[0]='字段'.repeat(50000);
 await store.stageSources(largeMetadata,1,()=>{});
 assert.throws(()=>store.sourceViews(),/source-view-budget-exceeded/);
 await store.append(changed,1,()=>{});assert.equal(store.history().revision,2);
 }finally{await store?.close();await ctx?.fiber.dispose();await rm(root,{recursive:true,force:true});}
});

test('run service resolves Host identity and denies suspended members and switched accounts',async()=>{
 const root=await mkdtemp(join(tmpdir(),'quality-service-'));const ctx=await boot(root);
 let selected=actor,active=true;
 const identity={async resolve(){return {...selected};},profile(){return {principalId:selected.principalId,organization:{id:selected.organizationId},resolvedBy:selected.resolvedBy};},membership(){return {state:active?'active':'suspended'};}};
 const artifactPath=join(root,'artifact-worker.mjs');
 await build({entryPoints:[fileURLToPath(new URL('../src/runtime/artifact-worker.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',outfile:artifactPath});
 const artifacts=new QualityArtifactExecutor(pathToFileURL(artifactPath));
 const service=new QualityAnalysisRunService(ctx.storageDomain,identity,artifacts);
 try{
 const created=await service.createRecord('质量记录','create-record');
 assert.equal((await service.createRecord('质量记录','create-record')).id,created.id);
 await assert.rejects(service.createRecord('不同意图','create-record'),/operation-conflict/);
 await service.appendHostRun(created.id,run(),0);
 const sourceAdmission=await service.stageHostSources(created.id,{inspections:{imported:run().content.sources.inspections.imported}},0);assert.equal(sourceAdmission.inspectionRows,1);await assert.rejects(service.stageHostSources('missing',{inspections:{imported:run().content.sources.inspections.imported}},0),/record-not-found/);
 const view=await service.readRunView(created.id,'r1',run().contentHash,true);assert.equal(view.statistics.summary.inspectedQuantity,100);assert.equal(view.hasDefectSource,false);assert.ok(view.markdown.includes(run().contentHash));assert.equal('sources' in view,false);
 await assert.rejects(service.readRunView(created.id,'r1','b'.repeat(64),false),/run-hash-conflict/);
 view.statistics.summary.inspectedQuantity=0;assert.equal((await service.readRunView(created.id,'r1',run().contentHash,false)).statistics.summary.inspectedQuantity,100);
 assert.equal((await service.listRecords()).length,1);
 assert.equal((await service.history(created.id)).runs.length,1);
 await service.appendHostRun('record1',run(),0);
 const {LibraryManager}=await import(new URL('../../library/dist/index.js',import.meta.url));
 await ctx.plugin(LibraryManager,{root:join(root,'library')});
 const reportClient=createQualityRecordClient(async(path,init)=>handleQualityRecordsRequest(new Request('http://fixture'+path,init),service,undefined,undefined,ctx.workdshLibrary));
 const publicReport=await reportClient.saveReport(created.id,'r1',run().contentHash,'公开质量报告');
 assert.deepEqual(await reportClient.saveReport(created.id,'r1',run().contentHash,'公开质量报告'),publicReport);
 assert.equal((await service.history(created.id)).reports.length,1);
 assert.match(new TextDecoder().decode(await ctx.workdshLibrary.readOriginal(actor,publicReport.assetId,publicReport.revisionId)),/公开质量报告/);
 await assert.rejects(reportClient.saveReport(created.id,'r1','b'.repeat(64),'公开质量报告'),error=>error.status===409);
 const missingReports=await handleQualityRecordsRequest(new Request('http://fixture/api',{method:'POST',body:JSON.stringify({endpoint:'save-report',payload:{recordId:created.id,runId:'r1',contentHash:run().contentHash,title:'公开质量报告'}})}),service);
 assert.equal(missingReports.status,503);
 const malformedClient=createQualityRecordClient(async()=>Response.json({ok:true,value:{...publicReport,runId:'foreign',format:'markdown',detailKind:'markdown'}}));
 await assert.rejects(malformedClient.saveReport(created.id,'r1',run().contentHash,'公开质量报告'));
 const interpretationSource={recordId:created.id,runId:'r1',contentHash:run().contentHash,sessionId:`session-${createHash('sha256').update(JSON.stringify(['workdsh-quality-analysis',actor.organizationId,actor.principalId,created.id,'r1',run().contentHash])).digest('hex').slice(0,32)}`,eventSeq:10,turn:1,text:'核查抽样方式；目前不能推断缺陷原因。'};
 const interpretation={...interpretationSource,candidateHash:createHash('sha256').update(JSON.stringify(interpretationSource)).digest('hex')};
 const beforeInterpretation=await service.history(created.id);
 const interpretationClient=createQualityRecordClient(async(path,init)=>handleQualityRecordsRequest(new Request('http://fixture'+path,init),service,undefined,undefined,ctx.workdshLibrary,undefined,undefined,async()=>interpretation));
 assert.deepEqual(await interpretationClient.aiCandidate(created.id,'r1',run().contentHash),interpretation);
 const adopted=await interpretationClient.adoptInterpretation(created.id,'r1',run().contentHash,interpretation.candidateHash);
 assert.deepEqual(await interpretationClient.adoptInterpretation(created.id,'r1',run().contentHash,interpretation.candidateHash),adopted);
 assert.deepEqual(await service.history(created.id),beforeInterpretation);
 const interpretationMarkdown=new TextDecoder().decode(await ctx.workdshLibrary.readOriginal(actor,adopted.assetId,adopted.revisionId));assert.match(interpretationMarkdown,/核查抽样方式/);assert.ok(interpretationMarkdown.includes(interpretation.candidateHash));assert.ok(interpretationMarkdown.includes(interpretation.sessionId));
 await assert.rejects(interpretationClient.adoptInterpretation(created.id,'r1',run().contentHash,'b'.repeat(64)),error=>error.status===409);
 await assert.rejects(service.adoptInterpretation({...interpretation,sessionId:'session-foreign'},ctx.workdshLibrary),/access-denied/);
 await assert.rejects(service.adoptInterpretation({...interpretation,text:'tampered'},ctx.workdshLibrary),/candidate-conflict/);
 const statisticsReceipt=await reportClient.saveStatistics(created.id,'r1',run().contentHash,'公开统计表','trend');
 assert.deepEqual(await reportClient.saveStatistics(created.id,'r1',run().contentHash,'公开统计表','trend'),statisticsReceipt);
 const statisticsBytes=await ctx.workdshLibrary.readOriginal(actor,statisticsReceipt.assetId,statisticsReceipt.revisionId);
 assert.match(new TextDecoder().decode(statisticsBytes),/周期起始日期/);
 await assert.rejects(reportClient.saveStatistics(created.id,'r1','b'.repeat(64),'公开统计表','trend'),error=>error.status===409);
 const receipt=await service.saveReport('record1','r1','质量报告',ctx.workdshLibrary);
 assert.deepEqual(await service.saveReport('record1','r1','质量报告',ctx.workdshLibrary),receipt);
 assert.equal((await service.history('record1')).reports.length,1);
 const {ProjectManager}=await import(new URL('../../projects/dist/index.js',import.meta.url));
 await ctx.plugin(ProjectManager);
 const project=await ctx.workdshProjects.create(actor,{name:'质量改善项目'});
 const projectClient=createQualityRecordClient(async(path,init)=>handleQualityRecordsRequest(new Request('http://fixture'+path,init),service,undefined,undefined,ctx.workdshLibrary,ctx.workdshProjects));
 const choices=await projectClient.projects();assert.deepEqual(choices,[{id:project.project.id,name:'质量改善项目'}]);
 const publicLink=await projectClient.linkReport(created.id,publicReport.operationId,project.project.id,publicReport);
 assert.equal((await projectClient.linkReport(created.id,publicReport.operationId,project.project.id,publicReport)).id,publicLink.id);
 assert.equal((await service.history(created.id)).projectLinks.length,1);
 await assert.rejects(projectClient.linkReport(created.id,publicReport.operationId,'missing',publicReport));
 assert.equal((await service.history(created.id)).reports.length,2);
 const wrongLink=createQualityRecordClient(async()=>Response.json({ok:true,value:{...publicLink,projectId:'foreign'}}));await assert.rejects(wrongLink.linkReport(created.id,publicReport.operationId,project.project.id,publicReport));
 // Remove this extra test reference so the existing independent core assertions retain their scope.
 await ctx.workdshProjects.removeAsset(actor,project.project.id,publicLink.id);
 const linked=await service.linkReport('record1',receipt.operationId,project.project.id,ctx.workdshLibrary,ctx.workdshProjects);
 assert.equal(linked.assetId,receipt.assetId);
 const again=await service.linkReport('record1',receipt.operationId,project.project.id,ctx.workdshLibrary,ctx.workdshProjects);
 assert.equal(again.id,linked.id);assert.equal((await ctx.workdshProjects.get(actor,project.project.id)).assets.length,1);
 assert.equal((await service.history('record1')).projectLinks.length,1);
 await ctx.workdshProjects.removeAsset(actor,project.project.id,linked.id);
 const restored=await service.linkReport('record1',receipt.operationId,project.project.id,ctx.workdshLibrary,ctx.workdshProjects);
 assert.notEqual(restored.id,linked.id);assert.equal((await service.history('record1')).projectLinks.length,2);
 await assert.rejects(service.linkReport('record1',receipt.operationId,'missing',ctx.workdshLibrary,ctx.workdshProjects),/not-found/);
 assert.equal((await service.history('record1')).reports.length,1);
 await assert.rejects(service.saveReport('record1','missing','质量报告',ctx.workdshLibrary),/run-not-found/);
 assert.equal((await service.history('record1')).runs.length,1);
 selected={...actor,principalId:'other'};await assert.rejects(service.listSourceViews(created.id),/record-not-found/);await assert.rejects(service.getRecord(created.id),/record-not-found/);await assert.rejects(service.readRunView(created.id,'r1',run().contentHash,false),/record-not-found/);assert.equal((await service.history('record1')).runs.length,0);assert.equal((await service.listRecords()).length,0);
 active=false;await assert.rejects(service.history('record1'),/access-denied/);
 await assert.rejects(service.appendHostRun('record1',run(),0),/access-denied/);
 active=true;selected=actor;assert.equal((await service.history('record1')).runs.length,1);
 const csv=await service.saveStatistics('record1','r1','质量明细','trend',ctx.workdshLibrary);
 assert.equal(csv.format,'csv');assert.equal(csv.detailKind,'trend');
 assert.deepEqual(await service.saveStatistics('record1','r1','质量明细','trend',ctx.workdshLibrary),csv);
 const csvBytes=await ctx.workdshLibrary.readOriginal(actor,csv.assetId,csv.revisionId);
 assert.ok(new TextDecoder().decode(csvBytes).includes('0.01'));
 assert.equal((await service.history('record1')).reports.length,2);

 const controller=new AbortController();controller.abort();await assert.rejects(service.history('record1',controller.signal),{name:'AbortError'});
 await service.close();await assert.rejects(service.history('record1'),/closed/);
 const reopened=new QualityAnalysisRunService(ctx.storageDomain,identity);try{assert.equal((await reopened.listSourceViews(created.id)).entries[0].sourceSnapshotId,sourceAdmission.sourceSnapshotId);assert.equal((await reopened.listRecords())[0].id,created.id);assert.equal((await reopened.history(created.id)).runs.length,1);assert.equal((await reopened.history('record1')).reports.length,2);assert.equal((await reopened.history('record1')).projectLinks.length,2);}finally{await reopened.close();}
 }finally{await service.close();await artifacts.close();await ctx.fiber.dispose();await rm(root,{recursive:true,force:true});}
});

test('real worker analysis saves under initiating actor and stale context cannot commit',async()=>{
 const root=await mkdtemp(join(tmpdir(),'quality-analysis-save-'));const ctx=await boot(root);
 const workerPath=join(root,'analysis-worker.mjs');
 await build({entryPoints:[fileURLToPath(new URL('../src/runtime/analysis-worker.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',outfile:workerPath});
 const csvPath=join(root,'csv-worker.mjs');await build({entryPoints:[fileURLToPath(new URL('../src/runtime/csv-worker.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',outfile:csvPath});const csv=new QualityCsvImporter(pathToFileURL(csvPath));
 const executor=new QualityAnalysisExecutor(pathToFileURL(workerPath));let selected=actor;
 const identity={async resolve(){return {...selected};},profile(){return {principalId:selected.principalId,organization:{id:selected.organizationId},resolvedBy:selected.resolvedBy};},membership(){return {state:'active'};}};
 let service=new QualityAnalysisRunService(ctx.storageDomain,identity);
 const reference=run();const request={runId:'real-worker',createdAt:reference.createdAt,sourceNamespace:'fixture',rules:reference.content.rules,inspections:reference.content.sources.inspections};
 try{
 const configured=await service.createRecord('已配置分析','configured-record');
 const {LibraryManager}=await import(new URL('../../library/dist/index.js',import.meta.url));await ctx.plugin(LibraryManager,{root:join(root,'library')});
 const file=await ctx.workdshLibrary.importAsset(actor,{name:'inspection.csv',bytes:new TextEncoder().encode('id,date,total,bad,unit,type\n001,2026-10-10,100,1,piece,initial'),operationId:'csv-input'});
 const importPayload={recordId:configured.id,reference:{assetId:file.asset.id,revisionId:file.revision.id},format:'csv',tableKind:'inspections',headerRow:1,expectedGeneration:0};
 const importRequest=payload=>new Request('http://fixture/api',{method:'POST',body:JSON.stringify({endpoint:'import-library',payload})});
 assert.equal((await handleQualityRecordsRequest(importRequest(importPayload),service,executor)).status,503);
 const importedResponse=await handleQualityRecordsRequest(importRequest(importPayload),service,executor,{library:ctx.workdshLibrary,csv});assert.equal(importedResponse.status,200);const admitted=(await importedResponse.json()).value;assert.equal(admitted.status,'ready');assert.equal(admitted.inspectionRows,1);assert.deepEqual(admitted.inspectionHeaders,['id','date','total','bad','unit','type']);
 assert.equal((await handleQualityRecordsRequest(importRequest({...importPayload,principalId:'other'}),service,executor,{library:ctx.workdshLibrary,csv})).status,400);
 assert.equal((await handleQualityRecordsRequest(importRequest({...importPayload,reference:{...importPayload.reference,revisionId:'missing'}}),service,executor,{library:ctx.workdshLibrary,csv})).status,403);
 const boundConfiguration={inspectionsMapping:reference.content.sources.inspections.mapping,rules:reference.content.rules,filter:{trendGranularity:'month'}};
 const rpc=(endpoint,payload,worker=executor)=>handleQualityRecordsRequest(new Request('http://fixture/api',{method:'POST',body:JSON.stringify({endpoint,payload})}),service,worker);
 const configuredClient=createQualityRecordClient(async(path,init)=>handleQualityRecordsRequest(new Request('http://fixture'+path,init),service,executor));
 await service.close();service=new QualityAnalysisRunService(ctx.storageDomain,identity);
 const savedSources=await configuredClient.sources(configured.id);
 assert.equal(savedSources.entries.length,1);assert.equal(savedSources.entries[0].sourceSnapshotId,admitted.sourceSnapshotId);
 assert.deepEqual(savedSources.entries[0].inspections.headers,admitted.inspectionHeaders);
 assert.equal(savedSources.entries[0].inspections.rowCount,1);
 assert.equal('rows' in savedSources.entries[0].inspections,false);
 assert.equal((await rpc('sources',{recordId:'missing'})).status,404);
 assert.equal((await rpc('sources',{recordId:configured.id,principalId:'other'})).status,400);

 const configurePayload={recordId:configured.id,title:'已配置分析',sourceNamespace:'fixture',sourceSnapshotId:admitted.sourceSnapshotId,analysis:boundConfiguration,expectedGeneration:0};
 const configuredReceipt=await configuredClient.configure(configured.id,'已配置分析','fixture',savedSources.entries[0].sourceSnapshotId,boundConfiguration,savedSources.generation);assert.equal(configuredReceipt.generation,1);const loadedConfiguration=await configuredClient.configuration(configured.id);assert.equal(loadedConfiguration.analysis.filter.trendGranularity,'month');assert.equal(loadedConfiguration.inspections.rowCount,1);assert.equal('rows' in loadedConfiguration.inspections,false);assert.deepEqual(loadedConfiguration.analysis.inspectionsMapping,boundConfiguration.inspectionsMapping);
 assert.equal((await rpc('configure',{...configurePayload,principalId:'other'})).status,400);assert.equal((await rpc('configure',configurePayload)).status,409);
 assert.equal((await rpc('configure',{...configurePayload,expectedGeneration:1,analysis:{...boundConfiguration,inspectionsMapping:{...boundConfiguration.inspectionsMapping,inspectionDate:'id'}}})).status,400);
 assert.equal(await service.bindSourceConfiguration(configured.id,'已配置分析','fixture',admitted.sourceSnapshotId,boundConfiguration,1),1);
 await assert.rejects(service.bindSourceConfiguration(configured.id,'已配置分析','fixture','missing',boundConfiguration,1),/source-not-found/);
 const analysisReceipt=await configuredClient.analyze(configured.id,0);assert.equal('content' in analysisReceipt.run,false);const configuredRun={status:analysisReceipt.status,run:(await service.history(configured.id)).runs[0]};assert.equal(configuredRun.status,'saved');assert.equal(configuredRun.run.content.statistics.trend[0].date,'2026-10-01');assert.equal(configuredRun.run.content.statistics.summary.inspectedQuantity,100);assert.equal(configuredRun.run.content.statistics.summary.nonconformingQuantity,1);
 let sessionCalls=0;
 const sessionAdapter=async(view)=>{sessionCalls++;return {recordId:view.recordId,runId:view.runId,contentHash:view.contentHash,sessionId:'session-'+ 'c'.repeat(32)};};
 const sessionClient=createQualityRecordClient(async(path,init)=>handleQualityRecordsRequest(new Request('http://fixture'+path,init),service,executor,undefined,undefined,undefined,sessionAdapter));
 const sessionReceipt=await sessionClient.aiSession(configured.id,configuredRun.run.runId,configuredRun.run.contentHash);
 assert.equal(sessionReceipt.runId,configuredRun.run.runId);assert.equal(sessionCalls,1);
 await assert.rejects(sessionClient.aiSession(configured.id,configuredRun.run.runId,'f'.repeat(64)),error=>error.status===409);assert.equal(sessionCalls,1);
 await assert.rejects(configuredClient.aiSession(configured.id,configuredRun.run.runId,configuredRun.run.contentHash),error=>error.status===503);
 const wrongSessionClient=createQualityRecordClient(async()=>Response.json({ok:true,value:{...sessionReceipt,runId:'other'}}));
 await assert.rejects(wrongSessionClient.aiSession(configured.id,configuredRun.run.runId,configuredRun.run.contentHash),error=>error.code==='quality/response/invalid');
 await service.close();service=new QualityAnalysisRunService(ctx.storageDomain,identity);const restored=await service.analyzeConfiguredAndSave(configured.id,1,executor);assert.equal(restored.status,'saved');assert.equal(restored.run.contentHash,configuredRun.run.contentHash);assert.notEqual(restored.run.runId,configuredRun.run.runId);
 const changedBoundExecutor={async execute(input,signal){const result=await executor.execute(input,signal);await service.bindSourceConfiguration(configured.id,'已配置分析','fixture',admitted.sourceSnapshotId,{...boundConfiguration,filter:{trendGranularity:'week'}},1);return result;}};
 await assert.rejects(service.analyzeConfiguredAndSave(configured.id,2,changedBoundExecutor),/generation-conflict/);assert.equal((await service.history(configured.id)).runs.length,2);assert.equal((await service.history(configured.id)).runs[0].content.filter.trendGranularity,'month');
 const cleanConfig=await service.readConfiguration(configured.id);
 const clientRows=await configuredClient.cleaningRows(configured.id,'inspections',0,cleanConfig.generation);assert.equal(clientRows.rows[0].values[3],'1');assert.ok(Object.isFrozen(clientRows.rows[0].values));
 const rowsResponse=await rpc('cleaning-rows',{recordId:configured.id,tableKind:'inspections',offset:0,limit:20,expectedGeneration:cleanConfig.generation});assert.equal(rowsResponse.status,200);
 const originalPage=(await rowsResponse.json()).value;assert.equal(originalPage.rows[0].values[3],'1');assert.equal(originalPage.rows[0].row,1);assert.equal(originalPage.total,1);assert.equal(originalPage.sourceSnapshotId,cleanConfig.sourceSnapshotId);
 originalPage.rows[0].values[3]='forged';assert.equal((await service.readCleaningRows(configured.id,'inspections',0,20,cleanConfig.generation)).rows[0].values[3],'1');
 assert.equal((await rpc('cleaning-rows',{recordId:configured.id,tableKind:'inspections',offset:0,limit:21,expectedGeneration:cleanConfig.generation})).status,400);
 assert.equal((await rpc('cleaning-rows',{recordId:configured.id,tableKind:'inspections',offset:0,limit:20,expectedGeneration:0})).status,409);
 const cleaning={sourceSnapshotId:cleanConfig.sourceSnapshotId,expectedGeneration:cleanConfig.generation,inspections:[{kind:'correct',row:1,header:'bad',expected:'1',value:'2',reason:'核对检验原单'}]};
 const clientDraft=await configuredClient.saveCleaningDraft(configured.id,cleaning,0);assert.equal(clientDraft.revision,1);assert.deepEqual((await configuredClient.cleaningDraft(configured.id)).draft,cleaning);
 assert.equal((await rpc('save-cleaning-draft',{recordId:configured.id,draft:cleaning,expectedRevision:0})).status,409);
 await service.close();service=new QualityAnalysisRunService(ctx.storageDomain,identity);
 const restoredDraft=await service.readCleaningDraft(configured.id);assert.equal(restoredDraft.revision,1);assert.deepEqual(restoredDraft.draft,cleaning);
 restoredDraft.draft.inspections[0].value='forged';assert.equal((await service.readCleaningDraft(configured.id)).draft.inspections[0].value,'2');
 const cleanReceipt=await configuredClient.analyze(configured.id,2,undefined,cleaning);assert.equal(cleanReceipt.status,'saved');assert.deepEqual(await service.readCleaningDraft(configured.id),{revision:2,draft:null});
 const cleanedRun=(await service.history(configured.id)).runs.find(value=>value.runId===cleanReceipt.run.runId);
 assert.equal(cleanedRun.content.statistics.summary.nonconformingQuantity,2);
 assert.equal(cleanedRun.content.cleaning.inspections[0].actor.principalId,actor.principalId);
 assert.equal(cleanedRun.content.cleaning.inspections[0].reason,'核对检验原单');
 assert.equal((await service.history(configured.id)).runs[0].content.statistics.summary.nonconformingQuantity,1);
 assert.equal((await rpc('analyze',{recordId:configured.id,expectedRevision:3,cleaning:{...cleaning,expectedGeneration:0}})).status,409);
 assert.equal((await rpc('analyze',{recordId:configured.id,expectedRevision:3,cleaning:{...cleaning,inspections:[{...cleaning.inspections[0],expected:'wrong'}]}})).status,400);
 assert.equal((await service.history(configured.id)).runs.length,3);
 const nextCleaning={...cleaning,inspections:[{...cleaning.inspections[0],value:'3'}]};await service.saveCleaningDraft(configured.id,nextCleaning,2);
 const laterCleaning={...cleaning,inspections:[{...cleaning.inspections[0],value:'4'}]};
 const concurrentDraftWorker={async execute(input,signal){const result=await executor.execute(input,signal);await service.saveCleaningDraft(configured.id,laterCleaning,3);return result;}};
 const nextRun=await service.analyzeConfiguredAndSave(configured.id,3,concurrentDraftWorker,undefined,nextCleaning);assert.equal(nextRun.status,'saved');assert.equal(nextRun.run.content.statistics.summary.nonconformingQuantity,3);
 assert.deepEqual(await service.readCleaningDraft(configured.id),{revision:4,draft:laterCleaning});

 const saved=await service.analyzeAndSave('record',request,0,executor,()=>{});
 assert.equal(saved.status,'saved');assert.equal((await service.history('record')).runs.length,1);
 const {ProjectManager}=await import(new URL('../../projects/dist/index.js',import.meta.url));await ctx.plugin(ProjectManager);
 const project=await ctx.workdshProjects.create(actor,{name:'分析项目'});
 const selection={projectId:project.project.id,projects:ctx.workdshProjects};
 const projectRun=await service.analyzeAndSave('project-record',{...request,runId:'project-run'},0,executor,()=>{},undefined,selection);
 assert.equal(projectRun.run.content.projectContext.configRevisionId,project.config.id);
 await ctx.workdshProjects.updateConfig(actor,project.project.id,{instruction:'新的项目指令',capabilities:[]},project.config.id);
 assert.equal((await service.history('project-record')).runs[0].content.projectContext.configRevisionId,project.config.id);
 await ctx.workdshProjects.archive(actor,project.project.id);
 await assert.rejects(service.analyzeAndSave('project-record',{...request,runId:'archived'},1,executor,()=>{},undefined,selection),/projects\/not-found/);

 const changedIdentityExecutor={async execute(input,signal){const result=await executor.execute(input,signal);selected={...actor,principalId:'other'};return result;}};
 await assert.rejects(service.analyzeAndSave('record',{...request,runId:'switched'},1,changedIdentityExecutor,()=>{}),/access-denied/);
 assert.equal((await service.history('record')).runs.length,0);selected=actor;
 assert.equal((await service.history('record')).runs.length,1);
 let checks=0;
 await assert.rejects(service.analyzeAndSave('record',{...request,runId:'stale'},1,executor,()=>{if(++checks>2)throw new Error('record-generation-conflict');}),/generation-conflict/);
 assert.equal((await service.history('record')).runs.length,1);
 const configuration={title:'质量分析',sourceNamespace:'fixture',timeZone:'UTC',mappingRevision:'mapping1',sourceSnapshotId:'snapshot1'};
 const changedConfigurationExecutor={async execute(input,signal){const result=await executor.execute(input,signal);await service.configure('record',configuration,0);return result;}};
 await assert.rejects(service.analyzeAndSave('record',{...request,runId:'configuration-changed'},1,changedConfigurationExecutor,()=>{}),/generation-conflict/);
 const history=await service.history('record');assert.equal(history.generation,1);assert.equal(history.runs.length,1);
 assert.equal(await service.configure('record',configuration,1),1);
 await assert.rejects(service.configure('record',{...configuration,title:'新版'},0),/generation-conflict/);
 }finally{await csv.close();await executor.close();await service.close();await ctx.fiber.dispose();await rm(root,{recursive:true,force:true});}
});

test('record RPC uses real Host identity and storage, rejects identity claims and bounds request bodies',async()=>{
 const root=await mkdtemp(join(tmpdir(),'quality-rpc-'));const ctx=await boot(root);let active=true;
 const identity={async resolve(){return {...actor};},profile(){return {principalId:actor.principalId,organization:{id:actor.organizationId},resolvedBy:actor.resolvedBy};},membership(){return {state:active?'active':'suspended'};}};
 const service=new QualityAnalysisRunService(ctx.storageDomain,identity);
 const call=body=>handleQualityRecordsRequest(new Request('http://fixture/api',{method:'POST',body:JSON.stringify(body)}),service);
 try{
  const input={endpoint:'create',payload:{title:'九月质量',operationId:'rpc-create'}};
  const first=await call(input);assert.equal(first.status,200);const created=(await first.json()).value;
  assert.equal((await (await call(input)).json()).value.id,created.id);
  assert.equal((await call({...input,payload:{...input.payload,title:'不同意图'}})).status,409);
  assert.equal((await call({endpoint:'list',payload:{}})).status,200);
  assert.equal((await call({endpoint:'list',payload:{principalId:'other'}})).status,400);
  assert.equal((await call({...input,organizationId:'other'})).status,400);
  assert.equal((await call({endpoint:'create',payload:{title:'x'.repeat(17000),operationId:'large'}})).status,413);
  const bad=new Request('http://fixture/api',{method:'POST',body:new Uint8Array([255])});assert.equal((await handleQualityRecordsRequest(bad,service)).status,400);
  active=false;assert.equal((await call({endpoint:'list',payload:{}})).status,403);
  assert.equal((await call(input)).status,403);
  active=true;assert.equal((await service.listRecords()).length,1);
  const controller=new AbortController();controller.abort();assert.equal((await handleQualityRecordsRequest(new Request('http://fixture/api',{method:'POST',body:'{}',signal:controller.signal}),service)).status,408);
 }finally{await service.close();await ctx.fiber.dispose();await rm(root,{recursive:true,force:true});}
});

test('record browser client round-trips real handler and keeps retry identity while rejecting malformed responses',async()=>{
 const root=await mkdtemp(join(tmpdir(),'quality-client-'));const ctx=await boot(root);let active=true;
 const identity={async resolve(){return {...actor};},profile(){return {principalId:actor.principalId,organization:{id:actor.organizationId},resolvedBy:actor.resolvedBy};},membership(){return {state:active?'active':'suspended'};}};
 const service=new QualityAnalysisRunService(ctx.storageDomain,identity);
 const transport=async(path,init)=>{assert.equal(path,'/api/workdsh-quality-records');assert.equal(init.credentials,'same-origin');return handleQualityRecordsRequest(new Request('http://fixture'+path,init),service);};
 const client=createQualityRecordClient(transport);
 try{
  const first=await client.create(' 首轮分析 ','client-create');assert.equal(first.title,'首轮分析');assert.ok(Object.isFrozen(first));
  assert.equal((await client.create('首轮分析','client-create')).id,first.id);
  const rows=await client.list();assert.equal(rows.length,1);assert.ok(Object.isFrozen(rows));
  active=false;await assert.rejects(client.list(),error=>error instanceof QualityRecordRequestError&&error.status===403);active=true;
  const malformed=createQualityRecordClient(async()=>Response.json({ok:true,value:[first,first]}));await assert.rejects(malformed.list(),/记录操作未完成/);
  const mismatch=createQualityRecordClient(async()=>Response.json({ok:true,value:{...first,operationId:'wrong'}}));await assert.rejects(mismatch.create('首轮分析','client-create'),/记录操作未完成/);
  const badPage=createQualityRecordClient(async()=>Response.json({ok:true,value:{revision:1,offset:0,total:2,entries:[]}}));await assert.rejects(badPage.runs(first.id),/记录操作未完成/);
  const invalid=createQualityRecordClient(async()=>new Response('not json'));await assert.rejects(invalid.list(),/记录操作未完成/);
  const controller=new AbortController();controller.abort();await assert.rejects(client.list(controller.signal),error=>error.name==='AbortError');
 }finally{await service.close();await ctx.fiber.dispose();await rm(root,{recursive:true,force:true});}
});

test('quality Host composition registers streaming route and disposes storage service with its owner',async()=>{
 const root=await mkdtemp(join(tmpdir(),'quality-host-'));const ctx=await boot(root);let route,service,plugin;
 ctx.provide('workdshIdentity',{async resolve(){return {...actor};},profile(){return {principalId:actor.principalId,organization:{id:actor.organizationId},resolvedBy:actor.resolvedBy};},membership(){return {state:'active'};}});
 // This observes official Cordis lifecycle, not connection admission or an installed Profile.
 ctx.provide('connection',{fetch:{register(value){route=value;return()=>{route=undefined;};}}});
 try{
  plugin=await ctx.plugin({name:'quality-host-probe',apply(child){service=mountQualityRecordsHost(child);}});
  assert.equal(route.path,'/api/workdsh-quality-records');assert.equal(route.requestBody,'streaming');assert.deepEqual(route.methods,['POST']);
  const client=createQualityRecordClient(async(path,init)=>route.fetch(new Request('http://fixture'+path,init)));
  const created=await client.create('宿主记录','host-create');assert.equal((await client.list())[0].id,created.id);
  assert.equal((await client.get(created.id)).generation,0);
  await service.appendHostRun(created.id,run(),0);
  const viewRequest=includeReport=>route.fetch(new Request('http://fixture'+route.path,{method:'POST',body:JSON.stringify({endpoint:'run-view',payload:{recordId:created.id,runId:'r1',contentHash:run().contentHash,includeReport}})}));
  const viewResponse=await viewRequest(false);assert.equal(viewResponse.status,200);const result=(await viewResponse.json()).value;assert.equal(result.statistics.summary.inspectedQuantity,100);assert.equal('dataset' in result,false);assert.equal((await viewRequest(true)).status,503);
  const restored=await client.view(created.id,'r1',run().contentHash);assert.equal(restored.statistics.summary.inspectedQuantity,100);assert.ok(Object.isFrozen(restored.statistics.summary));
  const wrong=createQualityRecordClient(async()=>Response.json({ok:true,value:{...result,runId:'foreign'}}));await assert.rejects(wrong.view(created.id,'r1',run().contentHash),/记录操作未完成/);
  const malformedResult=structuredClone(result);malformedResult.statistics.summary.nonconformingQuantity=999;const malformedView=createQualityRecordClient(async()=>Response.json({ok:true,value:malformedResult}));await assert.rejects(malformedView.view(created.id,'r1',run().contentHash),/记录操作未完成/);
  await assert.rejects(client.view(created.id,'r1',run().contentHash,true),error=>error.status===503);
  const page=await route.fetch(new Request('http://fixture'+route.path,{method:'POST',body:JSON.stringify({endpoint:'runs',payload:{recordId:created.id,offset:0,limit:20}})}));
  assert.equal(page.status,200);const summaries=(await page.json()).value;assert.equal(summaries.total,1);assert.equal(summaries.entries[0].runId,'r1');assert.equal('content' in summaries.entries[0],false);
  const clientPage=await client.runs(created.id,0,1);assert.equal(clientPage.entries[0].contentHash,run().contentHash);assert.ok(Object.isFrozen(clientPage.entries));
  const nextRun=structuredClone(run());nextRun.runId='r2';await service.appendHostRun(created.id,nextRun,1);
  await assert.rejects(client.runs(created.id,1,1,clientPage.revision),error=>error.code==='quality/store/revision-conflict');
  const refreshed=await client.runs(created.id,0,1);assert.equal(refreshed.entries[0].runId,'r2');assert.equal((await client.runs(created.id,1,1,refreshed.revision)).entries[0].runId,'r1');
  const stale=await route.fetch(new Request('http://fixture'+route.path,{method:'POST',body:JSON.stringify({endpoint:'runs',payload:{recordId:created.id,offset:0,limit:20,expectedRevision:0}})}));assert.equal(stale.status,409);
  await service.configure(created.id,{title:'宿主记录',sourceNamespace:'fixture',timeZone:'UTC',mappingRevision:'m1',sourceSnapshotId:'s1'},0);
  assert.equal((await client.get(created.id)).configuration.mappingRevision,'m1');
  const controller=new QualityRecordController(client);await controller.refresh();const opened=await controller.open(created.id);assert.equal(opened.id,created.id);assert.equal(opened.generation,1);
  const selected=(await client.runs(opened.id,0,1)).entries[0];const selectedView=await client.view(opened.id,selected.runId,selected.contentHash);assert.equal(selectedView.runId,'r2');assert.equal(selectedView.statistics.summary.inspectedQuantity,100);controller.dispose();
  await assert.rejects(client.get('missing'),error=>error.status===404);
  await plugin.dispose();plugin=undefined;assert.equal(route,undefined);await assert.rejects(service.listRecords(),/quality\/service\/closed/);
  plugin=await ctx.plugin({name:'quality-host-reopen',apply(child){service=mountQualityRecordsHost(child);}});
  assert.equal((await service.listRecords())[0].id,created.id);assert.equal((await service.getRecord(created.id)).generation,1);
 }finally{await plugin?.dispose();await ctx.fiber.dispose();await rm(root,{recursive:true,force:true});}
});

test('record controller retains retry intent, reconciles unknown success and ignores late disposed results',async()=>{
 const record={id:'record',title:'质量',createdAt:'2026-10-10T00:00:00Z',operationId:'intent'};let calls=0,known=[];
 const controller=new QualityRecordController({get:async()=>({...record,revision:0,generation:0}),list:async()=>known,create:async(title,op)=>{assert.equal(op,'intent');calls++;if(calls===1)throw new Error('network');return record;}},()=> 'intent');
 assert.equal(await controller.create('质量'),undefined);assert.equal(controller.snapshot().pendingTitle,'质量');
 await assert.rejects(controller.create('另一个名称'),/pending-intent/);
 assert.equal((await controller.create('质量')).id,'record');assert.equal(controller.snapshot().records.length,1);assert.equal(controller.snapshot().pendingTitle,undefined);
 controller.dispose();await assert.rejects(controller.refresh(),/closed/);
 let resolve;const late=new QualityRecordController({get:async()=>({...record,revision:0,generation:0}),list:()=>new Promise(done=>{resolve=done;}),create:async()=>record});
 const request=late.refresh();late.dispose();resolve([record]);await request;assert.equal(late.snapshot().records.length,0);
 const ambiguous=new QualityRecordController({get:async()=>({...record,revision:0,generation:0}),list:async()=>[record],create:async()=>{throw new Error('lost receipt');}},()=> 'intent');
 await ambiguous.create('质量');await ambiguous.refresh();assert.equal(ambiguous.snapshot().pendingTitle,undefined);assert.equal(ambiguous.snapshot().records.length,1);ambiguous.dispose();
});

test('interpretation receipts restore after cold storage open and cannot cross runs or owners',async()=>{
 const root=await mkdtemp(join(tmpdir(),'quality-interpretation-store-'));let ctx,store;
 try{ctx=await boot(root);store=await QualityAnalysisRunStore.open(ctx.storageDomain,actor,'record1');const snapshot=run();await store.append(snapshot,0,()=>{});
 const receipt={recordId:'record1',runId:snapshot.runId,contentHash:snapshot.contentHash,candidateHash:'c'.repeat(64),assetId:'asset',revisionId:'revision',operationId:'quality-interpretation-'+'c'.repeat(64)};
 await store.rememberInterpretation(receipt,()=>{});await store.rememberInterpretation(receipt,()=>{});assert.deepEqual(store.listInterpretations(snapshot.runId,snapshot.contentHash),[receipt]);
 await assert.rejects(store.rememberInterpretation({...receipt,recordId:'other'},()=>{}),/source-mismatch/);
 await assert.rejects(store.rememberInterpretation({...receipt,assetId:'different'},()=>{}),/receipt-conflict/);
 await assert.rejects(store.rememberInterpretation({...receipt,candidateHash:'d'.repeat(64),operationId:'quality-interpretation-'+'d'.repeat(64)},()=>{throw Error('revoked');}),/revoked/);
 const before=store.history();await store.close();await ctx.fiber.dispose();ctx=await boot(root);store=await QualityAnalysisRunStore.open(ctx.storageDomain,actor,'record1');assert.deepEqual(store.listInterpretations(snapshot.runId,snapshot.contentHash),[receipt]);assert.deepEqual(store.history(),before);
 const other=await QualityAnalysisRunStore.open(ctx.storageDomain,{...actor,principalId:'other'},'record1');assert.throws(()=>other.listInterpretations(snapshot.runId,snapshot.contentHash),/run-not-found/);await other.close();
 }finally{await store?.close();await ctx?.fiber.dispose();await rm(root,{recursive:true,force:true});}
});

test('expert run associations persist independently, cannot rebind a task, and preserve statistics',async()=>{
 const root=await mkdtemp(join(tmpdir(),'quality-expert-association-'));let ctx,store;
 try{
  ctx=await boot(root);store=await QualityAnalysisRunStore.open(ctx.storageDomain,actor,'record1');
  const first=run();await store.append(first,0,()=>{});const before=store.history();
  const association={recordId:'record1',runId:first.runId,contentHash:first.contentHash,sessionId:'session-expert',expertId:'expert',expertRevisionId:'revision',compositionDigest:'b'.repeat(64),creationOperationId:'create-expert'};
  const plan={recordId:'record1',runId:first.runId,contentHash:first.contentHash,executionPlanId:'plan-1',operationId:'create-plan-1',expertId:'expert',expertRevisionId:'revision',expiresAt:'2026-10-11T00:10:00Z',instruction:'固定运行的质量分析提示词'};
  await store.rememberExpertPlan(plan,()=>{});await store.rememberExpertPlan({...plan},()=>{});
  assert.deepEqual(store.readExpertPlan(first.runId,first.contentHash,'plan-1'),plan);
  await assert.rejects(store.rememberExpertPlan({...plan,expertId:'other'},()=>{}),/plan-conflict/);
  assert.throws(()=>store.readExpertPlan(first.runId,first.contentHash,'unrelated-plan'),/plan-not-found/);
  await store.rememberExpertAssociation(association,()=>{});await store.rememberExpertAssociation({...association},()=>{});
  assert.deepEqual(store.history(),before);assert.deepEqual(store.listExpertAssociations(first.runId,first.contentHash),[association]);
  const copy=store.listExpertAssociations(first.runId,first.contentHash);copy[0].expertId='changed';assert.equal(store.listExpertAssociations(first.runId,first.contentHash)[0].expertId,'expert');
  await assert.rejects(store.rememberExpertAssociation({...association,expertRevisionId:'other'},()=>{}),/association-conflict/);
  await assert.rejects(store.rememberExpertAssociation({...association,sessionId:'different'},()=>{}),/association-conflict/);
  await assert.rejects(store.rememberExpertAssociation({...association,recordId:'other'},()=>{}),/source-mismatch/);
  await assert.rejects(store.rememberExpertAssociation({...association,contentHash:'c'.repeat(64)},()=>{}),/run-hash-conflict/);
  await assert.rejects(store.rememberExpertAssociation({...association,sessionId:'new',creationOperationId:'new'},()=>{throw Error('revoked')}),/revoked/);
  await store.close();await ctx.fiber.dispose();ctx=await boot(root);store=await QualityAnalysisRunStore.open(ctx.storageDomain,actor,'record1');
  assert.deepEqual(store.listExpertAssociations(first.runId,first.contentHash),[association]);assert.deepEqual(store.history(),before);
  assert.deepEqual(store.readExpertPlan(first.runId,first.contentHash,'plan-1'),plan);
  const other=await QualityAnalysisRunStore.open(ctx.storageDomain,{...actor,principalId:'other'},'record1');
  assert.throws(()=>other.listExpertAssociations(first.runId,first.contentHash),/run-not-found/);await other.close();
 }finally{await store?.close();await ctx?.fiber.dispose();await rm(root,{recursive:true,force:true});}
});

test('service adopts only persisted reverified expert sources with expert provenance',async()=>{
 const root=await mkdtemp(join(tmpdir(),'quality-expert-adoption-'));const ctx=await boot(root);let active=true,imports=0,document;
 const identity={resolve:async()=>actor,profile:()=>({principalId:actor.principalId,organization:{id:actor.organizationId},resolvedBy:actor.resolvedBy}),membership:()=>({state:active?'active':'revoked'})};
 const service=new QualityAnalysisRunService(ctx.storageDomain,identity);
 try{
  const record=await service.createRecord('专家分析','expert-record');const first=run();await service.appendHostRun(record.id,first,0);
  const association={recordId:record.id,runId:first.runId,contentHash:first.contentHash,sessionId:'session-'+ 'd'.repeat(32),expertId:'expert',expertRevisionId:'revision',compositionDigest:'b'.repeat(64),creationOperationId:'create-expert'};
  const content={recordId:record.id,runId:first.runId,contentHash:first.contentHash,sessionId:association.sessionId,eventSeq:2,turn:1,text:'核查抽样与检验标准。'};
  const candidate={...content,candidateHash:createHash('sha256').update(JSON.stringify(content)).digest('hex')};
  const library={importAsset:async(_actor,input)=>{imports++;document=new TextDecoder().decode(input.bytes);return {asset:{id:'asset'},revision:{id:'revision',assetId:'asset',originalSha256:createHash('sha256').update(input.bytes).digest('hex')}}}};
  await assert.rejects(service.adoptInterpretation(candidate,library,undefined,{association,reverify:async()=>{}}),/access-denied/);assert.equal(imports,0);
  await service.rememberExpertAssociation(association,async()=>{});let checks=0;
  const expertPorts={list:(_view,signal)=>service.listExpertAssociations(record.id,first.runId,first.contentHash,signal),read:async saved=>({association:saved,candidate})};
  const rpc=(endpoint,payload)=>handleQualityRecordsRequest(new Request('http://fixture/api/workdsh-quality-records',{method:'POST',body:JSON.stringify({endpoint,payload})}),service,undefined,undefined,library,undefined,undefined,undefined,expertPorts);
  const source={recordId:record.id,runId:first.runId,contentHash:first.contentHash};
  const expertClient=createQualityRecordClient(async(path,init)=>handleQualityRecordsRequest(new Request('http://fixture'+path,init),service,undefined,undefined,library,undefined,undefined,undefined,expertPorts));
  assert.deepEqual(await expertClient.expertSources(record.id,first.runId,first.contentHash),[association]);
  assert.equal((await expertClient.expertCandidate(association)).text,candidate.text);
  const mismatchedClient=createQualityRecordClient(async()=>Response.json({ok:true,value:{association:{...association,expertRevisionId:'wrong'},candidate}}));
  await assert.rejects(mismatchedClient.expertCandidate(association),error=>error.code==='quality/response/invalid');
  const sourceResponse=await rpc('expert-sources',source);assert.equal(sourceResponse.status,200);assert.deepEqual((await sourceResponse.json()).value,[association]);
  assert.equal((await rpc('expert-candidate',{...source,sessionId:'unrelated'})).status,403);
  assert.equal((await rpc('expert-candidate',{...source,sessionId:association.sessionId,owner:'page-owner'})).status,400);
  const preview=await rpc('expert-candidate',{...source,sessionId:association.sessionId});assert.equal(preview.status,200);assert.equal((await preview.json()).value.candidate.text,candidate.text);
  assert.equal((await rpc('adopt-expert-interpretation',{...source,sessionId:association.sessionId,candidateHash:'f'.repeat(64)})).status,409);assert.equal(imports,0);

  await assert.rejects(service.adoptInterpretation(candidate,library),/access-denied/);
  await service.adoptInterpretation(candidate,library,undefined,{association,reverify:async()=>checks++});assert.equal(checks,2);assert.equal(imports,1);
  const provenance=JSON.parse(document.split('```json\n\n')[1].split('\n\n```')[0]);assert.equal(provenance.sessionId,association.sessionId);assert.equal(provenance.expertId,'expert');assert.equal(provenance.expertRevisionId,'revision');
  assert.equal((await service.readRunView(record.id,first.runId,first.contentHash,false)).statistics.summary.inspectedQuantity,100);
  assert.equal((await service.listExpertAssociations(record.id,first.runId,first.contentHash)).length,1);
  await assert.rejects(service.adoptInterpretation(candidate,library,undefined,{association,reverify:async()=>{active=false}}),/access-denied/);assert.equal(imports,1);
 }finally{await service.close();await ctx.fiber.dispose();await rm(root,{recursive:true,force:true});}
});

 test('expert task orchestration preserves the exact plan for replay and run association',async()=>{
  const root=await mkdtemp(join(tmpdir(),'quality-expert-tasks-'));const ctx=await boot(root);let active=true,prepares=0,nativeCreates=0,seenOperation,binding;
  const identity={resolve:async()=>actor,profile:()=>({principalId:actor.principalId,organization:{id:actor.organizationId,kind:'personal'},resolvedBy:actor.resolvedBy}),membership:()=>({state:active?'active':'revoked'})};
  const service=new QualityAnalysisRunService(ctx.storageDomain,identity);
  const experts={list:async()=>({items:[{id:'expert-1',name:'质量核查专家',canUse:true,publishedRevisionRef:{revisionId:'revision-1'}},{id:'hidden',name:'无权专家',canUse:false,publishedRevisionRef:{revisionId:'revision-2'}}]}),prepareExecution:async(a,id,revision,workspace,model,draft)=>{assert.equal(a.principalId,actor.principalId);assert.equal(workspace,undefined);assert.equal(model,undefined);prepares++;assert.ok(draft.includes('不修改统计'));return {executionPlanId:'plan-1',expertRevisionRef:{expertId:id,revisionId:'revision-1'},expiresAt:'2026-10-11T00:10:00Z',missing:[]};},createExecution:async(a,planId,operation)=>{assert.equal(planId,'plan-1');if(!seenOperation){nativeCreates++;seenOperation=operation.operationId;binding={sessionId:'session-'+ 'e'.repeat(32),owner:{organizationId:actor.organizationId,ownerPrincipalId:actor.principalId},expertRevisionRef:{expertId:'expert-1',revisionId:'revision-1'},compositionDigest:'b'.repeat(64),presetRevisionRef:'preset-1',creationOperationId:seenOperation};}else assert.equal(operation.operationId,seenOperation);return {sessionId:binding.sessionId,binding:structuredClone(binding),handoffId:'handoff'};},verifyBinding:async()=>structuredClone(binding)};
  const nativeCtx={get:name=>({workdshIdentity:identity,workdshExperts:experts,workdshAccess:{sessionOwner:()=>binding?.owner}}[name]),fiber:{assertActive(){}}};
  try{
   const record=await service.createRecord('专家任务','create-record');const first=run();await service.appendHostRun(record.id,first,0);const source={recordId:record.id,runId:first.runId,contentHash:first.contentHash};
   const tasks=createQualityExpertTasks(nativeCtx,service);assert.deepEqual(await tasks.list(source),[{id:'expert-1',name:'质量核查专家',revisionId:'revision-1'}]);const plan=await tasks.prepare(source,'expert-1');assert.equal(prepares,1);assert.equal(nativeCreates,0);
   const rpc=(endpoint,payload)=>handleQualityRecordsRequest(new Request('http://fixture/api/workdsh-quality-records',{method:'POST',body:JSON.stringify({endpoint,payload})}),service,undefined,undefined,undefined,undefined,undefined,undefined,{...tasks,available:tasks.list,list:async()=>[],read:async()=>{throw Error('unused')}});
   assert.equal((await rpc('create-expert-task',{...source,executionPlanId:'unrelated-plan'})).status,404);
   assert.equal((await rpc('prepare-expert-task',{...source,expertId:'expert-1',operationId:'page-controlled'})).status,400);
   const ready=await rpc('available-experts',source);assert.equal(ready.status,200);assert.equal((await ready.json()).value.length,1);
   const created=await tasks.create(source,plan.executionPlanId);const again=await tasks.create(source,plan.executionPlanId);assert.deepEqual(created,again);assert.equal(nativeCreates,1);assert.ok(created.instruction.includes(first.contentHash));
   assert.deepEqual(await service.listExpertAssociations(record.id,first.runId,first.contentHash),[created.association]);
   await assert.rejects(tasks.create(source,'unrelated-plan'),/plan-not-found/);assert.equal(nativeCreates,1);
   active=false;await assert.rejects(tasks.create(source,plan.executionPlanId),/access-denied/);await assert.rejects(tasks.prepare(source,'expert-1'),/access-denied/);assert.equal(prepares,1);
  }finally{await service.close();await ctx.fiber.dispose();await rm(root,{recursive:true,force:true});}
 });

test('expert failures expose bounded recovery codes without private service messages',async()=>{
 const source={recordId:'record',runId:'run',contentHash:'a'.repeat(64)};
 for(const [code,status,expected] of [
  ['experts/plan-expired',409,'quality/expert/plan-expired'],
  ['experts/forbidden',403,'quality/expert/unavailable'],
  ['experts/disabled',409,'quality/expert/not-ready'],
  ['experts/dependency-missing',409,'quality/expert/not-ready'],
  ['experts/outcome-unknown',409,'quality/expert/outcome-unknown'],
  ['experts/unavailable',503,'quality/expert/service-unavailable'],
  ['unrecognized',500,'quality/request/internal']
 ]){
  const error=Object.assign(new Error('private-provider-detail'),{code});
  const ports={available:async()=>{throw error},list:async()=>[],read:async()=>{throw Error('unused')}};
  const response=await handleQualityRecordsRequest(new Request('http://fixture/api',{method:'POST',body:JSON.stringify({endpoint:'available-experts',payload:source})}),{},undefined,undefined,undefined,undefined,undefined,undefined,ports);
  assert.equal(response.status,status);const body=await response.json();assert.equal(body.error.code,expected);assert.ok(!JSON.stringify(body).includes('private-provider-detail'));
 }
});
