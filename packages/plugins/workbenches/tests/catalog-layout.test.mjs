import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(new URL('../../../../apps/web/package.json',import.meta.url));
const featureRequire=createRequire(new URL('../package.json',import.meta.url));
const {build}=require('esbuild'),React=featureRequire('react');
const {renderToStaticMarkup}=createRequire(featureRequire.resolve('@deepseek-ai/dsh-client-ui-renderer/client'))('react-dom/server');
const built=await build({entryPoints:[fileURLToPath(new URL('../src/client/WorkbenchCatalogList.tsx',import.meta.url))],bundle:true,platform:'node',format:'cjs',write:false,external:['@deepseek-ai/dsh-client-ui-primitives','react','react/jsx-runtime']});
const module={exports:{}};new Function('require','module','exports',built.outputFiles[0].text)(n=>n==='@deepseek-ai/dsh-client-ui-primitives'?{Menu:({anchor})=>anchor}:n.startsWith('react')?featureRequire(n):require(n),module,module.exports);
const {WorkbenchCatalogList}=module.exports;
const base={entries:[],developments:[],busy:false,canOpen:()=>true,onOpen(){},onContinue(){},onSetEnabled(){}};
const entry={packageName:'example-ledger',descriptor:{id:'example.ledger',title:'合同台账',description:'登记合同及到期日期'},selected:true,compatible:true,registered:true,runtimeStatus:'active',version:'1.0.0',installed:{packageName:'example-ledger',version:'1.0.0',sha256:'a'.repeat(64)}};
function render(row,props={}){return renderToStaticMarkup(React.createElement(WorkbenchCatalogList,{...base,...props,entries:[row]}));}
test('management trigger is accessible and closed; opening is the visible main action',()=>{
 const html=render(entry);assert.match(html,/aria-label="打开合同台账"/);assert.match(html,/可用/);
 assert.match(html,/aria-label="合同台账的管理操作"/);assert.match(html,/aria-haspopup="menu"/);assert.match(html,/aria-expanded="false"/);
 assert.doesNotMatch(html,/<details class="wd-catalog-menu"/);
});
test('failed or unregistered workbenches cannot open and retain development recovery',()=>{
 const html=render({...entry,runtimeStatus:'failed',registered:false},{developments:[{title:'合同台账',development:{id:'dev',packageName:entry.packageName}}]});
 assert.match(html,/加载失败/);assert.match(html,/查看进度/);assert.doesNotMatch(html,/aria-label="打开合同台账"/);
 const pending=render({...entry,registered:false});assert.match(pending,/<button disabled="" aria-label="打开合同台账"/);
 const missingClient=render(entry,{canOpen:()=>false});assert.match(missingClient,/<button disabled="" aria-label="打开合同台账"/);
});

test('disabled installed applications expose enable directly instead of an unusable open button',()=>{const html=render({...entry,selected:false,registered:false,runtimeStatus:'unknown'});assert.match(html,/aria-label="启用合同台账"/);assert.doesNotMatch(html,/aria-label="打开合同台账"/);});

const overviewBuild=await build({entryPoints:[fileURLToPath(new URL('../src/client/WorkbenchDevelopmentOverview.tsx',import.meta.url))],bundle:true,platform:'node',format:'cjs',write:false,external:['react','react/jsx-runtime']});
const overviewModule={exports:{}};new Function('require','module','exports',overviewBuild.outputFiles[0].text)(n=>n.startsWith('react')?featureRequire(n):require(n),overviewModule,overviewModule.exports);
test('seven making records expose pagination instead of silently hiding the last record',()=>{
 const creations=Array.from({length:7},(_,i)=>({id:String(i),idea:`旅行计划${i}`,createdAt:`2026-10-${String(10+i).padStart(2,'0')}T00:00:00Z`}));
 const html=renderToStaticMarkup(React.createElement(overviewModule.exports.WorkbenchDevelopmentOverview,{compact:true,developments:[],creations,onContinue(){},onDiscuss(){}}));
 assert.equal((html.match(/<article/g)??[]).length,6);
 assert.match(html,/共 7 个/);assert.match(html,/1 \/ 2/);assert.match(html,/aria-label="制作记录分页"/);
 assert.match(html,/<button disabled="">上一页/);assert.match(html,/<button>下一页/);
});
