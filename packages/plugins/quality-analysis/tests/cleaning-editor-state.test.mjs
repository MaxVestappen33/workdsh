import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

// Exercise the actual editor's handlers and async state transitions without a
// DOM or browser. This small hook adapter does not certify React DOM behavior.
const require=createRequire(new URL('../../../../apps/web/package.json',import.meta.url));
const built=await require('esbuild').build({
 entryPoints:[fileURLToPath(new URL('../src/client/QualityCleaningEditor.tsx',import.meta.url))],
 bundle:true,platform:'node',format:'esm',write:false,jsx:'transform',
 // The package tsconfig selects the automatic JSX runtime. Keep this isolated
 // hook harness classic throughout the bundled child components so it never
 // invokes the real React development runtime with our deliberately tiny stub.
 tsconfigRaw:{compilerOptions:{jsx:'react',jsxFactory:'React.createElement',jsxFragmentFactory:'React.Fragment'}},
 plugins:[{name:'headless-editor-hooks',setup(builder){
  builder.onResolve({filter:/^react$/},()=>({path:'react',namespace:'headless-editor-hooks'}));
  // The shared modal's DOM focus/cancel behavior is exercised separately.
  // Keep this adapter stateless so invoking a child cannot borrow editor hooks.
  builder.onResolve({filter:/\.\/QualityDrawer\.js$/},()=>({path:'QualityDrawer',namespace:'editor-drawer'}));
  builder.onLoad({filter:/.*/,namespace:'editor-drawer'},()=>({contents:`
   export function QualityDrawer(props){
    if(!props.open)return null;
    return {type:'test-record-panel',props:{'aria-label':props.title,onKeyDown:event=>{if(event.key==='Escape'&&!props.closeDisabled)props.onClose();},children:[
     {type:'header',props:{children:[props.title,props.subtitle,{type:'button',props:{disabled:props.closeDisabled,onClick:props.onClose,children:props.closeLabel??'关闭'}}]}},
     {type:'div',props:{children:props.children}},
     {type:'footer',props:{children:props.footer}},
    ]}};
   }
  `,loader:'js'}));
  builder.onLoad({filter:/.*/,namespace:'headless-editor-hooks'},()=>({contents:`
   const React={createElement:(type,props,...children)=>({type,props:{...props,children}}),Fragment:Symbol.for('test.fragment')};
   export default React;
   export const useState=(...args)=>globalThis.__qualityEditorHooks.useState(...args);
   export const useRef=(...args)=>globalThis.__qualityEditorHooks.useRef(...args);
   export const useEffect=(...args)=>globalThis.__qualityEditorHooks.useEffect(...args);
   export const useId=()=>globalThis.__qualityEditorHooks.useId();
  `,loader:'js'}));
 }}],
});
const {QualityCleaningEditor}=await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const headers=['编号','日期','总数','问题数','单位','类型','__internal_trace'];
const mapping={inspectionId:headers[0],inspectionDate:headers[1],inspectedQuantity:headers[2],nonconformingQuantity:headers[3],quantityUnit:headers[4],inspectionType:headers[5]};
const defectHeaders=['缺陷号','检验号','缺陷代号','缺陷名','发生次数','__internal_trace'];
const defectsMapping={defectId:defectHeaders[0],inspectionId:defectHeaders[1],defectCode:defectHeaders[2],defectLabel:defectHeaders[3],occurrences:defectHeaders[4]};
const sourceSnapshotId='a'.repeat(64);
function nodes(element){
 if(element===null||element===undefined||typeof element==='boolean')return [];
 if(Array.isArray(element))return element.flatMap(nodes);
 if(typeof element!=='object')return [];
 if(typeof element.type==='function')return [element,...nodes(element.type(element.props))];
 return [element,...nodes(element.props?.children)];
}
function text(element){
 if(element===null||element===undefined||typeof element==='boolean')return '';
 if(Array.isArray(element))return element.map(text).join('');
 if(typeof element!=='object')return String(element);
 if(typeof element.type==='function')return text(element.type(element.props));
 return text(element.props?.children);
}
function harness(){
 const state={generation:2,totalRecords:45,configurationFails:false,configurationCalls:0,analyzeCalls:0,confirmCalls:[],confirmResult:false,savedDraft:null};
 const slots=[],effects=[],forms=[];let cursor=0,dirty=true,tree;
 const hooks={
  useState(initial){const index=cursor++;if(!slots[index])slots[index]={value:typeof initial==='function'?initial():initial};return [slots[index].value,next=>{const value=typeof next==='function'?next(slots[index].value):next;if(!Object.is(value,slots[index].value)){slots[index].value=value;dirty=true;}}];},
  useRef(initial){const index=cursor++;return slots[index]??=( {current:initial} );},
  useId(){const index=cursor++;return `editor-test-${index}`;},
  useEffect(run,deps){const index=cursor++,previous=slots[index];if(!previous||deps.some((value,i)=>!Object.is(value,previous.deps[i])))effects.push(()=>{previous?.cleanup?.();slots[index]={deps,cleanup:run()};});},
 };
 const config=()=>({recordId:'record',title:'质量',generation:state.generation,sourceSnapshotId,mappingRevision:'b'.repeat(64),sourceNamespace:'quality',inspections:{headers,rowCount:state.totalRecords,sha256:'c'.repeat(64)},defects:{headers:defectHeaders,rowCount:state.totalRecords,sha256:'d'.repeat(64)},analysis:{inspectionsMapping:mapping,defectsMapping,rules:{timeZone:'Asia/Shanghai',dateFormat:'yyyy-mm-dd',inspectionTypes:{initial:'initial',recheck:'retest'}},filter:{}}});
 const client={
  async configuration(){state.configurationCalls++;if(state.configurationFails)throw Error('read-failed');return config();},
  async cleaningRows(recordId,tableKind,offset,generation){return {recordId,tableKind,offset,generation,sourceSnapshotId,total:state.totalRecords,headers:tableKind==='inspections'?headers:defectHeaders,rows:Array.from({length:Math.max(0,Math.min(20,state.totalRecords-offset))},(_,index)=>({row:offset+index+1,location:{record:offset+index+1,line:offset+index+3},values:tableKind==='inspections'?[`INS-${offset+index+1}`,'2026-10-10',100,5,'piece','initial','PRIVATE_INTERNAL_DETAIL']:[`DEF-${offset+index+1}`,`INS-${offset+index+1}`,'D01','外观划伤',2,'PRIVATE_INTERNAL_DETAIL']}))};},
  async cleaningDraft(){return {revision:1,draft:state.savedDraft};},
  async saveCleaningDraft(recordId,draft,revision){state.savedDraft=structuredClone(draft);return {revision:revision+1,draft};},
  async get(){return {revision:3};},
  async analyze(recordId,revision,cleaningSignal,cleaning){state.analyzeCalls++;forms.push(cleaning);return {status:'blocked',totalIssueCount:1,issues:[{table:'inspections',row:21,code:'invalid-inspection'}]};},
 };
 const props={recordId:'record',active:true,client,check:{sourceSnapshotId,generation:2,result:{status:'blocked',totalIssueCount:1,issues:[{table:'inspections',row:21,code:'invalid-inspection'}]}},onRun(){},onBlocked(){}};
 function render(){cursor=0;dirty=false;const previous=globalThis.__qualityEditorHooks;globalThis.__qualityEditorHooks=hooks;try{tree=QualityCleaningEditor(props);}finally{globalThis.__qualityEditorHooks=previous;}while(effects.length)effects.shift()();}
 // Each settle models a render after externally changed props as well as
 // flushing hook updates. Mutating props.active must not silently skip render.
 async function settle(){dirty=true;for(let round=0;round<20;round++){if(dirty)render();await new Promise(resolve=>setImmediate(resolve));if(!dirty&&!effects.length)return;}throw Error('editor-state-did-not-settle');}
 function find(predicate){const result=nodes(tree).find(predicate);assert.ok(result,'expected editor control exists');return result;}
 function labeled(label){return find(element=>element.props?.['aria-label']===label);}
 function button(label){return find(element=>element.type==='button'&&text(element)===label);}
 function click(label){const element=button(label);assert.equal(!!element.props.disabled,false,`${label} should be enabled`);element.props.onClick();}
 function change(label,value){const element=labeled(label);assert.equal(!!element.props.disabled,false,`${label} should be enabled`);element.props.onChange({currentTarget:{value},target:{value}});}
 function confirm(message){state.confirmCalls.push(message);return state.confirmResult;}
 function runWithConfirm(action){const previous=globalThis.window;globalThis.window={confirm};try{return action();}finally{if(previous===undefined)delete globalThis.window;else globalThis.window=previous;}}
 function clickRow(row=1){const record=find(element=>element.type==='tr'&&(text(element).startsWith(`INS-${row}2026`)||text(element).startsWith(`DEF-${row}INS-${row}`)));const action=nodes(record).find(element=>element.type==='button');assert.ok(action);runWithConfirm(()=>action.props.onClick());}
 function drawer(){return find(element=>typeof element.type==='function'&&element.type.name==='QualityDrawer');}
 function escaped(){runWithConfirm(()=>find(element=>element.type==='test-record-panel').props.onKeyDown({key:'Escape',preventDefault(){},stopPropagation(){}}));}
 return {state,props,forms,settle,button,labeled,click,change,clickRow,escaped,drawer,runWithConfirm,content:()=>text(tree),hasDetails:()=>nodes(tree).some(element=>element.type==='test-record-panel'),countType:type=>nodes(tree).filter(element=>element.type===type).length};
}
async function edited(){const editor=harness();await editor.settle();editor.clickRow();await editor.settle();editor.change('修正后的值','changed-id');editor.change('核对说明','已经核对原始单据');await editor.settle();return editor;}

