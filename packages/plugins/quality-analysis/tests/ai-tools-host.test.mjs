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
const nativeLoad=name=>import(pathToFileURL(web.resolve(name)).href);
const [Agents,AgentLoop,Sessions,Projections,SystemPrompt,Tools,Llm]=await Promise.all(['dsh-agent','dsh-agent-loop','dsh-session','dsh-session-projection','dsh-system-prompt','dsh-tools','dsh-llm'].map(name=>nativeLoad('@deepseek-ai/'+name)));
const actor={principalId:'member.a',organizationId:'org',requestId:'quality-ai-test',resolvedBy:'trusted-fixture'};
const compiled=await build({stdin:{contents:"export * from './ai-tools';export * from './run-service';export * from './analysis-run';export * from './analysis-executor';export * from './record-rpc';export {LibraryManager} from '../../../library/src/services/library-manager';",resolveDir:fileURLToPath(new URL('../src/runtime/',import.meta.url)),loader:'ts'},bundle:true,platform:'node',format:'esm',write:false,
 alias:{'workdsh-contracts':fileURLToPath(new URL('../../../contracts/src/index.ts',import.meta.url))},plugins:[{name:'shared-published-runtime',setup(b){
  b.onResolve({filter:/^(?:@deepseek-ai\/cordis|@deepseek-ai\/dsh-storage-domain|zod)$/},a=>({path:pathToFileURL(runtime.resolve(a.path)).href,external:true}));
  b.onResolve({filter:/^(?:@deepseek-ai\/dsh-tools|workdsh-tabular|jszip|pdfjs-dist(?:\/.*)?)$/},a=>({path:pathToFileURL(libraryRequire.resolve(a.path)).href,external:true}));
 }}]});
