import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(new URL('../../../../apps/web/package.json',import.meta.url));
// Exercise the production button and asynchronous lifecycle. Native panel
// rendering belongs to its official owner and is not certified by this harness.
const built=await require('esbuild').build({entryPoints:[fileURLToPath(new URL('../src/client/QualitySourcePreview.tsx',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false,jsx:'transform',tsconfigRaw:{compilerOptions:{jsx:'react',jsxFactory:'React.createElement',jsxFragmentFactory:'React.Fragment'}},plugins:[{name:'source-preview-hooks',setup(builder){
 builder.onResolve({filter:/^react$/},()=>({path:'react',namespace:'source-preview-hooks'}));
 builder.onLoad({filter:/.*/,namespace:'source-preview-hooks'},()=>({contents:`const React={createElement:(type,props,...children)=>({type,props:{...props,children}})};export default React;export const useState=(...args)=>globalThis.__qualitySourceHooks.useState(...args);export const useRef=(...args)=>globalThis.__qualitySourceHooks.useRef(...args);export const useEffect=(...args)=>globalThis.__qualitySourceHooks.useEffect(...args);export const useSyncExternalStore=(...args)=>globalThis.__qualitySourceHooks.useSyncExternalStore(...args);`,loader:'js'}));
}}]});
const {QualitySourcePreview}=await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const tick=()=>new Promise(done=>setImmediate(done));
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function nodes(element){if(!element||typeof element!=='object')return [];if(Array.isArray(element))return element.flatMap(nodes);return [element,...nodes(element.props?.children)];}
function text(element){if(element===null||element===undefined||typeof element==='boolean')return '';if(Array.isArray(element))return element.map(text).join('');return typeof element==='object'?text(element.props?.children):String(element);}
function harness(format='csv'){
 const state={opens:[],mounts:0,reads:0,saves:0,stateWrites:0,openWait:undefined,openError:undefined,capabilities:[],guardCalls:0};
 const slots=[],effects=[];let cursor=0,dirty=true,tree;
 const hooks={useState(initial){const index=cursor++;if(!slots[index])slots[index]={value:typeof initial==='function'?initial():initial};return [slots[index].value,next=>{state.stateWrites++;const value=typeof next==='function'?next(slots[index].value):next;if(!Object.is(value,slots[index].value)){slots[index].value=value;dirty=true;}}];},useRef(initial){const index=cursor++;return slots[index]??={current:initial};},useEffect(run,deps){const index=cursor++,previous=slots[index];if(!previous||deps?.some((value,i)=>!Object.is(value,previous.deps?.[i])))effects.push(()=>{previous?.cleanup?.();slots[index]={deps,cleanup:run()};});},useSyncExternalStore(_subscribe,get){cursor++;return get();}};
 const props={source:Object.freeze({assetId:'asset1',revisionId:'source-revision',title:`十月检验.${format}`,format}),registry:{subscribe(){return()=>{};},getRevision(){return 1;},canOpen(value){state.capabilities.push(value);throw Error('Native file navigation must not depend on a custom preview provider');},mount(){state.mounts++;throw Error('Quality must not mount a second Office');}},management:{readOriginal(){state.reads++;throw Error('Quality must not read original bytes');},saveOriginalRevision(){state.saves++;throw Error('Quality must not save Office files');}},async openOriginal(...args){state.opens.push(args);if(state.openWait)await state.openWait.promise;if(state.openError)throw state.openError;}};
 function render(){cursor=0;dirty=false;globalThis.__qualitySourceHooks=hooks;try{tree=QualitySourcePreview(props);}finally{delete globalThis.__qualitySourceHooks;}while(effects.length)effects.shift()();}
 async function settle(){for(let i=0;i<30;i++){if(dirty)render();await tick();if(!dirty&&!effects.length)return;}throw Error('did-not-settle');}
 function button(){const result=nodes(tree).find(row=>row.type==='button');assert.ok(result);return result;}
 function open(){assert.equal(!!button().props.disabled,false);button().props.onClick();}
 function cleanup(){for(const slot of slots)slot?.cleanup?.();}
 return {state,props,settle,button,open,cleanup,render,update:next=>{Object.assign(props,next);dirty=true;},content:()=>text(tree),allNodes:()=>nodes(tree)};
}

test('CSV source opens the exact pinned revision through the native panel only after explicit action',async()=>{
 const preview=harness();await preview.settle();assert.match(preview.content(),/在右侧打开源文件/);assert.equal(preview.state.opens.length,0);
 assert.equal(preview.allNodes().some(row=>row.type==='dialog'||row.type==='iframe'||row.type==='table'||typeof row.type==='function'),false);
 preview.open();await preview.settle();assert.equal(preview.state.opens.length,1);assert.equal(preview.state.opens[0][0],preview.props.source);assert.equal(preview.state.opens[0][0].revisionId,'source-revision');assert.equal(preview.state.opens[0][1],undefined);
 assert.equal(preview.state.mounts,0);assert.equal(preview.state.reads,0);assert.equal(preview.state.saves,0);assert.equal(preview.state.capabilities.length,0,'the native file owner is independent of the custom Office preview registry');assert.equal(preview.props.source.revisionId,'source-revision');preview.cleanup();
});
test('XLSX follows the same native owner without a local editor or replacement revision',async()=>{
 const preview=harness('xlsx');preview.update({label:'打开检验源文件'});await preview.settle();assert.equal(text(preview.button()),'打开检验源文件');assert.equal(preview.button().props.title,'十月检验.xlsx');preview.open();await preview.settle();assert.equal(preview.state.opens[0][0].format,'xlsx');assert.equal(preview.state.opens[0][0].revisionId,'source-revision');assert.equal(preview.state.mounts+preview.state.reads+preview.state.saves,0);assert.doesNotMatch(preview.content(),/保存新版本|采用新版本|已打开/);preview.cleanup();
});
test('missing native entry, unsupported format and hidden page disable opening explicitly',async()=>{
 const preview=harness();preview.update({openOriginal:undefined});await preview.settle();assert.equal(preview.button().props.disabled,true);assert.match(preview.content(),/系统文件查看服务暂未就绪/);preview.button().props.onClick();await preview.settle();assert.equal(preview.state.opens.length,0);
 const source=preview.props.source;preview.update({openOriginal:async(...args)=>preview.state.opens.push(args),source:{...source,format:'pdf'}});await preview.settle();assert.equal(preview.button().props.disabled,true);preview.button().props.onClick();await preview.settle();assert.equal(preview.state.opens.length,0);
 preview.update({source,active:false});await preview.settle();assert.equal(preview.button().props.disabled,true);preview.button().props.onClick();await preview.settle();assert.equal(preview.state.opens.length,0);
 preview.update({active:true});await preview.settle();assert.equal(preview.button().props.disabled,false);preview.cleanup();
});
test('unconfirmed cleaning guard blocks native navigation and a confirmed pending request cannot duplicate',async()=>{
 const preview=harness();let allow=false;preview.update({beforeOpen:()=>{preview.state.guardCalls++;return allow;}});await preview.settle();preview.open();await preview.settle();assert.equal(preview.state.guardCalls,1);assert.equal(preview.state.opens.length,0);assert.equal(preview.button().props.disabled,false);
 allow=true;preview.state.openWait=deferred();preview.open();preview.button().props.onClick();await preview.settle();assert.equal(preview.state.opens.length,1);assert.equal(preview.state.guardCalls,2);assert.equal(preview.button().props.disabled,true);assert.match(preview.content(),/正在打开/);
 preview.state.openWait.resolve();await preview.settle();assert.equal(preview.button().props.disabled,false);preview.cleanup();
});
test('a native navigation failure has a business error and retry clears it without claiming success',async()=>{
 const preview=harness();preview.state.openError=Error('private-token-must-not-leak');await preview.settle();preview.open();await preview.settle();assert.match(preview.content(),/源文件未能打开，请重试或在资料库查看/);assert.equal(preview.allNodes().some(row=>row.props?.role==='alert'),true);assert.doesNotMatch(preview.content(),/private-token|已打开|保存成功/);
 preview.state.openError=undefined;preview.state.openWait=deferred();preview.open();await preview.settle();assert.doesNotMatch(preview.content(),/源文件未能打开/);preview.state.openWait.resolve();await preview.settle();assert.equal(preview.state.opens.length,2);assert.doesNotMatch(preview.content(),/未能打开|已打开/);preview.cleanup();
});
test('unmount after confirmed navigation does not cancel the native panel or publish late state',async()=>{
 const preview=harness();preview.state.openWait=deferred();await preview.settle();preview.open();await preview.settle();assert.equal(preview.state.opens.length,1);preview.cleanup();const writes=preview.state.stateWrites;preview.state.openWait.resolve();await tick();assert.equal(preview.state.stateWrites,writes);assert.equal(preview.state.opens[0][1],undefined);assert.equal(preview.props.source.revisionId,'source-revision');
});
test('a late native failure after unmount does not update a departed workbench',async()=>{
 const preview=harness();preview.state.openWait=deferred();await preview.settle();preview.open();await preview.settle();preview.cleanup();const writes=preview.state.stateWrites;preview.state.openWait.reject(Error('native-panel-denied'));await tick();assert.equal(preview.state.stateWrites,writes);assert.equal(preview.state.opens.length,1);
});
test('hiding the workbench does not abort an already confirmed native open',async()=>{
 const preview=harness();preview.state.openWait=deferred();await preview.settle();const source=preview.props.source;preview.open();await preview.settle();preview.update({active:false});await preview.settle();assert.equal(preview.button().props.disabled,true);assert.equal(preview.state.opens[0][0],source);assert.equal(preview.state.opens[0][1],undefined);preview.state.openWait.resolve();await preview.settle();assert.equal(preview.state.opens.length,1);preview.cleanup();
});
