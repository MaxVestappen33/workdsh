import test from 'node:test';import assert from 'node:assert/strict';import{createRequire}from'node:module';import{fileURLToPath}from'node:url';
const web=createRequire(new URL('../../../../apps/web/package.json',import.meta.url));const built=await web('esbuild').build({entryPoints:[fileURLToPath(new URL('../src/client/delivery-state.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false});const{workbenchDeliveryState:state}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const row={installed:{packageName:'p',version:'1.0.0',sha256:'a'.repeat(64)},selected:true,compatible:true,registered:true,runtimeStatus:'active'};
test('delivery never equates generated, installed or Host-active with user acceptance',()=>{
 assert.equal(state(undefined,false,0,false).key,'developing');assert.equal(state(undefined,false,1,false).key,'built');
 assert.equal(state({...row,selected:false,registered:false,runtimeStatus:'unknown'},false,1,false).key,'disabled');
 assert.equal(state({...row,runtimeStatus:'failed'},true,1,true).key,'failed');
 assert.equal(state({...row,registered:false},true,1,true).key,'pending');
 assert.equal(state(row,false,1,true).key,'pending');assert.equal(state(row,true,1,false).key,'trial');assert.equal(state(row,true,1,true).key,'accepted');
 assert.equal(state({...row,compatible:false},true,1,true).key,'incompatible');
});