test('all destructive editor exits keep row inputs when discard is cancelled',async()=>{
 const actions=[
  editor=>editor.click('关闭详情'),editor=>editor.escaped(),editor=>editor.click('取消'),editor=>editor.clickRow(2),
  editor=>editor.click('下一页'),editor=>editor.change('核对数据表','defects'),
  editor=>editor.click('刷新数据'),editor=>editor.click('检查数据并生成分析'),
  editor=>editor.change('修正字段','问题数'),editor=>editor.click('检验记录第 21 条'),
 ];
 for(const action of actions){const editor=await edited(),calls=editor.state.configurationCalls;editor.runWithConfirm(()=>action(editor));await editor.settle();assert.equal(editor.hasDetails(),true);assert.equal(editor.labeled('修正后的值').props.value,'changed-id');assert.equal(editor.labeled('核对说明').props.value,'已经核对原始单据');assert.equal(editor.labeled('修正字段').props.value,'编号');assert.equal(editor.state.analyzeCalls,0);assert.equal(editor.state.configurationCalls,calls);assert.equal(editor.state.confirmCalls.length,1);}
});
test('restoring saved decisions also respects unadded row inputs',async()=>{
 const editor=await edited();editor.state.savedDraft={sourceSnapshotId,expectedGeneration:2,inspections:[],defects:[]};editor.click('读取已保存决定');await editor.settle();editor.runWithConfirm(()=>editor.click('确认替换当前决定'));await editor.settle();assert.equal(editor.hasDetails(),true);assert.equal(editor.labeled('修正后的值').props.value,'changed-id');assert.equal(editor.state.confirmCalls.length,1);
});
test('explicit discard permits navigation, while adding a decision preserves the original raw cell',async()=>{
 const editor=await edited();editor.state.confirmResult=true;editor.runWithConfirm(()=>editor.click('下一页'));await editor.settle();assert.equal(editor.hasDetails(),false);assert.match(editor.content(),/第 2 \/ 3 页/);
 editor.clickRow(21);await editor.settle();editor.change('修正后的值','INS-CORRECTED');editor.change('核对说明','核对原件');await editor.settle();editor.click('确认修改');await editor.settle();assert.equal(editor.hasDetails(),false);assert.match(editor.content(),/本轮 1 项决定 · 尚未保存/);assert.match(editor.content(),/待应用修正/);
 editor.click('确认决定并重新分析');await editor.settle();assert.equal(editor.state.analyzeCalls,1);assert.deepEqual(editor.forms[0].inspections,[{kind:'correct',row:21,header:'编号',expected:'INS-21',value:'INS-CORRECTED',reason:'核对原件'}]);
});
test('hidden modules preserve the editor only while source and generation stay unchanged',async()=>{
 const editor=await edited();editor.props.active=false;await editor.settle();assert.equal(editor.hasDetails(),false);assert.equal(editor.drawer().props.open,false);editor.props.active=true;await editor.settle();assert.equal(editor.hasDetails(),true);assert.equal(editor.labeled('修正后的值').props.value,'changed-id');assert.equal(editor.labeled('核对说明').props.value,'已经核对原始单据');assert.equal(editor.state.confirmCalls.length,0);
 editor.props.active=false;await editor.settle();editor.state.generation=3;editor.props.active=true;await editor.settle();assert.equal(editor.hasDetails(),false);assert.match(editor.content(),/原记录输入和本轮决定已失效/);assert.match(editor.content(),/本轮 0 项决定/);
});
test('a failed revalidation retains inputs for reference and prevents old data from being submitted',async()=>{
 const editor=await edited();editor.props.active=false;await editor.settle();editor.state.configurationFails=true;editor.props.active=true;await editor.settle();assert.equal(editor.hasDetails(),true);assert.equal(editor.labeled('修正后的值').props.value,'changed-id');assert.equal(editor.button('检查数据并生成分析').props.disabled,true);assert.equal(editor.button('确认修改').props.disabled,true);editor.button('检查数据并生成分析').props.onClick();await editor.settle();assert.equal(editor.state.analyzeCalls,0);assert.match(editor.content(),/先前内容仅供查看/);
 editor.state.confirmResult=true;editor.state.configurationFails=false;editor.runWithConfirm(()=>editor.click('刷新数据'));await editor.settle();assert.equal(editor.button('检查数据并生成分析').props.disabled,false);
});

