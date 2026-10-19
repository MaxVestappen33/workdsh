import {readFile,mkdtemp,rm,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {join,resolve,relative,isAbsolute,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {isDeepStrictEqual} from 'node:util';

// The platform writes this development-only record from its actual Profile
// context. It supplies host peers, never missing business dependencies or a
// replacement resolver for the candidate's executable JavaScript.
async function hostPeerRequire(directory){
 let text;try{text=await readFile(join(directory,'.workdsh-runtime.json'),'utf8');}
 catch(error){if(error.code==='ENOENT')return undefined;throw Error('workbench/startup-invalid-runtime-anchor');}
 try{
  const record=JSON.parse(text);
  if(record.schemaVersion!==1||typeof record.installationAnchor!=='string'||!isAbsolute(record.installationAnchor))throw Error();
  return createRequire(await realpath(record.installationAnchor));
 }catch{throw Error('workbench/startup-invalid-runtime-anchor');}
}

/** Run from the official development tool's sandbox, never from package preview
 * or the live Host. A temporary Home is data separation, not an OS sandbox.
 * Test providers are explicitly reported and cannot certify production startup. */
export async function checkWorkbenchStartup(directory,{timeoutMs=15000,signal}={}){
 signal?.throwIfAborted();
 const source=await realpath(directory),home=await mkdtemp(join(tmpdir(),'workdsh-startup-'));
 try{
  return await new Promise((accept,reject)=>{
   const env={PATH:process.env.PATH??'',HOME:home,USERPROFILE:home,TMPDIR:home,TEMP:home,TMP:home,DSH_HOME:home,DSH_AGENTS_HOME:join(home,'agents')};
   if(process.platform==='win32'){if(process.env.SystemRoot)env.SystemRoot=process.env.SystemRoot;if(process.env.ComSpec)env.ComSpec=process.env.ComSpec;}
   const child=spawn(process.execPath,[fileURLToPath(import.meta.url),'--worker',source,home],{cwd:home,env,signal,stdio:['ignore','ignore','ignore','pipe']});
   let bytes='',overflow=false,timedOut=false;
   const timer=setTimeout(()=>{timedOut=true;child.kill('SIGKILL');},timeoutMs);
   child.stdio[3].on('data',chunk=>{if(bytes.length+chunk.length>65536){overflow=true;child.kill('SIGKILL');}else bytes+=chunk.toString('utf8');});
   child.on('error',error=>{clearTimeout(timer);reject(error);});
   child.on('close',()=>{clearTimeout(timer);
    if(timedOut)return accept({status:'failed',stage:'lifecycle',errorCode:'workbench/startup-timeout'});
    if(overflow)return accept({status:'failed',stage:'lifecycle',errorCode:'workbench/startup-report-limit'});
    try{const report=JSON.parse(bytes);if(!['passed','failed'].includes(report.status))throw Error();accept(report);}
    catch{accept({status:'failed',stage:'lifecycle',errorCode:'workbench/startup-process-exited'});}
   });
  });
 }finally{await rm(home,{recursive:true,force:true});}
}
async function worker(directory,home){
 let ctx,stage='dependencies';const providers=['workdshWorkbenchRegistration (test adapter)'];
 try{
  const pkg=JSON.parse(await readFile(join(directory,'package.json'),'utf8')),require=createRequire(join(directory,'package.json'));
  const hostRequire=await hostPeerRequire(directory),hostPeers=new Set(['@deepseek-ai/cordis','workdsh-plugin-workbenches']);
  const missing=[],mismatches=[],resolvers=new Map();
  const semver=createRequire(import.meta.url)('semver');
  for(const [name,range] of Object.entries({...pkg.dependencies,...pkg.peerDependencies})){
   let entry,resolver=require;
   try{entry=resolver.resolve(name);}catch{
    if(hostRequire&&hostPeers.has(name)&&Object.hasOwn(pkg.peerDependencies??{},name)&&!Object.hasOwn(pkg.dependencies??{},name)){
     resolver=hostRequire;try{entry=resolver.resolve(name);}catch{}
    }
    if(!entry){if(pkg.peerDependenciesMeta?.[name]?.optional!==true||Object.hasOwn(pkg.dependencies??{},name))missing.push(name);continue;}
   }
   resolvers.set(name,resolver);
   let manifest;
   try{manifest=JSON.parse(await readFile(resolver.resolve(name+'/package.json'),'utf8'));}catch{
    let cursor=dirname(entry);for(let i=0;i<32;i++){
     try{const value=JSON.parse(await readFile(join(cursor,'package.json'),'utf8'));if(value.name===name){manifest=value;break;}}catch{}
     const parent=dirname(cursor);if(parent===cursor)break;cursor=parent;
    }
   }
   if(!manifest||manifest.name!==name||typeof range!=='string'||!semver.validRange(range)||!semver.valid(manifest.version)||!semver.satisfies(manifest.version,range,{includePrerelease:true}))mismatches.push({packageName:name,requested:typeof range==='string'&&semver.validRange(range)?range:'unsupported-version-specification',actual:semver.valid(manifest?.version)?manifest.version:'unconfirmed'});
  }
  if(missing.length)return {status:'failed',stage,errorCode:'workbench/startup-missing-dependencies',missingDependencies:missing};
  if(mismatches.length)return {status:'failed',stage,errorCode:'workbench/startup-dependency-version-mismatch',dependencyMismatches:mismatches};
  const entry=pkg.exports?.['.']?.default;
  if(typeof entry!=='string'||!entry.startsWith('./'))throw Error('workbench/startup-invalid-entry');
  const path=await realpath(resolve(directory,entry)),delta=relative(directory,path);
  if(delta.startsWith('..')||isAbsolute(delta))throw Error('workbench/startup-invalid-entry');
  const hostSha256=createHash('sha256').update(await readFile(path)).digest('hex');
  const cordisRequire=resolvers.get('@deepseek-ai/cordis')??require;
  const cordisVersion=JSON.parse(await readFile(cordisRequire.resolve('@deepseek-ai/cordis/package.json'),'utf8')).version;
  if(cordisVersion!=='4.0.5')throw Error('workbench/startup-unsupported-cordis');
  const {Context}=await import(pathToFileURL(cordisRequire.resolve('@deepseek-ai/cordis')).href);
  ctx=new Context();let registered=false;
  ctx.provide('workdshWorkbenchRegistration',{async registerManaged(caller,declaration,page){
   if(!isDeepStrictEqual(declaration,pkg.workdsh?.workbench)||typeof page!=='string'||!page)throw Error('workbench/startup-registration-mismatch');
   registered=true;return caller.effect(()=>()=>{},'startup.registration-test-adapter');
  }});
  stage='fixtures';
  const fixture=pkg.workdsh?.startupFixture;
  if(fixture!==undefined){
   if(typeof fixture!=='string'||!fixture.startsWith('./'))throw Error('workbench/startup-invalid-fixture');
   const path=await realpath(resolve(directory,fixture)),delta=relative(directory,path);
   if(delta.startsWith('..')||isAbsolute(delta))throw Error('workbench/startup-invalid-fixture');
   const setup=await import(pathToFileURL(path).href);
   if(typeof setup.setup!=='function')throw Error('workbench/startup-invalid-fixture');
   await setup.setup(ctx,{home});providers.push('application fixture');
  }
  stage='lifecycle';
  const plugin=await import(pathToFileURL(path).href);await ctx.plugin(plugin);
  // Await children too. Awaiting only the top fiber misses nested failures and
  // injection-PENDING components. Registry/Fiber inspection uses public APIs.
  let fibers=[];
  for(let pass=0;pass<64;pass++){
   fibers=[...ctx.registry.values()].flatMap(runtime=>[...runtime.fibers]);
   await Promise.all(fibers.map(fiber=>fiber.await()));
   const current=[...ctx.registry.values()].flatMap(runtime=>[...runtime.fibers]);
   if(current.length===fibers.length&&current.every((fiber,i)=>fiber===fibers[i]))break;
   if(pass===63)throw Error('workbench/startup-unstable-lifecycle');
  }
  // Cordis 4.0.5 FiberState ACTIVE=2. Check dependency-pending children rather
  // than manufacturing the services the application forgot to declare/provide.
  const incomplete=fibers.filter(fiber=>fiber.state!==2);
  if(incomplete.length)return {status:'failed',stage,errorCode:'workbench/startup-incomplete-lifecycle',missingServices:[...new Set(incomplete.flatMap(fiber=>Object.keys(fiber.inject).filter(name=>!fiber.ctx.get(name))))],testProviders:providers};
  if(!registered)throw Error('workbench/startup-registration-missing');
  stage='cleanup';await ctx.fiber.dispose();ctx=undefined;
  return {status:'passed',scope:'isolated-host-lifecycle',packageName:pkg.name,version:pkg.version,hostSha256,testProviders:providers,productionRegistration:'not-checked',clientPage:'not-checked',businessAcceptance:'not-checked'};
 }catch(error){return {status:'failed',stage,errorCode:error instanceof Error&&/^workbench\/[a-z-]+$/.test(error.message)?error.message:error?.code==='ERR_MODULE_NOT_FOUND'?'workbench/startup-module-not-found':'workbench/startup-lifecycle-failed',testProviders:providers};}
 finally{if(ctx)await ctx.fiber.dispose();}
}
if(process.argv[2]==='--worker'){
 let report;try{report=await worker(process.argv[3],process.argv[4]);}catch{report={status:'failed',stage:'cleanup',errorCode:'workbench/startup-cleanup-failed'};}
 const {writeSync}=await import('node:fs');writeSync(3,JSON.stringify(report));process.exit(report.status==='passed'?0:1);
}else if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const result=await checkWorkbenchStartup(process.argv[2]??process.cwd());console.log(JSON.stringify(result,null,2));process.exitCode=result.status==='passed'?0:1;
}
