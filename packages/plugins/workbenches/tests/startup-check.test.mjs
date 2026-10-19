import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import {readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
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

async function anchoredCandidate(body,change={}){
 const fixture=await candidate(body,{peerDependencies:{'@deepseek-ai/cordis':'4.0.5','workdsh-plugin-workbenches':'^3.0.0-alpha.7'},...change});
 const installation=await mkdtemp(join(tmpdir(),'workdsh-startup-installation-'));
 await rm(join(fixture.directory,'node_modules'));
 const sdk=fileURLToPath(new URL('..',import.meta.url)),require=createRequire(join(sdk,'package.json'));
 await writeFile(join(installation,'package.json'),'{}');
 for(const name of ['workdsh-plugin-workbenches','@deepseek-ai/cordis','zod']){
  const target=name==='workdsh-plugin-workbenches'?sdk:dirname(require.resolve(name+'/package.json'));
  const link=join(installation,'node_modules',name);await mkdir(dirname(link),{recursive:true});await symlink(target,link,process.platform==='win32'?'junction':'dir');
 }
 await writeFile(join(fixture.directory,'.workdsh-runtime.json'),JSON.stringify({schemaVersion:1,installationAnchor:join(installation,'package.json')}));
 return {...fixture,close:async()=>{await fixture.close();await rm(installation,{recursive:true,force:true});}};
}
test('a Desktop source without node_modules verifies declared host peers through its explicit installation anchor',async()=>{
 const fixture=await anchoredCandidate(`export const inject=['workdshWorkbenchRegistration'];export async function apply(ctx){${register}}`);
 try{const result=await checkWorkbenchStartup(fixture.directory);assert.equal(result.status,'passed',JSON.stringify(result));assert.equal((await readdir(fixture.directory)).includes('node_modules'),false);}finally{await fixture.close();}
});
test('the installation anchor cannot hide missing business dependencies, even when installed in the Host',async()=>{
 const fixture=await anchoredCandidate('export function apply(){}',{dependencies:{zod:'4.4.3'}});
 try{const result=await checkWorkbenchStartup(fixture.directory);assert.equal(result.errorCode,'workbench/startup-missing-dependencies');assert.deepEqual(result.missingDependencies,['zod']);}finally{await fixture.close();}
 const direct=await anchoredCandidate('export function apply(){}',{dependencies:{'@deepseek-ai/cordis':'4.0.5'}});
 try{const result=await checkWorkbenchStartup(direct.directory);assert.deepEqual(result.missingDependencies,['@deepseek-ai/cordis']);}finally{await direct.close();}
});
test('anchored host peers must satisfy the candidate declaration',async()=>{
 const fixture=await anchoredCandidate('export function apply(){}',{peerDependencies:{'@deepseek-ai/cordis':'^99.0.0'}});
 try{const result=await checkWorkbenchStartup(fixture.directory);assert.equal(result.errorCode,'workbench/startup-dependency-version-mismatch');assert.equal(result.dependencyMismatches[0].actual,'4.0.5');}finally{await fixture.close();}
});
test('real candidate bare imports still fail under native Node rather than using a manufactured module loader',async()=>{
 const fixture=await anchoredCandidate(`import {Context} from '@deepseek-ai/cordis';export const inject=['workdshWorkbenchRegistration'];export async function apply(ctx){${register}if(!Context)throw Error();}`);
 try{const result=await checkWorkbenchStartup(fixture.directory);assert.equal(result.status,'failed');assert.equal(result.stage,'lifecycle');assert.equal(result.errorCode,'workbench/startup-module-not-found');}finally{await fixture.close();}
});
test('a malformed platform runtime record is an explicit failure',async()=>{
 const fixture=await anchoredCandidate('export function apply(){}');
 try{await writeFile(join(fixture.directory,'.workdsh-runtime.json'),JSON.stringify({schemaVersion:1,installationAnchor:'./not-an-installation'}));const result=await checkWorkbenchStartup(fixture.directory);assert.equal(result.errorCode,'workbench/startup-invalid-runtime-anchor');}finally{await fixture.close();}
});