test('changing the source scope while the unified table stays active revalidates and clears old row inputs',async()=>{
 const editor=await edited(),calls=editor.state.configurationCalls;
 editor.state.generation=3;editor.props.sourceScopeKey=`record/${sourceSnapshotId}/3`;
 await editor.settle();assert.ok(editor.state.configurationCalls>calls);
 assert.equal(editor.hasDetails(),false);assert.match(editor.content(),/原记录输入和本轮决定已失效/);
 assert.match(editor.content(),/本轮 0 项决定/);assert.equal(editor.state.analyzeCalls,0);
});

test('disabled analysis also prevents direct handler submission while a new file awaits confirmation',async()=>{
 const editor=harness();await editor.settle();editor.props.analysisDisabled=true;await editor.settle();
 const action=editor.button('检查数据并生成分析');assert.equal(action.props.disabled,true);
 action.props.onClick();await editor.settle();assert.equal(editor.state.analyzeCalls,0);
 editor.props.analysisDisabled=false;await editor.settle();editor.click('检查数据并生成分析');await editor.settle();assert.equal(editor.state.analyzeCalls,1);
});

test('the unified compact table submits confirmed row corrections through its sole primary analysis action',async()=>{
 const editor=await edited();editor.props.compact=true;await editor.settle();
 editor.click('确认修改');await editor.settle();assert.equal(editor.countType('table'),1);
 assert.match(editor.content(),/1 项修改 · 尚未保存/);editor.click('确认修改并分析');await editor.settle();
 assert.equal(editor.state.analyzeCalls,1);assert.deepEqual(editor.forms[0].inspections,[{kind:'correct',row:1,header:'编号',expected:'INS-1',value:'changed-id',reason:'已经核对原始单据'}]);
 assert.equal(editor.forms[0].expectedGeneration,2);assert.equal(editor.forms[0].sourceSnapshotId,sourceSnapshotId);
});

