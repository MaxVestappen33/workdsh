import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const web=createRequire(new URL('../../../../apps/web/package.json',import.meta.url));
const runtime=createRequire(new URL('../../projects/package.json',import.meta.url));
const libraryRequire=createRequire(new URL('../../library/package.json',import.meta.url));
const {build}=web('esbuild');
const load=name=>import(pathToFileURL(runtime.resolve(name)).href);
const {Context}=await load('@deepseek-ai/cordis');const {default:Storage}=await load('@deepseek-ai/dsh-storage');
const JsonStorage=await load('@deepseek-ai/dsh-storage-json');const StorageDomain=await load('@deepseek-ai/dsh-storage-domain');
const actor={principalId:'member.a',organizationId:'org',requestId:'draft-host',resolvedBy:'trusted-fixture'};
const fields={title:'',analysis:'  草稿正文只保存在资料库。\n\n第二段保留空行。  ',conclusion:'尚待核对',recommendations:''};
const compiled=await build({stdin:{contents:"export * from './run-service';export * from './analysis-run';export * from './report-drafts';export {LibraryManager} from '../../../library/src/services/library-manager';",resolveDir:fileURLToPath(new URL('../src/runtime/',import.meta.url)),loader:'ts'},bundle:true,platform:'node',format:'esm',write:false,
  alias:{'workdsh-contracts':fileURLToPath(new URL('../../../contracts/src/index.ts',import.meta.url))},plugins:[{name:'shared-published-runtime',setup(b){
    b.onResolve({filter:/^(?:@deepseek-ai\/cordis|@deepseek-ai\/dsh-storage-domain|zod)$/},a=>({path:pathToFileURL(runtime.resolve(a.path)).href,external:true}));
    b.onResolve({filter:/^(?:workdsh-tabular|jszip|pdfjs-dist(?:\/.*)?)$/},a=>({path:pathToFileURL(libraryRequire.resolve(a.path)).href,external:true}));
  }}]});
