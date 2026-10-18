import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const {build}=createRequire(new URL('../../../../apps/web/package.json',import.meta.url))('esbuild');
const built=await build({entryPoints:[fileURLToPath(new URL('../src/client/native-installation-client.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false});
const {createWorkbenchNativeInstallationClient}=await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const descriptor={id:'company.quality',title:'质量分析',description:'',protocolVersion:'1.0',layout:'full-page',hostCompatibility:{sdk:'^1.0.0',harness:'0.2.1-rc.1'},capabilities:[]};
const selection={developmentId:'dev',expectedRevision:'r1',packageName:'quality-plugin',version:'1.0.0',workbenchId:descriptor.id,sha256:'a'.repeat(64)};
const value={developmentId:selection.developmentId,package:{packageName:selection.packageName,version:selection.version,sha256:selection.sha256},descriptor,installedVerified:true,activationVerified:false};
test('native reconciliation sends only the selected baseline and never claims activation',async()=>{
 const result=await createWorkbenchNativeInstallationClient(async(path,options)=>{
  assert.equal(path,'/api/workdsh-workbench-native-installation');
  assert.deepEqual(JSON.parse(options.body),{developmentId:'dev',expectedRevision:'r1',version:'1.0.0',sha256:selection.sha256});
  assert.equal(options.credentials,'same-origin');
  return Response.json({ok:true,value:{...value,path:'/private',package:{...value.package,path:'/private'}}});
 })({...selection,path:'/never-send'});
 assert.equal(result.installedVerified,true);assert.equal(result.activationVerified,false);
 assert.equal(result.path,undefined);assert.equal(result.package.path,undefined);assert.ok(Object.isFrozen(result.package));
});
test('native reconciliation rejects foreign receipts, activation claims, failed HTTP and late responses',async()=>{
 for(const bad of [{...value,developmentId:'foreign'},{...value,package:{...value.package,sha256:'b'.repeat(64)}},{...value,package:{...value.package,version:'2.0.0'}},{...value,descriptor:{...descriptor,id:'foreign.id'}},{...value,activationVerified:true},{...value,installedVerified:false}])
  await assert.rejects(createWorkbenchNativeInstallationClient(async()=>Response.json({ok:true,value:bad}))(selection),/invalid-response/);
 let calls=0;await assert.rejects(createWorkbenchNativeInstallationClient(async()=>{calls++;return Response.json({ok:false,error:{code:'workbench/development-access-denied'}},{status:403});})(selection),/development-access-denied/);assert.equal(calls,1);
 const controller=new AbortController();await assert.rejects(createWorkbenchNativeInstallationClient(async()=>{controller.abort();return Response.json({ok:true,value});})(selection,controller.signal),error=>error.name==='AbortError');
});
