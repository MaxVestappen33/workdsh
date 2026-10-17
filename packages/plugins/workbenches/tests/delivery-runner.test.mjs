import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,symlink,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runWorkbenchDelivery} from '../scripts/run-delivery.mjs';
async function fixture(failBuild=false,failStartup=false){
 const directory=await mkdtemp(join(tmpdir(),'workdsh-delivery-test-'));
 await mkdir(join(directory,'dist'));await symlink(fileURLToPath(new URL('../../../../apps/web/node_modules',import.meta.url)),join(directory,'node_modules'),'dir');
 await writeFile(join(directory,'package.json'),JSON.stringify({name:'workdsh-delivery-probe',version:'1.0.0',type:'module',files:['dist'],scripts:{build:'node build.mjs',prepack:'node must-not-run.mjs'},exports:{'.':{default:'./dist/index.js'}},peerDependencies:{'@deepseek-ai/cordis':'4.0.5'},workdsh:{workbench:{id:'probe'}}}));
 await writeFile(join(directory,'build.mjs'),failBuild?'process.exit(2)':'');
 await writeFile(join(directory,'dist/index.js'),failStartup?'export function apply(){throw Error("private-error-must-not-leak");}':"export const inject=['workdshWorkbenchRegistration'];export async function apply(ctx){await ctx.get('workdshWorkbenchRegistration').registerManaged(ctx,{id:'probe'},'probe-page');}");
 return directory;
}
async function cleanup(directory,result){await rm(directory,{recursive:true,force:true});if(result)await rm(dirname(result.reportPath),{recursive:true,force:true});}
test('fixed pipeline builds, checks real startup and packs once without app prepack scripts',async()=>{
 const dir=await fixture();let result;
 try{result=await runWorkbenchDelivery(dir);assert.equal(result.status,'passed',JSON.stringify(result));assert.deepEqual(result.stages.map(s=>[s.name,s.status]),[['build','passed'],['startup-check','passed'],['pack','passed']]);assert.match(result.candidate.sha256,/^[a-f0-9]{64}$/);assert.equal(result.clientPage,'not-checked');for(const s of result.stages){assert.ok(s.durationMs>=0);assert.ok(Date.parse(s.finishedAt)>=Date.parse(s.startedAt));}assert.equal(JSON.parse(await readFile(result.reportPath,'utf8')).status,'passed');assert.equal((await readdir(dir)).filter(s=>s.endsWith('.tgz')).length,1);
 const duplicate=await runWorkbenchDelivery(dir);try{assert.equal(duplicate.status,'failed');assert.equal(duplicate.stages.at(-1).name,'pack');assert.equal(duplicate.candidate,undefined);}finally{await rm(dirname(duplicate.reportPath),{recursive:true,force:true});}
 }finally{await cleanup(dir,result);}
});
for(const [name,build,startup] of [['build',true,false],['startup-check',false,true]])test(`${name} failure stops before generating an archive and persists bounded diagnostics`,async()=>{
 const dir=await fixture(build,startup);let result;
 try{result=await runWorkbenchDelivery(dir);assert.equal(result.status,'failed');assert.equal(result.stages.at(-1).name,name);assert.equal(result.stages.at(-1).status,'failed');assert.equal((await readdir(dir)).some(s=>s.endsWith('.tgz')),false);assert.doesNotMatch(JSON.stringify(result),/private-error-must-not-leak/);assert.equal(JSON.parse(await readFile(result.reportPath,'utf8')).status,'failed');}finally{await cleanup(dir,result);}
});
test('cancellation does not start the build or pack',async()=>{const dir=await fixture();let result;try{const controller=new AbortController();controller.abort();result=await runWorkbenchDelivery(dir,{signal:controller.signal});assert.equal(result.status,'cancelled');assert.deepEqual(result.stages,[]);assert.equal((await readdir(dir)).some(s=>s.endsWith('.tgz')),false);}finally{await cleanup(dir,result);}});

test('a hanging build times out and cannot reach startup or packaging',async()=>{
 const dir=await fixture();let result;try{await writeFile(join(dir,'build.mjs'),'setInterval(()=>{},1000);');result=await runWorkbenchDelivery(dir,{commandTimeoutMs:500});assert.equal(result.status,'failed');assert.equal(result.stages.length,1);assert.equal(result.stages[0].errorCode,'workbench/delivery-command-timeout');assert.equal((await readdir(dir)).some(s=>s.endsWith('.tgz')),false);}finally{await cleanup(dir,result);}
});
