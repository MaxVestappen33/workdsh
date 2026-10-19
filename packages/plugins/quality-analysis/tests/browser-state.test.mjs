import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

// Execute the real browser and history controller hooks/event handlers. Child
// business screens are opaque; these checks do not prove rendered UI quality.
const require=createRequire(new URL('../../../../apps/web/package.json',import.meta.url));
async function compile(name,opaque=false){
 const built=await require('esbuild').build({entryPoints:[fileURLToPath(new URL(`../src/client/${name}.tsx`,import.meta.url))],bundle:true,platform:'node',format:'esm',write:false,jsx:'transform',
  tsconfigRaw:{compilerOptions:{jsx:'react',jsxFactory:'React.createElement',jsxFragmentFactory:'React.Fragment'}},
  plugins:[{name:'quality-browser-hooks',setup(builder){
   builder.onResolve({filter:/^react$/},()=>({path:'react',namespace:'quality-browser-hooks'}));
   builder.onLoad({filter:/.*/,namespace:'quality-browser-hooks'},()=>({contents:`
    const React={createElement:(type,props,...children)=>({type,props:{...props,children}}),Fragment:Symbol.for('test.fragment')};export default React;
    export const useState=(...args)=>globalThis.__qualityBrowserHooks.useState(...args);
    export const useRef=(...args)=>globalThis.__qualityBrowserHooks.useRef(...args);
    export const useEffect=(...args)=>globalThis.__qualityBrowserHooks.useEffect(...args);
    export const useMemo=(...args)=>globalThis.__qualityBrowserHooks.useMemo(...args);
    export const useCallback=(...args)=>globalThis.__qualityBrowserHooks.useCallback(...args);
    export const useSyncExternalStore=(...args)=>globalThis.__qualityBrowserHooks.useSyncExternalStore(...args);
   `,loader:'js'}));
   if(opaque){
    builder.onResolve({filter:/\/Quality(Records|History|HistoryResult|RecordWorkflow|Drawer)\.js$/},args=>({path:args.path.split('/').at(-1).slice(0,-3),namespace:'quality-browser-child'}));
    builder.onLoad({filter:/.*/,namespace:'quality-browser-child'},args=>({contents:`export const ${args.path}='test:${args.path}';`,loader:'js'}));
   }
  }}]});
 return import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
}
const {QualityAnalysisBrowser}=await compile('QualityAnalysisBrowser',true),{QualityHistory}=await compile('QualityHistory'),{QualityRecords}=await compile('QualityRecords');
const text=node=>Array.isArray(node)?node.map(text).join(''):node&&typeof node==='object'?node.type==='style'?'':text(node.props?.children):node===null||node===undefined||typeof node==='boolean'?'':String(node);
function nodes(node,result=[]){if(Array.isArray(node))node.forEach(child=>nodes(child,result));else if(node&&typeof node==='object'){result.push(node);nodes(node.props?.children,result);}return result;}
function hooksHarness(component,props){
 const slots=[],effects=[];let cursor=0,dirty=true,tree,boundaryKey,hasBoundary=false;
 const equal=(left,right)=>left&&right&&left.length===right.length&&right.every((value,index)=>Object.is(left[index],value));
 const hooks={
  useState(initial){const index=cursor++;if(!slots[index])slots[index]={value:typeof initial==='function'?initial():initial};return[slots[index].value,next=>{const value=typeof next==='function'?next(slots[index].value):next;if(!Object.is(value,slots[index].value)){slots[index].value=value;dirty=true;}}];},
  useRef(initial){const index=cursor++;return slots[index]??={current:initial};},
  useEffect(run,deps){const index=cursor++,old=slots[index];if(!old||!equal(old.deps,deps))effects.push(()=>{old?.cleanup?.();slots[index]={deps,cleanup:run()};});},
  useMemo(factory,deps){const index=cursor++,old=slots[index];if(!old||!equal(old.deps,deps))slots[index]={deps,value:factory()};return slots[index].value;},
  useCallback(callback,deps){return hooks.useMemo(()=>callback,deps);},
  useSyncExternalStore(subscribe,get){hooks.useEffect(()=>subscribe(()=>{dirty=true;}),[subscribe]);return get();},
 };
 function render(){cursor=0;dirty=false;const previous=globalThis.__qualityBrowserHooks;globalThis.__qualityBrowserHooks=hooks;try{const outer=component(props);if(hasBoundary&&!Object.is(boundaryKey,outer.props?.key)){for(const slot of slots)slot?.cleanup?.();slots.length=0;effects.length=0;cursor=0;}hasBoundary=true;boundaryKey=outer.props?.key;tree=typeof outer.type==='function'?outer.type(outer.props):outer;}finally{globalThis.__qualityBrowserHooks=previous;}while(effects.length)effects.shift()();}
 async function settle(){dirty=true;for(let count=0;count<35;count++){if(dirty)render();await new Promise(resolve=>setImmediate(resolve));if(!dirty&&!effects.length)return;}throw Error('browser-state-did-not-settle');}
 const find=predicate=>{const result=nodes(tree).find(predicate);assert.ok(result,'actual browser control exists');return result;};
 return{settle,props,boundary:()=>boundaryKey,all:()=>nodes(tree),text:()=>text(tree),child:name=>find(node=>node.type===`test:${name}`).props,
  click(label){const item=find(node=>node.type==='button'&&text(node)===label);assert.equal(!!item.props.disabled,false,`${label} is enabled`);return item.props.onClick();},
  cleanup(){for(const slot of slots)slot?.cleanup?.();},
 };
}
const run=(id='latest')=>({runId:id,contentHash:(id==='latest'?'a':'b').repeat(64),createdAt:id==='latest'?'2026-10-11T00:00:00Z':'2026-10-11T01:00:00Z',inspectedQuantity:300,nonconformingQuantity:15});
const record=(id='record',configuration=true)=>({id,title:id==='record'?'本月质量分析':'另一份分析',revision:1,generation:1,...(configuration?{configuration:{sourceSnapshotId:'source',sourceNamespace:'record'}}:{})});
async function browser(){const client={async list(){return[];}},libraryOpens=[];const h=hooksHarness(QualityAnalysisBrowser,{identityScopeKey:'identity',client,library:{management:{},openLibrary(){libraryOpens.push('open');}}});h.libraryOpens=libraryOpens;await h.settle();return h;}
async function open(h,entry=record()){h.child('QualityRecords').onOpen(entry);await h.settle();}
function loadState(h,state){h.child('QualityHistory').onLoadState({recordId:'record',busy:false,total:1,...state});}
function selected(h){return h.child('QualityHistoryResult');}

