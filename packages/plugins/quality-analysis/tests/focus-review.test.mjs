import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

// Execute actual focus-review hooks and handlers. Authorized evidence decoding
// and native Composer ownership have separate runtime tests; no DOM is used.
const require=createRequire(new URL('../../../../apps/web/package.json',import.meta.url));
const built=await require('esbuild').build({
 stdin:{contents:"export {QualityFocusReview} from './QualityFocusReview';export {QualityHistoryResult} from './QualityHistoryResult';",resolveDir:fileURLToPath(new URL('../src/client/',import.meta.url)),loader:'tsx'},bundle:true,platform:'node',format:'esm',write:false,
 tsconfigRaw:{compilerOptions:{jsx:'react',jsxFactory:'React.createElement',jsxFragmentFactory:'React.Fragment'}},
 plugins:[{name:'focus-review-hooks',setup(builder){
  builder.onResolve({filter:/^react$/},()=>({path:'react',namespace:'focus-review-hooks'}));
  builder.onResolve({filter:/\/Quality(ReportEditor|Interpretation|Results)\.js$/},args=>({path:args.path.split('/').at(-1).slice(0,-3),namespace:'focus-review-owner-child'}));
  builder.onLoad({filter:/.*/,namespace:'focus-review-owner-child'},args=>({contents:`export const ${args.path}='test:${args.path}';`,loader:'js'}));
  builder.onLoad({filter:/.*/,namespace:'focus-review-hooks'},()=>({contents:`
   const React={createElement:(type,props,...children)=>({type,props:{...props,children}}),Fragment:Symbol.for('test.fragment')};export default React;
   export const useState=(...args)=>globalThis.__qualityFocusHooks.useState(...args);
   export const useRef=(...args)=>globalThis.__qualityFocusHooks.useRef(...args);
   export const useEffect=(...args)=>globalThis.__qualityFocusHooks.useEffect(...args);
  `,loader:'js'}));
 }}],
});
const {QualityFocusReview,QualityHistoryResult}=await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const basis={recordId:'quality-record',runId:'saved-run',contentHash:'a'.repeat(64)},period={kind:'period',date:'2026-10-10'};
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function evidence(selection=period,offset=0,total=21){return {...basis,selection,offset,total,nextOffset:offset+Math.min(20,total-offset)<total?offset+Math.min(20,total-offset):null,range:{dateFrom:'2026-10-10',dateTo:'2026-10-10',trendGranularity:'day'},rows:Array.from({length:Math.max(0,Math.min(20,total-offset))},(_,index)=>({sourceRow:offset+index+1,location:{record:offset+index+1,line:offset+index+2},inspection:{inspectionId:selection.kind==='inspection'?selection.inspectionId:`INS-${offset+index+1}`,inspectionDate:'2026-10-10',lineId:'一号线',inspectedQuantity:100,nonconformingQuantity:5,quantityUnit:'piece',inspectionType:'initial'}}))};}
function nodes(element){if(element===null||element===undefined||typeof element==='boolean')return [];if(Array.isArray(element))return element.flatMap(nodes);if(typeof element!=='object')return [];return [element,...nodes(element.props?.children)];}
function text(element){if(element===null||element===undefined||typeof element==='boolean')return '';if(Array.isArray(element))return element.map(text).join('');return typeof element==='object'?text(element.props?.children):String(element);}
function harness(){
 const state={responses:[],reads:[],handoffs:[],selected:[],closed:0,aiResponse:undefined,total:21,lateUpdates:0},slots=[],effects=[];let cursor=0,dirty=true,tree,unmounted=false;
 const hooks={
  useState(initial){const index=cursor++;if(!slots[index])slots[index]={value:typeof initial==='function'?initial():initial};return [slots[index].value,next=>{if(unmounted){state.lateUpdates++;return;}const value=typeof next==='function'?next(slots[index].value):next;if(!Object.is(value,slots[index].value)){slots[index].value=value;dirty=true;}}];},
  useRef(initial){const index=cursor++;return slots[index]??={current:initial};},
  useEffect(run,deps){const index=cursor++,old=slots[index];if(!old||deps.some((value,i)=>!Object.is(value,old.deps?.[i])))effects.push(()=>{old?.cleanup?.();slots[index]={deps,cleanup:run()};});},
 };
 const props={view:{...basis},selection:period,
  client:{async focusInspections(recordId,runId,contentHash,selection,offset,signal){state.reads.push({recordId,runId,contentHash,selection:structuredClone(selection),offset,signal});if(state.responses.length){const result=state.responses.shift();if(result instanceof Error)throw result;return await result;}return evidence(selection,offset,selection.kind==='inspection'?1:state.total);}},
  onSelect:selection=>state.selected.push(selection),onClose:()=>state.closed++,
  onOpenAi:async(selection,signal)=>{state.handoffs.push({selection,signal});if(state.aiResponse)await state.aiResponse.promise;},
 };
 function render(){cursor=0;dirty=false;const previous=globalThis.__qualityFocusHooks;globalThis.__qualityFocusHooks=hooks;try{tree=QualityFocusReview(props);}finally{if(previous===undefined)delete globalThis.__qualityFocusHooks;else globalThis.__qualityFocusHooks=previous;}while(effects.length)effects.shift()();}
 async function settle(){if(unmounted){await new Promise(done=>setImmediate(done));return;}dirty=true;for(let count=0;count<35;count++){if(dirty)render();await new Promise(done=>setImmediate(done));if(!dirty&&!effects.length)return;}throw Error('focus-review-did-not-settle');}
 function button(label){const element=nodes(tree).find(item=>item.type==='button'&&(text(item)===label||item.props?.['aria-label']===label));assert.ok(element,`focus control ${label} exists`);return element;}
 function click(label){const element=button(label);assert.equal(!!element.props.disabled,false,`${label} is enabled`);element.props.onClick();}
 function cleanup(){if(unmounted)return;unmounted=true;for(const slot of slots)slot?.cleanup?.();}
 return {props,state,settle,button,click,cleanup,content:()=>text(tree),alerts:()=>nodes(tree).filter(item=>item.props?.role==='alert').map(text).join('')};
}

