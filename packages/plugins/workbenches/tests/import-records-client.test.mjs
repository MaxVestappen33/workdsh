import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const {build}=createRequire(new URL('../../../../apps/web/package.json',import.meta.url))('esbuild');
const built=await build({entryPoints:[fileURLToPath(new URL('../src/client/import-records-client.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false});
const {createWorkbenchImportRecordsClient}=await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const scope={developmentId:'dev',packageName:'quality-plugin',workbenchId:'company.quality'};
const row={id:'existing-op',iterationId:'existing-iteration',developmentId:'dev',kind:'install',state:'unknown',inputHash:'a'.repeat(64),candidate:{packageName:scope.packageName,workbenchId:scope.workbenchId,version:'1.0.0',sha256:'a'.repeat(64)},updatedAt:new Date().toISOString()};
test('records recreate fixed recovery selection and exclude private data',async()=>{
 const records=await createWorkbenchImportRecordsClient(async(path,options)=>{assert.equal(path,'/api/workdsh-workbench-import-records');assert.deepEqual(JSON.parse(options.body),{developmentId:'dev'});return Response.json({ok:true,value:[{...row,actor:{secret:true},path:'/private'}]});})(scope);
 assert.equal(records[0].selection.operationId,'existing-op');assert.equal(records[0].selection.iterationId,'existing-iteration');assert.equal(records[0].actor,undefined);assert.ok(Object.isFrozen(records[0].selection));
});
test('foreign, duplicate and incomplete records cannot become recovery commands',async()=>{
 for(const rows of [[{...row,developmentId:'foreign'}],[row,row],[{...row,kind:'update'}]])await assert.rejects(createWorkbenchImportRecordsClient(async()=>Response.json({ok:true,value:rows}))(scope),/invalid-response/);
});

test('legacy row remains visible without fabricating a recovery selection',async()=>{
 const records=await createWorkbenchImportRecordsClient(async()=>Response.json({ok:true,value:[{...row,candidate:undefined}, {...row,id:'modern'}]}))(scope);
 assert.equal(records.length,2);assert.equal(records[0].id,'existing-op');assert.equal(records[0].selection,undefined);assert.equal(records[0].recoveryUnavailable,true);assert.equal(records[1].selection.operationId,'modern');
});