test('current analysis selection preserves the chosen historical result and current report tab',async()=>{
 const h=await browser();try{
  await open(h);h.child('QualityHistory').onSelect(run('historical'));await h.settle();h.click('报告');await h.settle();
  assert.equal(selected(h).runId,'historical');assert.equal(selected(h).mode,'report');
  await open(h);assert.equal(selected(h).runId,'historical');assert.equal(selected(h).mode,'report');
 }finally{h.cleanup();}
});
test('workflow record refresh updates first-analysis and no-data state without resetting the selected run',async()=>{
 const h=await browser();try{
  await open(h,record('record',false));h.click('分析总览');loadState(h,{total:0});await h.settle();assert.match(h.text(),/先导入检验数据/);
  const workflow=h.child('QualityRecordWorkflow');assert.equal(typeof workflow.onRecordChanged,'function');workflow.onRecordChanged(record());await h.settle();
  assert.match(h.text(),/开始第一次分析/);assert.doesNotMatch(h.text(),/先导入检验数据/);
  h.child('QualityHistory').onSelect(run());await h.settle();h.child('QualityRecordWorkflow').onRecordChanged({...record(),generation:2,revision:2});await h.settle();assert.equal(selected(h).runId,'latest');
 }finally{h.cleanup();}
});
test('overview distinguishes pending history, load error, unconfigured empty and configured empty states',async()=>{
 const h=await browser();try{
  await open(h);assert.match(h.text(),/正在读取分析结果/);
  loadState(h,{error:'网络暂不可用',total:undefined});await h.settle();assert.match(h.text(),/暂时无法读取分析结果/);assert.match(h.text(),/网络暂不可用/);assert.doesNotMatch(h.text(),/正在读取分析结果/);
  loadState(h,{total:0});await h.settle();assert.match(h.text(),/开始第一次分析/);assert.doesNotMatch(h.text(),/暂时无法读取分析结果/);
  await open(h,record('other',false));h.click('分析总览');h.child('QualityHistory').onLoadState({recordId:'other',busy:false,total:0});await h.settle();assert.match(h.text(),/先导入检验数据/);
 }finally{h.cleanup();}
});
test('report leave guard rejects tab, record and historical-result replacement',async()=>{
 const h=await browser();try{
  await open(h);h.child('QualityHistory').onSelect(run());await h.settle();h.click('报告');await h.settle();let calls=0;
  selected(h).onLeaveGuard(()=>{calls++;return false;});
  h.click('检验数据');await h.settle();assert.equal(selected(h).mode,'report');
  h.child('QualityHistory').onSelect(run('historical'));await h.settle();assert.equal(selected(h).runId,'latest');
  await open(h,record('other'));assert.equal(selected(h).recordId,'record');assert.equal(calls,3);
  selected(h).onLeaveGuard(()=>true);h.child('QualityHistory').onSelect(run('historical'));await h.settle();assert.equal(selected(h).runId,'historical');
 }finally{h.cleanup();}
});
test('business navigation has only overview, inspection data and reports; analysis is a data action',async()=>{
 const h=await browser();try{
  await open(h);const navigation=h.all().find(node=>node.type==='nav'&&node.props['aria-label']==='质量业务模块');assert.ok(navigation);
  const labels=nodes(navigation).filter(node=>node.type==='button').map(text);assert.deepEqual(labels,['分析总览','检验数据','报告']);
  h.click('检验数据');await h.settle();assert.equal(h.child('QualityRecordWorkflow').view,'data');
 }finally{h.cleanup();}
});
test('leaving for the library checks both retained data decisions and report text before native panel navigation',async()=>{
 const h=await browser();try{
  await open(h);const workflow=h.child('QualityRecordWorkflow');workflow.onLeaveGuard(()=>false);workflow.openLibrary();await h.settle();assert.equal(h.libraryOpens.length,0);
  h.child('QualityRecordWorkflow').onLeaveGuard(()=>true);h.child('QualityRecordWorkflow').openLibrary();await h.settle();assert.equal(h.libraryOpens.length,1);
  h.child('QualityHistory').onSelect(run());await h.settle();h.click('报告');await h.settle();selected(h).onLeaveGuard(()=>false);selected(h).openLibrary();await h.settle();assert.equal(h.libraryOpens.length,1);
  selected(h).onLeaveGuard(()=>true);selected(h).openLibrary();await h.settle();assert.equal(h.libraryOpens.length,2);
 }finally{h.cleanup();}
});
test('newest-first history selects a default once; refresh and pagination preserve explicit user selection',async()=>{
 const calls=[],selections=[],pages=[{revision:1,total:21,offset:0,entries:[run(),run('historical')]},{revision:2,total:21,offset:0,entries:[run('newer'),run()]},{revision:2,total:21,offset:20,entries:[run('oldest')]}];
 const h=hooksHarness(QualityHistory,{identityScopeKey:'identity',recordId:'record',selectLatestOnLoad:true,client:{async runs(...args){calls.push(args.slice(0,4));return structuredClone(pages.shift());}},onSelect:value=>selections.push(value.runId)});
 try{await h.settle();assert.deepEqual(selections,['latest']);h.click('2026/10/11 09:00:00 · 检验 300 · 不合格 15');await h.settle();assert.deepEqual(selections,['latest','historical']);h.click('刷新历史');await h.settle();assert.deepEqual(selections,['latest','historical']);h.click('下一页');await h.settle();assert.deepEqual(selections,['latest','historical']);assert.deepEqual(calls.map(item=>item[1]),[0,0,20]);assert.equal(calls[2][3],2);}finally{h.cleanup();}
});


