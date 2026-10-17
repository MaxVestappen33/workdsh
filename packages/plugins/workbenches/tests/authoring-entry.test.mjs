import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(new URL('../../../../apps/web/package.json',import.meta.url));
const featureRequire=createRequire(new URL('../package.json',import.meta.url));
const {build}=require('esbuild'),React=featureRequire('react');
const {renderToStaticMarkup}=createRequire(featureRequire.resolve('@deepseek-ai/dsh-client-ui-renderer/client'))('react-dom/server');
async function load(file){const out=await build({entryPoints:[fileURLToPath(new URL(file,import.meta.url))],bundle:true,platform:'node',format:'cjs',write:false,external:['react','react/jsx-runtime']});const m={exports:{}};new Function('require','module','exports',out.outputFiles[0].text)(n=>n.startsWith('react')?featureRequire(n):require(n),m,m.exports);return m.exports;}
const {createAuthoringNavigation}=await load('../src/client/authoring-navigation.ts');
const {WorkbenchAuthoringPanel}=await load('../src/client/WorkbenchAuthoringPanel.tsx');
test('create and saved development entry are distinct and repeated clicks carry new intent',()=>{
 const navigation=createAuthoringNavigation(),observed=[];const stop=navigation.subscribe(()=>observed.push(navigation.getSnapshot()));
 navigation.open('create');navigation.open('developments');navigation.open('create');
 assert.deepEqual(observed.map(v=>v.view),['create','developments','create']);assert.deepEqual(observed.map(v=>v.revision),[1,2,3]);stop();navigation.open('developments');assert.equal(observed.length,3);
});
test('create entry renders the idea page immediately instead of the development list',()=>{
 const html=renderToStaticMarkup(React.createElement(WorkbenchAuthoringPanel,{identityScopeKey:'personal:user',entryRequest:{revision:1,view:'create'},native:{},onClose(){}}));
 assert.match(html,/你想做一个什么工作台/);assert.match(html,/aria-label="应用想法"/);assert.doesNotMatch(html,/aria-label="我的开发"/);assert.doesNotMatch(html,/开发记录：/);
});
test('saved developments entry renders the existing development list',()=>{
 const html=renderToStaticMarkup(React.createElement(WorkbenchAuthoringPanel,{identityScopeKey:'personal:user',entryRequest:{revision:2,view:'developments'},native:{},onClose(){}}));
 assert.match(html,/aria-label="我的开发"/);assert.doesNotMatch(html,/aria-label="应用想法"/);
});

test('direct resume carries the persisted development or discussion ID without creating another identity',()=>{
 const navigation=createAuthoringNavigation();
 navigation.open('developments',{developmentId:'existing-development'});
 assert.equal(navigation.getSnapshot().developmentId,'existing-development');
 navigation.open('create',{creationId:'existing-discussion'});
 assert.equal(navigation.getSnapshot().creationId,'existing-discussion');
 assert.equal(navigation.getSnapshot().developmentId,undefined);
 navigation.open('create');
 assert.equal(navigation.getSnapshot().creationId,undefined);
});
const {WorkbenchDevelopmentOverview}=await load('../src/client/WorkbenchDevelopmentOverview.tsx');
test('manager shows unconfirmed discussions and uninstalled developments together',()=>{
 const html=renderToStaticMarkup(React.createElement(WorkbenchDevelopmentOverview,{creations:[{id:'idea',idea:'合同到期提醒',phase:'discussing',createdAt:'2026-10-14T08:00:00Z'}],developments:[{title:'制作中的合同台账',development:{id:'dev',state:'developing',updatedAt:'2026-10-14T09:00:00Z'}}],onAll(){},onContinue(){},onDiscuss(){}}));
 assert.match(html,/合同到期提醒/);assert.match(html,/制作中的合同台账/);assert.match(html,/继续讨论/);assert.match(html,/查看进度/);
 assert.ok(html.indexOf('制作中的合同台账')<html.indexOf('合同到期提醒'));
 assert.doesNotMatch(html,/workdsh.user-/);
});