test('a small compact dataset offers analysis and row review without inactive pagination',async()=>{
 const editor=harness();editor.state.totalRecords=2;editor.props.compact=true;await editor.settle();
 assert.equal(editor.countType('table'),1);assert.match(editor.content(),/共 2 条原始记录/);
 assert.throws(()=>editor.button('上一页'));assert.throws(()=>editor.button('下一页'));assert.equal(editor.button('开始分析').props.disabled,false);
 editor.clickRow(2);await editor.settle();assert.equal(editor.hasDetails(),true);assert.equal(editor.labeled('修正后的值').props.value,'INS-2');
});

test('inspection record details use the shared modal contract and present only mapped business values',async()=>{
 const editor=harness();editor.props.compact=true;await editor.settle();editor.clickRow();await editor.settle();const modal=editor.drawer();
 assert.equal(modal.props.open,true);assert.equal(modal.props.placement,'center');assert.equal(modal.props.className,'wd-quality-record-dialog');assert.equal(modal.props.title,'核对检验记录');assert.equal(text(modal.props.subtitle),'检验编号：INS-1');assert.equal(modal.props.closeLabel,'关闭详情');assert.equal(modal.props.closeDisabled,false);
 assert.ok(modal.props.footer,'the shared modal receives footer content separately from its scrolling body');assert.match(text(modal.props.footer),/取消.*确认修改/);assert.equal(nodes(modal.props.children).some(element=>element.type==='button'&&['确认修改','关闭详情'].includes(text(element))),false);
 const details=nodes(modal.props.children).find(element=>element.type==='dl');assert.ok(details);const summary=text(details);assert.match(summary,/数量单位件/);assert.match(summary,/检验类型初检/);assert.doesNotMatch(summary,/piece|initial|__internal_trace|PRIVATE_INTERNAL_DETAIL/);assert.doesNotMatch(text(modal.props.children),/invalid-inspection|校验代码|原始列名|__internal_trace|PRIVATE_INTERNAL_DETAIL/);assert.equal(editor.button('确认修改').props.disabled,true);
 // A reason alone does not establish an actual cell correction.
 editor.change('核对说明','已核对');await editor.settle();assert.equal(editor.button('确认修改').props.disabled,true);editor.change('修正后的值','INS-CORRECTED');await editor.settle();assert.equal(editor.button('确认修改').props.disabled,false);
});

