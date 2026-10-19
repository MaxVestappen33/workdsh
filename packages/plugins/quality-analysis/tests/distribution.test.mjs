import test from 'node:test';import assert from 'node:assert/strict';import {Worker} from 'node:worker_threads';import {readFile} from 'node:fs/promises';import {createRequire} from 'node:module';import {runInNewContext} from 'node:vm';
const require=createRequire(new URL('../package.json',import.meta.url));
const platformRequire=createRequire(require.resolve('workdsh-plugin-workbenches/package.json'));
// Native CSS is loaded by the browser module loader. This Node registration
// test supplies only its inert visual boundary; managed registration stays real.
const nativeRequire=name=>{if(name==='@deepseek-ai/dsh-client-ui-primitives')return {Button:()=>null};try{return platformRequire(name);}catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error;return require(name);}};
test('distributed CSV worker processes full bytes from the shipped entry',async()=>{
 const worker=new Worker(new URL('../dist/csv-worker.js',import.meta.url),{workerData:new TextEncoder().encode('id,quantity\n001,10\n002,20\n')});
 try{const result=await new Promise((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject);worker.once('exit',code=>{if(code)reject(new Error('worker failed'));});});
 assert.equal(result.ok,true);assert.equal(result.table.complete,true);assert.equal(result.table.rows.length,2);assert.equal(result.table.rows[0][0],'001');assert.match(result.sha256,/^[a-f0-9]{64}$/);
 }finally{await worker.terminate();}
});
test('built quality Client uses platform managed registration and the declared identity',async()=>{
 const {createLibraryOriginalPanelClient}=await import('../../library/dist/client/original-panel.js');
 const libraryCode=await readFile(new URL('../../library/dist/client.browser.js',import.meta.url),'utf8');assert.match(libraryCode,/createLibraryOriginalPanelClient/);
 let platformModule;runInNewContext(await readFile(new URL('../../workbenches/dist/client.browser.js',import.meta.url),'utf8'),{window:{__ModuleLoader__:{load:entry=>{platformModule=entry.factory(nativeRequire);}}}});
 let module;const code=await readFile(new URL('../dist/client.browser.js',import.meta.url),'utf8');
 runInNewContext(code,{fetch:()=>{throw new Error('unexpected request');},window:{__ModuleLoader__:{load:entry=>{assert.equal(entry.id,'workdsh-plugin-quality-analysis');module=entry.factory(name=>name==='workdsh-plugin-workbenches/client'?platformModule:name==='workdsh-plugin-library/client'?{createLibraryClient(){},createLibraryOriginalPanelClient,createLibraryNativeFileClient(){return{open(){throw Error('registration must not navigate to a file');}};},LibraryAssetPicker(){}}:nativeRequire(name));}}}});
 let registered;const ctx={effect(){},get:name=>{assert.equal(name,'workdshWorkbenchClientRegistration');return {registerManaged:async(caller,descriptor,page)=>{assert.equal(caller,ctx);assert.equal(typeof page,'function');registered=descriptor;}};}};
 await module.apply(ctx);assert.equal(registered.id,'workdsh.quality-analysis');assert.ok(module.inject.includes('workdshWorkbenchClientRegistration'));
});
