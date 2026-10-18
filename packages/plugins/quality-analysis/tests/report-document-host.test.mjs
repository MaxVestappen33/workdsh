import test,{after} from 'node:test';
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
const built=await build({
  stdin:{contents:"export * from './run-service';export * from './analysis-run';export {LibraryManager} from '../../../library/src/services/library-manager';",resolveDir:fileURLToPath(new URL('../src/runtime/',import.meta.url)),loader:'ts'},
  bundle:true,platform:'node',format:'esm',write:false,
  alias:{'workdsh-contracts':fileURLToPath(new URL('../../../contracts/src/index.ts',import.meta.url))},
  plugins:[{name:'published-runtime-owner',setup(builder){
    builder.onResolve({filter:/^(?:@deepseek-ai\/cordis|@deepseek-ai\/dsh-storage-domain|zod)$/},args=>({path:pathToFileURL(runtimeRequire.resolve(args.path)).href,external:true}));
    builder.onResolve({filter:/^(?:workdsh-tabular|jszip|pdfjs-dist(?:\/.*)?)$/},args=>({path:pathToFileURL(libraryRequire.resolve(args.path)).href,external:true}));
  }}],
});
const bundleRoot=await mkdtemp(join(tmpdir(),'quality-report-host-bundle-'));
after(()=>rm(bundleRoot,{recursive:true,force:true}));
const bundlePath=join(bundleRoot,'report-host.mjs');await writeFile(bundlePath,built.outputFiles[0].text);
const {QualityAnalysisRunService,createQualityAnalysisRun,LibraryManager}=await import(pathToFileURL(bundlePath).href);
const load=name=>import(pathToFileURL(runtimeRequire.resolve(name)).href);
const {Context}=await load('@deepseek-ai/cordis');
const {default:Storage}=await load('@deepseek-ai/dsh-storage');
const JsonStorage=await load('@deepseek-ai/dsh-storage-json');
const StorageDomain=await load('@deepseek-ai/dsh-storage-domain');
const actor={principalId:'member.a',organizationId:'org',requestId:'report-test',resolvedBy:'trusted-fixture'};
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const fields={title:'十月质量分析',analysis:'两个检验日的结果需要结合抽样范围解读。\n记录已由人工核对。',conclusion:'现有数据不能说明缺陷原因。',recommendations:'核查抽样范围，再补充缺陷明细。'};

function analysisRun(runId='r1',secondBad=10){
  const rows=[['INS-001','2026-10-10','100','5','piece','initial'],['INS-002','2026-10-11','200',String(secondBad),'piece','initial']];
  const headers=['id','date','total','bad','unit','type'];
  const bytes=new TextEncoder().encode([headers,...rows].map(row=>row.join(',')).join('\n'));
  return createQualityAnalysisRun({
    runId,createdAt:'2026-10-11T00:00:00Z',sourceNamespace:'report-fixture',
    rules:{timeZone:'Asia/Shanghai',dateFormat:'yyyy-mm-dd',inspectionTypes:{initial:'initial'}},
    inspections:{mapping:{inspectionId:'id',inspectionDate:'date',inspectedQuantity:'total',nonconformingQuantity:'bad',quantityUnit:'unit',inspectionType:'type'},
      imported:{sha256:sha256(bytes),table:{complete:true,encoding:'utf-8',byteLength:bytes.byteLength,headers,rows,locations:[{record:2,line:2},{record:3,line:3}],ignoredBlankRecords:0}}},
  });
}

function port(library,overrides={}){
  return {importAsset:library.importAsset.bind(library),readOriginal:library.readOriginal.bind(library),saveOriginalRevision:library.saveOriginalRevision.bind(library),...overrides};
}

function proxyMethods(target,overrides){
  return new Proxy(target,{get(object,key){
    if(Object.hasOwn(overrides,key))return overrides[key];
    const value=Reflect.get(object,key,object);return typeof value==='function'?value.bind(object):value;
  }});
}

