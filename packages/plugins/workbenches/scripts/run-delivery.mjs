import {spawn} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rename,rm,realpath,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,basename,dirname,delimiter,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {checkWorkbenchStartup} from './check-startup.mjs';

/** Resolve installed pnpm JavaScript, never a system npm or a .cmd wrapper. */
export async function resolveWorkbenchPackageManager(directory,{environment=process.env,nodeExecutable=process.execPath}={}){
 const inspect=async(entry,expectedVersion)=>{
  const root=await realpath(dirname(dirname(entry)));
  const pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
  if(pkg.name!=='pnpm'||!/^\d+\.\d+\.\d+$/.test(pkg.version)||!/^bin\/pnpm\.(?:cjs|mjs)$/.test(pkg.bin?.pnpm??'')||(expectedVersion&&pkg.version!==expectedVersion))throw Error('invalid-pnpm');
  const path=await realpath(join(root,pkg.bin.pnpm));
  const child=relative(root,path);if(isAbsolute(child)||child.startsWith('..'))throw Error('invalid-pnpm-entry');
  return {entry:path,name:'pnpm',version:pkg.version};
 };
 const primary=environment.DSH_BUNDLED_PRIMARY_RUNTIME;
 if(primary){
  try{const metadata=JSON.parse(await readFile(join(primary,'runtime.json'),'utf8'));if(typeof metadata.pnpm!=='string')throw Error();return {...await inspect(join(primary,'dependencies/pnpm/bin/pnpm.cjs'),metadata.pnpm),source:'bundled-primary-runtime'};}
  catch{throw Error('workbench/delivery-package-manager-invalid');}
 }
 const candidates=[];
 for(const anchor of [join(resolve(directory),'package.json'),fileURLToPath(import.meta.url)]){
  for(const modules of createRequire(anchor).resolve.paths('pnpm')??[])candidates.push(join(modules,'pnpm/bin/pnpm.cjs'));
 }
 // Official development tools can expose the bundled Node without inheriting
 // DSH environment variables. Its sibling pnpm has the same public layout.
 candidates.push(join(dirname(nodeExecutable),'../../pnpm/bin/pnpm.cjs'));
 for(const part of (environment.PATH??'').split(delimiter).filter(Boolean))candidates.push(join(part,'pnpm.cjs'),join(part,'../pnpm/bin/pnpm.cjs'));
 for(const candidate of candidates){try{return {...await inspect(candidate),source:'installed-pnpm'};}catch{}}
 throw Error('workbench/delivery-package-manager-unavailable');
}