test('focused evidence reads the exact saved basis, paginates locally and selects a row without initiating AI',async()=>{
 const page=harness();try{await page.settle();assert.deepEqual({...page.state.reads[0],signal:undefined},{...basis,selection:period,offset:0,signal:undefined});assert.match(page.content(),/2026\/10\/10 的检验记录/);assert.match(page.content(),/INS-1.*一号线.*100.*5.*5\.00%/);assert.equal(page.button('上一页').props.disabled,true);
  page.click('选择检验记录 INS-1');await page.settle();assert.deepEqual(page.state.selected,[{kind:'inspection',inspectionId:'INS-1'}]);assert.equal(page.state.handoffs.length,0);assert.equal(page.state.reads.length,1);
  page.click('下一页');await page.settle();assert.equal(page.state.reads.at(-1).offset,20);assert.match(page.content(),/INS-21/);assert.equal(page.button('下一页').props.disabled,true);page.click('上一页');await page.settle();assert.deepEqual(page.state.reads.map(item=>item.offset),[0,20,0]);assert.deepEqual(page.props.view,basis);assert.deepEqual(page.props.selection,period);
 }finally{page.cleanup();}
});

test('superseded evidence requests abort and cannot publish stale rows or stale failures',async()=>{
 for(const failure of [false,true]){
  const page=harness(),first=deferred();try{page.state.responses.push(first.promise);await page.settle();assert.equal(page.button('与 AI 核查').props.disabled,true);const old=page.state.reads[0];page.props.selection={kind:'inspection',inspectionId:'CURRENT'};await page.settle();assert.equal(old.signal.aborted,true);assert.match(page.content(),/CURRENT/);
   if(failure)first.reject(Error('old-permission-error'));else first.resolve({...evidence(period,0,1),rows:[{...evidence(period,0,1).rows[0],inspection:{...evidence(period,0,1).rows[0].inspection,inspectionId:'STALE_RECORD'}}]});await page.settle();assert.doesNotMatch(page.content(),/STALE_RECORD|暂时无法定位|old-permission-error/);assert.equal(page.alerts(),'');assert.match(page.content(),/CURRENT/);
  }finally{page.cleanup();}
 }
});