// Only fault injection wraps the real published backend; successful writes and
// reopened reads still go through official JSON storage and the real LibraryManager.
function injectReportStoreWrite(storage,fault){
  return proxyMethods(storage,{open:async spec=>{
    const domain=await storage.open(spec);
    if(!spec.name.startsWith('workdsh_quality_'))return domain;
    const global=proxyMethods(domain.global,{set:async value=>{
      if(value.reportDocuments?.length&&fault.armed){
        fault.armed=false;
        if(fault.afterCommit)await domain.global.set(value);
        throw Error('fixture/report-store-response-lost');
      }
      return domain.global.set(value);
    }});
    return proxyMethods(domain,{global});
  }});
}

async function fixture(t,{storageFault}={}){
  const root=await mkdtemp(join(tmpdir(),'quality-report-document-'));
  const state={actor:{...actor},active:true};
  const identity={async resolve(){return {...state.actor};},profile(){return {principalId:state.actor.principalId,organization:{id:state.actor.organizationId},resolvedBy:state.actor.resolvedBy};},membership(){return {state:state.active?'active':'suspended'};}};
  const f={root,state,identity,run:analysisRun()};
  async function open(){
    f.ctx=new Context();
    await f.ctx.plugin(Storage);await f.ctx.plugin(JsonStorage,{root:join(root,'storage')});await f.ctx.plugin(StorageDomain,{backend:'json'});
    await f.ctx.plugin(LibraryManager,{root:join(root,'library')});
    f.library=f.ctx.workdshLibrary;
    f.service=new QualityAnalysisRunService(storageFault?injectReportStoreWrite(f.ctx.storageDomain,storageFault):f.ctx.storageDomain,identity);
  }
  f.close=async()=>{await f.service?.close();f.service=undefined;await f.ctx?.fiber.dispose();f.ctx=undefined;};
  f.reopen=async()=>{await f.close();await open();};
  t.after(async()=>{await f.close();await rm(root,{recursive:true,force:true});});
  await open();
  f.record=await f.service.createRecord('报告加工验收','create-record');
  await f.service.appendHostRun(f.record.id,f.run,0);
  f.list=(run=f.run)=>f.service.listReportDocuments(f.record.id,run.runId,run.contentHash);
  f.read=(report,revisionId,library=f.library,run=f.run,signal)=>f.service.readReportDocument(f.record.id,run.runId,run.contentHash,report.reportId,revisionId,library,signal);
  f.save=(input,library=f.library,run=f.run,signal)=>f.service.saveReportDocument(f.record.id,run.runId,run.contentHash,input,library,signal);
  return f;
}

async function assertStored(f,view){
  const bytes=await f.library.readOriginal(actor,view.receipt.assetId,view.revisionId);
  assert.equal(sha256(bytes),view.receipt.sha256);
  assert.equal(view.receipt.revisionId,view.revisionId);
  assert.equal(new TextDecoder('utf-8',{fatal:true}).decode(bytes),view.markdown);
  assert.equal(view.recordId,f.record.id);assert.equal(view.runId,f.run.runId);assert.equal(view.contentHash,f.run.contentHash);
  assert.match(view.markdown,/300/);assert.match(view.markdown,/15/);assert.match(view.markdown,/95(?:\.0+)?\s*%/);
}

