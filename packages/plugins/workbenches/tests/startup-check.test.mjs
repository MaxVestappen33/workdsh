import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import {readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {checkWorkbenchStartup} from '../scripts/check-startup.mjs';
const modules=fileURLToPath(new URL('../../../../apps/web/node_modules',import.meta.url));
async function candidate(body,change={}){
 const directory=await mkdtemp(join(tmpdir(),'workdsh-startup-test-'));
 await mkdir(join(directory,'dist'));await symlink(modules,join(directory,'node_modules'),'dir');
 await writeFile(join(directory,'package.json'),JSON.stringify({name:'startup-test',version:'1.0.0',type:'module',exports:{'.':{default:'./dist/index.js'}},peerDependencies:{'@deepseek-ai/cordis':'4.0.5'},workdsh:{workbench:{id:'probe'}},...change}));
 await writeFile(join(directory,'dist/index.js'),body);
 return {directory,close:()=>rm(directory,{recursive:true,force:true})};
}
const register="await ctx.get('workdshWorkbenchRegistration').registerManaged(ctx,{id:'probe'},'probe-page');";
test('startup check loads the actual host, disposes its effects and reports test boundaries',async()=>{
 const f=await candidate(`export const inject=['workdshWorkbenchRegistration'];export async function apply(ctx){${register}ctx.effect(()=>()=>{});}`);
 try{const result=await checkWorkbenchStartup(f.directory);assert.equal(result.status,'passed');assert.match(result.hostSha256,/^[a-f0-9]{64}$/);assert.equal(result.productionRegistration,'not-checked');assert.equal(result.clientPage,'not-checked');}finally{await f.close();}
});
test('a nested child startup failure cannot be hidden by a successful parent apply',async()=>{
 const f=await candidate(`export const inject=['workdshWorkbenchRegistration'];export async function apply(ctx){${register}ctx.plugin({apply(){throw Error('credential-must-never-appear');}});}`);
 try{const result=await checkWorkbenchStartup(f.directory);assert.equal(result.status,'failed');assert.equal(result.stage,'lifecycle');assert.doesNotMatch(JSON.stringify(result),/credential-must/);}finally{await f.close();}
});
test('a dependency-pending child fails with its missing services',async()=>{
 const f=await candidate(`export const inject=['workdshWorkbenchRegistration'];export async function apply(ctx){${register}ctx.plugin({inject:['missingBusinessService'],apply(){}});}`);
 try{const result=await checkWorkbenchStartup(f.directory);assert.equal(result.status,'failed');assert.deepEqual(result.missingServices,['missingBusinessService']);}finally{await f.close();}
});
test('missing runtime modules and hanging startup fail before packaging',async()=>{
 const missing=await candidate('export function apply(){}',{dependencies:{'uninstalled-workdsh-startup-test':'1.0.0'}});
 try{const result=await checkWorkbenchStartup(missing.directory);assert.equal(result.errorCode,'workbench/startup-missing-dependencies');assert.deepEqual(result.missingDependencies,['uninstalled-workdsh-startup-test']);}finally{await missing.close();}
 const hanging=await candidate('export async function apply(){setInterval(()=>{},1000);await new Promise(()=>{});}');
 try{const result=await checkWorkbenchStartup(hanging.directory,{timeoutMs:800});assert.equal(result.status,'failed');assert.equal(result.errorCode,'workbench/startup-timeout');}finally{await hanging.close();}
});

test('the actual official tool compiler error in a child plugin blocks delivery',async()=>{
 const f=await candidate(`import {defineTool} from '@deepseek-ai/dsh-tools';export const inject=['workdshWorkbenchRegistration'];export async function apply(ctx){${register}ctx.plugin({apply(){defineTool({name:'invalid_optional',description:'probe',parameters:{week:{type:'string',required:false}},output:{schema:{type:'json'},render:()=>[]},execute:async()=>({})});}});}`);
 try{const result=await checkWorkbenchStartup(f.directory);assert.equal(result.status,'failed');assert.equal(result.stage,'lifecycle');}finally{await f.close();}
});

test('npm prepack blocks a candidate archive when the shared startup check fails',async()=>{
 const f=await candidate('export function apply(){throw Error("startup failure");}');
 try{
  const runner=fileURLToPath(new URL('../scripts/check-startup.mjs',import.meta.url));
  await writeFile(join(f.directory,'package.json'),JSON.stringify({name:'startup-test',version:'1.0.0',type:'module',exports:{'.':{default:'./dist/index.js'}},peerDependencies:{'@deepseek-ai/cordis':'4.0.5'},scripts:{prepack:`node "${runner}" .`},workdsh:{workbench:{id:'probe'}}}));
  const result=spawnSync('npm',['pack','--offline','--json'],{cwd:f.directory,env:{...process.env,PATH:dirname(process.execPath)+':'+process.env.PATH},encoding:'utf8',timeout:15000});
  assert.notEqual(result.status,0);assert.equal((await readdir(f.directory)).some(name=>name.endsWith('.tgz')),false);assert.match(result.stdout+result.stderr,/startup-lifecycle-failed/);
 }finally{await f.close();}
});

test('a resolvable runtime package with the wrong version cannot pass startup validation',async()=>{
 const f=await candidate('export function apply(){}',{peerDependencies:{'@deepseek-ai/cordis':'^99.0.0'}});
 try{const result=await checkWorkbenchStartup(f.directory);assert.equal(result.status,'failed');assert.equal(result.errorCode,'workbench/startup-dependency-version-mismatch');assert.deepEqual(result.dependencyMismatches,[{packageName:'@deepseek-ai/cordis',requested:'^99.0.0',actual:'4.0.5'}]);}finally{await f.close();}
});

test('unsupported dependency specifications never echo embedded credentials',async()=>{
 const f=await candidate('export function apply(){}',{peerDependencies:{'@deepseek-ai/cordis':'https://private-credential@example.invalid/archive.tgz'}});
 try{const result=await checkWorkbenchStartup(f.directory);assert.equal(result.errorCode,'workbench/startup-dependency-version-mismatch');assert.doesNotMatch(JSON.stringify(result),/private-credential|https:/);assert.equal(result.dependencyMismatches[0].requested,'unsupported-version-specification');}finally{await f.close();}
});

test('an absent explicitly optional peer does not fail an otherwise complete Host lifecycle',async()=>{
 const f=await candidate(`export const inject=['workdshWorkbenchRegistration'];export async function apply(ctx){${register}}`,{peerDependencies:{'@deepseek-ai/cordis':'4.0.5','workdsh-absent-optional-probe':'^1.0.0'},peerDependenciesMeta:{'workdsh-absent-optional-probe':{optional:true}}});
 try{assert.equal((await checkWorkbenchStartup(f.directory)).status,'passed');}finally{await f.close();}
});