test('defect record details keep their own business identity and cancel untouched inputs directly',async()=>{
 const editor=harness();await editor.settle();editor.change('核对数据表','defects');await editor.settle();editor.clickRow();await editor.settle();const modal=editor.drawer();
 assert.equal(modal.props.title,'核对缺陷记录');assert.equal(text(modal.props.subtitle),'缺陷记录编号：DEF-1');assert.equal(modal.props.placement,'center');assert.match(text(modal.props.children),/缺陷记录编号DEF-1/);assert.match(text(modal.props.children),/缺陷名称外观划伤/);assert.doesNotMatch(text(modal.props.children),/PRIVATE_INTERNAL_DETAIL|__internal_trace/);
 editor.click('取消');await editor.settle();assert.equal(editor.hasDetails(),false);assert.equal(editor.state.confirmCalls.length,0);assert.equal(editor.state.analyzeCalls,0);
});

test('inspection type correction presents business choices while preserving the source codes submitted for verification',async()=>{
 const editor=harness();editor.props.compact=true;await editor.settle();editor.clickRow();await editor.settle();editor.change('修正字段','类型');await editor.settle();
 const choice=editor.labeled('修正后的值');assert.equal(choice.type,'select');assert.equal(choice.props.value,'initial');assert.match(text(choice),/初检.*复检/);assert.doesNotMatch(text(choice),/initial|recheck/);
 editor.change('修正后的值','recheck');editor.change('核对说明','对照复检单');await editor.settle();editor.click('确认修改');await editor.settle();editor.click('确认修改并分析');await editor.settle();
 assert.equal(editor.state.analyzeCalls,1);assert.deepEqual(editor.forms[0].inspections,[{kind:'correct',row:1,header:'类型',expected:'initial',value:'recheck',reason:'对照复检单'}]);assert.equal(editor.forms[0].expectedGeneration,2);assert.equal(editor.forms[0].sourceSnapshotId,sourceSnapshotId);
});

test('pending saved-analysis location blocks detail exits and source changes, then cancellation leaves the record editable',async()=>{
 const editor=harness(),calls=[];let rejectFocus,leaveGuard;
 const waiting=new Promise((_resolve,reject)=>{rejectFocus=reject;});
 editor.props.onInspectionFocus=(inspectionId,sourceHash)=>{calls.push({inspectionId,sourceHash});return waiting;};
 editor.props.onLeaveGuard=guard=>{leaveGuard=guard;};
 await editor.settle();editor.clickRow();await editor.settle();editor.click('在分析中定位');await editor.settle();const reads=editor.state.configurationCalls;
 assert.deepEqual(calls,[{inspectionId:'INS-1',sourceHash:'c'.repeat(64)}]);assert.equal(leaveGuard(),false);assert.equal(editor.drawer().props.closeDisabled,true);
 for(const label of ['正在定位…','关闭详情','取消','刷新数据','下一页','检查数据并生成分析'])assert.equal(editor.button(label).props.disabled,true,`${label} is disabled while locating`);
 assert.equal(editor.labeled('核对数据表').props.disabled,true);
 // Call the production handlers directly too: disabled attributes alone do
 // not certify that the owner prevents an asynchronous source replacement.
 editor.drawer().props.onClose();editor.button('取消').props.onClick();editor.button('刷新数据').props.onClick();editor.labeled('核对数据表').props.onChange({currentTarget:{value:'defects'},target:{value:'defects'}});await editor.settle();
 assert.equal(editor.hasDetails(),true);assert.equal(editor.labeled('修正后的值').props.value,'INS-1');assert.equal(editor.labeled('核对数据表').props.value,'inspections');assert.equal(editor.state.configurationCalls,reads);assert.equal(editor.state.analyzeCalls,0);assert.equal(calls.length,1);
 rejectFocus(new DOMException('owner scope cancelled','AbortError'));await editor.settle();assert.equal(editor.hasDetails(),true);assert.equal(editor.drawer().props.closeDisabled,false);assert.equal(leaveGuard(),true);assert.equal(editor.button('在分析中定位').props.disabled,false);
 editor.change('修正后的值','INS-AFTER-CANCEL');editor.change('核对说明','取消定位后继续核对');await editor.settle();editor.click('确认修改');await editor.settle();assert.equal(editor.hasDetails(),false);editor.click('确认决定并重新分析');await editor.settle();
 assert.equal(editor.state.analyzeCalls,1);assert.deepEqual(editor.forms[0].inspections,[{kind:'correct',row:1,header:'编号',expected:'INS-1',value:'INS-AFTER-CANCEL',reason:'取消定位后继续核对'}]);assert.equal(calls.length,1);
});
