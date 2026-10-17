import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(new URL('../../../../apps/web/package.json',import.meta.url));
const build=await require('esbuild').build({entryPoints:[fileURLToPath(new URL('../src/client/LibraryReferencePage.tsx',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false,jsx:'transform',tsconfigRaw:{compilerOptions:{jsx:'react'}},plugins:[{name:'reference-hooks',setup(b){b.onResolve({filter:/^react$/},()=>({path:'react',namespace:'reference-hooks'}));b.onLoad({filter:/.*/,namespace:'reference-hooks'},()=>({loader:'js',contents:`const React={createElement:(type,props,...children)=>({type,props:{...props,children}})};export default React;export const createElement=React.createElement;export const useState=(...args)=>globalThis.__libraryHooks.useState(...args);export const useRef=(...args)=>globalThis.__libraryHooks.useRef(...args);export const useEffect=(...args)=>globalThis.__libraryHooks.useEffect(...args);`}));}}]});
const {LibraryReferencePage}=await import('data:text/javascript;base64,'+Buffer.from(build.outputFiles[0].text).toString('base64'));
const tick=()=>new Promise(done=>setImmediate(done));
const nodes=value=>!value||typeof value!=='object'?[]:Array.isArray(value)?value.flatMap(nodes):[value,...nodes(value.props?.children)];
const text=value=>value==null||typeof value==='boolean'?'':Array.isArray(value)?value.map(text).join(''):typeof value==='object'?text(value.props?.children):String(value);
function fixture(kind='csv'){
 let dirty=true,cursor=0,tree;const slots=[],effects=[],state={reads:[],mounts:[],disposals:0,guards:new Map(),returns:[],saves:[],saveWait:undefined};
 const info={tab:{id:'tab',signal:new AbortController().signal,visible:true,navigation:{params:{assetId:'asset',revisionId:'pinned',name:`检验.${kind}`,kind,saveOriginal:kind==='xlsx',returnPanelId:'quality',returnLabel:'返回质量分析'},revision:1}}};
 const host={};const hooks={useState(initial){const i=cursor++;if(!slots[i])slots[i]={value:typeof initial==='function'?initial():initial};return [slots[i].value,next=>{slots[i].value=typeof next==='function'?next(slots[i].value):next;dirty=true;}];},useRef(initial){const i=cursor++;return slots[i]??={current:initial};},useEffect(run,deps){const i=cursor++,previous=slots[i];if(!previous||deps.some((value,j)=>!Object.is(value,previous.deps[j])))effects.push(()=>{previous?.cleanup?.();slots[i]={deps,cleanup:run()};});}};
 const props={useTabInfo:()=>info,registerCloseGuard(id,guard){state.guards.set(id,guard);return()=>state.guards.delete(id);},returnToPanel(id){state.returns.push(id);},management:{async readOriginal(...args){state.reads.push(args);return new Uint8Array([1,2]);},async readText(){return 'text';},async saveOriginalRevision(input,signal){state.saves.push(input);if(state.saveWait)await state.saveWait;signal.throwIfAborted();return {asset:{id:'asset'},revision:{id:'new',assetId:'asset',originalSha256:Buffer.from(await crypto.subtle.digest('SHA-256',input.bytes)).toString('hex')}};}},previewRegistry:{canOpen(){return true;},async mount(target,input){state.mounts.push({target,input});return()=>state.disposals++;}}};
 function render(){cursor=0;dirty=false;globalThis.__libraryHooks=hooks;try{tree=LibraryReferencePage(props);}finally{delete globalThis.__libraryHooks;}for(const node of nodes(tree))if(node.props?.ref)node.props.ref.current=host;while(effects.length)effects.shift()();}
 async function settle(){const old=globalThis.window;globalThis.window={addEventListener(){},removeEventListener(){}};try{for(let i=0;i<30;i++){if(dirty)render();await tick();if(!dirty&&!effects.length)return;}throw Error('did-not-settle');}finally{if(old===undefined)delete globalThis.window;else globalThis.window=old;}}
 function cleanup(){const old=globalThis.window;globalThis.window={removeEventListener(){}};try{slots.forEach(slot=>slot?.cleanup?.());}finally{if(old===undefined)delete globalThis.window;else globalThis.window=old;}}
 return {state,info,props,settle,cleanup,all:()=>nodes(tree),content:()=>text(tree),hide:()=>{info.tab.visible=false;dirty=true;}};
}
test('the Library right-side owner mounts pinned CSV through the shared Office provider, read-only with controlled return',async()=>{
 const f=fixture();await f.settle();assert.equal(f.state.reads[0][0],'asset');assert.equal(f.state.reads[0][1],'pinned');assert.equal(f.state.mounts[0].input.kind,'csv');assert.equal(f.state.mounts[0].input.onSaveOriginal,undefined);
 const button=f.all().find(node=>node.type==='button');assert.equal(text(button),'返回质量分析');button.props.onClick();assert.deepEqual(f.state.returns,['quality']);f.cleanup();assert.equal(f.state.disposals,1);assert.equal(f.state.guards.size,0);
});
test('switching away preserves the existing Office editor and saving blocks official Tab close and return',async()=>{
 const f=fixture('xlsx');await f.settle();let finish;f.state.saveWait=new Promise(resolve=>finish=resolve);
 const pending=f.state.mounts[0].input.onSaveOriginal(new Uint8Array([3]),new AbortController().signal);await f.settle();assert.equal(f.all().find(node=>node.type==='button').props.disabled,true);assert.throws(()=>f.state.guards.get('tab')(),/正在保存/);
 f.hide();await f.settle();assert.equal(f.state.disposals,0);assert.equal(f.state.mounts.length,1);
 finish();await pending;await f.settle();assert.match(f.content(),/新版本已保存/);assert.doesNotThrow(()=>f.state.guards.get('tab')());assert.equal(f.state.saves[0].expectedRevisionId,'pinned');f.cleanup();
});
test('failed save does not claim a saved version and releases the close guard',async()=>{
 const f=fixture('xlsx');f.props.management.saveOriginalRevision=async()=>{throw Error('network');};await f.settle();await assert.rejects(f.state.mounts[0].input.onSaveOriginal(new Uint8Array([4]),new AbortController().signal));await f.settle();assert.match(f.content(),/保存结果未确认/);assert.doesNotThrow(()=>f.state.guards.get('tab')());f.cleanup();
});
