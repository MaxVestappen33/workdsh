import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

// Execute the production importer and its event handlers. This hook adapter
// verifies interaction state, not React DOM rendering or workbook parsing.
const require=createRequire(new URL('../../../../apps/web/package.json',import.meta.url));
const built=await require('esbuild').build({
 stdin:{contents:"export {QualityLibraryImport} from './QualityLibraryImport'; export {QualityRecordRequestError} from './record-client';",resolveDir:fileURLToPath(new URL('../src/client/',import.meta.url)),sourcefile:'library-import-state-entry.ts',loader:'ts'},
 bundle:true,platform:'node',format:'esm',write:false,jsx:'transform',
 tsconfigRaw:{compilerOptions:{jsx:'react',jsxFactory:'React.createElement',jsxFragmentFactory:'React.Fragment'}},
 plugins:[{name:'library-import-hooks',setup(builder){
  builder.onResolve({filter:/^react$/},()=>({path:'react',namespace:'library-import-hooks'}));
  builder.onLoad({filter:/.*/,namespace:'library-import-hooks'},()=>({contents:`
   const React={createElement:(type,props,...children)=>({type,props:{...props,children}}),Fragment:Symbol.for('test.fragment')};
   export default React;
   export const useState=(...args)=>globalThis.__qualityImportHooks.useState(...args);
   export const useRef=(...args)=>globalThis.__qualityImportHooks.useRef(...args);
   export const useEffect=(...args)=>globalThis.__qualityImportHooks.useEffect(...args);
  `,loader:'js'}));
 }}],
});
const {QualityLibraryImport,QualityRecordRequestError}=await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const xlsx={assetId:'inspection-asset',revisionId:'saved-xlsx-revision',title:'十月检验.xlsx',format:'xlsx'};
const ready={status:'ready',sourceSnapshotId:'a'.repeat(64),inspectionRows:2,defectRows:null,inspectionHeaders:['编号','日期','检验数量','不合格数量']};
const worksheets={status:'worksheet_required',worksheets:['底稿目录','检验明细']};
function nodes(element){if(element===null||element===undefined||typeof element==='boolean')return [];if(Array.isArray(element))return element.flatMap(nodes);if(typeof element!=='object')return [];return [element,...nodes(element.props?.children)];}
function text(element){if(element===null||element===undefined||typeof element==='boolean')return '';if(Array.isArray(element))return element.map(text).join('');return typeof element==='object'?text(element.props?.children):String(element);}
function harness(options={}){
 const selectedSource=Object.hasOwn(options,'selectedSource')?options.selectedSource:xlsx,selectResult=options.selectResult;
 const state={responses:[],requests:[],ready:[],reconcileCalls:0,reconcileError:undefined,selectCalls:0,selectResult};
 const props={identityScopeKey:'user1',recordId:'quality-record',generation:7,tableKind:'inspections',selectedSource,
  client:{async importLibrary(request,signal){state.requests.push({request:structuredClone(request),signal});const result=state.responses.shift();if(result instanceof Error)throw result;assert.ok(result,'a queued import response exists');return result;}},
  async selectSource(){state.selectCalls++;return state.selectResult;},
  async onReconcile(){state.reconcileCalls++;if(state.reconcileError)throw state.reconcileError;},
  onReady:result=>state.ready.push(result),
 };
 const slots=[],effects=[];let cursor=0,dirty=true,tree;
 const hooks={
  useState(initial){const index=cursor++;if(!slots[index])slots[index]={value:typeof initial==='function'?initial():initial};return [slots[index].value,next=>{const value=typeof next==='function'?next(slots[index].value):next;if(!Object.is(value,slots[index].value)){slots[index].value=value;dirty=true;}}];},
  useRef(initial){const index=cursor++;return slots[index]??={current:initial};},
  useEffect(run,deps){const index=cursor++,previous=slots[index];if(!previous||deps.some((value,i)=>!Object.is(value,previous.deps?.[i])))effects.push(()=>{previous?.cleanup?.();slots[index]={deps,cleanup:run()};});},
 };
 function render(){cursor=0;dirty=false;const previous=globalThis.__qualityImportHooks;globalThis.__qualityImportHooks=hooks;try{const wrapped=QualityLibraryImport(props);tree=wrapped.type(wrapped.props);}finally{if(previous===undefined)delete globalThis.__qualityImportHooks;else globalThis.__qualityImportHooks=previous;}while(effects.length)effects.shift()();}
 async function settle(){for(let round=0;round<35;round++){if(dirty)render();await new Promise(done=>setImmediate(done));if(!dirty&&!effects.length)return;}throw Error('import-state-did-not-settle');}
 function button(label){const result=nodes(tree).find(element=>element.type==='button'&&text(element)===label);assert.ok(result,`button ${label} exists`);return result;}
 function hasButton(label){return nodes(tree).some(element=>element.type==='button'&&text(element)===label);}
 function labeled(label){const result=nodes(tree).find(element=>element.props?.['aria-label']===label);assert.ok(result,`control ${label} exists`);return result;}
 function click(label){const control=button(label);assert.equal(!!control.props.disabled,false,`${label} should be enabled`);control.props.onClick();}
 function change(label,value){const control=labeled(label);assert.equal(!!control.props.disabled,false,`${label} should be enabled`);control.props.onChange({target:{value},currentTarget:{value}});}
 function alert(){return nodes(tree).filter(element=>element.props?.role==='alert').map(text).join('');}
 function cleanup(){for(const slot of slots)slot?.cleanup?.();}
 return {state,props,settle,button,hasButton,labeled,click,change,alert,content:()=>text(tree),cleanup};
}