// Run ONLY inside the official development tool's authorization/sandbox.
// This runner is not a sandbox or an installation/acceptance receipt.
export async function runWorkbenchDelivery(directory,{signal,commandTimeoutMs=120000,startupTimeoutMs=15000,environment=process.env}={}){
 const source=await realpath(directory),work=await mkdtemp(join(tmpdir(),'workdsh-delivery-'));
 const reportPath=join(work,'report.json'),packDirectory=await mkdtemp(join(tmpdir(),'workdsh-pack-'));
 const report={schemaVersion:1,status:'running',startedAt:new Date().toISOString(),scope:'development-build-startup-pack',stages:[],installation:'not-checked',clientPage:'not-checked',businessAcceptance:'not-checked'};
 const total=performance.now();
 let packageManager;
 const save=async()=>{await writeFile(reportPath+'.tmp',JSON.stringify(report,null,2),{mode:0o600});await rename(reportPath+'.tmp',reportPath);};
 const command=(args)=>new Promise((accept,reject)=>{
  signal?.throwIfAborted();
  // Do not inherit model/provider credentials. No automatic privilege escalation.
  const env={PATH:dirname(process.execPath)+delimiter+(environment.PATH??''),HOME:work,USERPROFILE:work,TMPDIR:work,TEMP:work,TMP:work,npm_config_store_dir:join(work,'pnpm-store'),npm_config_update_notifier:'false'};
  for(const name of ['SystemRoot','ComSpec','PATHEXT','WINDIR'])if(process.platform==='win32'&&environment[name])env[name]=environment[name];
  // Package scripts still use the OS script shell; do not rely on finding it
  // in a PATH that may intentionally contain only the bundled Node directory.
  const scriptShell=process.platform==='win32'?(environment.ComSpec??(environment.SystemRoot?join(environment.SystemRoot,'System32/cmd.exe'):undefined)):'/bin/sh';
  const fixedManager=Number(packageManager.version.split('.')[0])>=11?['--pm-on-fail=ignore','--config.verify-deps-before-run=false']:['--config.manage-package-manager-versions=false','--config.package-manager-strict=false'];
  const child=spawn(process.execPath,[packageManager.entry,...fixedManager,...(scriptShell?['--config.script-shell='+scriptShell]:[]),...args],{cwd:source,env,detached:process.platform!=='win32',stdio:['ignore','pipe','ignore']});
  let output='',overflow=false,timedOut=false,settled=false,finalizeTimer;
  const stop=()=>{
   try{
    if(process.platform!=='win32'&&child.pid)process.kill(-child.pid,'SIGKILL');
    else if(child.pid&&environment.SystemRoot){
     const killer=spawn(join(environment.SystemRoot,'System32/taskkill.exe'),['/PID',String(child.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});
     killer.once('error',()=>{try{child.kill('SIGKILL');}catch{}});
     killer.unref();
    }else child.kill('SIGKILL');
   }catch{}
   // Detached grandchildren can keep an inherited pipe open after pnpm exits.
   // A timeout/cancellation report must not wait forever for their stdio.
   child.stdout.destroy();child.unref();finalizeTimer=setTimeout(()=>finish(null),1000);
  };
  const abort=()=>stop();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)stop();
  const clear=()=>{clearTimeout(timer);clearTimeout(finalizeTimer);signal?.removeEventListener('abort',abort);};
  const finish=code=>{if(settled)return;settled=true;clear();if(signal?.aborted)return reject(Error('workbench/delivery-aborted'));if(timedOut)return reject(Error('workbench/delivery-command-timeout'));if(overflow)return reject(Error('workbench/delivery-output-limit'));if(code!==0)return reject(Error('workbench/delivery-command-failed'));accept(output);};
  const timer=setTimeout(()=>{timedOut=true;stop();},commandTimeoutMs);
  child.stdout.on('data',chunk=>{if(Buffer.byteLength(output)+chunk.length>65536){overflow=true;stop();}else output+=chunk.toString('utf8');});
  child.on('error',error=>{if(settled)return;settled=true;clear();reject(error);});
  child.on('close',finish);
 });
 const stage=async(name,run)=>{
  signal?.throwIfAborted();const item={name,status:'running',startedAt:new Date().toISOString()},start=performance.now();report.stages.push(item);await save();
  try{const value=await run();signal?.throwIfAborted();item.status='passed';return value;}
  catch(error){item.status=signal?.aborted?'cancelled':'failed';item.errorCode=/^workbench\/[a-z-]+$/.test(error?.message??'')?error.message:'workbench/delivery-stage-failed';throw error;}
  finally{item.finishedAt=new Date().toISOString();item.durationMs=Math.round((performance.now()-start)*100)/100;await save();}
 };
 try{
  await save();
  await stage('build',async()=>{packageManager=await resolveWorkbenchPackageManager(source,{environment});report.packageManager={name:packageManager.name,version:packageManager.version,source:packageManager.source};await command(['run','build']);});
  await stage('startup-check',async()=>{report.startup=await checkWorkbenchStartup(source,{timeoutMs:startupTimeoutMs,signal});if(report.startup.status!=='passed')throw Error(report.startup.errorCode??'workbench/delivery-startup-failed');});
  await stage('pack',async()=>{
   // Startup already ran: suppress package lifecycle scripts to avoid duplicate builds.
   await command(['--config.ignore-scripts=true','--config.offline=true','pack','--pack-destination',packDirectory]);
   const packed=await readdir(packDirectory),filename=packed[0];if(packed.length!==1||typeof filename!=='string'||basename(filename)!==filename||!filename.endsWith('.tgz'))throw Error('workbench/delivery-invalid-pack-result');
   const bytes=await readFile(join(packDirectory,filename));
   // Never silently replace an immutable version with different bytes.
   const destination=join(source,filename);try{await writeFile(destination,bytes,{flag:'wx',mode:0o600});}catch(error){if(error?.code==='EEXIST')throw Error('workbench/delivery-archive-already-exists');throw error;}
   report.candidate={filename,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length};
  });
  report.status='passed';
 }catch{report.status=signal?.aborted?'cancelled':'failed';}
 finally{report.finishedAt=new Date().toISOString();report.durationMs=Math.round((performance.now()-total)*100)/100;await save();await rm(packDirectory,{recursive:true,force:true});}
 return {...report,reportPath};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const controller=new AbortController();for(const event of ['SIGINT','SIGTERM'])process.once(event,()=>controller.abort());
 const report=await runWorkbenchDelivery(process.argv[2]??process.cwd(),{signal:controller.signal});console.log(JSON.stringify(report,null,2));process.exitCode=report.status==='passed'?0:1;
}
