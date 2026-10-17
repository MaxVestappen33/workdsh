import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const {build}=createRequire(new URL('../../../../apps/web/package.json',import.meta.url))('esbuild');
const built=await build({entryPoints:[fileURLToPath(new URL('../src/client/prepare-import-client.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false});
const {createWorkbenchImportPreparationClient}=await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const input={developmentId:'dev',packageName:'quality-plugin',version:'2.0.0',workbenchId:'company.quality',sha256:'a'.repeat(64)};
const receipt={packageName:input.packageName,version:input.version,sha256:input.sha256};
test('preparation confirms uploaded generation and reads update baseline without sending paths',async()=>{
 const prepare=createWorkbenchImportPreparationClient(async(path,options)=>{
  assert.equal(path,'/api/workdsh-workbench-import-prepare');assert.deepEqual(JSON.parse(options.body),input);
  return Response.json({ok:true,value:{kind:'update',package:receipt,installedVersion:'1.0.0',expectedInstalledHash:'b'.repeat(64),path:'/private'}});
 });
 const result=await prepare({...input,path:'/never-send'});assert.equal(result.path,undefined);assert.equal(result.expectedInstalledHash,'b'.repeat(64));assert.ok(Object.isFrozen(result.package));
});
test('preparation rejects mismatched package, missing update baseline and late cancellation',async()=>{
 for(const value of [{kind:'install',package:{...receipt,version:'wrong'}},{kind:'update',package:receipt},{kind:'install',package:receipt,expectedInstalledHash:'b'.repeat(64)}])
  await assert.rejects(createWorkbenchImportPreparationClient(async()=>Response.json({ok:true,value}))(input),/invalid-response/);
 const controller=new AbortController();
 await assert.rejects(createWorkbenchImportPreparationClient(async()=>{controller.abort();return Response.json({ok:true,value:{kind:'install',package:receipt}});})(input,controller.signal),error=>error.name==='AbortError');
});
const {createWorkbenchOfflinePreparationClient}=await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
test('offline preparation obtains Host reference without sending fictional development identity',async()=>{
 const {developmentId:unused,...offline}=input;
 const result=await createWorkbenchOfflinePreparationClient(async(path,options)=>{
  assert.equal(path,'/api/workdsh-workbench-offline-prepare');assert.deepEqual(JSON.parse(options.body),offline);
  return Response.json({ok:true,value:{kind:'install',package:receipt,importId:'import:host-reference',path:'/private'}});
 })(offline);
 assert.equal(result.importId,'import:host-reference');assert.equal(result.path,undefined);assert.ok(Object.isFrozen(result));
 await assert.rejects(createWorkbenchOfflinePreparationClient(async()=>Response.json({ok:true,value:{kind:'install',package:receipt}}))(offline),/invalid-response/);
});

test('preparation preserves safe diagnostic codes and discards arbitrary server text',async()=>{
 for(const [code,expected] of [['workbench/tool-schema-invalid','tool-schema-invalid'],['private raw log credential','import-prepare-failed']])await assert.rejects(createWorkbenchImportPreparationClient(async()=>Response.json({ok:false,error:{code}},{status:409}))(input),new RegExp(expected));
});