test('a merged-cell failure retains the selected revision, worksheet and header until an adjusted retry succeeds',async()=>{
 const page=harness();page.state.responses.push(worksheets,new QualityRecordRequestError('quality/source/merged-cells',400),ready);await page.settle();
 page.click('导入检验数据');await page.settle();assert.equal(page.state.ready.length,0);assert.equal(page.labeled('导入工作表').props.value,'');assert.equal(page.button('导入选中工作表').props.disabled,true);
 page.change('导入工作表','底稿目录');page.change('列名所在行','1');await page.settle();page.click('导入选中工作表');await page.settle();
 assert.match(page.alert(),/合并单元格/);assert.equal(page.hasButton('重新读取检验表'),false);assert.match(page.content(),/十月检验.xlsx/);assert.equal(page.labeled('导入工作表').props.value,'底稿目录');assert.equal(page.labeled('列名所在行').props.value,1);assert.match(text(page.labeled('导入工作表')),/底稿目录.*检验明细/);assert.equal(page.state.ready.length,0);
 page.change('导入工作表','检验明细');page.change('列名所在行','3');await page.settle();assert.equal(page.alert(),'');page.click('导入选中工作表');await page.settle();
 assert.equal(page.state.requests.length,3);assert.equal(page.state.ready.length,1);assert.deepEqual(page.state.ready[0],ready);assert.equal(page.alert(),'');assert.equal(page.state.reconcileCalls,0);
 assert.deepEqual(page.state.requests[2].request,{recordId:'quality-record',reference:{assetId:xlsx.assetId,revisionId:xlsx.revisionId},format:'xlsx',tableKind:'inspections',headerRow:3,worksheet:'检验明细',expectedGeneration:7});page.cleanup();
});

test('network and unrecognized import failures expose uncertainty and reconciliation without leaking internal errors',async()=>{
 const unknown=new QualityRecordRequestError('quality/unrecognized/server-failure',500);unknown.message='PRIVATE_INTERNAL_DETAIL';
 for(const cause of [new TypeError('PRIVATE_INTERNAL_DETAIL'),unknown,new QualityRecordRequestError('quality/response/invalid',200)]){
  const page=harness();page.state.responses.push(cause);await page.settle();page.click('导入检验数据');await page.settle();
  assert.match(page.alert(),/导入.*尚未确认/);assert.equal(page.hasButton('重新读取检验表'),true);assert.doesNotMatch(page.alert(),/文件未导入|访问权限|PRIVATE_INTERNAL_DETAIL|quality\//);assert.equal(page.state.ready.length,0);assert.equal(page.labeled('列名所在行').props.value,1);assert.match(page.content(),/十月检验.xlsx/);page.cleanup();
 }
});

test('a failed reconciliation reports a read failure and preserves the original import selection for retry',async()=>{
 const page=harness();page.state.responses.push(worksheets,new TypeError('import-offline'));page.state.reconcileError=new QualityRecordRequestError('quality/source/merged-cells',400);await page.settle();
 page.click('导入检验数据');await page.settle();page.change('导入工作表','检验明细');page.change('列名所在行','3');await page.settle();page.click('导入选中工作表');await page.settle();page.click('重新读取检验表');await page.settle();
 assert.equal(page.state.reconcileCalls,1);assert.match(page.alert(),/未能读取当前检验数据/);assert.doesNotMatch(page.alert(),/合并单元格|文件未导入|权限|import-offline/);assert.equal(page.hasButton('重新读取检验表'),true);assert.equal(page.labeled('导入工作表').props.value,'检验明细');assert.equal(page.labeled('列名所在行').props.value,3);assert.equal(page.state.ready.length,0);assert.equal(page.state.requests.length,2);page.cleanup();
});

test('cancelling the file chooser retains an existing selection or leaves an empty importer without a false failure',async()=>{
 for(const selectedSource of [xlsx,undefined]){
  const page=harness({selectedSource});await page.settle();page.click('从资料库选择');await page.settle();
  assert.equal(page.state.selectCalls,1);assert.equal(page.state.requests.length,0);assert.equal(page.state.ready.length,0);assert.equal(page.alert(),'');assert.equal(page.hasButton('重新读取检验表'),false);
  assert.equal(page.hasButton('导入检验数据'),!!selectedSource);if(selectedSource)assert.match(page.content(),/十月检验.xlsx/);page.cleanup();
 }
});