test('real reports preserve editable fields, v1/v2, unchanged saves and historical basis across a cold reopen',async t=>{
  const f=await fixture(t);
  assert.deepEqual(await f.list(),[]);
  const basis=await f.service.readRunView(f.record.id,f.run.runId,f.run.contentHash,false);
  assert.equal(basis.statistics.summary.inspectedQuantity,300);assert.equal(basis.statistics.summary.nonconformingQuantity,15);
  assert.equal(1-basis.statistics.summary.nonconformingRate,.95);
  assert.deepEqual(basis.statistics.trend.map(day=>day.summary.nonconformingRate),[.05,.05]);
  const v1=await f.save({operationId:'create-report',fields});
  assert.deepEqual(v1.fields,fields);assert.equal(v1.version,1);await assertStored(f,v1);
  assert.equal((await f.library.list(actor)).length,1);
  const summaries=await f.list();assert.equal(summaries.length,1);assert.equal(summaries[0].reportId,v1.reportId);assert.equal(summaries[0].currentRevisionId,v1.revisionId);
  assert.equal('fields' in summaries[0],false);assert.equal('markdown' in summaries[0],false);
  await f.reopen();
  const restored=await f.read(v1);assert.deepEqual(restored.fields,fields);assert.equal(restored.markdown,v1.markdown);await assertStored(f,restored);
  const nextFields={...fields,title:'十月质量报告 · 复核版',conclusion:'人工复核后保留 95% 合格率结论。\n缺陷原因仍待核实。'};
  const v2=await f.save({reportId:v1.reportId,expectedRevisionId:v1.revisionId,operationId:'edit-report',fields:nextFields});
  assert.equal(v2.reportId,v1.reportId);assert.equal(v2.receipt.assetId,v1.receipt.assetId);assert.equal(v2.version,2);assert.notEqual(v2.revisionId,v1.revisionId);
  assert.deepEqual(v2.fields,nextFields);assert.equal(v2.versions.length,2);await assertStored(f,v2);
  const noChange=await f.save({reportId:v2.reportId,expectedRevisionId:v2.revisionId,operationId:'save-unchanged',fields:nextFields});
  assert.equal(noChange.revisionId,v2.revisionId);assert.equal(noChange.version,2);assert.equal(noChange.versions.length,2);
  assert.equal((await f.library.list(actor))[0].revision.number,2);
  const changedRun=analysisRun('r2',20);await f.service.appendHostRun(f.record.id,changedRun,1);
  const changedBasis=await f.service.readRunView(f.record.id,changedRun.runId,changedRun.contentHash,false);
  assert.equal(changedBasis.statistics.summary.nonconformingQuantity,25);
  assert.deepEqual(await f.list(changedRun),[]);
  await f.reopen();
  const old=await f.read(v1,v1.revisionId);assert.deepEqual(old.fields,fields);assert.equal(old.markdown,v1.markdown);assert.equal(old.version,1);assert.equal(old.currentRevisionId,v2.revisionId);await assertStored(f,old);
  const current=await f.read(v2);assert.deepEqual(current.fields,nextFields);assert.equal(current.version,2);await assertStored(f,current);
  const retriedCreation=await f.save({operationId:'create-report',fields});
  assert.equal(retriedCreation.revisionId,v1.revisionId);assert.equal(retriedCreation.version,1);assert.deepEqual(retriedCreation.fields,fields);
  assert.equal((await f.list()).length,1);assert.equal((await f.library.list(actor))[0].revision.number,2);
});

test('an import committed by the real LibraryManager survives a lost acknowledgement without a duplicate report',async t=>{
  const f=await fixture(t);let committed;
  const lossy=port(f.library,{importAsset:async(...args)=>{committed=await f.library.importAsset(...args);throw Error('fixture/library-import-response-lost');}});
  const request={operationId:'create-lost-ack',fields};
  await assert.rejects(f.save(request,lossy),/library-import-response-lost/);
  assert.ok(committed.asset.id);assert.equal((await f.library.list(actor)).length,1);
  await f.reopen();
  const retried=await f.save(request);assert.equal(retried.receipt.assetId,committed.asset.id);assert.equal(retried.revisionId,committed.revision.id);assert.equal(retried.version,1);await assertStored(f,retried);
  assert.equal((await f.list()).length,1);assert.equal((await f.library.list(actor)).length,1);
  await assert.rejects(f.save({...request,fields:{...fields,conclusion:'不同保存意图'}}),/operation-conflict/);
});

