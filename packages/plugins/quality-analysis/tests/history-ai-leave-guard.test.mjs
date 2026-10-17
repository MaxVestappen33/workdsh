import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

// Real HistoryResult request ownership and callbacks; native navigation/model
// execution and child visuals are opaque. This is not rendered UI acceptance.
const require=createRequire(new URL('../../../../apps/web/package.json',import.meta.url));
const built=await require('esbuild').build({entryPoints:[fileURLToPath(new URL('../src/client/QualityHistoryResult.tsx',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false,jsx:'transform',
 tsconfigRaw:{compilerOptions:{jsx:'react',jsxFactory:'React.createElement',jsxFragmentFactory:'React.Fragment'}},
 plugins:[{name:'quality-ai-leave-hooks',setup(builder){
  builder.onResolve({filter:/^react$/},()=>({path:'react',namespace:'quality-ai-leave-hooks'}));
  builder.onLoad({filter:/.*/,namespace:'quality-ai-leave-hooks'},()=>({contents:`
   const React={createElement:(type,props,...children)=>({type,props:{...props,children}}),Fragment:Symbol.for('test.fragment')};export default React;
   export const useState=(...args)=>globalThis.__qualityAiLeaveHooks.useState(...args);
   export const useRef=(...args)=>globalThis.__qualityAiLeaveHooks.useRef(...args);
   export const useEffect=(...args)=>globalThis.__qualityAiLeaveHooks.useEffect(...args);
  `,loader:'js'}));
  builder.onResolve({filter:/\/Quality(ReportEditor|Interpretation|Results)\.js$/},args=>({path:args.path.split('/').at(-1).slice(0,-3),namespace:'quality-ai-leave-child'}));
  builder.onLoad({filter:/.*/,namespace:'quality-ai-leave-child'},args=>({contents:`export const ${args.path}='test:${args.path}';`,loader:'js'}));
 }}]});
const {QualityHistoryResult}=await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const scope={recordId:'record',runId:'fixed-run',contentHash:'a'.repeat(64)};
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
function harness({delay=false,failed=false}={}){
 const slots=[],effects=[],handoffs=[],experts=[],notifications=[];let cursor=0,dirty=true,tree;
 const response=delay?deferred():undefined;
 const hooks={
  useState(initial){const index=cursor++;if(!slots[index])slots[index]={value:typeof initial==='function'?initial():initial};return[slots[index].value,next=>{const value=typeof next==='function'?next(slots[index].value):next;if(!Object.is(value,slots[index].value)){slots[index].value=value;dirty=true;}}];},
  useRef(initial){const index=cursor++;return slots[index]??={current:initial};},
  useEffect(run,deps){const index=cursor++,old=slots[index];if(!old||deps.some((value,i)=>!Object.is(value,old.deps[i])))effects.push(()=>{old?.cleanup?.();slots[index]={deps,cleanup:run()};});},
 };
 const view={...scope,reports:[],interpretations:[]};
 const props={identityScopeKey:'scope',...scope,mode:'report',client:{async view(){if(failed)throw Error('network');return structuredClone(view);}},
  onAiDraft:async(value,signal,purpose,report)=>{handoffs.push({view:value,signal,purpose,report});if(response)await response.promise;},
  onExpertDraft:async(...args)=>{experts.push(args);},onLeaveGuard:guard=>notifications.push(guard),
 };
 function render(){cursor=0;dirty=false;const previous=globalThis.__qualityAiLeaveHooks;globalThis.__qualityAiLeaveHooks=hooks;try{const outer=QualityHistoryResult(props);tree=outer.type(outer.props);}finally{globalThis.__qualityAiLeaveHooks=previous;}while(effects.length)effects.shift()();}
 async function settle(){dirty=true;for(let count=0;count<25;count++){if(dirty)render();await new Promise(resolve=>setImmediate(resolve));if(!dirty&&!effects.length)return;}throw Error('history-ai-state-did-not-settle');}
 return{settle,handoffs,experts,notifications,response,content:()=>tree.props,editor:()=>tree.props.reportEditor?.props,interpretation:()=>tree.props.interpretation?.props,
  cleanup(){for(const slot of slots)slot?.cleanup?.();},
 };
}

test('inline native report conversation preserves editing and forwards the selected report without leaving the business page',async()=>{
 const h=harness();try{
  await h.settle();const editor=h.editor();assert.equal(typeof editor.onOpenAi,'function');let calls=0;const guard=()=>{calls++;return false;};editor.onLeaveGuard(guard);
  assert.equal(h.notifications.at(-1),guard);editor.onOpenAi({reportId:'selected',revisionId:'version'});await h.settle();assert.equal(calls,0);assert.equal(h.handoffs.length,1);assert.equal(h.content().draft.busy,false);
  assert.deepEqual(h.handoffs[0].view,{...scope,reports:[],interpretations:[]});assert.equal(h.handoffs[0].signal.aborted,false);assert.equal(h.handoffs[0].purpose,'report');assert.deepEqual(h.handoffs[0].report,{reportId:'selected',revisionId:'version'});assert.match(h.content().draft.message,/右侧原生对话/);
 }finally{h.cleanup();}
});
test('an active AI draft handoff owns its request, deduplicates clicks and aborts when the result leaves',async()=>{
 const h=harness({delay:true});try{
  await h.settle();h.editor().onLeaveGuard(()=>true);h.editor().onOpenAi();await h.settle();assert.equal(h.handoffs.length,1);assert.equal(h.editor().aiBusy,true);
  h.editor().onOpenAi();h.content().draft.onOpen();await h.settle();assert.equal(h.handoffs.length,1);
  h.cleanup();assert.equal(h.handoffs[0].signal.aborted,true);h.response.resolve();await h.settle();assert.doesNotMatch(h.content().draft.message??'',/已打开 AI 对话/);
 }finally{h.cleanup();}
});
test('expert handoff shares the report leave guard and forwards the exact verified native context only when accepted',async()=>{
 const h=harness();try{
  await h.settle();h.editor().onLeaveGuard(()=>false);const signal=new AbortController().signal;
  await assert.rejects(()=>h.interpretation().onExpertDraft('native-session','business instruction',signal),/unsaved-edit/);assert.equal(h.experts.length,0);
  h.editor().onLeaveGuard(()=>true);await h.interpretation().onExpertDraft('native-session','business instruction',signal);assert.equal(h.experts.length,1);assert.deepEqual(h.experts[0],['native-session','business instruction',signal]);
  h.editor().onLeaveGuard(undefined);assert.equal(h.notifications.at(-1),undefined);
 }finally{h.cleanup();}
});
test('failed fixed analysis reading never creates an editable report or starts an AI request',async()=>{
 const h=harness({failed:true});try{await h.settle();assert.equal(h.editor(),undefined);assert.equal(h.content().view,undefined);assert.match(h.content().error,/读取失败/);h.content().draft.onOpen();await h.settle();assert.equal(h.handoffs.length,0);}finally{h.cleanup();}
});