function proxy(object,overrides){return new Proxy(object,{get(target,key){if(Object.hasOwn(overrides,key))return overrides[key];const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});}
function ports(library,overrides={}){return {readContentDraft:library.readContentDraft.bind(library),saveContentDraft:library.saveContentDraft.bind(library),archiveContentDraft:library.archiveContentDraft.bind(library),...overrides};}
async function fixture(t,{fault}={}){
  const root=await mkdtemp(join(tmpdir(),'quality-report-draft-'));const bundle=join(root,'host.mjs');await writeFile(bundle,compiled.outputFiles[0].text);
  const source=await import(pathToFileURL(bundle).href);const state={actor:{...actor},active:true},snapshots=[];
  const identity={async resolve(){return {...state.actor};},profile(){return {principalId:state.actor.principalId,organization:{id:state.actor.organizationId},resolvedBy:state.actor.resolvedBy};},membership(){return {state:state.active?'active':'suspended'};}};
  const f={root,state,snapshots,...source};
  async function open(){
    f.ctx=new Context();await f.ctx.plugin(Storage);await f.ctx.plugin(JsonStorage,{root:join(root,'storage')});await f.ctx.plugin(StorageDomain,{backend:'json'});await f.ctx.plugin(source.LibraryManager,{root:join(root,'library')});f.library=f.ctx.workdshLibrary;
    const storage=proxy(f.ctx.storageDomain,{open:async spec=>{
      const domain=await f.ctx.storageDomain.open(spec);if(!spec.name.startsWith('workdsh_quality_'))return domain;
      return proxy(domain,{global:proxy(domain.global,{set:async value=>{
        snapshots.push(structuredClone(value));
        if(value.reportDrafts?.length&&fault?.armed){fault.armed=false;if(fault.afterCommit)await domain.global.set(value);throw Error('fixture/metadata-response-lost');}
        return domain.global.set(value);
      }})});
    }});
    f.service=new source.QualityAnalysisRunService(storage,identity);
  }
  f.close=async()=>{await f.service?.close();f.service=undefined;await f.ctx?.fiber.dispose();f.ctx=undefined;};
  f.reopen=async()=>{await f.close();await open();};t.after(async()=>{await f.close();await rm(root,{recursive:true,force:true});});await open();
  f.run=source.createQualityAnalysisRun({runId:'r1',createdAt:'2026-10-11T00:00:00Z',sourceNamespace:'fixture',rules:{timeZone:'Asia/Shanghai',dateFormat:'yyyy-mm-dd',inspectionTypes:{initial:'initial'}},inspections:{mapping:{inspectionId:'id',inspectionDate:'date',inspectedQuantity:'total',nonconformingQuantity:'bad',quantityUnit:'unit',inspectionType:'type'},imported:{sha256:'a'.repeat(64),table:{complete:true,encoding:'utf-8',byteLength:1,headers:['id','date','total','bad','unit','type'],rows:[['001','2026-10-10','100','5','piece','initial'],['002','2026-10-11','200','10','piece','initial']],locations:[{record:2,line:2},{record:3,line:3}],ignoredBlankRecords:0}}}});
  f.record=await f.service.createRecord('报告草稿','create-record');await f.service.appendHostRun(f.record.id,f.run,0);
  f.save=(input,library=f.library)=>f.service.saveReportDraft(f.record.id,'r1',f.run.contentHash,input,library);
  f.read=(draft,library=f.library,signal)=>f.service.readReportDraft(f.record.id,'r1',f.run.contentHash,draft.draftId,library,signal);
  f.list=()=>f.service.listReportDrafts(f.record.id,'r1',f.run.contentHash);
  f.archive=(draft,operationId,library=f.library)=>f.service.archiveReportDraft(f.record.id,'r1',f.run.contentHash,draft.draftId,draft.draftRevision,operationId,library);
  f.formal=(input)=>f.service.saveReportDocument(f.record.id,'r1',f.run.contentHash,input,f.library);
  return f;
}

test('blank-title detached draft survives cold reopening, keeps exact text and publishes first formal version independently',async t=>{
  const f=await fixture(t);assert.deepEqual(await f.list(),[]);
  const first=await f.save({operationId:'draft-create',fields});assert.equal(first.title,'');assert.deepEqual(first.fields,fields);assert.equal(first.status,'active');
  assert.equal((await f.library.list(actor)).length,0,'an unpublished draft is not a report asset');
  assert.deepEqual(await f.service.listReportDocuments(f.record.id,'r1',f.run.contentHash),[]);
  assert.equal('fields' in (await f.list())[0],false);assert.equal('libraryOperationId' in first,false);
  for(const snapshot of f.snapshots)assert.equal(JSON.stringify(snapshot).includes('草稿正文只保存在资料库'),false);
  const libraryDraft=await f.library.readContentDraft(actor,f.qualityReportLibraryDraftId(actor,first));
  assert.equal(f.qualityReportDraftHash(libraryDraft.content),first.sha256);assert.match(libraryDraft.content,/草稿正文只保存在资料库/);
  await f.reopen();assert.deepEqual((await f.read(first)).fields,fields);
  const changedFields={...fields,title:'  未完成报告  ',analysis:fields.analysis+'\n补充的人工记录。'};
  const edited=await f.save({draftId:first.draftId,expectedDraftRevision:first.draftRevision,operationId:'draft-edit',fields:changedFields});
  assert.notEqual(edited.draftRevision,first.draftRevision);assert.equal(edited.title,'  未完成报告  ');
  const noChange=await f.save({draftId:edited.draftId,expectedDraftRevision:edited.draftRevision,operationId:'draft-no-change',fields:changedFields});
  assert.equal(noChange.draftRevision,edited.draftRevision);assert.equal(noChange.sha256,edited.sha256);assert.equal(noChange.updatedAt,edited.updatedAt);
  await assert.rejects(f.save({operationId:'draft-create',fields}),/operation-superseded/);
  await assert.rejects(f.save({draftId:first.draftId,expectedDraftRevision:first.draftRevision,operationId:'stale-save',fields}),/revision-conflict/);
  await f.reopen();assert.deepEqual((await f.read(noChange)).fields,changedFields);
  const formal=await f.formal({operationId:'formal-first',fields:{...changedFields,title:'质量分析报告'}});
  assert.equal(formal.version,1);assert.match(formal.markdown,/固定统计：检验数量 300；不合格数量 15；合格率 95\.00%。/);
  assert.equal((await f.read(noChange)).status,'active','formal confirmation and draft archiving are separate commits');
  const archived=await f.archive(noChange,'draft-archive');assert.equal(archived.status,'archived');assert.deepEqual(archived.fields,changedFields);
  await f.reopen();assert.deepEqual((await f.read(archived)).fields,changedFields);assert.equal((await f.list())[0].status,'archived');
  await assert.rejects(f.save({draftId:archived.draftId,expectedDraftRevision:archived.draftRevision,operationId:'edit-archived',fields:changedFields}),/archived/);
});

test('committed Library draft save and archive recover the same intent after lost replies and cold reopening',async t=>{
  const f=await fixture(t);let committed;
  const lossy=ports(f.library,{saveContentDraft:async(...args)=>{committed=await f.library.saveContentDraft(...args);throw Error('fixture/library-response-lost');}});
  const request={operationId:'draft-lost-ack',fields};await assert.rejects(f.save(request,lossy),/library-response-lost/);assert.deepEqual(await f.list(),[]);
  await f.reopen();const recovered=await f.save(request);assert.equal(recovered.draftRevision,committed.revision);assert.deepEqual(recovered.fields,fields);
  await assert.rejects(f.save({...request,fields:{...fields,analysis:'不同意图'}}),/operation-conflict/);
  const edit={draftId:recovered.draftId,expectedDraftRevision:recovered.draftRevision,operationId:'draft-edit-lost',fields:{...fields,conclusion:'人工追加结论'}};
  const editPort=ports(f.library,{saveContentDraft:async(...args)=>{committed=await f.library.saveContentDraft(...args);throw Error('fixture/library-response-lost');}});
  await assert.rejects(f.save(edit,editPort),/library-response-lost/);await f.reopen();const edited=await f.save(edit);assert.equal(edited.draftRevision,committed.revision);assert.deepEqual(edited.fields,edit.fields);
  const archivePort=ports(f.library,{archiveContentDraft:async(...args)=>{committed=await f.library.archiveContentDraft(...args);throw Error('fixture/archive-response-lost');}});
  await assert.rejects(f.archive(edited,'archive-lost',archivePort),/archive-response-lost/);await f.reopen();
  const archived=await f.archive(edited,'archive-lost');assert.equal(archived.draftRevision,committed.revision);assert.equal(archived.status,'archived');assert.deepEqual(archived.fields,edit.fields);
});

for(const afterCommit of [false,true])test(`Quality metadata ${afterCommit?'committed':'uncommitted'} on lost acknowledgement recovers one detached draft`,async t=>{
  const fault={armed:false,afterCommit};const f=await fixture(t,{fault});fault.armed=true;
  const request={operationId:'metadata-lost',fields};await assert.rejects(f.save(request),/metadata-response-lost/);assert.equal(fault.armed,false);
  await f.reopen();const recovered=await f.save(request);assert.deepEqual(recovered.fields,fields);assert.equal((await f.list()).length,1);
  assert.deepEqual(await f.save(request),recovered);assert.equal((await f.library.list(actor)).length,0);
});

test('draft CAS protects concurrent writers and parent binding stays fixed when the report advances',async t=>{
  const f=await fixture(t);const first=await f.save({operationId:'draft-create',fields});
  const results=await Promise.allSettled(['a','b'].map(name=>f.save({draftId:first.draftId,expectedDraftRevision:first.draftRevision,operationId:'writer-'+name,fields:{...fields,conclusion:name}})));
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1);assert.match(results.find(result=>result.status==='rejected').reason.message,/revision-conflict/);
  const report=await f.formal({operationId:'formal-create',fields:{...fields,title:'正式报告'}});
  const parentDraft=await f.save({operationId:'parent-draft',reportId:report.reportId,baseRevisionId:report.revisionId,fields});
  const newer=await f.formal({reportId:report.reportId,expectedRevisionId:report.revisionId,operationId:'formal-edit',fields:{...fields,title:'正式报告',conclusion:'正式报告新结论'}});
  assert.deepEqual((await f.read(parentDraft)).fields,fields);
  const edited=await f.save({draftId:parentDraft.draftId,expectedDraftRevision:parentDraft.draftRevision,reportId:report.reportId,baseRevisionId:report.revisionId,operationId:'old-base-draft-edit',fields:{...fields,analysis:'继续加工旧基准草稿'}});
  assert.equal(edited.baseRevisionId,report.revisionId);
  await assert.rejects(f.save({operationId:'new-draft-stale-parent',reportId:report.reportId,baseRevisionId:report.revisionId,fields}),/parent-revision-conflict/);
  await assert.rejects(f.save({draftId:edited.draftId,expectedDraftRevision:edited.draftRevision,operationId:'automatic-rebase',reportId:report.reportId,baseRevisionId:newer.revisionId,fields}),/scope-mismatch/);
  await assert.rejects(f.formal({reportId:report.reportId,expectedRevisionId:edited.baseRevisionId,operationId:'overwrite-parent',fields:{...edited.fields,title:'旧草稿'}}),/revision-conflict/);
});

