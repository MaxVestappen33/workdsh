import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const {build}=createRequire(new URL('../../../../apps/web/package.json',import.meta.url))('esbuild');
const built=await build({entryPoints:[fileURLToPath(new URL('../src/client/catalog-client.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false,alias:{'workdsh-contracts':fileURLToPath(new URL('../../../contracts/src/index.ts',import.meta.url))}});
const {createWorkbenchCatalogClient}=await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const descriptor={id:'company.quality',title:'质量分析',description:'',protocolVersion:'1.0',layout:'full-page',hostCompatibility:{sdk:'^1.0.0',harness:'0.2.1-rc.1'},capabilities:[]};
const row={packageName:'quality-plugin',selected:false,descriptor,version:'1.0.0',compatible:true,registered:false,installed:{packageName:'quality-plugin',version:'1.0.0',sha256:'a'.repeat(64)}};
test('catalog retains disabled installed workbenches and discards private facts',async()=>{
 const result=await createWorkbenchCatalogClient(async(path,options)=>{assert.equal(path,'/api/workdsh-workbench-catalog');assert.equal(options.body,'{}');return Response.json({ok:true,value:[{...row,path:'/private'}]});})();
 assert.equal(result[0].selected,false);assert.equal(result[0].installed.sha256,row.installed.sha256);assert.equal(result[0].path,undefined);assert.ok(Object.isFrozen(result[0].installed));
});
test('catalog rejects contradictory registration and mismatched package generations',async()=>{
 for(const rows of [[{...row,registered:true}],[{...row,installed:{...row.installed,version:'other'}}],[row,row],[{...row,installed:undefined}]])await assert.rejects(createWorkbenchCatalogClient(async()=>Response.json({ok:true,value:rows}))(),/invalid-response/);
});
test('catalog preserves bounded native runtime observations without exposing inventory details',async()=>{
 const [parsed]=await createWorkbenchCatalogClient(async()=>Response.json({ok:true,value:[{...row,selected:true,runtimeStatus:'failed',rows:[{entryId:'private'}]}]}))();
 assert.equal(parsed.runtimeStatus,'failed');assert.equal(parsed.rows,undefined);assert.equal(parsed.errorCode,undefined);
 await assert.rejects(createWorkbenchCatalogClient(async()=>Response.json({ok:true,value:[{...row,runtimeStatus:'invented'}]}))(),/invalid-response/);
});
test('resource catalog diagnostics remain declared, bounded and separate from permissions',async()=>{
 const resourceRow={...row,descriptor:{...descriptor,capabilities:['skill.select','connector.invoke']},missingResourceCatalogs:['skill.select']};
 const [parsed]=await createWorkbenchCatalogClient(async()=>Response.json({ok:true,value:[resourceRow]}))();
 assert.deepEqual(parsed.missingResourceCatalogs,['skill.select']);assert.equal(Object.isFrozen(parsed.missingResourceCatalogs),true);assert.equal(parsed.authorized,undefined);
 for(const missing of [['expert.select'],['skill.select','skill.select'],['library.read'],['token']])await assert.rejects(createWorkbenchCatalogClient(async()=>Response.json({ok:true,value:[{...resourceRow,missingResourceCatalogs:missing}]}))(),/invalid-response/);
});