test('a real Library revision committed before a lost response is recovered once after reopening',async t=>{
  const f=await fixture(t);const v1=await f.save({operationId:'create-report',fields});let committed;
  const changed={...fields,recommendations:'人工复核抽样范围，并补充后续检验。'};
  const request={reportId:v1.reportId,expectedRevisionId:v1.revisionId,operationId:'edit-lost-ack',fields:changed};
  const lossy=port(f.library,{saveOriginalRevision:async(...args)=>{committed=await f.library.saveOriginalRevision(...args);throw Error('fixture/library-revision-response-lost');}});
  await assert.rejects(f.save(request,lossy),/library-revision-response-lost/);
  assert.equal(committed.revision.number,2);
  await f.reopen();
  const retried=await f.save(request);assert.equal(retried.revisionId,committed.revision.id);assert.equal(retried.version,2);assert.deepEqual(retried.fields,changed);await assertStored(f,retried);
  assert.equal((await f.library.list(actor))[0].revision.number,2);assert.equal((await f.list()).length,1);
  const original=await f.read(v1,v1.revisionId);assert.deepEqual(original.fields,fields);
});

for(const afterCommit of [false,true])test(`official report metadata ${afterCommit?'committed before':'not committed on'} a lost response recovers the same save intent`,async t=>{
  const fault={armed:false,afterCommit};const f=await fixture(t,{storageFault:fault});fault.armed=true;
  const request={operationId:'store-lost-ack',fields};
  await assert.rejects(f.save(request),/report-store-response-lost/);
  assert.equal(fault.armed,false,'the fault must intercept an actual report metadata write');
  const entry=(await f.library.list(actor))[0];assert.ok(entry);
  await f.reopen();
  const retried=await f.save(request);assert.equal(retried.receipt.assetId,entry.asset.id);assert.equal(retried.revisionId,entry.revision.id);assert.equal(retried.version,1);await assertStored(f,retried);
  assert.equal((await f.list()).length,1);assert.equal((await f.library.list(actor)).length,1);
});

test('two writers sharing an old base cannot replace each other or produce a spurious third version',async t=>{
  const f=await fixture(t);const v1=await f.save({operationId:'create-report',fields});
  const requests=['a','b'].map(writer=>({reportId:v1.reportId,expectedRevisionId:v1.revisionId,operationId:`writer-${writer}`,fields:{...fields,conclusion:`人工修订 ${writer}`}}));
  const results=await Promise.allSettled(requests.map(request=>f.save(request)));
  const success=results.filter(result=>result.status==='fulfilled');const failed=results.filter(result=>result.status==='rejected');
  assert.equal(success.length,1);assert.equal(failed.length,1);assert.match(failed[0].reason.message,/revision-conflict/);
  const winner=success[0].value;const current=await f.read(winner);assert.equal(current.revisionId,winner.revisionId);assert.equal(current.versions.length,2);
  assert.equal((await f.library.list(actor))[0].revision.number,2);
  await assert.rejects(f.save({reportId:v1.reportId,expectedRevisionId:v1.revisionId,operationId:'later-stale',fields:{...fields,analysis:'旧基准修订'}}),/revision-conflict/);
  assert.deepEqual((await f.read(v1,v1.revisionId)).fields,fields);
});

test('wrong record, run, hash, report, revision and caller-controlled statistics cannot be saved or read',async t=>{
  const f=await fixture(t);const v1=await f.save({operationId:'create-report',fields});
  await assert.rejects(f.service.listReportDocuments('missing','r1',f.run.contentHash),/record-not-found/);
  await assert.rejects(f.service.listReportDocuments(f.record.id,'missing',f.run.contentHash),/run-not-found/);
  await assert.rejects(f.service.listReportDocuments(f.record.id,'r1','b'.repeat(64)),/run-hash-conflict/);
  await assert.rejects(f.read({reportId:'missing'}),/report.*not-found/);
  await assert.rejects(f.read(v1,'missing-revision'),/revision.*not-found|report.*not-found/);
  const other=await f.service.createRecord('其他记录','other-record');await f.service.appendHostRun(other.id,f.run,0);
  await assert.rejects(f.service.readReportDocument(other.id,'r1',f.run.contentHash,v1.reportId,undefined,f.library),/report.*not-found/);
  const second=analysisRun('r2',20);await f.service.appendHostRun(f.record.id,second,1);
  await assert.rejects(f.read(v1,undefined,f.library,second),/report.*not-found|basis.*conflict/);
  await assert.rejects(f.save({operationId:'injected-statistics',fields:{...fields,statistics:{inspectedQuantity:1}}}),/invalid/);
  await assert.rejects(f.save({operationId:'injected-actor',fields,actor:{principalId:'other'}}),/invalid/);
  await assert.rejects(f.save({operationId:'missing-base',reportId:v1.reportId,fields}),/invalid/);
  await assert.rejects(f.save({operationId:'bad-text',fields:{...fields,analysis:'不可接受\u0000文本'}}),/invalid/);
  assert.equal((await f.list()).length,1);assert.equal((await f.library.list(actor)).length,1);
});