test('source configuration advances while the old fixed run draft remains readable after reopening',async t=>{
  const f=await fixture(t);const draft=await f.save({operationId:'draft-create',fields});
  const initial={inspections:{imported:f.run.content.sources.inspections.imported}};
  const first=await f.service.stageHostSources(f.record.id,initial,0);
  const analysis={inspectionsMapping:f.run.content.sources.inspections.mapping,rules:f.run.content.rules,filter:{trendGranularity:'day'}};
  await f.service.bindSourceConfiguration(f.record.id,'初次配置','fixture',first.sourceSnapshotId,analysis,0);
  const changed=structuredClone(initial);changed.inspections.imported.sha256='b'.repeat(64);changed.inspections.imported.table.rows[1][3]='20';
  const second=await f.service.stageHostSources(f.record.id,changed,1);await f.service.bindSourceConfiguration(f.record.id,'新来源配置','fixture',second.sourceSnapshotId,analysis,1);
  assert.equal((await f.service.getRecord(f.record.id)).generation,2);
  await f.reopen();assert.deepEqual((await f.read(draft)).fields,fields);assert.equal((await f.list())[0].contentHash,f.run.contentHash);
});

function gate(){let enter,release;return {entered:new Promise(r=>{enter=r;}),released:new Promise(r=>{release=r;}),enter:()=>enter(),release:()=>release()};}
test('library bytes, canonical identity, current actor and cancellation are checked at every draft boundary',async t=>{
  const f=await fixture(t);const draft=await f.save({operationId:'draft-create',fields});
  const wrong=ports(f.library,{readContentDraft:async(...args)=>{const real=await f.library.readContentDraft(...args);return {...real,content:real.content+' '};}});
  await assert.rejects(f.read(draft,wrong),/library-mismatch/);
  const changedScope=ports(f.library,{readContentDraft:async(...args)=>{const real=await f.library.readContentDraft(...args),body=JSON.parse(real.content);body.identity.runId='foreign';const content=JSON.stringify(body);return {...real,content,sha256:f.qualityReportDraftHash(content)};}});
  await assert.rejects(f.read(draft,changedScope),/library-mismatch|scope-mismatch/);
  f.state.active=false;await assert.rejects(f.list(),/access-denied/);await assert.rejects(f.read(draft),/access-denied/);f.state.active=true;
  const pause=gate(),delayed=ports(f.library,{saveContentDraft:async(...args)=>{pause.enter();await pause.released;return f.library.saveContentDraft(...args);}});
  const pending=f.save({draftId:draft.draftId,expectedDraftRevision:draft.draftRevision,operationId:'revoked-save',fields:{...fields,analysis:'不应提交'}},delayed);
  await pause.entered;f.state.active=false;pause.release();await assert.rejects(pending,/access-denied/);f.state.active=true;assert.deepEqual((await f.read(draft)).fields,fields);
  const readPause=gate(),controller=new AbortController();const delayedRead=ports(f.library,{readContentDraft:async(...args)=>{const value=await f.library.readContentDraft(...args);readPause.enter();await readPause.released;return value;}});
  const canceled=f.read(draft,delayedRead,controller.signal);await readPause.entered;controller.abort();readPause.release();await assert.rejects(canceled,{name:'AbortError'});
  f.state.actor={...actor,principalId:'other'};await assert.rejects(f.read(draft),/record-not-found|access-denied/);
});
