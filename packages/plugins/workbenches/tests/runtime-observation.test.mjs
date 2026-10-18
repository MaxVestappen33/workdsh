import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const {build}=createRequire(new URL('../../../../apps/web/package.json',import.meta.url))('esbuild');
async function load(path){const result=await build({entryPoints:[fileURLToPath(new URL(path,import.meta.url))],bundle:true,platform:'node',format:'esm',write:false});return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);}
const {observeWorkbenchRuntime:observe}=await load('../src/runtime/runtime-observation.ts');
const {catalogStatus}=await load('../src/client/catalog-status.ts');
const bundle={rows:[{entryId:'own-host'},{entryId:'own-client'}]};
const plugin=(entryId,fiberPhase,enabled=true)=>({entryId,fiberPhase,enabled});
test('native failed entry is correlated by exact public identity, not another package failure',()=>{
 assert.equal(observe(bundle,[plugin('own-host','active'),plugin('own-client','failed')]),'failed');
 assert.equal(observe(bundle,[plugin('own-host','active'),plugin('own-client','active'),plugin('other','failed')]),'active');
 assert.equal(observe(bundle,[plugin('own-host','active'),plugin('own-client','failed',false)]),'active');
 assert.equal(observe({...bundle,error:{diagnostic:'/private/secret'}},[]),'failed');
});
test('incomplete or ambiguous inventory never becomes a successful runtime',()=>{
 for(const rows of [[],[plugin('own-host','active')],[plugin('own-host','active'),plugin('own-client','active'),plugin('own-client','active')]])assert.equal(observe(bundle,rows),'unknown');
 assert.equal(observe(bundle,[plugin('own-host','active'),plugin('own-client','pending')]),'loading');
 assert.equal(observe(bundle,[plugin('own-host','active'),plugin('own-client','unloading')]),'unloading');
 assert.equal(observe({rows:[]},[]),'unknown');
});
test('workbench view separates failure, loading, missing registration and verified registration',()=>{
 const row={compatible:true,selected:true,registered:false};
 assert.equal(catalogStatus({...row,runtimeStatus:'failed'}).label,'加载失败');
 assert.equal(catalogStatus({...row,runtimeStatus:'loading'}).label,'正在加载');
 assert.equal(catalogStatus({...row,runtimeStatus:'active'}).label,'业务尚未就绪');
 assert.equal(catalogStatus(row).label,'运行状态未确认');
 assert.equal(catalogStatus({...row,registered:true}).label,'已启用');
 assert.equal(catalogStatus({...row,registered:true,runtimeStatus:'failed'}).label,'加载失败');
 assert.equal(catalogStatus({...row,selected:false,runtimeStatus:'failed'}).label,'已停用');
 assert.equal(catalogStatus({...row,errorCode:'workbench/installation-unverified',runtimeStatus:'failed'}).label,'安装未核验');
});
