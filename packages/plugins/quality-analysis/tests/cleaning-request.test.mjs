import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';
const require=createRequire(new URL('../../../../apps/web/package.json',import.meta.url));const result=await require('esbuild').build({entryPoints:[fileURLToPath(new URL('../src/runtime/configuration-request.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false});const {qualityAnalyzeRequestSchema}=await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
test('cleaning request binds source/generation and rejects actor claims and unreasoned decisions',()=>{
 const cleaning={sourceSnapshotId:'a'.repeat(64),expectedGeneration:2,inspections:[{kind:'correct',row:1,header:'数量',expected:10,value:'20',reason:'核对原单'}]};const request={recordId:'record',expectedRevision:1,cleaning};
 assert.equal(qualityAnalyzeRequestSchema.safeParse(request).success,true);
 for(const value of [{...cleaning,principalId:'forged'},{...cleaning,expectedGeneration:-1},{...cleaning,sourceSnapshotId:'other'},{...cleaning,inspections:[{kind:'exclude',row:1,reason:''}]},{...cleaning,inspections:[{kind:'correct',row:1,header:'数量',value:'20',reason:'核对'}]}])assert.equal(qualityAnalyzeRequestSchema.safeParse({...request,cleaning:value}).success,false);
});
