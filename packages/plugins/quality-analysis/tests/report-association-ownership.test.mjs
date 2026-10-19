import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

// Exercise the real HistoryResult controller callbacks with deferred Host
// replies. Child UI stays opaque; this is response ownership, not a DOM test.
const require=createRequire(new URL('../../../../apps/web/package.json',import.meta.url));
const built=await require('esbuild').build({entryPoints:[fileURLToPath(new URL('../src/client/QualityHistoryResult.tsx',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false,jsx:'transform',
 tsconfigRaw:{compilerOptions:{jsx:'react',jsxFactory:'React.createElement',jsxFragmentFactory:'React.Fragment'}},
 plugins:[{name:'association-controller-hooks',setup(builder){
  builder.onResolve({filter:/^react$/},()=>({path:'react',namespace:'association-controller-hooks'}));
  builder.onLoad({filter:/.*/,namespace:'association-controller-hooks'},()=>({contents:`
   const React={createElement:(type,props,...children)=>({type,props:{...props,children}}),Fragment:Symbol.for('test.fragment')};
   export default React;
   export const useState=(...args)=>globalThis.__qualityAssociationHooks.useState(...args);
   export const useRef=(...args)=>globalThis.__qualityAssociationHooks.useRef(...args);
   export const useEffect=(...args)=>globalThis.__qualityAssociationHooks.useEffect(...args);
   export const useId=()=>'';
  `,loader:'js'}));
 }}]});
const {QualityHistoryResult}=await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function receipt(version){return {runId:'fixed-run',contentHash:'a'.repeat(64),sha256:version==='A'?'b'.repeat(64):'c'.repeat(64),operationId:'report-operation-'+version,assetId:'report-asset',revisionId:'revision-'+version,nodeId:'report-node',format:'markdown',detailKind:'markdown'};}
function harness(){
 const requests=[],statistics=[],slots=[],effects=[];let cursor=0,dirty=true,tree;
 const hooks={
  useState(initial){const index=cursor++;if(!slots[index])slots[index]={value:typeof initial==='function'?initial():initial};return [slots[index].value,next=>{const value=typeof next==='function'?next(slots[index].value):next;if(!Object.is(value,slots[index].value)){slots[index].value=value;dirty=true;}}];},
  useRef(initial){const index=cursor++;return slots[index]??={current:initial};},
  useEffect(run,deps){const index=cursor++,previous=slots[index];if(!previous||deps.some((value,i)=>!Object.is(value,previous.deps[i])))effects.push(()=>{previous?.cleanup?.();slots[index]={deps,cleanup:run()};});},
 };
 const client={
  async view(){return {recordId:'record',runId:'fixed-run',contentHash:'a'.repeat(64),reports:[],interpretations:[]};},
  async projects(){return [{id:'project',name:'生产质量'}];},
  linkReport(recordId,operationId,projectId,saved,signal){const reply=deferred();requests.push({recordId,operationId,projectId,saved,signal,...reply});return reply.promise;},
  saveStatistics(recordId,runId,hash,title,kind,signal){const reply=deferred();statistics.push({signal,...reply});return reply.promise;},
 };
 const props={identityScopeKey:'scope',recordId:'record',runId:'fixed-run',contentHash:'a'.repeat(64),mode:'report',client};
 function render(){cursor=0;dirty=false;const previous=globalThis.__qualityAssociationHooks;globalThis.__qualityAssociationHooks=hooks;try{const outer=QualityHistoryResult(props);tree=outer.type(outer.props);}finally{globalThis.__qualityAssociationHooks=previous;}while(effects.length)effects.shift()();}
 async function settle(){dirty=true;for(let round=0;round<20;round++){if(dirty)render();await new Promise(resolve=>setImmediate(resolve));if(!dirty&&!effects.length)return;}throw Error('association-state-did-not-settle');}
 return {requests,statistics,settle,report:()=>tree.props.report,adopt:saved=>tree.props.reportEditor.props.onSaved(saved),choose:()=>tree.props.report.onChooseProject(),link:()=>tree.props.report.onLink(),saveStatistics:()=>tree.props.report.onSaveStatistics()};
}
async function selected(saved=receipt('A')){const controller=harness();await controller.settle();controller.adopt(saved);await controller.settle();controller.choose();await controller.settle();return controller;}

test('switching fixed receipt cancels only old link and its late reply cannot mark the new receipt linked or finish its request',async()=>{
 const controller=await selected();controller.link();await controller.settle();const old=controller.requests[0];
 assert.equal(old.saved.revisionId,'revision-A');assert.equal(controller.report().busy,true);
 controller.adopt(receipt('B'));await controller.settle();assert.equal(old.signal.aborted,true);assert.equal(controller.report().linked,undefined);assert.equal(controller.report().busy,false);
 controller.link();await controller.settle();const next=controller.requests[1];assert.equal(next.saved.revisionId,'revision-B');assert.equal(next.signal.aborted,false);
 old.resolve({projectId:'project'});await controller.settle();assert.equal(controller.report().linked,undefined);assert.equal(controller.report().busy,true);assert.equal(next.signal.aborted,false);
 next.resolve({projectId:'project'});await controller.settle();assert.equal(controller.report().linked,'project');assert.equal(controller.report().busy,false);
});
test('reading the same fixed receipt again preserves its in-flight association ownership',async()=>{
 const controller=await selected();controller.link();await controller.settle();const request=controller.requests[0];
 controller.adopt(structuredClone(receipt('A')));await controller.settle();assert.equal(request.signal.aborted,false);assert.equal(controller.report().busy,true);
 request.resolve({projectId:'project'});await controller.settle();assert.equal(controller.report().linked,'project');
 controller.adopt(structuredClone(receipt('A')));await controller.settle();assert.equal(controller.report().linked,'project');
});
test('new unsaved report invalidates the old association, and a later old failure does not cancel or overwrite another export',async()=>{
 const controller=await selected();controller.link();await controller.settle();const old=controller.requests[0];
 controller.adopt(undefined);await controller.settle();assert.equal(old.signal.aborted,true);assert.equal(controller.report().saved,undefined);
 controller.saveStatistics();await controller.settle();const exportRequest=controller.statistics[0];
 old.reject(Error('old-association-failed'));await controller.settle();assert.equal(exportRequest.signal.aborted,false);assert.equal(controller.report().busy,true);assert.equal(controller.report().error,undefined);assert.equal(controller.report().linked,undefined);
 controller.adopt(receipt('B'));await controller.settle();assert.equal(exportRequest.signal.aborted,false);assert.equal(controller.report().busy,true);
 exportRequest.resolve({});await controller.settle();assert.deepEqual(controller.report().statisticsSaved,['trend']);assert.equal(controller.report().busy,false);
});
test('an unrelated project reply cannot acknowledge the selected receipt association',async()=>{
 const controller=await selected();controller.link();await controller.settle();controller.requests[0].resolve({projectId:'different-project'});await controller.settle();
 assert.equal(controller.report().linked,undefined);assert.match(controller.report().error,/关联结果未确认/);assert.equal(controller.report().busy,false);
});