function proxy(object,overrides){return new Proxy(object,{get(target,key){if(Object.hasOwn(overrides,key))return overrides[key];const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});}

async function fixture(t,{rows,fault,filter,decisions,actualWorker=false,nativeAgent=false}={}){
 const root=await mkdtemp(join(tmpdir(),'quality-ai-host-')),bundle=join(root,'host.mjs');await writeFile(bundle,compiled.outputFiles[0].text);
 const source=await import(pathToFileURL(bundle).href),state={actor:{...actor},active:true,owner:{organizationId:actor.organizationId,ownerPrincipalId:actor.principalId},calls:0},snapshots=[];
 const identity={async resolve(input){return {...state.actor,...(input?.sessionId?{sessionId:input.sessionId}:{})};},profile(){return {principalId:state.actor.principalId,organization:{id:state.actor.organizationId},resolvedBy:state.actor.resolvedBy};},membership(){return {state:state.active?'active':'suspended'};}};
 const f={root,state,snapshots,...source,sessionId:'session-quality-ai-fixed-run'};
 async function open(){
  f.ctx=new Context();await f.ctx.plugin(Storage);await f.ctx.plugin(JsonStorage,{root:join(root,'storage')});await f.ctx.plugin(StorageDomain,{backend:'json'});await f.ctx.plugin(source.LibraryManager,{root:join(root,'library')});f.library=f.ctx.workdshLibrary;
  f.ctx.provide('workdshAccess',{sessionOwner(){return state.owner;}});
  if(nativeAgent){
   for(const module of [SystemPrompt,Tools,Llm,Sessions,Agents,Projections])await f.ctx.plugin(module.default);
   await f.ctx.plugin(AgentLoop.default,{agents:[]});
   f.agentHandle=await f.ctx.agents.create({sessionId:Sessions.SessionId(f.sessionId),meta:{cwd:root}});f.agent=f.agentHandle.agent;
  }
  const storage=proxy(f.ctx.storageDomain,{open:async spec=>{
   const domain=await f.ctx.storageDomain.open(spec);if(!spec.name.startsWith('workdsh_quality_ai_'))return domain;
   return proxy(domain,{global:proxy(domain.global,{set:async value=>{snapshots.push(structuredClone(value));if(fault?.armed&&value.operations.length){fault.armed=false;if(fault.afterCommit)await domain.global.set(value);throw Error('fixture/context-response-lost');}return domain.global.set(value);}})});
  }});
  f.service=new source.QualityAnalysisRunService(storage,identity);
  if(actualWorker){const worker=join(root,'analysis-worker.mjs');await build({entryPoints:[fileURLToPath(new URL('../src/runtime/analysis-worker.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',outfile:worker});f.worker=new source.QualityAnalysisExecutor(pathToFileURL(worker));}
  f.executor={async execute(input,signal){state.calls++;signal?.throwIfAborted();const value=f.worker?await f.worker.execute(input,signal):source.createQualityAnalysisRun(input);if(state.afterExecute)await state.afterExecute();return value;}};
  f.api=source.createQualityAiTools(f.ctx,f.service,storage,identity,f.executor,f.library);
  f.tools=new Map();const registration={register(definition){f.tools.set(definition.name,definition);return nativeAgent?f.ctx.tools.register(definition):()=>f.tools.delete(definition.name);}};
  if(!nativeAgent)f.ctx.provide('tools',registration);source.registerQualityAiTools(nativeAgent?proxy(f.ctx,{tools:registration}):f.ctx,f.api);
 }
 f.close=async()=>{await f.agentHandle?.dispose();await f.ctx?.fiber.dispose();await f.service?.close();await f.worker?.close();f.ctx=undefined;f.service=undefined;f.worker=undefined;f.agentHandle=undefined;f.agent=undefined;};f.reopen=async()=>{await f.close();await open();};
 t.after(async()=>{await f.close();await rm(root,{recursive:true,force:true});});await open();
 const data=rows??[['001','2026-10-10','100','5','piece','initial'],['002','2026-10-11','200','10','piece','initial']];
 f.run=source.createQualityAnalysisRun({runId:'r1',createdAt:'2026-10-11T00:00:00Z',sourceNamespace:'fixture',projectContext:{projectId:'p1',projectName:'已授权项目',configRevisionId:'pc1'},rules:{timeZone:'Asia/Shanghai',dateFormat:'yyyy-mm-dd',inspectionTypes:{initial:'initial'}},...(filter?{filter}:{}),...(decisions?{cleaningActor:{principalId:actor.principalId,decidedAt:'2026-10-11T00:00:00Z'}}:{}),inspections:{...(decisions?{decisions}:{}),mapping:{inspectionId:'id',inspectionDate:'date',inspectedQuantity:'total',nonconformingQuantity:'bad',quantityUnit:'unit',inspectionType:'type'},imported:{sha256:'a'.repeat(64),table:{complete:true,encoding:'utf-8',byteLength:1,headers:['id','date','total','bad','unit','type'],rows:data,locations:data.map((_,i)=>({record:i+2,line:i+2})),ignoredBlankRecords:0}}}});
 f.record=await f.service.createRecord('质量分析','create-record');await f.service.appendHostRun(f.record.id,f.run,0);
 f.source={recordId:f.record.id,runId:f.run.runId,contentHash:f.run.contentHash,sessionId:f.sessionId};
 f.bind=()=>f.api.bind(f.source);f.exec=(callId,sessionId=f.sessionId,signal=new AbortController().signal)=>({agent:{id:sessionId},callId,signal});
 f.call=(name,args={},callId=name,exec=f.exec(callId))=>f.tools.get(name).execute(args,exec);
 f.context=()=>f.api.readContext(f.record.id,f.sessionId);
 return f;
}

test('official definitions read complete immutable pages only for their governed Session, and reject model identity overrides',async t=>{
 const rows=Array.from({length:27},(_,i)=>['INS-'+i,'2026-10-10','100','5','piece','initial']),f=await fixture(t,{rows});
 assert.deepEqual([...f.tools.keys()],['quality_read_context','quality_read_inspections','quality_read_focused_inspections','quality_analyze','quality_read_report_draft','quality_update_report_draft']);
 await assert.rejects(f.call('quality_read_context'),/not-bound/);await f.bind();
 const first=await f.call('quality_read_inspections');assert.equal(first.total,27);assert.equal(first.rows.length,20);assert.equal(first.nextOffset,20);assert.equal(first.rows[0].sourceRow,1);assert.equal(first.rows[0].location.line,2);
 const second=await f.call('quality_read_inspections',{offset:first.nextOffset,limit:20});assert.equal(second.rows.length,7);assert.equal(second.nextOffset,null);assert.equal(second.rows[6].inspection.inspectionId,'INS-26');
 await assert.rejects(f.call('quality_read_inspections',{recordId:'guessed',offset:0}),/invalid-arguments/);
 await assert.rejects(f.call('quality_read_inspections',{limit:21}),/invalid/);await assert.rejects(f.call('quality_read_context',{},'foreign',f.exec('foreign','session-other')),/not-bound/);
 await assert.rejects(f.api.readContext('guessed',f.sessionId),/access-denied/);
 f.state.owner={organizationId:'org',ownerPrincipalId:'other'};await assert.rejects(f.call('quality_read_context'),/access-denied/);
 assert.equal(f.state.calls,0,'read tools never masquerade as a real calculation');
});

test('Agent executes the existing analysis service, advances the same Session, preserves original run and replays a tool call once',async t=>{
 const f=await fixture(t);await f.bind();const before=await f.call('quality_read_context');assert.equal(before.analysis.statistics.summary.inspectedQuantity,300);
 const saved=await f.call('quality_analyze',{filter:{trendGranularity:'week'}},'week-call');assert.equal(saved.sessionId,f.sessionId);assert.equal(saved.originRunId,'r1');assert.notEqual(saved.runId,'r1');assert.equal(saved.analysis.statistics.trend.length,1);assert.equal(saved.analysis.statistics.summary.nonconformingQuantity,15);assert.equal(f.state.calls,1);
 assert.equal((await f.context()).runId,saved.runId);assert.deepEqual((await f.service.history(f.record.id)).runs[0],f.run);assert.deepEqual((await f.service.history(f.record.id)).runs[1].content.projectContext,f.run.content.projectContext);
 assert.deepEqual(await f.call('quality_analyze',{filter:{trendGranularity:'week'}},'week-call'),saved);assert.equal(f.state.calls,1);
 await assert.rejects(f.call('quality_analyze',{filter:{trendGranularity:'month'}},'week-call'),/operation-conflict/);
 await f.bind();assert.equal((await f.context()).runId,saved.runId,'reopening the origin session does not reset its working run');
 await f.reopen();assert.equal((await f.context()).runId,saved.runId);const month=await f.call('quality_analyze',{filter:{trendGranularity:'month'}},'month-call');assert.equal(month.sessionId,f.sessionId);assert.equal(month.analysis.statistics.trend[0].date,'2026-10-01');
});

test('current-run reverse lookup survives cold reload, is exact and unique, and verifies actor, record and native ownership',async t=>{
 const f=await fixture(t),origin={recordId:f.record.id,runId:'r1',contentHash:f.run.contentHash};
 assert.equal(await f.api.findRunSession(origin),undefined);await f.bind();
 const first=await f.call('quality_analyze',{filter:{trendGranularity:'week'}},'first-continuation');
 const firstView={recordId:first.recordId,runId:first.runId,contentHash:first.contentHash};
 assert.deepEqual(await f.api.findRunSession(firstView),await f.context());assert.equal(await f.api.findRunSession(origin),undefined);
 await f.reopen();const restored=await f.api.findRunSession(firstView);assert.equal(restored.sessionId,f.sessionId);assert.equal(restored.originRunId,'r1');
 const second=await f.call('quality_analyze',{filter:{trendGranularity:'month'}},'next-continuation'),current={recordId:second.recordId,runId:second.runId,contentHash:second.contentHash};
 assert.equal(await f.api.findRunSession(firstView),undefined,'historical intermediate results do not retarget a newer Session');
 await assert.rejects(f.api.findRunSession({...current,contentHash:'f'.repeat(64)}),/quality\/store\/run-hash-conflict/);
 await assert.rejects(f.api.findRunSession({...current,recordId:'foreign-record'}),/not-found|access-denied/);
 f.state.actor={...actor,principalId:'another-member'};await assert.rejects(f.api.findRunSession(current),/not-found|access-denied/);f.state.actor={...actor};
 f.state.owner={organizationId:'org',ownerPrincipalId:'other'};await assert.rejects(f.api.findRunSession(current),/access-denied/);f.state.owner={organizationId:'org',ownerPrincipalId:actor.principalId};
 f.state.active=false;await assert.rejects(f.api.findRunSession(current),/access-denied/);f.state.active=true;
 const cancelled=new AbortController();cancelled.abort();await assert.rejects(f.api.findRunSession(current,cancelled.signal),{name:'AbortError'});
 await f.api.bind({...current,sessionId:'session-ambiguous-owned-binding'});
 await assert.rejects(f.api.findRunSession(current),/session-selection-conflict/);
});

test('Host-bound report target persists and drives native tools without visible report identifiers; invalid targets cannot change it',async t=>{
 const f=await fixture(t,{nativeAgent:true});await f.bind();const view={recordId:f.record.id,runId:'r1',contentHash:f.run.contentHash};
 const fields={title:'报告甲',analysis:'甲分析',conclusion:'甲结论',recommendations:'甲建议'};
 const a=await f.service.saveReportDocument(view.recordId,view.runId,view.contentHash,{operationId:'selected-a',fields},f.library);
 const b=await f.service.saveReportDocument(view.recordId,view.runId,view.contentHash,{operationId:'selected-b',fields:{...fields,title:'报告乙',analysis:'乙分析'}},f.library);
 const targetA={reportId:a.reportId,revisionId:a.revisionId},selected=await f.api.selectReport(view,f.sessionId,targetA);
 assert.deepEqual(selected.selectedReport,targetA);assert.deepEqual(await f.api.selectReport(view,f.sessionId,targetA),selected,'reopening the same target is idempotent');
 await f.reopen();assert.deepEqual((await f.context()).selectedReport,targetA);
 const read=await f.call('quality_read_report_draft');assert.equal(read.report.reportId,a.reportId);assert.deepEqual(read.report.fields,fields);
 const drafted=await f.call('quality_update_report_draft',{analysis:'按当前界面选择加工甲'},'selected-a-ai');assert.equal(drafted.reportDraft.reportId,a.reportId);
 const before=await f.context();await assert.rejects(f.api.selectReport(view,f.sessionId,{reportId:'foreign-report',revisionId:a.revisionId}),/not-found/);assert.deepEqual(await f.context(),before);
 await assert.rejects(f.api.selectReport({...view,recordId:'foreign-record'},f.sessionId,targetA),/context-conflict/);
 f.state.owner={organizationId:'org',ownerPrincipalId:'other'};await assert.rejects(f.api.selectReport(view,f.sessionId,targetA),/access-denied/);f.state.owner={organizationId:'org',ownerPrincipalId:actor.principalId};
 const targetB={reportId:b.reportId,revisionId:b.revisionId};await f.api.selectReport(view,f.sessionId,targetB);
 const next=await f.call('quality_read_report_draft');assert.equal(next.draft,null);assert.equal(next.report.reportId,b.reportId);
 const second=await f.call('quality_update_report_draft',{analysis:'独立加工乙'},'selected-b-ai');assert.equal(second.reportDraft.reportId,b.reportId);assert.notEqual(second.reportDraft.draftId,drafted.reportDraft.draftId);
 assert.equal((await f.service.readReportDraft(view.recordId,view.runId,view.contentHash,drafted.reportDraft.draftId,f.library)).fields.analysis,'按当前界面选择加工甲');
 const cleared=await f.api.selectReport(view,f.sessionId,null);assert.equal(cleared.selectedReport,undefined);assert.equal((await f.context()).selectedReport,undefined);
 await f.api.selectReport(view,f.sessionId,targetA);const analyzed=await f.call('quality_analyze',{filter:{trendGranularity:'week'}},'selected-new-analysis');assert.equal(analyzed.selectedReport,undefined);
 await assert.rejects(f.api.selectReport({recordId:view.recordId,runId:analyzed.runId,contentHash:analyzed.contentHash},f.sessionId,targetA),/not-found/);
});

test('Host report selection rejects native maintenance and running turns without waiting or changing the bound target',{timeout:10000},async t=>{
 const f=await fixture(t,{nativeAgent:true});await f.bind();const view={recordId:f.record.id,runId:'r1',contentHash:f.run.contentHash};
 const report=await f.service.saveReportDocument(view.recordId,view.runId,view.contentHash,{operationId:'busy-target',fields:{title:'当前报告',analysis:'分析',conclusion:'结论',recommendations:'建议'}},f.library);
 const target={reportId:report.reportId,revisionId:report.revisionId};await f.api.selectReport(view,f.sessionId,target);const before=await f.context();
 const maintenance=Promise.withResolvers(),held=f.agent.runMaintenance(async()=>maintenance.promise);
 try{
  assert.equal(f.agent.status,'idle','native maintenance owns the Agent despite public idle status');
  await assert.rejects(f.api.selectReport(view,f.sessionId,null),/^Error: quality\/ai\/session-busy$/);assert.deepEqual(await f.context(),before);
 }finally{maintenance.resolve();await held;}
 const entered=Promise.withResolvers(),turn=Promise.withResolvers();
 const remove=f.ctx.on('agent/pre-step',async payload=>{assert.equal(payload.agent,f.agent);entered.resolve();await turn.promise;return {kind:'reject'};});
 try{
  f.agent.followup(Llm.createMessage({role:'user',source:{kind:'user'},content:[{type:'text',text:'只测试原生运行边界，不调用模型'}]}));await entered.promise;
  assert.equal(f.agent.status,'running');await assert.rejects(f.api.selectReport(view,f.sessionId,null),/^Error: quality\/ai\/session-busy$/);assert.deepEqual(await f.context(),before);
 }finally{turn.resolve();await f.agent.whenIdle();remove();}
 assert.equal((await f.api.selectReport(view,f.sessionId,null)).selectedReport,undefined,'an explicit idle retry succeeds');
});

test('Host report selection observes native cancellation, request cancellation and authority loss before committing',{timeout:10000},async t=>{
 const f=await fixture(t,{nativeAgent:true});await f.bind();const view={recordId:f.record.id,runId:'r1',contentHash:f.run.contentHash};
 const fields={title:'报告甲',analysis:'分析',conclusion:'结论',recommendations:'建议'};
 const a=await f.service.saveReportDocument(view.recordId,view.runId,view.contentHash,{operationId:'cancel-a',fields},f.library);
 const b=await f.service.saveReportDocument(view.recordId,view.runId,view.contentHash,{operationId:'cancel-b',fields:{...fields,title:'报告乙'}},f.library);
 const targetA={reportId:a.reportId,revisionId:a.revisionId},targetB={reportId:b.reportId,revisionId:b.revisionId};await f.api.selectReport(view,f.sessionId,targetA);const before=await f.context();
 const read=f.service.readReportDocument.bind(f.service);let entered,release;
 f.service.readReportDocument=async(...args)=>{entered.resolve(args.at(-1));await release.promise;return read(...args);};
 for(const mode of ['native','request','revocation']){
  entered=Promise.withResolvers();release=Promise.withResolvers();const controller=new AbortController();
  const selection=f.api.selectReport(view,f.sessionId,targetB,controller.signal),outcome=selection.then(value=>({value}),error=>({error}));
  const activeSignal=await entered.promise;assert.equal(f.agent.status,'idle');
  await assert.rejects(f.api.selectReport(view,f.sessionId,null),/^Error: quality\/ai\/session-busy$/,'a second Host selection cannot enter the first selection\'s maintenance claim');
  if(mode==='native')f.agent.cancel({kind:'user'});else if(mode==='request')controller.abort();else f.state.active=false;
  if(mode!=='revocation')assert.equal(activeSignal.aborted,true,'the business read uses the fused native/request cancellation signal');
  release.resolve();const result=await outcome;
  if(mode==='native')assert.equal(result.error?.kind,'user');else if(mode==='request')assert.equal(result.error?.name,'AbortError');else assert.match(String(result.error),/quality\/service\/access-denied/);
  f.state.active=true;assert.deepEqual(await f.context(),before);assert.equal(f.agent.status,'idle');
 }
 f.service.readReportDocument=read;await f.agentHandle.dispose();f.agentHandle=undefined;
 await assert.rejects(f.api.selectReport(view,f.sessionId,targetB),/quality\/service\/session-unavailable/);assert.deepEqual(await f.context(),before);
});

test('Host report selection fails closed when the native Agent registry is unavailable',async t=>{
 const f=await fixture(t);await f.bind();const before=await f.context();
 await assert.rejects(f.api.selectReport({recordId:f.record.id,runId:'r1',contentHash:f.run.contentHash},f.sessionId,null),/quality\/service\/session-unavailable/);assert.deepEqual(await f.context(),before);
});

test('registered native tool executes the actual bounded worker on all rows instead of returning an Office preview or precomputed response',async t=>{
 const rows=Array.from({length:35},(_,i)=>['INS-'+i,'2026-10-'+String(1+i%20).padStart(2,'0'),'100',String(i%5),'piece','initial']),f=await fixture(t,{rows,actualWorker:true});await f.bind();
 const saved=await f.call('quality_analyze',{filter:{trendGranularity:'week'}},'real-worker');assert.equal(f.state.calls,1);assert.equal(saved.analysis.statistics.summary.inspectionCount,35);assert.equal(saved.analysis.statistics.summary.inspectedQuantity,3500);assert.equal(saved.analysis.statistics.summary.nonconformingQuantity,70);assert.equal(saved.analysis.statistics.trend.length,4);
 assert.equal((await f.context()).runId,saved.runId);assert.equal((await f.service.history(f.record.id)).runs[0].content.dataset.inspections.length,35);
});

test('AI processes the real saved report into an independent CAS draft, preserves unpatched fields, and never edits formal or manual drafts',async t=>{
 const f=await fixture(t);await f.bind();const fields={title:'本月质量报告',analysis:'原分析',conclusion:'原结论',recommendations:'原建议'};
 const formal=await f.service.saveReportDocument(f.record.id,'r1',f.run.contentHash,{operationId:'formal-first',fields},f.library);
 const manual=await f.service.saveReportDraft(f.record.id,'r1',f.run.contentHash,{operationId:'manual-draft',fields:{...fields,analysis:'尚未保存的人工编辑基底'}},f.library);
 const basis=await f.call('quality_read_report_draft');assert.equal(basis.draft,null);assert.equal(basis.report.reportId,formal.reportId);assert.deepEqual(basis.report.fields,fields);
 const created=await f.call('quality_update_report_draft',{analysis:'AI根据实际检验数据加工'},'draft-first');assert.ok(created.reportDraft.draftId);assert.notEqual(created.reportDraft.draftId,manual.draftId);assert.equal(created.reportDraft.reportId,formal.reportId);assert.equal(created.reportDraft.baseRevisionId,formal.revisionId);
 const read=await f.call('quality_read_report_draft');assert.deepEqual(read.draft.fields,{...fields,analysis:'AI根据实际检验数据加工'});
 const edited=await f.call('quality_update_report_draft',{conclusion:'AI补充的结论',expected_draft_revision:read.draft.draftRevision},'draft-edit');assert.notEqual(edited.reportDraft.draftRevision,read.draft.draftRevision);
 await assert.rejects(f.call('quality_update_report_draft',{conclusion:'过期覆盖',expected_draft_revision:read.draft.draftRevision},'stale-edit'),/revision-conflict/);
 assert.deepEqual((await f.service.readReportDocument(f.record.id,'r1',f.run.contentHash,formal.reportId,formal.revisionId,f.library)).fields,fields);
 assert.equal((await f.service.readReportDraft(f.record.id,'r1',f.run.contentHash,manual.draftId,f.library)).fields.analysis,'尚未保存的人工编辑基底');
 for(const snapshot of f.snapshots)assert.equal(JSON.stringify(snapshot).includes('AI根据实际检验数据加工'),false,'AI context contains references, never report bodies');
 await f.reopen();assert.equal((await f.context()).reportDraft.draftId,edited.reportDraft.draftId);assert.equal((await f.call('quality_read_report_draft')).draft.fields.conclusion,'AI补充的结论');
 const newRun=await f.call('quality_analyze',{filter:{trendGranularity:'week'}},'new-basis');assert.equal(newRun.reportDraft,undefined);assert.equal((await f.service.readReportDraft(f.record.id,'r1',f.run.contentHash,edited.reportDraft.draftId,f.library)).status,'active');
});

test('committed analysis and draft receipts recover context-write failures without duplicate runs or erased text',async t=>{
 const fault={armed:false,afterCommit:false},f=await fixture(t,{fault});await f.bind();fault.armed=true;
 await assert.rejects(f.call('quality_analyze',{filter:{trendGranularity:'week'}},'recover-run'),/context-response-lost/);assert.equal((await f.context()).runId,'r1');assert.equal(f.state.calls,1);
 await f.reopen();const recovered=await f.call('quality_analyze',{filter:{trendGranularity:'week'}},'recover-run');assert.equal(f.state.calls,1);assert.equal((await f.service.history(f.record.id)).runs.length,2);
 const first=await f.call('quality_update_report_draft',{title:'草稿',analysis:'保留分析',conclusion:'保留结论'},'first-draft');fault.armed=true;
 const args={recommendations:'新增建议',expected_draft_revision:first.reportDraft.draftRevision};await assert.rejects(f.call('quality_update_report_draft',args,'recover-draft'),/context-response-lost/);
 await f.reopen();const restored=await f.call('quality_update_report_draft',args,'recover-draft');assert.equal((await f.context()).reportDraft.draftRevision,restored.reportDraft.draftRevision);assert.deepEqual((await f.call('quality_read_report_draft')).draft.fields,{title:'草稿',analysis:'保留分析',conclusion:'保留结论',recommendations:'新增建议'});assert.equal((await f.context()).runId,recovered.runId);
});

test('explicitly selecting another formal report creates a separate AI draft and cannot retarget or overwrite the old draft',async t=>{
 const f=await fixture(t);await f.bind();const fields={title:'报告甲',analysis:'甲分析',conclusion:'甲结论',recommendations:'甲建议'};
 const first=await f.service.saveReportDocument(f.record.id,'r1',f.run.contentHash,{operationId:'report-a',fields},f.library);
 const second=await f.service.saveReportDocument(f.record.id,'r1',f.run.contentHash,{operationId:'report-b',fields:{...fields,title:'报告乙',analysis:'乙分析'}},f.library);
 const selection={report_id:first.reportId,base_revision_id:first.revisionId};const basis=await f.call('quality_read_report_draft',selection);assert.deepEqual(basis.report.fields,fields);
 await assert.rejects(f.call('quality_read_report_draft',{report_id:'guessed-report',base_revision_id:first.revisionId}),/not-found/);
 await assert.rejects(f.call('quality_update_report_draft',{...selection,recordId:f.record.id,analysis:'spoof'}),/invalid-arguments/);
 const saved=await f.call('quality_update_report_draft',{...selection,analysis:'仅加工甲分析'},'edit-report-a');assert.equal(saved.reportDraft.reportId,first.reportId);
 const read=await f.call('quality_read_report_draft',selection);assert.deepEqual(read.draft.fields,{...fields,analysis:'仅加工甲分析'});
 const wrong={report_id:second.reportId,base_revision_id:second.revisionId};const nextBasis=await f.call('quality_read_report_draft',wrong);assert.equal(nextBasis.draft,null);assert.equal(nextBasis.report.fields.analysis,'乙分析');assert.equal(nextBasis.previousDraft.draftId,saved.reportDraft.draftId);
 await assert.rejects(f.call('quality_update_report_draft',{...wrong,analysis:'不可静默改乙',expected_draft_revision:read.draft.draftRevision},'wrong-parent'),/revision-conflict/);
 const separate=await f.call('quality_update_report_draft',{...wrong,analysis:'单独加工乙'},'new-report-b');assert.notEqual(separate.reportDraft.draftId,saved.reportDraft.draftId);assert.equal(separate.reportDraft.reportId,second.reportId);
 assert.deepEqual((await f.service.readReportDraft(f.record.id,'r1',f.run.contentHash,saved.reportDraft.draftId,f.library)).fields,{...fields,analysis:'仅加工甲分析'});
 const originalSecond=await f.service.readReportDocument(f.record.id,'r1',f.run.contentHash,second.reportId,second.revisionId,f.library);assert.equal(originalSecond.fields.analysis,'乙分析');
 await f.call('quality_analyze',{filter:{trendGranularity:'week'}},'different-run');await assert.rejects(f.call('quality_read_report_draft',selection),/not-found/);
});

test('adopting and archiving an AI draft permits a second native round based on the actual newly saved formal revision',async t=>{
 const f=await fixture(t);await f.bind();const fields={title:'质量报告',analysis:'原分析',conclusion:'原结论',recommendations:'原建议'};
 const first=await f.service.saveReportDocument(f.record.id,'r1',f.run.contentHash,{operationId:'first-report',fields},f.library);
 const firstSelection={report_id:first.reportId,base_revision_id:first.revisionId};const edited=await f.call('quality_update_report_draft',{...firstSelection,analysis:'第一轮AI加工'},'round-one');
 const draft=await f.service.readReportDraft(f.record.id,'r1',f.run.contentHash,edited.reportDraft.draftId,f.library);
 const adopted=await f.service.saveReportDocument(f.record.id,'r1',f.run.contentHash,{reportId:first.reportId,expectedRevisionId:first.revisionId,operationId:'adopt-round-one',fields:draft.fields},f.library);
 await f.service.archiveReportDraft(f.record.id,'r1',f.run.contentHash,draft.draftId,draft.draftRevision,'archive-round-one',f.library);
 assert.equal((await f.context()).reportDraft.status,'archived');const selected={report_id:adopted.reportId,base_revision_id:adopted.revisionId};
 const reopened=await f.call('quality_read_report_draft',selected);assert.equal(reopened.draft,null);assert.deepEqual(reopened.report.fields,draft.fields);
 await assert.rejects(f.call('quality_update_report_draft',{...selected,conclusion:'过期旧CAS',expected_draft_revision:draft.draftRevision},'stale-new-round'),/revision-conflict/);
 const second=await f.call('quality_update_report_draft',{...selected,conclusion:'第二轮结论'},'round-two');assert.equal(second.sessionId,f.sessionId);assert.notEqual(second.reportDraft.draftId,draft.draftId);assert.equal(second.reportDraft.baseRevisionId,adopted.revisionId);
 const secondRead=await f.call('quality_read_report_draft',selected);assert.deepEqual(secondRead.draft.fields,{...draft.fields,conclusion:'第二轮结论'});assert.equal((await f.service.readReportDraft(f.record.id,'r1',f.run.contentHash,draft.draftId,f.library)).status,'archived');
 assert.deepEqual((await f.service.readReportDocument(f.record.id,'r1',f.run.contentHash,adopted.reportId,adopted.revisionId,f.library)).fields,draft.fields);
 await f.reopen();assert.equal((await f.context()).sessionId,f.sessionId);assert.equal((await f.call('quality_read_report_draft',selected)).draft.draftId,second.reportDraft.draftId);
});

test('revocation and cancellation after actual calculation do not append a run or change Session context',async t=>{
 const f=await fixture(t);await f.bind();f.state.afterExecute=async()=>{f.state.active=false;};await assert.rejects(f.call('quality_analyze',{filter:{trendGranularity:'week'}},'revoked'),/access-denied/);
 f.state.active=true;assert.equal((await f.context()).runId,'r1');assert.equal((await f.service.history(f.record.id)).runs.length,1);
 const controller=new AbortController();f.state.afterExecute=async()=>controller.abort();await assert.rejects(f.call('quality_analyze',{filter:{trendGranularity:'week'}},'aborted',f.exec('aborted',f.sessionId,controller.signal)),{name:'AbortError'});
 assert.equal((await f.context()).runId,'r1');assert.equal((await f.service.history(f.record.id)).runs.length,1);
});

test('ai-context RPC requires exact record/session input and returns its authorized current references',async t=>{
 const f=await fixture(t);await f.bind();
 const rpc=async payload=>f.handleQualityRecordsRequest(new Request('http://local/api/workdsh-quality-records',{method:'POST',body:JSON.stringify({endpoint:'ai-context',payload})}),f.service,undefined,undefined,undefined,undefined,undefined,undefined,undefined,(recordId,sessionId,signal)=>f.api.readContext(recordId,sessionId,signal));
 const response=await rpc({recordId:f.record.id,sessionId:f.sessionId});assert.equal(response.status,200);assert.deepEqual((await response.json()).value,await f.context());
 assert.equal((await rpc({recordId:f.record.id,sessionId:f.sessionId,runId:'guessed'})).status,400);assert.equal((await rpc({recordId:'guessed',sessionId:f.sessionId})).status,403);
});

test('ai-session RPC accepts only a validated optional report target and leaves its receipt at four fields',async t=>{
 const f=await fixture(t,{nativeAgent:true});await f.bind();const view={recordId:f.record.id,runId:'r1',contentHash:f.run.contentHash},fields={title:'报告',analysis:'分析',conclusion:'结论',recommendations:'建议'};
 const report=await f.service.saveReportDocument(view.recordId,view.runId,view.contentHash,{operationId:'rpc-report',fields},f.library);
 const target={reportId:report.reportId,revisionId:report.revisionId};let selectionCalls=0;
 const rpc=async(payload,endpoint='ai-session')=>f.handleQualityRecordsRequest(new Request('http://local/api/workdsh-quality-records',{method:'POST',body:JSON.stringify({endpoint,payload})}),f.service,undefined,undefined,undefined,undefined,async(request,signal)=>{
  if(request.reportTarget!==undefined){selectionCalls++;await f.api.selectReport(request,f.sessionId,request.reportTarget,signal);}
  return {recordId:request.recordId,runId:request.runId,contentHash:request.contentHash,sessionId:f.sessionId};
 });
 const response=await rpc({...view,reportTarget:target});assert.equal(response.status,200);assert.deepEqual((await response.json()).value,{...view,sessionId:f.sessionId});assert.deepEqual((await f.context()).selectedReport,target);
 assert.equal((await rpc(view)).status,200);assert.equal(selectionCalls,1);assert.deepEqual((await f.context()).selectedReport,target);
 assert.equal((await rpc({...view,reportTarget:{...target,sessionId:'spoof'}})).status,400);assert.equal((await rpc({...view,reportTarget:target},'ai-candidate')).status,400);
 assert.equal((await rpc({...view,reportTarget:{reportId:'foreign-report',revisionId:report.revisionId}})).status,404);assert.deepEqual((await f.context()).selectedReport,target);
 assert.equal((await rpc({...view,reportTarget:null})).status,200);assert.equal((await f.context()).selectedReport,undefined);
});


test('Host focus binds the same native Session to filtered immutable evidence and report tools retain its full analytical basis',async t=>{
 const f=await fixture(t,{nativeAgent:true});await f.bind();const view={recordId:f.record.id,runId:'r1',contentHash:f.run.contentHash};
 assert.equal((await f.call('quality_read_context')).focus,null);await assert.rejects(f.call('quality_read_focused_inspections'),/not-selected/);
 const focused=await f.api.selectFocus(view,f.sessionId,{kind:'inspection',inspectionId:'002'});
 assert.equal(focused.sessionId,f.sessionId);assert.deepEqual(focused.selectedFocus,{kind:'inspection',inspectionId:'002'});
 assert.deepEqual(await f.api.selectFocus(view,f.sessionId,focused.selectedFocus),focused,'the same selection is idempotent');
 const read=await f.call('quality_read_context');assert.equal(read.analysis.statistics.summary.inspectedQuantity,300);assert.equal(read.focus.total,1);
 assert.equal(read.focus.rows[0].inspection.inspectedQuantity,200);assert.equal(read.focus.rows[0].sourceRow,2);assert.equal(read.focus.rows[0].location.line,3);
 assert.deepEqual(read.focus.range,{dateFrom:'2026-10-11',dateTo:'2026-10-11',trendGranularity:'day'});
 const evidence=await f.call('quality_read_focused_inspections');assert.equal(evidence.runId,'r1');assert.equal(evidence.rows[0].inspection.inspectionId,'002');assert.equal(evidence.nextOffset,null);
 await assert.rejects(f.call('quality_read_focused_inspections',{inspectionId:'001'}),/invalid-arguments/);
 const drafted=await f.call('quality_update_report_draft',{conclusion:'仅核查第二条记录，不能断言根因'},'focus-draft');assert.deepEqual(drafted.selectedFocus,focused.selectedFocus);
 assert.equal((await f.call('quality_read_report_draft')).draft.runId,'r1');assert.equal((await f.context()).reportDraft.draftId,drafted.reportDraft.draftId);
 await f.reopen();assert.deepEqual((await f.context()).selectedFocus,focused.selectedFocus);assert.equal((await f.call('quality_read_context')).focus.rows[0].inspection.inspectionId,'002');
 const analyzed=await f.call('quality_analyze',{filter:{trendGranularity:'week'}},'focus-recalculate');assert.equal(analyzed.selectedFocus,undefined);assert.equal((await f.context()).selectedFocus,undefined);
 await assert.rejects(f.api.selectFocus(view,f.sessionId,focused.selectedFocus),/context-conflict/);
});

test('focus evidence obeys saved date filters, current trend granularity and bounded paging',async t=>{
 const rows=Array.from({length:27},(_,i)=>['INS-'+i,i===0?'2026-10-09':'2026-10-10','100','5','piece','initial']);
 const f=await fixture(t,{rows,filter:{dateFrom:'2026-10-10',trendGranularity:'week'},nativeAgent:true});await f.bind();const view={recordId:f.record.id,runId:'r1',contentHash:f.run.contentHash};
 await assert.rejects(f.api.selectFocus(view,f.sessionId,{kind:'inspection',inspectionId:'INS-0'}),/focus\/not-found/);
 await assert.rejects(f.api.selectFocus(view,f.sessionId,{kind:'period',date:'2026-10-10'}),/focus\/not-found/);
 const selected={kind:'period',date:'2026-10-05'},page=await f.service.readRunFocusInspections(view.recordId,view.runId,view.contentHash,selected,0);
 assert.equal(page.total,26);assert.equal(page.rows.length,20);assert.equal(page.rows[0].inspection.inspectionId,'INS-1');assert.equal(page.rows[0].sourceRow,2);assert.equal(page.nextOffset,20);
 assert.deepEqual(page.range,{dateFrom:'2026-10-10',dateTo:'2026-10-10',trendGranularity:'week'});
 await f.api.selectFocus(view,f.sessionId,selected);const remaining=await f.call('quality_read_focused_inspections',{offset:20});assert.equal(remaining.rows.length,6);assert.equal(remaining.nextOffset,null);
 assert.equal(remaining.rows.at(-1).sourceRow,27);assert.equal((await f.call('quality_read_inspections')).total,27,'full data reading retains its existing contract');
 const before=await f.context();await assert.rejects(f.api.selectFocus({...view,recordId:'foreign-record'},f.sessionId,selected),/context-conflict/);
 await assert.rejects(f.api.selectFocus({...view,contentHash:'f'.repeat(64)},f.sessionId,selected),/context-conflict/);
 await assert.rejects(f.api.selectFocus(view,'unbound-session',selected),/not-bound/);
 f.state.owner={organizationId:'org',ownerPrincipalId:'other'};await assert.rejects(f.api.selectFocus(view,f.sessionId,selected),/access-denied/);f.state.owner={organizationId:'org',ownerPrincipalId:actor.principalId};
 assert.deepEqual(await f.context(),before);
});

test('focus changes fail closed during native turns and maintenance and cannot bypass cancellation or revocation',{timeout:10000},async t=>{
 const f=await fixture(t,{nativeAgent:true});await f.bind();const view={recordId:f.record.id,runId:'r1',contentHash:f.run.contentHash},first={kind:'inspection',inspectionId:'001'},second={kind:'inspection',inspectionId:'002'};
 await f.api.selectFocus(view,f.sessionId,first);const before=await f.context(),held=Promise.withResolvers(),maintenance=f.agent.runMaintenance(async()=>held.promise);
 try{await assert.rejects(f.api.selectFocus(view,f.sessionId,second),/session-busy/);}finally{held.resolve();await maintenance;}
 const entered=Promise.withResolvers(),turn=Promise.withResolvers(),remove=f.ctx.on('agent/pre-step',async payload=>{assert.equal(payload.agent,f.agent);entered.resolve();await turn.promise;return {kind:'reject'};});
 try{f.agent.followup(Llm.createMessage({role:'user',source:{kind:'user'},content:[{type:'text',text:'只测试原生焦点锁，不调用模型'}]}));await entered.promise;await assert.rejects(f.api.selectFocus(view,f.sessionId,second),/session-busy/);}
 finally{turn.resolve();await f.agent.whenIdle();remove();}
 assert.deepEqual(await f.context(),before);
 const read=f.service.readRunFocusInspections.bind(f.service);let readEntered,readRelease;
 f.service.readRunFocusInspections=async(...args)=>{readEntered.resolve(args.at(-1));await readRelease.promise;return read(...args);};
 for(const mode of ['native','request','revocation']){
  readEntered=Promise.withResolvers();readRelease=Promise.withResolvers();const controller=new AbortController(),selection=f.api.selectFocus(view,f.sessionId,second,controller.signal),outcome=selection.then(value=>({value}),error=>({error})),activeSignal=await readEntered.promise;
  await assert.rejects(f.api.selectFocus(view,f.sessionId,null),/session-busy/);
  if(mode==='native')f.agent.cancel({kind:'user'});else if(mode==='request')controller.abort();else f.state.active=false;
  if(mode!=='revocation')assert.equal(activeSignal.aborted,true);
  readRelease.resolve();const result=await outcome;assert.ok(result.error);f.state.active=true;assert.deepEqual(await f.context(),before);
 }
 f.service.readRunFocusInspections=read;await f.api.selectFocus(view,f.sessionId,null);assert.equal((await f.context()).selectedFocus,undefined);
});

test('focus RPC rejects unbound, foreign, stale and malformed identities and never invokes Session creation',async t=>{
 const f=await fixture(t,{nativeAgent:true});await f.bind();const view={recordId:f.record.id,runId:'r1',contentHash:f.run.contentHash},selection={kind:'inspection',inspectionId:'002'};let sessionCreates=0;
 const rpc=async(endpoint,payload)=>f.handleQualityRecordsRequest(new Request('https://fixture.test/api',{method:'POST',body:JSON.stringify({endpoint,payload})}),f.service,undefined,undefined,undefined,undefined,async()=>{sessionCreates++;throw Error('must-not-create');},undefined,undefined,(recordId,sessionId,signal)=>f.api.readContext(recordId,sessionId,signal),(basis,sessionId,focus,signal)=>f.api.selectFocus(basis,sessionId,focus,signal));
 const preview=await rpc('focus-inspections',{...view,selection,offset:0});assert.equal(preview.status,200);assert.equal((await preview.json()).value.rows[0].inspection.inspectionId,'002');
 const selected=await rpc('ai-focus',{...view,sessionId:f.sessionId,selection});assert.equal(selected.status,200);assert.deepEqual((await selected.json()).value.selectedFocus,selection);assert.equal(sessionCreates,0);
 assert.equal((await rpc('ai-focus',{...view,sessionId:'unbound',selection})).status,409);
 assert.equal((await rpc('ai-focus',{...view,contentHash:'f'.repeat(64),sessionId:f.sessionId,selection})).status,409);
 assert.equal((await rpc('ai-focus',{...view,sessionId:f.sessionId,selection:{...selection,recordId:'spoofed'}})).status,400);
 assert.equal((await rpc('focus-inspections',{...view,selection:{kind:'inspection',inspectionId:'guessed'},offset:0})).status,404);
 assert.equal((await rpc('focus-inspections',{...view,selection,offset:-1})).status,400);
 assert.equal((await rpc('focus-inspections',{...view,selection,offset:0,sessionId:f.sessionId})).status,400);
 assert.equal(sessionCreates,0);assert.deepEqual((await f.context()).selectedFocus,selection);
});

test('focus CAS refuses a selection prepared before another business-context mutation committed',async t=>{
 const f=await fixture(t,{nativeAgent:true});await f.bind();const view={recordId:f.record.id,runId:'r1',contentHash:f.run.contentHash};
 const read=f.service.readRunFocusInspections.bind(f.service),entered=Promise.withResolvers(),release=Promise.withResolvers();
 f.service.readRunFocusInspections=async(...args)=>{entered.resolve();await release.promise;return read(...args);};
 const pending=f.api.selectFocus(view,f.sessionId,{kind:'inspection',inspectionId:'002'}),outcome=pending.then(value=>({value}),error=>({error}));await entered.promise;
 // A separate business storage write can commit even while native maintenance
 // owns the Agent. The focus setter must still compare the saved revision.
 const draft=await f.call('quality_update_report_draft',{analysis:'并发保存的报告草稿'},'concurrent-draft');release.resolve();
 assert.match(String((await outcome).error),/context-conflict/);const actual=await f.context();assert.equal(actual.selectedFocus,undefined);assert.equal(actual.reportDraft.draftId,draft.reportDraft.draftId);
});


test('focus evidence preserves original row provenance after reviewed cleaning and uses corrected immutable values',async t=>{
 const rows=[['001','2026-10-10','100','5','piece','initial'],['002','2026-10-11','200','10','piece','initial'],['003','2026-10-12','300','15','piece','initial']];
 const f=await fixture(t,{rows,decisions:[{kind:'exclude',row:1,reason:'重复检验单'},{kind:'correct',row:2,header:'bad',expected:'10',value:'20',reason:'对照检验单确认'}]});
 const args=[f.record.id,'r1',f.run.contentHash];await assert.rejects(f.service.readRunFocusInspections(...args,{kind:'inspection',inspectionId:'001'},0),/not-found/);
 const corrected=await f.service.readRunFocusInspections(...args,{kind:'inspection',inspectionId:'002'},0);assert.equal(corrected.rows[0].sourceRow,2);assert.equal(corrected.rows[0].location.line,3);assert.equal(corrected.rows[0].inspection.nonconformingQuantity,20);
 const retained=await f.service.readRunFocusInspections(...args,{kind:'inspection',inspectionId:'003'},0);assert.equal(retained.rows[0].sourceRow,3);assert.equal(retained.rows[0].location.line,4);
 assert.equal(f.run.content.sources.inspections.imported.table.rows[1][3],'10','the source value remains unchanged');
});
