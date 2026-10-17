import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

// Execute the real editor's event handlers and hook state with deferred Host
// replies. Child visuals stay opaque; this is not browser acceptance.
const require=createRequire(new URL('../../../../apps/web/package.json',import.meta.url));
const built=await require('esbuild').build({entryPoints:[fileURLToPath(new URL('../src/client/QualityReportEditor.tsx',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false,jsx:'transform',
 tsconfigRaw:{compilerOptions:{jsx:'react',jsxFactory:'React.createElement',jsxFragmentFactory:'React.Fragment'}},
 plugins:[{name:'report-draft-controller-hooks',setup(builder){
  builder.onResolve({filter:/^react$/},()=>({path:'react',namespace:'report-draft-controller-hooks'}));
  builder.onLoad({filter:/.*/,namespace:'report-draft-controller-hooks'},()=>({contents:`
   const React={createElement:(type,props,...children)=>({type,props:{...props,children}}),Fragment:Symbol.for('test.fragment')};
   export default React;
   export const useState=(...args)=>globalThis.__qualityDraftHooks.useState(...args);
   export const useRef=(...args)=>globalThis.__qualityDraftHooks.useRef(...args);
   export const useEffect=(...args)=>globalThis.__qualityDraftHooks.useEffect(...args);
  `,loader:'js'}));
 }}]});
const {QualityReportEditor}=await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const scope={recordId:'record',runId:'saved-run',contentHash:'a'.repeat(64)};
const textFields=title=>({title,analysis:' 保留原文\n第二行 ',conclusion:'待核对',recommendations:'复核检验记录'});
function savedReport(revisionId='report-v1'){
 const fields=textFields('正式报告');
 return {...scope,reportId:'report',fields,revisionId,currentRevisionId:revisionId,version:revisionId==='report-v1'?1:2,markdown:'# 正式报告\n',
  versions:[{version:revisionId==='report-v1'?1:2,revisionId,sha256:'b'.repeat(64),operationId:'formal-op',createdAt:'2026-10-11T00:00:00Z',title:fields.title}],
  receipt:{runId:scope.runId,contentHash:scope.contentHash,sha256:'b'.repeat(64),operationId:'host-op',assetId:'asset',revisionId,nodeId:'node',format:'markdown',detailKind:'markdown'}};
}
function savedDraft(fields=textFields('草稿'),parent={}){return {...scope,...parent,draftId:'draft',draftRevision:'draft-v1',sha256:'c'.repeat(64),updatedAt:'2026-10-11T00:00:00Z',title:fields.title,status:'active',fields};}
const nodeText=node=>Array.isArray(node)?node.map(nodeText).join(''):node&&typeof node==='object'?node.type==='style'?'':nodeText(node.props?.children):node===null||node===undefined||typeof node==='boolean'?'':String(node);
function nodes(node,result=[]){if(Array.isArray(node))node.forEach(child=>nodes(child,result));else if(node&&typeof node==='object'){result.push(node);nodes(node.props?.children,result);}return result;}
function harness({report,initialDrafts=[],unsupported=false,candidate:initialCandidate,expertSources=[],aiDraft}={}){
 const slots=[],effects=[],drafts=new Map(initialDrafts.map(item=>[item.draftId,structuredClone(item)])),saves=[],reads=[],archives=[],reports=report?[structuredClone(report)]:[];
 let cursor=0,dirty=true,tree,guard,readbackFailure=false,saveFailure=false,archiveReadbackFailure=false,archiveBodyMismatch=false,confirmed=0,formalResult,allowConfirm=false;
 let currentCandidate=initialCandidate,delayedCandidate;const candidateReads=[],formalSaves=[];
 const previousWindow=globalThis.window;
 globalThis.window={confirm:()=>{confirmed++;return allowConfirm;},addEventListener(){},removeEventListener(){}};
 const hooks={
  useState(initial){const index=cursor++;if(!slots[index])slots[index]={value:typeof initial==='function'?initial():initial};return [slots[index].value,next=>{const value=typeof next==='function'?next(slots[index].value):next;if(!Object.is(value,slots[index].value)){slots[index].value=value;dirty=true;}}];},
  useRef(initial){const index=cursor++;return slots[index]??={current:initial};},
  useEffect(run,deps){const index=cursor++,previous=slots[index];if(!previous||deps.some((value,i)=>!Object.is(value,previous.deps[i])))effects.push(()=>{previous?.cleanup?.();slots[index]={deps,cleanup:run()};});},
 };
 const client={
  async reportDocuments(){return reports.map(item=>({...item,title:item.fields.title}));},
  async reportDocument(recordId,runId,hash,reportId,revisionId){if(formalResult&&revisionId===formalResult.revisionId)return structuredClone(formalResult);const found=reports.find(item=>item.reportId===reportId);if(!found)throw Error('missing-report');return structuredClone(found);},
  async saveReportDocument(recordId,runId,hash,input){formalSaves.push(structuredClone(input));formalResult={...savedReport('report-v2'),fields:structuredClone(input.fields),reportId:input.reportId??'new-report'};formalResult.versions[0].title=input.fields.title;return structuredClone(formalResult);},
 };
 if(initialCandidate!==undefined){
  const readCandidate=async source=>{candidateReads.push(source);if(delayedCandidate){const delay=delayedCandidate;delayedCandidate=undefined;return delay;}return currentCandidate?structuredClone(currentCandidate):null;};
  Object.assign(client,{aiCandidate:async(recordId,runId,hash)=>readCandidate({recordId,runId,contentHash:hash}),
   expertSources:async()=>structuredClone(expertSources),expertCandidate:async association=>readCandidate({...association})});
 }
 if(!unsupported)Object.assign(client,{
  async reportDrafts(){return [...drafts.values()].map(item=>structuredClone(item));},
  async reportDraft(recordId,runId,hash,draftId){reads.push(draftId);if(readbackFailure){readbackFailure=false;throw Error('lost-readback');}const draft=drafts.get(draftId);if(!draft)throw Error('missing-draft');if(archiveReadbackFailure&&draft.status==='archived')throw Error('lost-archive-readback');return structuredClone(draft);},
  async saveReportDraft(recordId,runId,hash,input){saves.push(structuredClone(input));if(saveFailure){saveFailure=false;throw Error('lost-save-response');}const id=input.draftId??'draft',old=drafts.get(id);const next={...savedDraft(input.fields,input.reportId?{reportId:input.reportId,baseRevisionId:input.baseRevisionId}:{}),draftId:id,draftRevision:old?.draftRevision??'draft-v1'};drafts.set(id,next);return structuredClone(next);},
  async archiveReportDraft(recordId,runId,hash,draftId,revision,operationId){archives.push({draftId,revision,operationId});const draft=drafts.get(draftId);draft.status='archived';draft.draftRevision='archived-v2';draft.updatedAt='2026-10-11T00:01:00Z';if(archiveBodyMismatch)draft.fields.analysis='different body';return structuredClone(draft);},
 });
 const props={view:scope,client,aiDraft,onLeaveGuard:next=>{guard=next;}};
 function render(){cursor=0;dirty=false;const previous=globalThis.__qualityDraftHooks;globalThis.__qualityDraftHooks=hooks;try{const outer=QualityReportEditor(props);tree=outer.type(outer.props);}finally{globalThis.__qualityDraftHooks=previous;}while(effects.length)effects.shift()();}
 async function settle(){dirty=true;for(let round=0;round<30;round++){if(dirty)render();await new Promise(resolve=>setImmediate(resolve));if(!dirty&&!effects.length)return;}throw Error('draft-state-did-not-settle');}
 const find=(predicate)=>{const result=nodes(tree).find(predicate);assert.ok(result,'actual editor control exists');return result;};
 return {settle,saves,reads,archives,drafts,client,candidateReads,formalSaves,
  field:(label)=>{const field=nodes(tree).find(node=>node.props?.['aria-label']===label);if(field)return field.props.value;const paper=nodes(tree).find(node=>node.props?.fields);return paper?.props.fields[{'报告标题':'title','分析说明':'analysis','结论':'conclusion','改进建议':'recommendations'}[label]];},
  change(label,value){find(node=>node.props?.['aria-label']===label).props.onChange({currentTarget:{value}});},
  click(label){const button=find(node=>node.type==='button'&&nodeText(node)===label);assert.equal(!!button.props.disabled,false,`${label} is enabled`);return button.props.onClick();},
  text:()=>nodeText(tree),guard:()=>guard(),confirmations:()=>confirmed,
  formDisabled:()=>nodes(tree).find(node=>node.type==='fieldset')?.props.disabled??true,
  controls:type=>nodes(tree).filter(node=>node.type===type),allowConfirm:()=>{allowConfirm=true;},
  enabled:label=>!find(node=>node.type==='button'&&nodeText(node)===label).props.disabled,
  setCandidate:next=>{currentCandidate=next;},
  setAiDraft:next=>{props.aiDraft=next;dirty=true;},
  delayCandidate(){let resolve;delayedCandidate=new Promise(done=>{resolve=done;});return resolve;},
  failReadback:()=>{readbackFailure=true;},failSave:()=>{saveFailure=true;},failArchiveReadback:()=>{archiveReadbackFailure=true;},mismatchArchiveBody:()=>{archiveBodyMismatch=true;},
  cleanup(){for(const slot of slots)slot?.cleanup?.();globalThis.window=previousWindow;},
 };
}
async function editor(options={}){const result=harness(options);await result.settle();if(!options.report&&!options.readOnly){result.click('生成报告');await result.settle();}if(options.initialDrafts?.length){result.click('更多');await result.settle();}if(options.candidate!==undefined){result.click('查看 AI 建议');await result.settle();}return result;}

test('draft save or readback failure retains exact text and retries the same operation before acknowledging saved',async()=>{
 for(const failure of ['failSave','failReadback']){
  const h=await editor();try{
   h.change('报告标题','');h.change('分析说明','  未完成文字\n保留  ');await h.settle();h[failure]();h.click('保存草稿');await h.settle();
   assert.equal(h.field('报告标题'),'');assert.equal(h.field('分析说明'),'  未完成文字\n保留  ');assert.match(h.text(),/草稿保存结果尚未确认/);assert.doesNotMatch(h.text(),/草稿已保存。/);assert.equal(h.formDisabled(),true);
   h.click('重试确认草稿');await h.settle();assert.deepEqual(h.saves[1],h.saves[0]);assert.equal(h.saves[0].fields.title,'');assert.match(h.text(),/草稿已保存。/);assert.equal(h.formDisabled(),false);
  }finally{h.cleanup();}
 }
});
test('persisted drafts are listed but restore only after explicit selection',async()=>{
 const h=await editor({initialDrafts:[savedDraft()]});try{
  assert.equal(h.field('报告标题'),'质量分析报告');assert.equal(h.reads.length,0);
  h.change('选择并恢复草稿','draft');await h.settle();assert.equal(h.field('报告标题'),'草稿');assert.equal(h.field('分析说明'),' 保留原文\n第二行 ');assert.match(h.text(),/按你的选择恢复/);assert.equal(h.guard(),true);
 }finally{h.cleanup();}
});
test('confirmed draft baseline makes leaving safe without pretending the formal report changed, and later typing is dirty again',async()=>{
 const h=await editor({report:savedReport()});try{
  h.click('编辑报告');await h.settle();h.change('结论','新的结论');await h.settle();assert.equal(h.guard(),false);const before=h.confirmations();
  h.click('保存草稿');await h.settle();assert.match(h.text(),/正式报告尚未更新/);assert.equal(h.guard(),true);assert.equal(h.confirmations(),before);
  h.change('结论','再调整结论');await h.settle();assert.equal(h.guard(),false);assert.equal(h.confirmations(),before+1);assert.match(h.text(),/草稿有未保存修改/);
 }finally{h.cleanup();}
});
test('old-parent draft is readable but cannot silently rebase; explicit new report retains its text and leaves the original draft',async()=>{
 const old=savedDraft(textFields('旧版草稿'),{reportId:'report',baseRevisionId:'report-v1'}),h=await editor({report:savedReport('report-v2'),initialDrafts:[old]});try{
  h.change('选择并恢复草稿','draft');await h.settle();assert.equal(h.field('报告标题'),'旧版草稿');assert.equal(h.formDisabled(),true);assert.match(h.text(),/草稿基于较早的报告版本/);assert.equal(h.saves.length,0);
  h.click('将这些文字另存为新报告');await h.settle();assert.equal(h.field('报告标题'),'旧版草稿');assert.equal(h.formDisabled(),false);h.click('保存草稿');await h.settle();assert.equal(h.saves[0].draftId,undefined);assert.equal(h.saves[0].reportId,undefined);assert.equal(h.saves[0].baseRevisionId,undefined);assert.match(h.text(),/正式报告尚未更新/);
 }finally{h.cleanup();}
});
test('formal save archives only the adopted exact draft revision after its fixed report readback',async()=>{
 const draft=savedDraft(textFields('继续加工的草稿'),{reportId:'report',baseRevisionId:'report-v1'}),h=await editor({report:savedReport(),initialDrafts:[draft]});try{
  h.change('选择并恢复草稿','draft');await h.settle();h.click('保存报告');await h.settle();assert.match(h.text(),/第 2 版已保存。/);assert.doesNotMatch(h.text(),/草稿整理状态未确认/);assert.equal(h.archives.length,1);assert.equal(h.archives[0].draftId,draft.draftId);assert.equal(h.archives[0].revision,draft.draftRevision);assert.equal(h.drafts.get(draft.draftId).draftRevision,'archived-v2');
 }finally{h.cleanup();}
});
test('archive readback failure or changed body cannot acknowledge archive, while the confirmed formal report remains saved',async()=>{
 for(const failure of ['failArchiveReadback','mismatchArchiveBody']){
  const h=await editor({report:savedReport(),initialDrafts:[savedDraft(textFields('草稿'),{reportId:'report',baseRevisionId:'report-v1'})]});try{
   h.change('选择并恢复草稿','draft');await h.settle();h[failure]();h.click('保存报告');await h.settle();
   assert.match(h.text(),/第 2 版已保存。/);assert.match(h.text(),/草稿整理状态未确认/);assert.equal(h.field('报告标题'),'草稿');
  }finally{h.cleanup();}
 }
});
test('verified AI draft archive consumes only its exact notice identity while new drafts or revisions remain visible',async()=>{
 const draft=savedDraft(textFields('AI 草稿'),{reportId:'report',baseRevisionId:'report-v1'}),h=await editor({report:savedReport(),initialDrafts:[draft],aiDraft:draft});try{
  assert.match(h.text(),/AI 已加工报告草稿/);
  h.click('查看 AI 草稿');await h.settle();assert.doesNotMatch(h.text(),/AI 已加工报告草稿/);
  h.click('保存报告');await h.settle();
  assert.equal(h.archives.length,1);assert.equal(h.drafts.get(draft.draftId).status,'archived');assert.match(h.text(),/第 2 版已保存。/);
  assert.doesNotMatch(h.text(),/AI 已加工报告草稿/);assert.equal(h.field('报告标题'),draft.fields.title);
  h.setAiDraft({...draft,draftRevision:'draft-v2'});await h.settle();assert.match(h.text(),/AI 已加工报告草稿/);
  h.setAiDraft({...draft,draftId:'another-draft'});await h.settle();assert.match(h.text(),/AI 已加工报告草稿/);
  h.setAiDraft(draft);await h.settle();assert.doesNotMatch(h.text(),/AI 已加工报告草稿/);
 }finally{h.cleanup();}
});
test('unverified AI draft archive keeps the notice even when the formal report save succeeded',async()=>{
 for(const failure of ['failArchiveReadback','mismatchArchiveBody']){
  const draft=savedDraft(textFields('AI 草稿'),{reportId:'report',baseRevisionId:'report-v1'}),h=await editor({report:savedReport(),initialDrafts:[draft],aiDraft:draft});try{
   h.click('查看 AI 草稿');await h.settle();h[failure]();h.click('保存报告');await h.settle();
   assert.equal(h.archives.length,1);assert.match(h.text(),/第 2 版已保存。/);assert.match(h.text(),/草稿整理状态未确认/);
   assert.match(h.text(),/AI 已加工报告草稿/);
  }finally{h.cleanup();}
 }
});
test('unsupported draft APIs leave formal editing available and state the lack of recoverable drafts',async()=>{
 const h=await editor({unsupported:true});try{assert.equal(h.formDisabled(),false);assert.doesNotMatch(h.text(),/选择已保存草稿/);assert.match(h.text(),/宿主未提供可恢复草稿/);}finally{h.cleanup();}
});

const interpretation=(changes={})=>({...scope,sessionId:'session-'+ '1'.repeat(32),eventSeq:9,turn:1,text:'趋势需结合检验批次核查。',candidateHash:'d'.repeat(64),...changes});
test('reading a fixed-run candidate does not change or save report text; explicit use rechecks and appends only analysis',async()=>{
 const candidate=interpretation(),h=await editor({candidate});try{
  h.change('报告标题','');h.change('分析说明','人工分析原文');h.change('结论','已确认的结论');h.change('改进建议','既有建议');await h.settle();
  h.click('查看已完成建议');await h.settle();assert.equal(h.field('分析说明'),'人工分析原文');assert.match(h.text(),/趋势需结合检验批次核查/);assert.equal(h.saves.length,0);assert.equal(h.formalSaves.length,0);
  h.click('加入分析说明');await h.settle();assert.equal(h.candidateReads.length,2);assert.deepEqual(h.candidateReads[1],scope);
  assert.equal(h.field('分析说明'),'人工分析原文\n\nAI 解读（待人工核对）\n'+candidate.text);assert.equal(h.field('报告标题'),'');assert.equal(h.field('结论'),'已确认的结论');assert.equal(h.field('改进建议'),'既有建议');assert.equal(h.saves.length,0);assert.equal(h.formalSaves.length,0);assert.equal(h.guard(),false);
  h.click('保存草稿');await h.settle();assert.equal(h.saves[0].fields.analysis,h.field('分析说明'));assert.equal(h.guard(),true);
 }finally{h.cleanup();}
});
test('candidate changes, active new turn, scope mismatch or excessive complete text retain report input without a save',async()=>{
 for(const replacement of [interpretation({text:'新回复',candidateHash:'e'.repeat(64)}),null,interpretation({runId:'another-run'})]){
  const h=await editor({candidate:interpretation()});try{
   h.change('分析说明','原文');await h.settle();h.click('查看已完成建议');await h.settle();h.setCandidate(replacement);h.click('加入分析说明');await h.settle();assert.equal(h.field('分析说明'),'原文');assert.equal(h.saves.length,0);assert.equal(h.formalSaves.length,0);assert.match(h.text(),/未追加解读/);
  }finally{h.cleanup();}
 }
 const h=await editor({candidate:interpretation({text:'中'.repeat(5000)})});try{
  h.change('分析说明','原文');await h.settle();h.click('查看已完成建议');await h.settle();h.click('加入分析说明');await h.settle();assert.equal(h.field('分析说明'),'原文');assert.match(h.text(),/完整文字超过报告容量/);assert.match(h.text(),/中{5000}/);assert.equal(h.saves.length,0);
 }finally{h.cleanup();}
});
test('expert candidate selection keeps the fixed association and historical read-only reports cannot apply it',async()=>{
 const association={...scope,sessionId:'session-'+ '1'.repeat(32),expertId:'expert',expertRevisionId:'expert-v1',compositionDigest:'f'.repeat(64),creationOperationId:'expert-op'};
 const historical={...savedReport(),currentRevisionId:'report-v2'},h=await editor({report:historical,candidate:interpretation(),expertSources:[association]});try{
  h.click('刷新专家对话');await h.settle();h.change('报告解读来源',association.sessionId);await h.settle();h.click('查看已完成建议');await h.settle();assert.deepEqual(h.candidateReads[0],association);assert.equal(h.enabled('加入分析说明'),false);assert.equal(h.field('分析说明'),historical.fields.analysis);assert.equal(h.formalSaves.length,0);
 }finally{h.cleanup();}
});
test('cancelled candidate recheck never appends its late reply',async()=>{
 const candidate=interpretation(),h=await editor({candidate});try{
  h.change('分析说明','保留');await h.settle();h.click('查看已完成建议');await h.settle();const resolve=h.delayCandidate();h.click('加入分析说明');await h.settle();h.click('停止等待');await h.settle();resolve(candidate);await h.settle();assert.equal(h.field('分析说明'),'保留');assert.equal(h.saves.length,0);assert.equal(h.formalSaves.length,0);assert.doesNotMatch(h.text(),/AI 建议已加入分析说明/);
 }finally{h.cleanup();}
});


test('saved reports open as full document reading without an editing form or management toolbar',async()=>{
 const h=await editor({report:savedReport()});try{
  assert.equal(h.controls('textarea').length,0);assert.equal(h.controls('input').length,0);assert.equal(h.controls('select').length,0);
  assert.ok(h.enabled('编辑报告'));assert.ok(h.enabled('导出报告'));assert.doesNotMatch(h.text(),/刷新列表|恢复草稿|保存草稿|继续加工/);
  h.click('编辑报告');await h.settle();assert.equal(h.controls('textarea').length,3);assert.equal(h.field('结论'),'待核对');
  h.click('取消编辑');await h.settle();assert.equal(h.controls('textarea').length,0);assert.equal(h.enabled('编辑报告'),true);assert.equal(h.formalSaves.length,0);
 }finally{h.cleanup();}
});
test('empty reports require creation and restore remains behind a deliberate management action',async()=>{
 const h=await editor({readOnly:true});try{
  assert.equal(h.controls('textarea').length,0);assert.equal(h.controls('input').length,0);assert.equal(h.controls('select').length,0);assert.match(h.text(),/把分析结果整理成报告/);
  h.click('生成报告');await h.settle();assert.equal(h.controls('textarea').length,3);assert.equal(h.saves.length,0);assert.equal(h.formalSaves.length,0);
  h.click('更多');await h.settle();assert.match(h.text(),/报告管理/);assert.ok(h.controls('select').length);assert.equal(h.reads.length,0);
 }finally{h.cleanup();}
});
test('cancelling edits confirms unsaved text before returning to the saved document and keeps durable drafts',async()=>{
 const durable=savedDraft(),h=await editor({report:savedReport(),initialDrafts:[durable]});try{
  h.click('编辑报告');await h.settle();h.change('分析说明','尚未保存的修改');await h.settle();h.click('取消编辑');await h.settle();
  assert.equal(h.field('分析说明'),'尚未保存的修改');assert.equal(h.controls('textarea').length,3);assert.equal(h.confirmations(),1);
  h.allowConfirm();h.click('取消编辑');await h.settle();assert.equal(h.controls('textarea').length,0);assert.equal(h.field('分析说明'),savedReport().fields.analysis);assert.deepEqual(h.drafts.get(durable.draftId),durable);assert.equal(h.saves.length,0);
 }finally{h.cleanup();}
});
