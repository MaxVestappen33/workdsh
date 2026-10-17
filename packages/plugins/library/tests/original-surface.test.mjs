import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(new URL('../../../../apps/web/package.json',import.meta.url));
const build=await require('esbuild').build({entryPoints:[fileURLToPath(new URL('../src/client/LibraryOriginalSurface.tsx',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false,jsx:'transform',tsconfigRaw:{compilerOptions:{jsx:'react'}},plugins:[{name:'surface-hooks',setup(b){
 b.onResolve({filter:/^react$/},()=>({path:'react',namespace:'surface-hooks'}));
 b.onLoad({filter:/.*/,namespace:'surface-hooks'},()=>({loader:'js',contents:`const React={createElement:(type,props,...children)=>({type,props:{...props,children}})};export default React;export const createElement=React.createElement;export const useState=(...args)=>globalThis.__librarySurfaceHooks.useState(...args);export const useRef=(...args)=>globalThis.__librarySurfaceHooks.useRef(...args);export const useEffect=(...args)=>globalThis.__librarySurfaceHooks.useEffect(...args);export const useSyncExternalStore=(_subscribe,get)=>get();`}));
}}]});
const {LibraryOriginalSurface}=await import('data:text/javascript;base64,'+Buffer.from(build.outputFiles[0].text).toString('base64'));
const tick=()=>new Promise(done=>setImmediate(done));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const nodes=value=>!value||typeof value!=='object'?[]:Array.isArray(value)?value.flatMap(nodes):[value,...nodes(value.props?.children)];
const text=value=>value==null||typeof value==='boolean'?'':Array.isArray(value)?value.map(text).join(''):typeof value==='object'?text(value.props?.children):String(value);
function element(){return {style:{},children:[],append(child){child.parent=this;this.children.push(child);},remove(){if(this.parent)this.parent.children=this.parent.children.filter(row=>row!==this);this.parent=undefined;}};}
function fixture(kind='csv'){
 let dirty=true,cursor=0,tree,disposed=false;const slots=[],effects=[],host=element();
 const state={reads:[],mounts:[],disposals:0,saves:[],saved:[],busy:[],revision:0,available:true};
 const hooks={useState(initial){const i=cursor++;if(!slots[i])slots[i]={value:typeof initial==='function'?initial():initial};return [slots[i].value,next=>{slots[i].value=typeof next==='function'?next(slots[i].value):next;dirty=true;}];},useRef(initial){const i=cursor++;return slots[i]??={current:initial};},useEffect(run,deps){const i=cursor++,previous=slots[i];if(!previous||deps.some((value,j)=>!Object.is(value,previous.deps[j])))effects.push(()=>{previous?.cleanup?.();slots[i]={deps,cleanup:run()};});}};
 const props={source:{assetId:'asset',revisionId:'pinned',name:`检验.${kind}`,kind},onSaved:entry=>state.saved.push(entry),onBusyChange:busy=>state.busy.push(busy),management:{async readOriginal(...args){state.reads.push(args);return new Uint8Array([1,2]);},async saveOriginalRevision(input,signal){state.saves.push({input,signal});signal.throwIfAborted();return {asset:{id:'asset'},revision:{id:'new',assetId:'asset',originalSha256:Buffer.from(await crypto.subtle.digest('SHA-256',input.bytes)).toString('hex')}};}},previewRegistry:{subscribe(){return()=>{};},getRevision:()=>state.revision,canOpen:()=>state.available,async mount(target,input){state.mounts.push({target,input});return()=>{state.disposals++;};}}};
 const withGlobals=work=>{const oldDocument=globalThis.document,oldHooks=globalThis.__librarySurfaceHooks;globalThis.document={createElement:element};globalThis.__librarySurfaceHooks=hooks;try{return work();}finally{if(oldDocument===undefined)delete globalThis.document;else globalThis.document=oldDocument;if(oldHooks===undefined)delete globalThis.__librarySurfaceHooks;else globalThis.__librarySurfaceHooks=oldHooks;}};
 async function settle(){for(let i=0;i<30;i++){if(dirty&&!disposed)withGlobals(()=>{cursor=0;dirty=false;tree=LibraryOriginalSurface(props);for(const node of nodes(tree))if(node.props?.ref)node.props.ref.current=host;while(effects.length)effects.shift()();});
  // The async reader resumes with its original component lifetime and DOM owner.
  const oldDocument=globalThis.document;globalThis.document={createElement:element};try{await tick();}finally{if(oldDocument===undefined)delete globalThis.document;else globalThis.document=oldDocument;}
  if(!dirty&&!effects.length)return;
 }throw Error('surface-did-not-settle');}
 const cleanup=()=>{disposed=true;slots.forEach(slot=>slot?.cleanup?.());};
 return {props,state,host,settle,cleanup,content:()=>text(tree),change:source=>{props.source={...props.source,...source};dirty=true;},refreshProvider:()=>{state.revision++;dirty=true;}};
}
test('fixed CSV is read through Library and mounted through the shared Office provider without a save callback',async()=>{
 const f=fixture();await f.settle();assert.equal(f.state.reads.length,1);assert.equal(f.state.reads[0][0],'asset');assert.equal(f.state.reads[0][1],'pinned');assert.equal(f.state.mounts[0].input.kind,'csv');assert.deepEqual(f.state.mounts[0].input.bytes,new Uint8Array([1,2]));assert.equal(f.state.mounts[0].input.onSaveOriginal,undefined);assert.equal(f.host.children.length,1);f.cleanup();assert.equal(f.state.reads[0][2].aborted,true);assert.equal(f.state.disposals,1);assert.equal(f.host.children.length,0);
});
test('XLSX save reports only the verified new Library revision and exposes busy state',async()=>{
 const f=fixture('xlsx');await f.settle();await f.state.mounts[0].input.onSaveOriginal(new Uint8Array([3]),new AbortController().signal);await f.settle();assert.deepEqual(f.state.busy,[true,false]);assert.equal(f.state.saves[0].input.expectedRevisionId,'pinned');assert.equal(f.state.saved[0].revision.id,'new');assert.match(f.content(),/新版本已保存/);assert.equal(f.props.source.revisionId,'pinned');f.cleanup();
});
test('failed save leaves the source pinned and never announces a confirmed new revision',async()=>{
 const f=fixture('xlsx');f.props.management.saveOriginalRevision=async()=>{throw Error('timeout');};await f.settle();await assert.rejects(f.state.mounts[0].input.onSaveOriginal(new Uint8Array([4]),new AbortController().signal));await f.settle();assert.equal(f.state.saved.length,0);assert.deepEqual(f.state.busy,[true,false]);assert.match(f.content(),/保存结果未确认/);f.cleanup();
});
test('source switch aborts an in-flight read and cannot mount its stale result',async()=>{
 const f=fixture(),old=deferred();let first=true;f.props.management.readOriginal=async(...args)=>{f.state.reads.push(args);if(first){first=false;return old.promise;}return new Uint8Array([9]);};await f.settle();f.change({revisionId:'next'});await f.settle();assert.equal(f.state.reads[0][2].aborted,true);old.resolve(new Uint8Array([7]));await f.settle();assert.equal(f.state.mounts.length,1);assert.deepEqual(f.state.mounts[0].input.bytes,new Uint8Array([9]));f.cleanup();
});
test('late native mount disposes its own detached target without clearing the next file',async()=>{
 const f=fixture(),old=deferred();let first=true;f.props.previewRegistry.mount=async(target,input)=>{f.state.mounts.push({target,input});if(first){first=false;return old.promise;}return()=>f.state.disposals++;};await f.settle();const oldTarget=f.state.mounts[0].target;f.change({revisionId:'next'});await f.settle();assert.equal(oldTarget.parent,undefined);const next=f.host.children[0];old.resolve(()=>f.state.disposals++);await f.settle();assert.equal(f.state.disposals,1);assert.equal(f.host.children[0],next);f.cleanup();assert.equal(f.state.disposals,2);
});
test('closing during save aborts the owner request and suppresses stale saved notifications',async()=>{
 const f=fixture('xlsx'),saving=deferred();f.props.management.saveOriginalRevision=async(input,signal)=>{f.state.saves.push({input,signal});return saving.promise;};await f.settle();const pending=f.state.mounts[0].input.onSaveOriginal(new Uint8Array([5]),new AbortController().signal);while(!f.state.saves.length)await tick();f.cleanup();assert.equal(f.state.saves[0].signal.aborted,true);assert.deepEqual(f.state.busy,[true,false]);saving.resolve({asset:{id:'asset'},revision:{id:'new',assetId:'asset',originalSha256:'not-used-after-abort'}});await assert.rejects(pending);assert.equal(f.state.saved.length,0);
});
test('provider readiness is observed without creating a substitute table',async()=>{
 const f=fixture();f.state.available=false;await f.settle();assert.match(f.content(),/系统 Office 暂未就绪/);assert.equal(f.state.reads.length,0);f.state.available=true;f.refreshProvider();await f.settle();assert.equal(f.state.mounts.length,1);f.cleanup();
});
