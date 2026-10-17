import test from 'node:test';import assert from 'node:assert/strict';import {readFile,readdir} from 'node:fs/promises';import {createRequire} from 'node:module';import {runInNewContext} from 'node:vm';
const require=createRequire(new URL('../package.json',import.meta.url));
const platformRequire=createRequire(require.resolve('workdsh-plugin-workbenches/package.json'));
const store=new URL('../../../../apps/web/node_modules/.pnpm/',import.meta.url);
const directory=(await readdir(store)).find(name=>name.startsWith('@deepseek-ai+dsh-client-modules@0.2.1-rc.1_'));
const kernel=await readFile(new URL(directory+'/node_modules/@deepseek-ai/dsh-client-modules/lib/client.js',store),'utf8');
const quality=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
const platform=JSON.parse(await readFile(new URL('../../workbenches/package.json',import.meta.url),'utf8'));
test('published native module system resolves actual quality/library bundles in declared dependency order',async()=>{
 assert.equal(platform.dsh.client.platform,'web');assert.ok(quality.dsh.client.external.includes('workdsh-plugin-library/client'));
 let api;runInNewContext(kernel,{window:{__ModuleLoader__:{load:entry=>api=entry.factory(()=>{throw new Error('unexpected kernel dependency');})}}});
 const facade={mode:'queue',pendingQueue:[]};const arrivals=[];
 const context={window:{__ModuleLoader__:facade},document:{querySelectorAll:()=>[]},fetch:()=>{throw new Error('unexpected network');}};
 const entries=[{id:platform.name,url:'platform',rev:'1',inject:platform.dsh.client.inject},{id:'workdsh-plugin-library',url:'library',rev:'1'},{id:quality.name,url:'quality',rev:'1',external:quality.dsh.client.external,inject:quality.dsh.client.inject}];
 // The published Web boot seeds these renderer modules before plugin loading.
 const staticModules={react:require('react'),'react/jsx-runtime':require('react/jsx-runtime'),'react-dom':platformRequire('react-dom'),'react-dom/client':platformRequire('react-dom/client'),'@deepseek-ai/dsh-client-ui-primitives':{},'@deepseek-ai/dsh-client-ui-layout':{}};
 const system=api.createClientModuleSystem(facade,{id:'@deepseek-ai/dsh-client-modules',exports:api},{boot:{rev:'1',entries,batches:entries.map(row=>({phase:'application',url:row.url,rev:'1',entries:[row.id]}))},staticModules,loadBundle:async url=>{
   arrivals.push(url);const path=url==='platform'?new URL('../../workbenches/dist/client.browser.js',import.meta.url):url==='quality'?new URL('../dist/client.browser.js',import.meta.url):new URL('../../library/dist/client.browser.js',import.meta.url);runInNewContext(await readFile(path,'utf8'),context);
 }});
 const module=await system.import(quality.name+'/client');assert.equal(module.name,'workdsh-quality-analysis-client');assert.equal(typeof module.apply,'function');
 assert.equal(typeof (await system.import('workdsh-plugin-workbenches/client')).handoffNativeWorkbenchDraft,'function');
 assert.ok(arrivals.indexOf('platform')<arrivals.indexOf('quality'));
 assert.ok(arrivals.indexOf('library')<arrivals.indexOf('quality'));
 assert.equal(typeof (await system.import('workdsh-plugin-library/client')).createLibraryClient,'function');
 assert.equal(await system.import(quality.name),module);
});