test('Host rejects forged library receipts and changed original bytes instead of trusting editable content',async t=>{
  const f=await fixture(t);let committed;
  const forged=port(f.library,{importAsset:async(...args)=>{committed=await f.library.importAsset(...args);return {...committed,revision:{...committed.revision,originalSha256:'b'.repeat(64)}};}});
  await assert.rejects(f.save({operationId:'bad-receipt',fields},forged),/invalid-library-receipt|sha|hash|integrity/);
  assert.deepEqual(await f.list(),[]);
  const v1=await f.save({operationId:'bad-receipt',fields});assert.equal(v1.receipt.assetId,committed.asset.id);await assertStored(f,v1);
  const tampered=port(f.library,{readOriginal:async(...args)=>new TextEncoder().encode(new TextDecoder().decode(await f.library.readOriginal(...args))+'\n伪造内容')});
  await assert.rejects(f.read(v1,undefined,tampered),/sha|hash|corrupt|integrity/);
  assert.deepEqual((await f.read(v1)).fields,fields);
  assert.equal((await f.library.list(actor)).length,1);
});

function gate(){let enter,release;return {entered:new Promise(resolve=>{enter=resolve;}),released:new Promise(resolve=>{release=resolve;}),enter:()=>enter(),release:()=>release()};}

test('report operations respect current membership, initiating identity and cancellation at asynchronous boundaries',async t=>{
  const f=await fixture(t);const v1=await f.save({operationId:'create-report',fields});
  f.state.active=false;
  await assert.rejects(f.list(),/access-denied/);await assert.rejects(f.read(v1),/access-denied/);
  await assert.rejects(f.save({operationId:'suspended-save',fields}),/access-denied/);
  f.state.active=true;f.state.actor={...actor,principalId:'member.other'};
  await assert.rejects(f.read(v1),/record-not-found|access-denied/);
  f.state.actor={...actor};
  const readGate=gate();
  const delayedRead=port(f.library,{readOriginal:async(...args)=>{const bytes=await f.library.readOriginal(...args);readGate.enter();await readGate.released;return bytes;}});
  const reading=f.read(v1,undefined,delayedRead);await readGate.entered;f.state.actor={...actor,principalId:'member.other'};readGate.release();
  await assert.rejects(reading,/access-denied/);f.state.actor={...actor};
  const saveGate=gate();
  const delayedSave=port(f.library,{saveOriginalRevision:async(...args)=>{saveGate.enter();await saveGate.released;return f.library.saveOriginalRevision(...args);}});
  const saving=f.save({reportId:v1.reportId,expectedRevisionId:v1.revisionId,operationId:'changed-identity-save',fields:{...fields,conclusion:'切换身份时禁止提交'}},delayedSave);
  await saveGate.entered;f.state.active=false;saveGate.release();await assert.rejects(saving,/access-denied/);f.state.active=true;
  assert.equal((await f.library.list(actor))[0].revision.number,1);assert.equal((await f.read(v1)).version,1);
  const abortGate=gate(),controller=new AbortController();
  const delayedAbort=port(f.library,{readOriginal:async(...args)=>{const bytes=await f.library.readOriginal(...args);abortGate.enter();await abortGate.released;return bytes;}});
  const canceled=f.read(v1,undefined,delayedAbort,f.run,controller.signal);await abortGate.entered;controller.abort();abortGate.release();
  await assert.rejects(canceled,{name:'AbortError'});
  assert.deepEqual((await f.read(v1)).fields,fields);
});
