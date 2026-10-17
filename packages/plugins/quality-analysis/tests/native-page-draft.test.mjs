import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(new URL('../../../../apps/web/package.json',import.meta.url));
// Execute the registered QualityPage itself. Only SDK boundary owners and child
// surfaces are replaced; the real native draft preflight stays in this bundle.
const built=await require('esbuild').build({entryPoints:[fileURLToPath(new URL('../src/client.tsx',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false,jsx:'transform',tsconfigRaw:{compilerOptions:{jsx:'react',jsxFactory:'React.createElement',jsxFragmentFactory:'React.Fragment'}},plugins:[{name:'native-quality-page-fixture',setup(b){
 b.onResolve({filter:/^react$/},()=>({path:'react',namespace:'fixture'}));
 b.onResolve({filter:/^workdsh-plugin-workbenches\/client$/},()=>({path:'workbenches',namespace:'fixture'}));
 b.onResolve({filter:/^workdsh-plugin-library\/client$/},()=>({path:'library',namespace:'fixture'}));
 b.onResolve({filter:/\/QualityAnalysisBrowser\.js$/},()=>({path:'browser',namespace:'fixture'}));
 b.onResolve({filter:/\/record-client\.js$/},()=>({path:'client',namespace:'fixture'}));
 b.onResolve({filter:/\/identity-scope\.js$/},()=>({path:'identity',namespace:'fixture'}));
 b.onResolve({filter:/\/analysis-instruction\.js$/},()=>({path:'instruction',namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},({path})=>({loader:'js',contents:{
 react:`const R={createElement:(type,props,...children)=>({type,props:{...props,children}}),Fragment:'fragment'};export default R;export const useState=(...a)=>globalThis.__nativePageHooks.useState(...a),useRef=(...a)=>globalThis.__nativePageHooks.useRef(...a),useEffect=(...a)=>globalThis.__nativePageHooks.useEffect(...a),useMemo=(...a)=>globalThis.__nativePageHooks.useMemo(...a),useCallback=(...a)=>globalThis.__nativePageHooks.useCallback(...a);`,
 workbenches:`export const NativeWorkbenchConversation='native:conversation';`,library:`export const createLibraryClient=()=>({}),createLibraryNativeFileClient=()=>({open:(...args)=>globalThis.__nativePageClient.openOriginal(...args)}),LibraryOriginalSurface='native:original';`,browser:`export const QualityAnalysisBrowser='quality:browser';`,client:`export const createQualityRecordClient=()=>globalThis.__nativePageClient;export class QualityRecordRequestError extends Error{}`,identity:`export const createQualityIdentityScopeOwner=(fetch,change)=>({check(){change({scope:'member',error:false,checking:false})},dispose(){}});`,instruction:`export const createQualityToolInstruction=()=> 'starter';`
 }[path]}));
}}]});
const {apply}=await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const flatten=(node,out=[])=>{if(Array.isArray(node))node.forEach(n=>flatten(n,out));else if(node&&typeof node==='object'){out.push(node);flatten(node.props?.children,out);}return out;};
const view={recordId:'record',runId:'run',contentHash:'a'.repeat(64)};
const context={...view,sessionId:'ordinary',originRunId:'run',originContentHash:'a'.repeat(64),revision:1};
async function fixture({draft='',phase='plain',running=false,readyHook,initialContext=context}={}){
 const calls=[],slots=[],effects=[];let cursor=0,dirty=true,tree,renderFactory,releases=0;
 const same=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
 const hooks={useState(initial){const i=cursor++;slots[i]??={value:typeof initial==='function'?initial():initial};return[slots[i].value,n=>{slots[i].value=typeof n==='function'?n(slots[i].value):n;dirty=true;}];},useRef(initial){return slots[cursor++]??={current:initial};},useEffect(run,deps){const i=cursor++,old=slots[i];if(!old||!same(old.deps,deps))effects.push(()=>{old?.cleanup?.();slots[i]={deps,cleanup:run()};});},useMemo(factory,deps){const i=cursor++,old=slots[i];if(!old||!same(old.deps,deps))slots[i]={deps,value:factory()};return slots[i].value;},useCallback(fn,deps){return hooks.useMemo(()=>fn,deps);}};
 const input={draft,phase,attachmentIds:[],occurrences:[],draftRev:0},inputListeners=new Set(),blockListeners=new Set();let composerBlock;
 const subscribe=listeners=>listener=>{listeners.add(listener);return()=>listeners.delete(listener);};
 let hostContext=initialContext;
 const client={async aiSession(...args){calls.push(['aiSession',...args]);return{sessionId:'ordinary'};},async aiFocus(...args){calls.push(['aiFocus',...args]);hostContext={...hostContext,selectedFocus:args[4],revision:hostContext.revision+1};return hostContext;},async aiContext(...args){calls.push(['aiContext',...args]);return hostContext;},async openOriginal(...args){calls.push(['openOriginal',...args]);}};
 const native={get:()=>({canOpen:()=>true}),layout:{selectPanel(){}},sessions:{retain(id){calls.push(['retain',id]);return{ready:Promise.resolve().then(async()=>{calls.push(['nativeReady',id]);await readyHook?.();return{sessionId:id,ctx:{},session:{getSnapshot:()=>({running}),subscribe:()=>()=>{}}};}),release(){releases++;}};}},conversation:{blocks:{storeFor:()=>({getSnapshot:()=>composerBlock,subscribe:subscribe(blockListeners)}),set(id,value){calls.push(['nativeBlock',id,value]);composerBlock=value;for(const listener of blockListeners)listener();}},input:{for(){return{state:{getSnapshot:()=>input,subscribe:subscribe(inputListeners)}};}}}};
 const globals={window:globalThis.window,document:globalThis.document};globalThis.window={addEventListener(){},removeEventListener(){}};globalThis.document={visibilityState:'visible',addEventListener(){},removeEventListener(){}};
 globalThis.__nativePageClient=client;globalThis.__nativePageHooks=hooks;
 await apply({...native,get:key=>key==='workdshWorkbenchClientRegistration'?{registerManaged(_ctx,_descriptor,create){renderFactory=create;}}:key==='sessions'?native.sessions:key==='conversation'?native.conversation:native.get(key)});
 async function settle(){for(let n=0;n<30;n++){if(dirty){dirty=false;cursor=0;const element=renderFactory();tree=element.type(element.props);while(effects.length)effects.shift()();}await new Promise(r=>setImmediate(r));if(!dirty&&!effects.length)return;}throw Error('page-did-not-settle');}
 const node=type=>flatten(tree).find(n=>n.type===type);
 await settle();node('quality:browser').props.onNavigation({recordId:'record',tab:'overview'});await settle();
 return{calls,input,client,native,settle,node,column:className=>flatten(tree).find(n=>n.props?.className===className),releases:()=>releases,block:()=>composerBlock,publishInput(patch){Object.assign(input,patch);for(const listener of inputListeners)listener();},async draft(purpose='report',signal=new AbortController().signal,selection){return node('quality:browser').props.onAiDraft(view,signal,purpose,{reportId:'report',revisionId:'version'},selection);},cleanup(){for(const slot of slots)slot?.cleanup?.();globalThis.window=globals.window;globalThis.document=globals.document;delete globalThis.__nativePageClient;delete globalThis.__nativePageHooks;}};
}
test('real QualityPage preserves an existing native draft without report targeting or another starter',async()=>{
 const f=await fixture({draft:'未发送用户草稿'});try{await f.draft();await f.settle();assert.equal(f.input.draft,'未发送用户草稿');assert.deepEqual(f.calls.filter(c=>c[0]==='aiSession').map(c=>c.length),[5]);assert.equal(f.node('native:conversation').props.sessionId,'ordinary');assert.equal(f.node('native:conversation').props.draftRequest,undefined);assert.equal(f.releases(),1);assert.equal(flatten(f.column('wd-quality-business-column')).find(n=>n.props?.role==='status').props.children[0],'已有输入已保留，请先完成当前对话。');assert.equal(flatten(f.column('wd-quality-native-companion')).some(n=>n.props?.className==='wd-quality-native-feedback'),false);}finally{f.cleanup();}
});
test('real QualityPage retains a busy native session without changing its report target',async()=>{
 const f=await fixture({running:true});try{await f.draft();await f.settle();assert.deepEqual(f.calls.filter(c=>c[0]==='aiSession').map(c=>c.length),[5]);assert.equal(f.node('native:conversation').props.draftRequest,undefined);f.node('native:conversation').props.onError(Error('session-unavailable'));await f.settle();const feedback=flatten(f.column('wd-quality-business-column'));assert.equal(feedback.find(n=>n.props?.role==='alert').props.children[0],'原生会话暂时无法打开，请稍后重试。');assert.equal(feedback.find(n=>n.props?.role==='status').props.children[0],'当前对话暂不能接收新请求，已有输入已保留。');assert.equal(f.node('native:conversation').props.sessionId,'ordinary');}finally{f.cleanup();}
});
test('an expert binding cannot be mistaken for the ordinary analytical session',async()=>{
 const f=await fixture({draft:'existing'});try{const p=f.node('quality:browser').props.onExpertDraft('expert','expert-starter',new AbortController().signal);await f.settle();const expert=f.node('native:conversation').props;assert.equal(expert.sessionId,'expert');expert.onDraftError(expert.draftRequest.id,Error('workbench/conversation-draft-preserved'));await p;await f.settle();await f.draft();await f.settle();assert.equal(f.node('native:conversation').props.sessionId,'ordinary');assert.deepEqual(f.calls.filter(c=>c[0]==='retain').map(c=>c[1]),['ordinary']);assert.equal(f.node('native:conversation').props.draftRequest,undefined);}finally{f.cleanup();}
});
test('changing the record during native preflight cannot bind or write a starter for the previous record',async()=>{
 let f;f=await fixture({readyHook:()=>f.node('quality:browser').props.onNavigation({recordId:'other',tab:'overview'})});try{await assert.rejects(f.draft(),/quality\/record-changed/);await f.settle();assert.equal(f.node('native:conversation'),undefined);assert.deepEqual(f.calls.filter(c=>c[0]==='aiSession').map(c=>c.length),[5]);assert.equal(f.releases(),1);}finally{f.cleanup();}
});
test('an empty native input selects the intended report before requesting a starter',async()=>{
 const f=await fixture();try{const pending=f.draft();await f.settle();const native=f.node('native:conversation').props;assert.equal(native.sessionId,'ordinary');assert.equal(native.draftRequest.instruction,'starter');const requests=f.calls.filter(c=>c[0]==='aiSession');assert.deepEqual(requests.map(c=>c.length),[5,6]);assert.deepEqual(requests[1][5],{reportId:'report',revisionId:'version'});assert.equal(f.releases(),0);assert.equal(f.block().reason,'正在准备分析请求，请稍候…');native.onDraftReady(native.draftRequest.id);await pending;await f.settle();assert.equal(f.node('native:conversation').props.draftRequest,undefined);assert.equal(f.block(),undefined);assert.equal(f.releases(),1);}finally{f.cleanup();}
});
async function openOriginal(f){await f.node('quality:browser').props.library.openOriginal({assetId:'asset',revisionId:'revision',title:'inspection.csv',format:'csv'});await f.settle();}
test('opening a source delegates to the native file client and retains the analytical conversation',async()=>{
 const f=await fixture({draft:'未发送用户草稿'});try{await f.draft();await f.settle();await openOriginal(f);const opened=f.calls.find(c=>c[0]==='openOriginal')[1];assert.deepEqual(opened,{assetId:'asset',revisionId:'revision',sessionId:'ordinary',returnPanel:{id:'workdsh-workbench:workdsh.quality-analysis',label:'返回质量分析'}});assert.equal(f.node('native:conversation').props.sessionId,'ordinary');assert.equal(f.input.draft,'未发送用户草稿');assert.equal(f.node('native:original'),undefined);}finally{f.cleanup();}
});
test('pre-aborted or preflight-aborted handoff never writes another native draft or report target',async()=>{
 const first=await fixture();try{await assert.rejects(first.draft('report',AbortSignal.abort()),{name:'AbortError'});assert.equal(first.calls.length,0);}finally{first.cleanup();}
 const controller=new AbortController(),f=await fixture({readyHook:()=>controller.abort()});try{await assert.rejects(f.draft('report',controller.signal),{name:'AbortError'});assert.deepEqual(f.calls.filter(c=>c[0]==='aiSession').map(c=>c.length),[5]);assert.equal(f.node('native:conversation'),undefined);assert.equal(f.releases(),1);}finally{f.cleanup();}
});
test('editing native input during target RPC cancels that request and never inserts another starter',async()=>{
 const f=await fixture(),started=Promise.withResolvers(),original=f.client.aiSession;let targetSignal;
 f.client.aiSession=async(...args)=>{const receipt=await original(...args);if(args.length===5){targetSignal=args[3];started.resolve();await new Promise((_,reject)=>targetSignal.addEventListener('abort',()=>reject(targetSignal.reason),{once:true}));}return receipt;};
 try{const pending=f.draft();await started.promise;f.publishInput({draft:'我正在编辑的旧报告要求',draftRev:1});await pending;await f.settle();assert.equal(targetSignal.aborted,true);assert.equal(f.input.draft,'我正在编辑的旧报告要求');assert.equal(f.node('native:conversation').props.draftRequest,undefined);assert.equal(f.block(),undefined);assert.equal(f.releases(),1);}finally{f.cleanup();}
});
test('input cancellation after a possible Host commit rereads the real context instead of claiming rollback',async()=>{
 const f=await fixture(),original=f.client.aiSession;let committed=false;
 f.client.aiSession=async(...args)=>{const receipt=await original(...args);if(args.length===5){committed=true;f.publishInput({draft:'用户新输入',draftRev:1});args[3].throwIfAborted();}return receipt;};
 f.client.aiContext=async(...args)=>{f.calls.push(['aiContext',...args]);return committed?{...context,revision:2,selectedReport:{reportId:'report',revisionId:'version'}}:context;};
 try{await f.draft();await f.settle();assert.equal(f.node('quality:browser').props.aiContext.revision,2);assert.equal(f.node('quality:browser').props.aiContext.selectedReport.reportId,'report');assert.equal(f.input.draft,'用户新输入');assert.equal(f.node('native:conversation').props.draftRequest,undefined);assert.equal(f.block(),undefined);}finally{f.cleanup();}
});

test('focus is handed to the existing native session only after preflight and preserves the selected report',async()=>{
 const selectedReport={reportId:'old-report',revisionId:'old-version'},f=await fixture({initialContext:{...context,selectedReport}});
 try{for(const selection of [{kind:'period',date:'2026-10-10'},{kind:'inspection',inspectionId:'QC-T006'}]){
  const start=f.calls.length,pending=f.draft('focus',new AbortController().signal,selection);await f.settle();
  const native=f.node('native:conversation').props;assert.equal(native.sessionId,'ordinary');assert.equal(native.draftRequest.instruction,'starter');
  const sequence=f.calls.slice(start),focus=sequence.find(c=>c[0]==='aiFocus');assert.ok(focus);
  assert.deepEqual(focus.slice(1,6),[view.recordId,view.runId,view.contentHash,'ordinary',selection]);assert.equal(focus[6].aborted,false);
  assert.deepEqual(sequence.filter(c=>c[0]==='aiSession').map(c=>c.length),[5],'focus never invokes the report-target setter');
  const focusAt=sequence.indexOf(focus),readyAt=sequence.findIndex(c=>c[0]==='nativeReady'),blockAt=sequence.findIndex(c=>c[0]==='nativeBlock'&&c[2]);
  assert.ok(readyAt>=0&&readyAt<focusAt,'native session readiness precedes the Host focus request');
  assert.ok(blockAt>=0&&blockAt<focusAt,'native input is guarded before changing its analytical target');
  assert.ok(sequence.findIndex((c,i)=>i>focusAt&&c[0]==='aiContext')>focusAt,'Host context is refreshed after focus selection');
  assert.deepEqual(f.node('quality:browser').props.aiContext.selectedReport,selectedReport);
  assert.deepEqual(f.node('quality:browser').props.aiContext.selectedFocus,selection);
  native.onDraftReady(native.draftRequest.id);await pending;await f.settle();assert.equal(f.block(),undefined);
 }
 assert.deepEqual(f.calls.filter(c=>c[0]==='retain').map(c=>c[1]),['ordinary','ordinary']);assert.equal(f.releases(),2);
 }finally{f.cleanup();}
});

test('focus opens the same session while an existing draft or task blocks target changes and starter insertion',async()=>{
 const selectedFocus={kind:'inspection',inspectionId:'OLD'},selection={kind:'inspection',inspectionId:'QC-T006'};
 for(const state of [{draft:'用户未发送的核查要求',notice:'已有输入已保留，所选记录尚未交给 AI。请处理当前输入后再核查。'},{running:true,notice:'AI 正在处理当前任务，所选记录尚未交给 AI。请等待完成后再核查。'}]){
  const f=await fixture({...state,initialContext:{...context,selectedFocus}});try{await f.draft('focus',new AbortController().signal,selection);await f.settle();
   assert.equal(f.input.draft,state.draft??'');assert.equal(f.node('native:conversation').props.sessionId,'ordinary');assert.equal(f.node('native:conversation').props.draftRequest,undefined);
   assert.deepEqual(f.calls.filter(c=>c[0]==='aiSession').map(c=>c.length),[5]);assert.equal(f.calls.filter(c=>c[0]==='aiFocus').length,0);
   assert.deepEqual(f.node('quality:browser').props.aiContext.selectedFocus,selectedFocus);
   assert.equal(flatten(f.column('wd-quality-business-column')).find(n=>n.props?.role==='status').props.children[0],state.notice);
   assert.equal(f.releases(),1);assert.equal(f.block(),undefined);
  }finally{f.cleanup();}
 }
});

test('pre-aborted and preflight-aborted focus cannot update a Host focus or insert a starter',async()=>{
 const selection={kind:'period',date:'2026-10-10'},first=await fixture();try{await assert.rejects(first.draft('focus',AbortSignal.abort(),selection),{name:'AbortError'});assert.equal(first.calls.length,0);}finally{first.cleanup();}
 const controller=new AbortController(),f=await fixture({readyHook:()=>controller.abort()});try{await assert.rejects(f.draft('focus',controller.signal,selection),{name:'AbortError'});await f.settle();
  assert.equal(f.calls.filter(c=>c[0]==='aiFocus').length,0);assert.deepEqual(f.calls.filter(c=>c[0]==='aiSession').map(c=>c.length),[5]);assert.equal(f.node('native:conversation'),undefined);assert.equal(f.releases(),1);
 }finally{f.cleanup();}
});

test('native input editing during focus RPC cancels the handoff, preserves input, and rereads actual Host context',async()=>{
 const selectedReport={reportId:'old-report',revisionId:'old-version'},f=await fixture({initialContext:{...context,selectedReport}}),started=Promise.withResolvers(),original=f.client.aiFocus;let focusSignal;
 f.client.aiFocus=async(...args)=>{const receipt=await original(...args);focusSignal=args[5];started.resolve();await new Promise((_,reject)=>focusSignal.addEventListener('abort',()=>reject(focusSignal.reason),{once:true}));return receipt;};
 try{const selection={kind:'inspection',inspectionId:'QC-T006'},pending=f.draft('focus',new AbortController().signal,selection);await started.promise;f.publishInput({draft:'用户正在编辑的原生输入',draftRev:1});await pending;await f.settle();
  assert.equal(focusSignal.aborted,true);assert.equal(f.input.draft,'用户正在编辑的原生输入');assert.equal(f.node('native:conversation').props.sessionId,'ordinary');assert.equal(f.node('native:conversation').props.draftRequest,undefined);
  assert.deepEqual(f.calls.filter(c=>c[0]==='aiSession').map(c=>c.length),[5]);assert.deepEqual(f.node('quality:browser').props.aiContext.selectedFocus,selection,'a possible Host commit is displayed from its actual receipt rather than claiming rollback');
  assert.deepEqual(f.node('quality:browser').props.aiContext.selectedReport,selectedReport);assert.equal(f.block(),undefined);assert.equal(f.releases(),1);
  assert.equal(flatten(f.column('wd-quality-business-column')).find(n=>n.props?.role==='status').props.children[0],'输入已变化，新的请求已取消。请核对当前分析对象后继续对话。');
 }finally{f.cleanup();}
});
