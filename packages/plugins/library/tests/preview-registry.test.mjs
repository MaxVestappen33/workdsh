import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';
const require=createRequire(new URL('../../../../apps/web/package.json',import.meta.url));
const result=await require('esbuild').build({entryPoints:[fileURLToPath(new URL('../src/client/preview-registry.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false});
const {createLibraryPreviewRegistry}=await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
test('registered Office spreadsheet viewers are discoverable and receive the original bytes',async()=>{
 const registry=createLibraryPreviewRegistry();assert.equal(registry.canOpen('xlsx'),false);let mounted,disposed=0,changes=0;
 const unsubscribe=registry.subscribe(()=>changes++);
 const remove=registry.register(['csv','xlsx'],(target,input)=>{mounted={target,input};return()=>disposed++;});
 assert.equal(registry.canOpen('xlsx'),true);assert.equal(registry.canOpen('csv'),true);assert.equal(registry.canOpen('pdf'),false);
 const target={},input={kind:'xlsx',name:'质量检验.xlsx',bytes:new Uint8Array([1,2,3])};const dispose=await registry.mount(target,input);
 assert.equal(mounted.target,target);assert.equal(mounted.input,input);dispose();assert.equal(disposed,1);
 remove();assert.equal(registry.canOpen('xlsx'),false);assert.equal(changes,2);await assert.rejects(registry.mount(target,input),/preview-unavailable/);unsubscribe();
});
test('disposing an older Office registration cannot remove its replacement',()=>{
 const registry=createLibraryPreviewRegistry();const old=registry.register(['xlsx'],()=>{});const current=registry.register(['xlsx'],()=>{});
 old();assert.equal(registry.canOpen('xlsx'),true);current();assert.equal(registry.canOpen('xlsx'),false);
});
