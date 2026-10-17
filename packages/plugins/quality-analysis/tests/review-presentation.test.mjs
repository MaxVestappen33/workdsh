import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {fileURLToPath,pathToFileURL} from 'node:url';
const require=createRequire(new URL('../../../../apps/web/package.json',import.meta.url)),feature=createRequire(new URL('../package.json',import.meta.url));
const React=feature('react'),layout=createRequire(feature.resolve('@deepseek-ai/dsh-client-ui-layout/client')),renderer=createRequire(layout.resolve('@deepseek-ai/dsh-client-ui-renderer/client'));
const {renderToStaticMarkup}=renderer('react-dom/server');
const built=await require('esbuild').build({stdin:{contents:"export * from './review-presentation';export * from './QualityReviewTable';export * from './QualityTrendChart';",resolveDir:fileURLToPath(new URL('../src/client/',import.meta.url)),loader:'tsx'},bundle:true,platform:'node',format:'esm',write:false,plugins:[{name:'one-react-owner',setup(b){b.onResolve({filter:/^react(?:\/jsx-runtime)?$/},args=>({path:pathToFileURL(feature.resolve(args.path)).href,external:true}));}}]});
const api=await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const headers=['原检号','日期列','检查件数','问题件数','计量','性质','其他信息'];
const mapping={inspectionId:headers[0],inspectionDate:headers[1],inspectedQuantity:headers[2],nonconformingQuantity:headers[3],quantityUnit:headers[4],inspectionType:headers[5]};
const page={recordId:'record',tableKind:'inspections',generation:2,sourceSnapshotId:'a'.repeat(64),offset:20,total:21,headers,rows:[{row:21,location:{record:25,line:31},values:['INS-21','2026-10-10',100,210,'piece','first','原件保留']}]};
const configuration={recordId:'record',generation:2,sourceSnapshotId:page.sourceSnapshotId,inspections:{headers},analysis:{inspectionsMapping:mapping,rules:{inspectionTypes:{first:'initial'}}}};
const result={status:'blocked',totalIssueCount:103,issues:[{table:'inspections',row:21,code:'invalid-inspection'},{table:'inspections',row:21,code:'duplicate-inspection-id'},{table:'dataset',code:'mixed-quantity-units'}]};
const check={sourceSnapshotId:page.sourceSnapshotId,generation:2,result};
const decision={kind:'correct',row:21,header:'问题件数',expected:210,value:'10',reason:'核对检验单'};
const render=(props={})=>renderToStaticMarkup(React.createElement(api.QualityReviewTable,{page,configuration,decisions:[],check,filter:'all',query:'',busy:false,onOpen:()=>{},...props}));
test('saved custom header mapping gives business labels without guessing raw names or changing cells',()=>{
 const original=JSON.stringify(page);assert.deepEqual(api.reviewColumns(page,configuration).map(c=>c.label),['检验编号','检验日期','检验数量','不合格数量','数量单位','检验类型']);
 assert.match(render(),/>检验数量</);assert.match(render(),/>件</);assert.match(render(),/>初检</);assert.match(render(),/>210</);assert.equal(JSON.stringify(page),original);
});
test('known unit and configured inspection type values become business terms without rewriting source cells',()=>{
 const original=JSON.stringify(page),rules={...configuration.analysis.rules,inspectionTypes:{first:'initial',again:'retest'}},config={...configuration,analysis:{...configuration.analysis,rules}};
 assert.equal(api.reviewValue('quantityUnit','piece',config),'件');assert.equal(api.reviewValue('inspectionType','first',config),'初检');assert.equal(api.reviewValue('inspectionType','again',config),'复检');
 assert.equal(api.reviewValue('inspectionType','unmapped',config),'unmapped');assert.equal(api.reviewValue('quantityUnit','kg',config),'kg');assert.equal(api.reviewValue('defectCode','D01',config),'D01');
 assert.equal(api.reviewValue('inspectedQuantity',0,config),'0');assert.equal(api.reviewValue('productId',null,config),'—');assert.equal(api.reviewValue('batchId','',config),'—');assert.equal(JSON.stringify(page),original);
});
test('source or generation mismatch cannot reuse old problem labels',()=>{
 for(const stale of [{...check,generation:1},{...check,sourceSnapshotId:'b'.repeat(64)}]){assert.equal(api.matchingReview(stale,page),undefined);const html=render({check:stale});assert.match(html,/>—</);assert.doesNotMatch(html,/有校验问题|>处理<|核对通过/);}
});
test('original data ordinal locates problems and multiple issues do not duplicate the row',()=>{
 assert.equal(Math.floor((page.rows[0].row-1)/20)*20,20);assert.notEqual(page.rows[0].location.line,page.rows[0].row);
 const html=render({filter:'issues'});assert.equal((html.match(/INS-21/g)??[]).length,1);assert.match(html,/有校验问题/);assert.doesNotMatch(html,/正常|核对通过/);
});
test('correction remains pending verification and preserves the actual header and original expected cell',()=>{
 const previous=Object.freeze([]),next=api.replaceReviewDecision(previous,decision);assert.equal(previous.length,0);assert.deepEqual(next,[decision]);
 const updated=api.replaceReviewDecision(next,{...decision,value:'11'});assert.equal(updated.length,1);assert.equal(updated[0].expected,210);assert.equal(updated[0].header,'问题件数');
 const html=render({decisions:updated});assert.match(html,/待应用修正/);assert.match(html,/>210</);assert.doesNotMatch(html,/已解决|>11</);
});
test('conflicting exclusions and corrections require explicitly removing previous decisions',()=>{
 assert.throws(()=>api.replaceReviewDecision([decision],{kind:'exclude',row:21,reason:'重复记录'}),/撤销/);
 assert.throws(()=>api.replaceReviewDecision([{kind:'exclude',row:21,reason:'重复记录'}],decision),/撤销/);
 assert.throws(()=>api.replaceReviewDecision([],{...decision,reason:' '}),/说明/);
});
test('business explanation does not invent a specific failed field or expose unknown codes',()=>{
 assert.match(api.reviewIssueMessage({code:'invalid-integer',field:'inspectedQuantity'}),/^检验数量/);
 assert.doesNotMatch(api.reviewIssueMessage({code:'invalid-inspection'}),/不合格数量.*大于/);
 for(const code of ['UNKNOWN','__proto__','constructor'])assert.equal(api.reviewIssueMessage({code,field:'__proto__'}),'该记录未通过校验，请查看问题详情并核对原数据。');
});
test('page filters stay explicitly local and missing issue detail never establishes a clean row',()=>{
 assert.match(render({filter:'reviewed'}),/本页没有符合条件/);assert.match(render({query:'not-here'}),/本页没有符合条件/);
 const noDetails=render({check:{...check,result:{status:'blocked',totalIssueCount:120,issues:[]}}});assert.match(noDetails,/>—</);assert.doesNotMatch(noDetails,/正常|核对通过|未检出问题/);
});
test('a table never uses a mapping from a different record, generation, source, or original headers',()=>{
 assert.equal(api.reviewSourceMatches(page,configuration),true);
 for(const config of [{...configuration,recordId:'other'},{...configuration,generation:3},{...configuration,sourceSnapshotId:'b'.repeat(64)},{...configuration,inspections:{headers:[...headers].reverse()}}]){
  assert.equal(api.reviewSourceMatches(page,config),false);assert.match(render({configuration:config}),/数据与字段配置已变化/);assert.doesNotMatch(render({configuration:config}),/INS-21/);
 }
});
test('row inputs are dirty only against the exact editor baseline, separate from saved decisions',()=>{
 const scope={recordId:'record',sourceSnapshotId:page.sourceSnapshotId,generation:2,tableKind:'inspections',row:21},form={kind:'correct',header:'问题件数',value:'10',reason:'核对检验单'},base={scope,form};
 assert.equal(api.reviewFormChanged(base,scope,{...form}),false);
 for(const edited of [{...form,kind:'exclude'},{...form,header:'日期列'},{...form,value:'11'},{...form,reason:'另一说明'}])assert.equal(api.reviewFormChanged(base,scope,edited),true);
 for(const other of [{...scope,row:20},{...scope,tableKind:'defects'},{...scope,generation:3},{...scope,recordId:'other'},{...scope,sourceSnapshotId:'b'.repeat(64)}])assert.equal(api.reviewFormChanged(base,other,{...form,value:'11'}),false);
 assert.equal(api.reviewFormChanged(undefined,scope,form),false);
});
test('trend uses a visible bounded axis without inventing changes or losing null gaps',()=>{
 const html=renderToStaticMarkup(React.createElement(api.QualityTrendChart,{rows:[{date:'2026-10-10',summary:{nonconformingRate:.05,inspectedQuantity:100,nonconformingQuantity:5}},{date:'2026-10-11',summary:{nonconformingRate:.05,inspectedQuantity:200,nonconformingQuantity:10}}]}));
 assert.match(html,/>10%</);assert.doesNotMatch(html,/>100%</);assert.equal((html.match(/不合格率 5\.00%/g)??[]).length,2);
 const high=renderToStaticMarkup(React.createElement(api.QualityTrendChart,{rows:[{date:'2026-10-10',summary:{nonconformingRate:.95,inspectedQuantity:100,nonconformingQuantity:95}}]}));assert.match(high,/>100%</);
});

