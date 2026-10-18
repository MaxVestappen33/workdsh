import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';
const {build}=createRequire(new URL('../../../../apps/web/package.json',import.meta.url))('esbuild');
const built=await build({entryPoints:[fileURLToPath(new URL('../src/client/offline-imports-client.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false});
const {createWorkbenchOfflineImportsClient}=await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const row={importId:'import:11111111-1111-4111-8111-111111111111',packageName:'quality-plugin',workbenchId:'company.quality',createdAt:'2026-10-10T00:00:00Z'};
test('offline discovery requests current Host member references without identities or private paths',async()=>{
 const result=await createWorkbenchOfflineImportsClient(async(path,options)=>{assert.equal(path,'/api/workdsh-workbench-offline-imports');assert.equal(options.body,'{}');assert.equal(options.credentials,'same-origin');return Response.json({ok:true,value:[{...row,path:'/private',principalId:'private'}]});})();
 assert.deepEqual(result,[row]);assert.ok(Object.isFrozen(result));assert.ok(Object.isFrozen(result[0]));
});
test('offline discovery rejects duplicates, invalid identity, failed requests and cancellation',async()=>{
 for(const rows of [[row,row],[{...row,importId:'caller-id'}],[{...row,packageName:'../bad'}],[{...row,createdAt:'invalid'}]])await assert.rejects(createWorkbenchOfflineImportsClient(async()=>Response.json({ok:true,value:rows}))(),/invalid-response/);
 await assert.rejects(createWorkbenchOfflineImportsClient(async()=>Response.json({ok:false},{status:403}))(),/records-unavailable/);
 const controller=new AbortController();await assert.rejects(createWorkbenchOfflineImportsClient(async()=>{controller.abort();return Response.json({ok:true,value:[row]});})(controller.signal),error=>error.name==='AbortError');
});
