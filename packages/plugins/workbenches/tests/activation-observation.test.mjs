import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const {build}=createRequire(new URL('../../../../apps/web/package.json',import.meta.url))('esbuild');
const built=await build({entryPoints:[fileURLToPath(new URL('../src/runtime/activation-observation.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false});
const {confirmWorkbenchRuntimeSelection:observe}=await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const result={packageName:'quality',version:'0.1.2',selected:true,confirmed:true,pendingRestart:false,application:'applied'};
const hash='a'.repeat(64),row={package:{packageName:'quality',version:'0.1.2',sha256:hash}};
test('installed selection waits for matching runtime version and bytes',()=>{
 for(const rows of [[],[{package:{...row.package,version:'0.1.1'}}],[{package:{...row.package,sha256:'b'.repeat(64)}}],[row,row]]){
  const observed=observe(result,true,hash,rows);assert.equal(observed.confirmed,false);assert.equal(observed.application,'restart-required');assert.equal(observed.pendingRestart,true);
 }
 assert.equal(observe(result,true,hash,[row]).confirmed,true);
});
test('disabling waits for registration removal and retains actual failures',()=>{
 assert.equal(observe({...result,selected:false},false,hash,[row]).confirmed,false);
 assert.equal(observe({...result,selected:false},false,hash,[]).confirmed,true);
 const failed={...result,application:'failed',confirmed:false};assert.equal(observe(failed,true,hash,[]),failed);
});
