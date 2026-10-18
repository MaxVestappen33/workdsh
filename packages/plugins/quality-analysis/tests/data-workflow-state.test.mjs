import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(new URL('../../../../apps/web/package.json',import.meta.url));
// Run production Workflow hooks, metadata requests and event wiring. Children
// are opaque: real table/analyze handlers live in cleaning-editor-state.test.
// These assertions do not certify browser rendering or real statistics.
const childNames=['QualityCleaningEditor','QualityLibraryInput','QualityMappingForm','QualityConfigurationEditor','QualitySourcePreview','QualityHistoryResult','QualityDrawer'];
const built=await require('esbuild').build({entryPoints:[fileURLToPath(new URL('../src/client/QualityRecordWorkflow.tsx',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false,jsx:'transform',tsconfigRaw:{compilerOptions:{jsx:'react',jsxFactory:'React.createElement',jsxFragmentFactory:'React.Fragment'}},plugins:[{name:'workflow-hooks',setup(builder){
 builder.onResolve({filter:/^react$/},()=>({path:'react',namespace:'workflow-hooks'}));
 builder.onResolve({filter:/\.\/Quality[A-Za-z]+\.js$/},args=>{const name=args.path.slice(2,-3);if(childNames.includes(name))return {path:name,namespace:'workflow-child'};});
 builder.onLoad({filter:/.*/,namespace:'workflow-child'},args=>({contents:`export function ${args.path}(){return null}`,loader:'js'}));
 builder.onLoad({filter:/.*/,namespace:'workflow-hooks'},()=>({contents:`const React={createElement:(type,props,...children)=>({type,props:{...props,children}}),Fragment:Symbol.for('test.fragment')};export default React;export const useState=(...args)=>globalThis.__qualityDataHooks.useState(...args);export const useRef=(...args)=>globalThis.__qualityDataHooks.useRef(...args);export const useEffect=(...args)=>globalThis.__qualityDataHooks.useEffect(...args);`,loader:'js'}));
}}]});
const {QualityRecordWorkflow}=await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const headers=['id','date','total','bad','unit','type'];
const snapshot='a'.repeat(64),mapping={inspectionId:'id',inspectionDate:'date',inspectedQuantity:'total',nonconformingQuantity:'bad',quantityUnit:'unit',inspectionType:'type'};
const analysis={inspectionsMapping:mapping,rules:{timeZone:'Asia/Shanghai',dateFormat:'yyyy-mm-dd',inspectionTypes:{initial:'initial'}},filter:{}};
function visibleNodes(element,includeHidden=false){if(!element||typeof element!=='object')return [];if(Array.isArray(element))return element.flatMap(item=>visibleNodes(item,includeHidden));if(element.props?.hidden&&!includeHidden)return [];return [element,...visibleNodes(element.props?.children,includeHidden),...visibleNodes(element.props?.toolbar,includeHidden)];}
function text(element){if(element===null||element===undefined||typeof element==='boolean')return '';if(Array.isArray(element))return element.map(text).join('');return typeof element==='object'?text(element.props?.children):String(element);}
function visibleText(element){if(element===null||element===undefined||typeof element==='boolean')return '';if(Array.isArray(element))return element.map(visibleText).join('');if(typeof element!=='object')return String(element);if(element.props?.hidden||element.type==='style')return '';return visibleText(element.props?.children);}
function deferred(){let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};}
function harness({configured=true,metadata=true,kind='csv'}={}){
 const state={configured,generation:1,revision:2,snapshot,analyzeCalls:[],rowCalls:0,getCalls:0,configurationCalls:0,listCalls:0,configureCalls:[],notices:[],runs:[],blocked:0,libraryOpens:0,nativeOpens:[],libraryKind:kind,libraryRevisionId:'old-revision',metadataEntry:undefined,metadataWait:undefined,getWait:undefined,configurationWait:undefined,configurationFails:false,signals:[]};
 const config=()=>({recordId:'r1',generation:state.generation,sourceSnapshotId:state.snapshot,title:'本月检验',sourceNamespace:'quality',mappingRevision:'b'.repeat(64),inspections:{headers,rowCount:2,sha256:'c'.repeat(64),provenance:{kind:'library',assetId:'asset',revisionId:'old-revision'},...(state.libraryKind==='xlsx'?{format:{kind:'xlsx',worksheet:'检验记录',headerRow:1,valuePolicy:'reject-formulas'}}:{})},analysis});
 const record=()=>({id:'r1',title:'本月检验',operationId:'create1',createdAt:'2026-10-10T00:00:00Z',revision:state.revision,generation:state.generation,...(state.configured?{configuration:{title:'本月检验',sourceNamespace:'quality',timeZone:'Asia/Shanghai',mappingRevision:'b'.repeat(64),sourceSnapshotId:state.snapshot}}:{})});
 const client={
  async get(id,signal){state.getCalls++;state.signals.push(signal);if(state.getWait)await state.getWait.promise;return record();},
  async sources(){return {recordId:'r1',generation:state.generation,entries:state.configured?[{sourceSnapshotId:state.snapshot,inspections:config().inspections}]:[]};},
  async configuration(){state.configurationCalls++;if(state.configurationWait)await state.configurationWait.promise;if(state.configurationFails)throw Error('configuration-denied');return config();},
  async cleaningRows(){state.rowCalls++;throw Error('Workflow must delegate row reads to its sole editor');},
  async analyze(...args){state.analyzeCalls.push(args);throw Error('Workflow must delegate analysis to its sole editor');},
  async configure(...args){state.configureCalls.push(args);state.configured=true;state.snapshot=args[3];state.generation++;state.revision++;return record();},
 };
 const management={async list(parentId){state.listCalls++;if(state.metadataWait)await state.metadataWait.promise;if(!metadata)throw Error('metadata-denied');return parentId==='folder'?[state.metadataEntry??{id:'node',kind:'asset',assetId:'asset',name:`十月检验.${state.libraryKind}`,asset:{id:'asset',kind:state.libraryKind,status:'active',currentRevisionId:state.libraryRevisionId},revision:{id:state.libraryRevisionId,assetId:'asset'}}]:[{id:'folder',kind:'folder',name:'质量文件'}];}};
 const props={identityScopeKey:'user1',record:record(),client,management,previewRegistry:{},openOriginal:async(...args)=>{state.nativeOpens.push(args);},openLibrary:()=>state.libraryOpens++,view:'data',active:true,onRecordChanged:next=>state.notices.push(next),onRun:next=>state.runs.push(next),onBlocked:()=>state.blocked++,onNavigate:view=>{props.view=view;dirty=true;}};
 const slots=[],effects=[];let cursor=0,dirty=true,tree;
 const hooks={useState(initial){const index=cursor++;if(!slots[index])slots[index]={value:typeof initial==='function'?initial():initial};return [slots[index].value,next=>{const value=typeof next==='function'?next(slots[index].value):next;if(!Object.is(value,slots[index].value)){slots[index].value=value;dirty=true;}}];},useRef(initial){const index=cursor++;return slots[index]??={current:initial};},useEffect(run,deps){const index=cursor++,previous=slots[index];if(!previous||deps?.some((value,i)=>!Object.is(value,previous.deps?.[i])))effects.push(()=>{previous?.cleanup?.();slots[index]={deps,cleanup:run()};});}};
 function render(){cursor=0;dirty=false;globalThis.__qualityDataHooks=hooks;try{const wrapped=QualityRecordWorkflow(props);tree=wrapped.type(wrapped.props);}finally{delete globalThis.__qualityDataHooks;}while(effects.length)effects.shift()();}
 async function settle(){for(let i=0;i<35;i++){if(dirty)render();await new Promise(done=>setImmediate(done));if(!dirty&&!effects.length)return;}throw Error('did-not-settle');}
 function nodes(hidden=false){return visibleNodes(tree,hidden);}
 function button(label){const element=nodes().find(row=>row.type==='button'&&text(row)===label);assert.ok(element,`button ${label} exists`);return element;}
 function click(label){const element=button(label);assert.equal(!!element.props.disabled,false);element.props.onClick();}
 function children(name){return nodes(true).filter(row=>typeof row.type==='function'&&row.type.name===name);}
 function child(name){const element=children(name)[0];assert.ok(element,`child ${name} exists`);return element;}
 function drawer(title){const element=children('QualityDrawer').find(row=>row.props.title===title);assert.ok(element,`drawer ${title} exists`);return element;}
 function cleanup(){for(const slot of slots)slot?.cleanup?.();}
 return {props,state,record,settle,button,click,child,children,drawer,cleanup,nodes,content:()=>visibleText(tree),render};
}
function ready(sourceSnapshotId='e'.repeat(64)){return {status:'ready',sourceSnapshotId,inspectionRows:3,defectRows:null,inspectionHeaders:headers};}

test('configured data delegates one compact table and analysis while Workflow reads only file metadata',async()=>{
 const data=harness();await data.settle();assert.match(data.content(),/十月检验.csv/);assert.match(data.content(),/2 条检验记录/);assert.doesNotMatch(data.content(),/数据来源|来源指纹|企业数据接入|原始数据/);
 assert.equal(data.children('QualityCleaningEditor').length,1);const editor=data.child('QualityCleaningEditor');assert.equal(editor.props.compact,true);assert.equal(editor.props.recordId,'r1');assert.equal(editor.props.client,data.props.client);
 assert.equal(editor.props.active,true);assert.equal(editor.props.analysisDisabled,false);assert.equal(editor.props.sourceScopeKey,`1/${snapshot}/0`);assert.equal(data.nodes().filter(row=>row.type==='table').length,0);assert.equal(data.state.rowCalls,0);assert.equal(data.state.analyzeCalls.length,0);assert.equal(data.drawer('更换检验文件').props.open,false);data.cleanup();
});
test('metadata revalidation prevents delegated analysis until confirmation and keeps one editor',async()=>{
 const data=harness();data.state.configurationWait=deferred();await data.settle();assert.equal(data.child('QualityCleaningEditor').props.analysisDisabled,true);assert.equal(data.children('QualityCleaningEditor').length,1);
 data.state.configurationWait.resolve();await data.settle();assert.equal(data.child('QualityCleaningEditor').props.analysisDisabled,false);data.cleanup();
});
test('editor result callbacks publish the verified child result and return blocked checks to the same table',async()=>{
 const data=harness();await data.settle();const check={status:'blocked',totalIssueCount:1,issues:[{table:'inspections',row:1,code:'invalid-inspection'}]},scope={generation:1,sourceSnapshotId:snapshot};
 data.child('QualityCleaningEditor').props.onBlocked(check,scope);await data.settle();assert.equal(data.state.blocked,1);assert.equal(data.props.view,'data');assert.equal(data.state.runs.length,0);assert.deepEqual(data.child('QualityCleaningEditor').props.check,{...scope,result:check});
 const run={runId:'confirmed-run',contentHash:'d'.repeat(64)};data.child('QualityCleaningEditor').props.onRun(run);await data.settle();assert.deepEqual(data.state.runs,[run]);assert.equal(data.child('QualityCleaningEditor').props.check,undefined);assert.ok(data.state.notices.every(row=>row.id==='r1'));assert.equal(data.state.analyzeCalls.length,0);assert.equal(data.state.rowCalls,0);data.cleanup();
});
test('active state pauses the same editor for hidden pages, import and rule dialogs',async()=>{
 const data=harness();await data.settle();const original=data.child('QualityCleaningEditor');data.props.active=false;data.render();await data.settle();assert.equal(data.child('QualityCleaningEditor').props.active,false);
 data.props.active=true;data.render();await data.settle();data.click('更多 ···');await data.settle();data.click('更换文件');await data.settle();assert.equal(data.drawer('更换检验文件').props.open,true);assert.equal(data.child('QualityCleaningEditor').props.active,false);
 data.drawer('更换检验文件').props.onClose();await data.settle();assert.equal(data.child('QualityCleaningEditor').props.active,true);data.props.view='settings';data.render();await data.settle();assert.equal(data.child('QualityCleaningEditor').props.active,false);assert.equal(data.drawer('分析规则').props.open,true);
 data.drawer('分析规则').props.onClose();await data.settle();assert.equal(data.child('QualityCleaningEditor').props.active,true);assert.equal(data.children('QualityCleaningEditor').length,1);assert.equal(data.child('QualityCleaningEditor').type,original.type);assert.equal(data.child('QualityCleaningEditor').props.sourceScopeKey,original.props.sourceScopeKey);data.cleanup();
});
test('a new source generation changes editor scope even when the data page remains active',async()=>{
 const data=harness();await data.settle();const before=data.child('QualityCleaningEditor').props.sourceScopeKey;data.state.generation=2;data.state.revision=3;data.state.snapshot='f'.repeat(64);data.props.record=data.record();data.render();await data.settle();
 assert.equal(data.child('QualityCleaningEditor').props.active,true);assert.equal(data.children('QualityCleaningEditor').length,1);assert.equal(data.child('QualityCleaningEditor').props.sourceScopeKey,`2/${data.state.snapshot}/0`);assert.notEqual(data.child('QualityCleaningEditor').props.sourceScopeKey,before);assert.equal(data.child('QualityCleaningEditor').props.analysisDisabled,false);data.cleanup();
});
test('import and configuration respect the registered editor leave guard, then wire confirmed mapping',async()=>{
 const data=harness();await data.settle();let registered;data.props.onLeaveGuard=guard=>{registered=guard;};data.render();data.child('QualityCleaningEditor').props.onLeaveGuard(()=>false);assert.equal(registered(),false);assert.equal(data.child('QualityLibraryInput').props.beforeImport(),false);
 // The import child owns file reading. Its ready event here tests only wiring.
 const imported=ready();data.child('QualityLibraryInput').props.onReady(imported);await data.settle();assert.equal(data.child('QualityCleaningEditor').props.analysisDisabled,true);assert.equal(data.child('QualityCleaningEditor').props.active,false);assert.equal(data.child('QualityMappingForm').props.inputRevisionKey,imported.sourceSnapshotId);
 await assert.rejects(data.child('QualityMappingForm').props.onApply(analysis,new AbortController().signal),/unsaved-cleaning/);assert.equal(data.state.configureCalls.length,0);data.child('QualityCleaningEditor').props.onLeaveGuard(()=>true);await data.child('QualityMappingForm').props.onApply(analysis,new AbortController().signal);await data.settle();
 assert.equal(data.state.configureCalls.length,1);const args=data.state.configureCalls[0];assert.equal(args[0],'r1');assert.equal(args[3],imported.sourceSnapshotId);assert.deepEqual(args[4],analysis);assert.equal(args[5],1);assert.equal(data.drawer('更换检验文件').props.open,false);assert.equal(data.child('QualityCleaningEditor').props.active,true);assert.equal(data.child('QualityCleaningEditor').props.analysisDisabled,false);assert.match(data.child('QualityCleaningEditor').props.sourceScopeKey,new RegExp(`^2/${imported.sourceSnapshotId}/`));data.cleanup();
});
test('choosing a previous source also refuses to replace unconfirmed editor changes',async()=>{
 const data=harness();await data.settle();data.child('QualityCleaningEditor').props.onLeaveGuard(()=>false);data.click('更多 ···');await data.settle();data.click('更换文件');await data.settle();
 const source=data.nodes().find(row=>row.props?.['aria-label']==='此前导入的检验表');assert.ok(source);source.props.onChange({target:{value:snapshot}});await data.settle();data.click('继续使用');await data.settle();assert.equal(data.children('QualityMappingForm').length,0);
 data.child('QualityCleaningEditor').props.onLeaveGuard(()=>true);data.click('继续使用');await data.settle();assert.equal(data.child('QualityMappingForm').props.inputRevisionKey,snapshot);assert.equal(data.child('QualityCleaningEditor').props.analysisDisabled,true);data.cleanup();
});
test('an empty record offers import instead of mounting a disabled or second table',async()=>{
 const data=harness({configured:false});await data.settle();assert.match(data.content(),/导入检验数据/);assert.equal(data.children('QualityCleaningEditor').length,0);assert.doesNotMatch(data.content(),/来源快照|企业数据接入|日期使用的时区/);data.click('导入文件');await data.settle();assert.equal(data.drawer('导入检验文件').props.open,true);assert.equal(data.child('QualityLibraryInput').props.generation,1);data.cleanup();
});
test('missing library metadata keeps the authorized editor with a generic file title',async()=>{
 const data=harness({metadata:false});await data.settle();assert.match(data.content(),/当前检验文件/);assert.match(data.content(),/2 条检验记录/);assert.doesNotMatch(data.content(),/十月检验.csv|old-revision|current-revision/);assert.equal(data.child('QualityCleaningEditor').props.analysisDisabled,false);assert.equal(data.children('QualitySourcePreview').length,0);data.cleanup();
});
test('column settings mount lazily, preserve same-source ownership and receive current generation guards',async()=>{
 const data=harness();await data.settle();assert.equal(data.children('QualityConfigurationEditor').length,0);data.props.view='settings';data.render();await data.settle();const first=data.child('QualityConfigurationEditor');assert.equal(first.props.key,`r1/1/${snapshot}`);data.child('QualityCleaningEditor').props.onLeaveGuard(()=>false);assert.equal(first.props.beforeConfigure(),false);
 data.props.view='data';data.render();await data.settle();assert.equal(data.child('QualityConfigurationEditor').props.key,first.props.key);data.props.view='settings';data.state.generation=2;data.state.revision=3;data.state.snapshot='f'.repeat(64);data.props.record=data.record();data.render();await data.settle();assert.equal(data.child('QualityConfigurationEditor').props.key,`r1/2/${data.state.snapshot}`);assert.notEqual(data.child('QualityConfigurationEditor').props.key,first.props.key);
 data.child('QualityCleaningEditor').props.onLeaveGuard(()=>true);assert.equal(data.child('QualityConfigurationEditor').props.beforeConfigure(),true);await data.child('QualityConfigurationEditor').props.onChanged(new AbortController().signal);await data.settle();assert.equal(data.props.view,'data');assert.match(data.child('QualityCleaningEditor').props.sourceScopeKey,new RegExp(`^2/${data.state.snapshot}/1$`));data.cleanup();
});
test('unmount cancels pending record confirmation before publishing state',async()=>{
 const data=harness();data.state.getWait=deferred();await data.settle();data.cleanup();assert.equal(data.state.signals[0].aborted,true);const notices=data.state.notices.length;data.state.getWait.resolve();await new Promise(done=>setImmediate(done));assert.equal(data.state.notices.length,notices);assert.equal(data.state.configurationCalls,0);
});
test('unmount cancels pending display metadata without publishing a late file title',async()=>{
 const data=harness();data.state.metadataWait=deferred();await data.settle();assert.match(data.content(),/当前检验文件/);data.cleanup();const calls=data.state.listCalls;data.state.metadataWait.resolve();await new Promise(done=>setImmediate(done));data.render();assert.doesNotMatch(data.content(),/十月检验.csv/);assert.equal(data.state.listCalls,calls);
});
test('failed configuration confirmation retains one editor and offers retry without duplicate row requests',async()=>{
 const data=harness();data.state.configurationFails=true;await data.settle();assert.match(data.content(),/检验文件暂时无法读取/);assert.equal(data.children('QualityCleaningEditor').length,1);
 // The real child separately refuses analysis on its own failed config read.
 assert.equal(data.state.analyzeCalls.length,0);assert.equal(data.state.rowCalls,0);data.state.configurationFails=false;data.click('重新读取');await data.settle();assert.doesNotMatch(data.content(),/暂时无法读取/);assert.equal(data.child('QualityCleaningEditor').props.analysisDisabled,false);data.cleanup();
});


test('source toolbar delegates the pinned revision to the native right panel and respects the cleaning leave guard',async()=>{
 const data=harness();await data.settle();const preview=data.child('QualitySourcePreview');assert.equal(preview.props.label,'在右侧打开源文件');assert.equal(preview.props.openOriginal,data.props.openOriginal);assert.equal(preview.props.registry,data.props.previewRegistry);assert.equal(preview.props.source.assetId,'asset');assert.equal(preview.props.source.revisionId,'old-revision');assert.equal(preview.props.active,true);
 data.child('QualityCleaningEditor').props.onLeaveGuard(()=>false);assert.equal(preview.props.beforeOpen(),false);assert.equal(data.state.nativeOpens.length,0);
 data.child('QualityCleaningEditor').props.onLeaveGuard(()=>true);assert.equal(preview.props.beforeOpen(),true);await preview.props.openOriginal(preview.props.source);assert.equal(data.state.nativeOpens.length,1);assert.equal(data.state.nativeOpens[0][0].revisionId,'old-revision');assert.equal(data.state.analyzeCalls.length,0);assert.equal(data.state.configureCalls.length,0);data.cleanup();
});
test('returning from the native panel reads a new Library revision without automatically importing or analyzing it',async()=>{
 const data=harness();await data.settle();assert.doesNotMatch(data.content(),/源文件已保存新版本/);const sourceKey=data.child('QualityCleaningEditor').props.sourceScopeKey;
 data.props.active=false;data.render();await data.settle();data.state.libraryRevisionId='office-saved-revision';const calls=data.state.listCalls;data.props.active=true;data.render();await data.settle();assert.ok(data.state.listCalls>calls,'return must reread Library metadata');assert.match(data.content(),/源文件已保存新版本/);
 assert.equal(data.child('QualitySourcePreview').props.source.revisionId,'old-revision');assert.equal(data.child('QualityCleaningEditor').props.sourceScopeKey,sourceKey);assert.equal(data.child('QualityLibraryInput').props.initialSource.revisionId,'office-saved-revision');assert.equal(data.state.analyzeCalls.length,0);assert.equal(data.state.configureCalls.length,0);assert.equal(data.children('QualityMappingForm').length,0);assert.equal(data.drawer('更换检验文件').props.open,false);
 data.click('采用新版本');await data.settle();assert.equal(data.drawer('更换检验文件').props.open,true);assert.equal(data.child('QualityLibraryInput').props.initialSource.revisionId,'office-saved-revision');assert.equal(data.child('QualitySourcePreview').props.source.revisionId,'old-revision');assert.equal(data.state.analyzeCalls.length,0);assert.equal(data.state.configureCalls.length,0);data.cleanup();
});
test('new revision adoption also preserves unconfirmed cleaning changes until the leave guard allows it',async()=>{
 const data=harness();data.state.libraryRevisionId='office-saved-revision';await data.settle();assert.match(data.content(),/源文件已保存新版本/);data.child('QualityCleaningEditor').props.onLeaveGuard(()=>false);data.click('采用新版本');await data.settle();assert.equal(data.drawer('更换检验文件').props.open,false);assert.equal(data.child('QualityCleaningEditor').props.active,true);assert.equal(data.state.configureCalls.length,0);
 data.child('QualityCleaningEditor').props.onLeaveGuard(()=>true);data.click('采用新版本');await data.settle();assert.equal(data.drawer('更换检验文件').props.open,true);assert.equal(data.state.configureCalls.length,0);assert.equal(data.state.analyzeCalls.length,0);data.cleanup();
});

function originalReceipt(assetId='asset',revisionId='office-saved-revision'){
 return {id:'node',kind:'asset',assetId,name:'十月检验.xlsx',asset:{id:assetId,kind:'xlsx',status:'active',currentRevisionId:revisionId},revision:{id:revisionId,assetId}};
}
test('saving the right-side XLSX offers immediate adoption without remounting or discarding pending cleaning decisions',async()=>{
 const data=harness({kind:'xlsx'});await data.settle();const before=data.child('QualityCleaningEditor').props.sourceScopeKey;
 data.child('QualityCleaningEditor').props.onLeaveGuard(()=>false);
 data.state.libraryRevisionId='office-saved-revision';data.props.originalRevisionSaved=originalReceipt();data.render();await data.settle();
 assert.match(data.content(),/源文件已保存新版本/);assert.equal(data.child('QualityCleaningEditor').props.sourceScopeKey,before);
 assert.equal(data.child('QualitySourcePreview').props.source.revisionId,'old-revision');assert.equal(data.child('QualityLibraryInput').props.initialSource.revisionId,'office-saved-revision');
 data.click('采用新版本');await data.settle();assert.equal(data.drawer('更换检验文件').props.open,false);
 assert.equal(data.state.configureCalls.length,0);assert.equal(data.state.analyzeCalls.length,0);
 data.child('QualityCleaningEditor').props.onLeaveGuard(()=>true);data.click('采用新版本');await data.settle();assert.equal(data.drawer('更换检验文件').props.open,true);data.cleanup();
});
test('a right-side save receipt from another asset or an unconfirmed revision cannot offer adoption',async()=>{
 const data=harness({kind:'xlsx'});await data.settle();const before=data.child('QualityCleaningEditor').props.sourceScopeKey;
 data.props.originalRevisionSaved=originalReceipt('other-asset');data.render();await data.settle();assert.doesNotMatch(data.content(),/源文件已保存新版本/);
 data.props.originalRevisionSaved=originalReceipt();data.render();await data.settle();assert.doesNotMatch(data.content(),/源文件已保存新版本/,'Library still reports only the imported revision');
 data.state.libraryRevisionId='office-saved-revision';data.props.originalRevisionSaved={...originalReceipt(),revision:{id:'mismatched-revision',assetId:'asset'}};data.render();await data.settle();assert.doesNotMatch(data.content(),/源文件已保存新版本/);
 assert.equal(data.child('QualityCleaningEditor').props.sourceScopeKey,before);assert.equal(data.state.configureCalls.length,0);data.cleanup();
});
test('closing during receipt readback prevents a late adoption proposal',async()=>{
 const data=harness({kind:'xlsx'});await data.settle();data.state.metadataWait=deferred();data.state.libraryRevisionId='office-saved-revision';
 data.props.originalRevisionSaved=originalReceipt();data.render();await data.settle();data.cleanup();data.state.metadataWait.resolve();await new Promise(done=>setImmediate(done));data.render();
 assert.doesNotMatch(data.content(),/源文件已保存新版本/);assert.equal(data.state.configureCalls.length,0);
});
test('receipt readback cannot offer a revision after the configured source generation changes',async()=>{
 const data=harness({kind:'xlsx'});await data.settle();const before=data.child('QualityCleaningEditor').props.sourceScopeKey;
 data.state.metadataWait=deferred();data.state.libraryRevisionId='office-saved-revision';data.props.originalRevisionSaved=originalReceipt();data.render();await data.settle();
 data.state.generation++;data.state.snapshot='f'.repeat(64);data.state.metadataWait.resolve();await data.settle();
 assert.doesNotMatch(data.content(),/源文件已保存新版本/);assert.equal(data.child('QualityCleaningEditor').props.sourceScopeKey,before);assert.equal(data.state.configureCalls.length,0);data.cleanup();
});