test('failed evidence reading retries the same saved basis before enabling a native handoff',async()=>{
 const page=harness();try{page.state.responses.push(Error('INTERNAL_PERMISSION_TRACE'));await page.settle();assert.match(page.alerts(),/暂时无法定位.*重新读取/);assert.doesNotMatch(page.content(),/INTERNAL_PERMISSION_TRACE/);assert.equal(page.button('与 AI 核查').props.disabled,true);assert.equal(page.state.handoffs.length,0);page.click('重新读取');await page.settle();assert.equal(page.alerts(),'');assert.equal(page.button('与 AI 核查').props.disabled,false);assert.equal(page.state.reads.length,2);assert.deepEqual(page.state.reads.map(({recordId,runId,contentHash,selection,offset})=>({recordId,runId,contentHash,selection,offset})),Array.from({length:2},()=>({...basis,selection:period,offset:0})));
 }finally{page.cleanup();}
});

test('a native focus handoff deduplicates direct handler calls and locks record changes until it settles',async()=>{
 const page=harness(),ai=deferred();try{page.state.aiResponse=ai;await page.settle();const action=page.button('与 AI 核查').props.onClick;action();await page.settle();assert.equal(page.state.handoffs.length,1);assert.deepEqual(page.state.handoffs[0].selection,period);assert.equal(page.state.handoffs[0].signal.aborted,false);assert.equal(page.button('正在关联…').props.disabled,true);assert.equal(page.button('收起记录').props.disabled,true);assert.equal(page.button('选择检验记录 INS-1').props.disabled,true);action();await page.settle();assert.equal(page.state.handoffs.length,1);
  ai.reject(Error('private-native-error'));await page.settle();assert.match(page.alerts(),/已有输入和分析保持原状/);assert.doesNotMatch(page.alerts(),/private-native-error/);assert.equal(page.button('与 AI 核查').props.disabled,false);assert.equal(page.state.selected.length,0);assert.equal(page.state.closed,0);
 }finally{page.cleanup();}
});

test('unmount aborts both evidence and focus handoff owners without a late state write',async()=>{
 const reading=harness(),read=deferred();reading.state.responses.push(read.promise);await reading.settle();reading.cleanup();assert.equal(reading.state.reads[0].signal.aborted,true);read.reject(Error('late-read'));await reading.settle();assert.equal(reading.state.lateUpdates,0);
 const handing=harness(),ai=deferred();handing.state.aiResponse=ai;await handing.settle();handing.click('与 AI 核查');await handing.settle();handing.cleanup();assert.equal(handing.state.handoffs[0].signal.aborted,true);ai.reject(Error('late-handoff'));await handing.settle();assert.equal(handing.state.lateUpdates,0);
});

test('AI association feedback applies only to the same record, run, hash and selected focus',async()=>{
 const page=harness();try{await page.settle();const context={...basis,sessionId:'native-session',originRunId:basis.runId,originContentHash:basis.contentHash,revision:1,selectedFocus:period};
  for(const wrong of [{...context,recordId:'other'},{...context,runId:'old-run'},{...context,contentHash:'b'.repeat(64)},{...context,selectedFocus:{kind:'inspection',inspectionId:'other'}}]){page.props.aiContext=wrong;await page.settle();assert.doesNotMatch(page.content(),/已关联当前 AI 会话/);}
  page.props.aiContext=context;await page.settle();assert.match(page.content(),/已关联当前 AI 会话/);assert.equal(page.state.handoffs.length,0);assert.deepEqual(page.props.view,basis);
 }finally{page.cleanup();}
});