test('trend leaves a zero-denominator period disconnected and keeps measured zero as a point',()=>{
 const rows=[{date:'2026-10-10',summary:{nonconformingRate:.05,inspectedQuantity:100,nonconformingQuantity:5}},{date:'2026-10-11',summary:{nonconformingRate:null,inspectedQuantity:0,nonconformingQuantity:0}},{date:'2026-10-12',summary:{nonconformingRate:0,inspectedQuantity:100,nonconformingQuantity:0}}];
 const html=renderToStaticMarkup(React.createElement(api.QualityTrendChart,{rows,quantityUnit:'件'}));
 assert.equal((html.match(/<path /g)??[]).length,2);assert.doesNotMatch(html,/<path[^>]* d="[^"]* L/);
 assert.equal((html.match(/<circle /g)??[]).length,2);assert.match(html,/2026-10-11 无法计算/);assert.match(html,/图中保留断点/);assert.match(html,/不合格率 0\.00% · 检验 100 件 · 不合格 0 件/);
 assert.doesNotMatch(html,/NaN|Infinity/);
});

test('trend caps only its visible periods and retains exact dates and values in point details',()=>{
 const rows=Array.from({length:31},(_,index)=>({date:new Date(Date.UTC(2026,0,index+1)).toISOString().slice(0,10),summary:{nonconformingRate:index===30?.95:.05,inspectedQuantity:100,nonconformingQuantity:index===30?95:5}}));
 const before=JSON.stringify(rows),html=renderToStaticMarkup(React.createElement(api.QualityTrendChart,{rows}));
 assert.equal((html.match(/<circle /g)??[]).length,30);assert.match(html,/2026\/01\/02 — 2026\/01\/31/);assert.doesNotMatch(html,/<title>2026-01-01/);
 assert.match(html,/显示最近 30 个周期；全部数据见明细/);assert.match(html,/>100%</);assert.match(html,/<title>2026-01-31 · 不合格率 95\.00%/);
 assert.equal(JSON.stringify(rows),before);
});

test('a single weekly period keeps its business date and fixed 12px axes without a connecting line',()=>{
 const html=renderToStaticMarkup(React.createElement(api.QualityTrendChart,{rows:[{date:'2025-12-29',summary:{nonconformingRate:.1,inspectedQuantity:200,nonconformingQuantity:20}}],granularity:'week',quantityUnit:'kg'}));
 assert.equal((html.match(/<circle /g)??[]).length,1);assert.doesNotMatch(html,/<path[^>]* d="[^"]* L/);assert.match(html,/周起始日期（周一）/);assert.match(html,/2025\/12\/29/);
 assert.match(html,/font-size="12"/);assert.doesNotMatch(html,/font-size="11"|max-height/);assert.match(html,/检验 200 kg/);
});