async function navigationBrowser({scope='identity',initialNavigation,entries=[record(),record('other')],denied=[]}={}){
 const calls=[],navigation=[];
 const client={async list(signal){calls.push(['list',signal]);return entries;},async get(id,signal){calls.push(['get',id,signal]);if(denied.includes(id))throw Error('access-denied');return entries.find(row=>row.id===id);}};
 const props={identityScopeKey:scope,client,library:{management:{},openLibrary(){}},initialNavigation,onNavigation:next=>navigation.push(next)};
 const h=hooksHarness(QualityAnalysisBrowser,props);await h.settle();
 // Mount the real picker against the Browser's real controller, while its other
 // business screens remain opaque. This covers the authorized list-to-open path.
 const picker=hooksHarness(QualityRecords,h.child('QualityRecords'));await picker.settle();await h.settle();
 return {h,picker,calls,navigation,props,cleanup(){picker.cleanup();h.cleanup();}};
}

test('native return navigation reopens the specified analysis among multiple records and retains the data tab',async()=>{
 const returned=await navigationBrowser({initialNavigation:{recordId:'other',tab:'data'}});try{
  const {h,calls,navigation}=returned;assert.deepEqual(calls.filter(call=>call[0]==='get').map(call=>call[1]),['other']);assert.equal(h.child('QualityRecordWorkflow').record.id,'other');assert.equal(h.child('QualityRecordWorkflow').view,'data');assert.equal(h.child('QualityRecordWorkflow').active,true);assert.deepEqual(navigation.at(-1),{recordId:'other',tab:'data'});
  const nav=h.all().find(node=>node.type==='nav'&&node.props['aria-label']==='质量业务模块');assert.equal(nodes(nav).find(node=>node.type==='button'&&text(node)==='检验数据').props['aria-current'],'page');
 }finally{returned.cleanup();}
});
test('changing identity remounts the navigation owner and discards the prior record and retained callbacks',async()=>{
 const first=await navigationBrowser({scope:'member-one',initialNavigation:{recordId:'other',tab:'data'}});try{
  const previousPicker=first.h.child('QualityRecords'),previousOwner=previousPicker.controller;assert.equal(first.h.child('QualityRecordWorkflow').record.id,'other');
  first.picker.cleanup();Object.assign(first.props,{identityScopeKey:'member-two',initialNavigation:undefined,client:{async list(){return [{...record('new-member-record'),title:'新成员的质量分析'}];},async get(id){return {...record(id),title:'新成员的质量分析'};}}});await first.h.settle();assert.equal(first.h.boundary(),'member-two');assert.notEqual(first.h.child('QualityRecords').controller,previousOwner);assert.equal(first.h.child('QualityRecords').initialRecordId,undefined);assert.equal(first.h.all().some(node=>node.type==='test:QualityRecordWorkflow'),false);
  // An old asynchronous picker cannot reopen the previous member's record.
  previousPicker.onOpen(record('other'));await first.h.settle();assert.equal(first.h.all().some(node=>node.type==='test:QualityRecordWorkflow'),false);
  const picker=hooksHarness(QualityRecords,first.h.child('QualityRecords'));try{await picker.settle();await first.h.settle();assert.equal(first.h.child('QualityRecordWorkflow').record.id,'new-member-record');assert.equal(first.h.child('QualityRecordWorkflow').active,false);assert.doesNotMatch(first.h.text(),/另一份分析/);const nav=first.h.all().find(node=>node.type==='nav'&&node.props['aria-label']==='质量业务模块');assert.equal(nodes(nav).find(node=>node.type==='button'&&text(node)==='分析总览').props['aria-current'],'page');}finally{picker.cleanup();}
 }finally{first.cleanup();}
});
test('a remembered analysis outside the authorized list is not fetched or blindly reopened',async()=>{
 const returned=await navigationBrowser({initialNavigation:{recordId:'missing-record',tab:'data'},entries:[record('other')]});try{
  assert.equal(returned.calls.filter(call=>call[0]==='get').length,0);assert.equal(returned.h.all().some(node=>node.type==='test:QualityRecordWorkflow'),false);assert.equal(returned.navigation.length,0);assert.equal(returned.h.child('QualityRecords').initialRecordId,'missing-record');
 }finally{returned.cleanup();}
});
test('a remembered analysis whose detail authorization fails stays in the picker without publishing navigation',async()=>{
 const returned=await navigationBrowser({initialNavigation:{recordId:'other',tab:'data'},denied:['other']});try{
  assert.deepEqual(returned.calls.filter(call=>call[0]==='get').map(call=>call[1]),['other']);assert.equal(returned.h.all().some(node=>node.type==='test:QualityRecordWorkflow'),false);assert.equal(returned.navigation.length,0);assert.match(returned.picker.text(),/记录打开失败，请核对权限或刷新列表/);
 }finally{returned.cleanup();}
});

test('continue conversation resumes without preparing another draft and only for its current analytical basis',async()=>{
 const h=await browser();try{
  await open(h);h.child('QualityHistory').onSelect(run());await h.settle();
  let resumes=0;h.props.onOpenConversation=()=>{resumes++;};
  h.props.aiContext={recordId:'record',sessionId:'session',originRunId:'latest',originContentHash:'a'.repeat(64),runId:'latest',contentHash:'a'.repeat(64),revision:1};
  await h.settle();h.click('继续对话');assert.equal(resumes,1);
  h.child('QualityHistory').onSelect(run('historical'));await h.settle();assert.doesNotMatch(h.text(),/继续对话/);
  h.child('QualityHistory').onSelect(run());h.props.conversationOpen=true;await h.settle();assert.doesNotMatch(h.text(),/继续对话/);assert.match(h.text(),/收起对话/);
 }finally{h.cleanup();}
});