test('the shared handoff busy state prevents focus controls from starting a competing request',async()=>{
 const page=harness();try{await page.settle();page.props.disabled=true;await page.settle();assert.equal(page.button('与 AI 核查').props.disabled,true);assert.equal(page.button('收起记录').props.disabled,true);assert.equal(page.button('选择检验记录 INS-1').props.disabled,true);assert.equal(page.button('下一页').props.disabled,true);
  page.button('与 AI 核查').props.onClick();await page.settle();assert.equal(page.state.handoffs.length,0);page.props.disabled=false;await page.settle();assert.equal(page.button('与 AI 核查').props.disabled,false);
 }finally{page.cleanup();}
});

function ownerHarness(){
 const slots=[],effects=[],calls=[],wait=deferred();let cursor=0,dirty=true,tree,unmounted=false,lateUpdates=0;
 const hooks={useState(initial){const i=cursor++;if(!slots[i])slots[i]={value:typeof initial==='function'?initial():initial};return [slots[i].value,next=>{if(unmounted){lateUpdates++;return;}const value=typeof next==='function'?next(slots[i].value):next;if(!Object.is(value,slots[i].value)){slots[i].value=value;dirty=true;}}];},useRef(initial){return slots[cursor++]??={current:initial};},useEffect(run,deps){const i=cursor++,old=slots[i];if(!old||deps.some((value,n)=>!Object.is(value,old.deps?.[n])))effects.push(()=>{old?.cleanup?.();slots[i]={deps,cleanup:run()};});}};
 const props={identityScopeKey:'member',...basis,mode:'summary',focusSelection:period,onFocusChange(){},client:{async view(){return {...basis,reports:[],interpretations:[]};}},onAiDraft:async(view,signal,purpose,report,selection)=>{calls.push({view,signal,purpose,report,selection});await wait.promise;}};
 function render(){cursor=0;dirty=false;globalThis.__qualityFocusHooks=hooks;try{const outer=QualityHistoryResult(props);tree=outer.type(outer.props);}finally{delete globalThis.__qualityFocusHooks;}while(effects.length)effects.shift()();}
 async function settle(){if(unmounted){await new Promise(done=>setImmediate(done));return;}dirty=true;for(let n=0;n<35;n++){if(dirty)render();await new Promise(done=>setImmediate(done));if(!dirty&&!effects.length)return;}throw Error('focus-owner-did-not-settle');}
 function cleanup(){if(unmounted)return;unmounted=true;for(const slot of slots)slot?.cleanup?.();}
 return {settle,cleanup,calls,wait,content:()=>tree.props,focus:()=>tree.props.focusReview.props,lateUpdates:()=>lateUpdates};
}

test('HistoryResult serializes focus and complete-analysis handoffs in both orders',async()=>{
 for(const first of ['focus','analysis']){
  const owner=ownerHarness();try{await owner.settle();const signal=new AbortController().signal;let focusRequest;
   if(first==='focus'){focusRequest=owner.focus().onOpenAi(period,signal);await owner.settle();owner.content().draft.onOpen();}
   else{owner.content().draft.onOpen();await owner.settle();await assert.rejects(()=>owner.focus().onOpenAi(period,signal),/request-pending/);}
   await owner.settle();assert.equal(owner.calls.length,1);assert.equal(owner.calls[0].purpose,first);assert.equal(owner.content().draft.busy,true);assert.equal(owner.focus().disabled,true);assert.deepEqual(owner.calls[0].view,{...basis,reports:[],interpretations:[]});if(first==='focus')assert.deepEqual(owner.calls[0].selection,period);
   owner.wait.resolve();if(focusRequest)await focusRequest;await owner.settle();assert.equal(owner.content().draft.busy,false);assert.equal(owner.focus().disabled,false);
  }finally{owner.cleanup();}
 }
});

test('HistoryResult aborts its shared focus owner on unmount without publishing a late busy update',async()=>{
 const owner=ownerHarness();await owner.settle();const pending=owner.focus().onOpenAi(period,new AbortController().signal);await owner.settle();owner.cleanup();assert.equal(owner.calls[0].signal.aborted,true);owner.wait.resolve();await pending;await owner.settle();assert.equal(owner.lateUpdates(),0);
});
