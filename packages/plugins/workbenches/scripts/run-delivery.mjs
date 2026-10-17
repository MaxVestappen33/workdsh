import {spawn} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rename,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,basename,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {checkWorkbenchStartup} from './check-startup.mjs';

// Run ONLY inside the official development tool's authorization/sandbox.
// This runner is not a sandbox or an installation/acceptance receipt.
export async function runWorkbenchDelivery(directory,{signal,commandTimeoutMs=120000,startupTimeoutMs=15000}={}){
 const source=await realpath(directory),work=await mkdtemp(join(tmpdir(),'workdsh-delivery-'));
 const reportPath=join(work,'report.json'),packDirectory=await mkdtemp(join(tmpdir(),'workdsh-pack-'));
 const report={schemaVersion:1,status:'running',startedAt:new Date().toISOString(),scope:'development-build-startup-pack',stages:[],installation:'not-checked',clientPage:'not-checked',businessAcceptance:'not-checked'};
 const total=performance.now();
 const save=async()=>{await writeFile(reportPath+'.tmp',JSON.stringify(report,null,2),{mode:0o600});await rename(reportPath+'.tmp',reportPath);};
 const command=(args)=>new Promise((accept,reject)=>{
  signal?.throwIfAborted();
  // Do not inherit model/provider credentials. No automatic privilege escalation.
  const env={PATH:dirname(process.execPath)+(process.platform==='win32'?';':':')+(process.env.PATH??''),HOME:work,USERPROFILE:work,TMPDIR:work,TEMP:work,TMP:work,npm_config_cache:join(work,'npm-cache'),npm_config_update_notifier:'false'};
  for(const name of ['SystemRoot','ComSpec'])if(process.platform==='win32'&&process.env[name])env[name]=process.env[name];
  const child=spawn(process.platform==='win32'?'npm.cmd':'npm',args,{cwd:source,env,detached:process.platform!=='win32',stdio:['ignore','pipe','ignore']});
  let output='',overflow=false,timedOut=false;
  const stop=()=>{try{if(process.platform!=='win32'&&child.pid)process.kill(-child.pid,'SIGKILL');else child.kill('SIGKILL');}catch{}};
  const abort=()=>stop();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)stop();
  const clear=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);};
  const timer=setTimeout(()=>{timedOut=true;stop();},commandTimeoutMs);
  child.stdout.on('data',chunk=>{if(Buffer.byteLength(output)+chunk.length>65536){overflow=true;stop();}else output+=chunk.toString('utf8');});
  child.on('error',error=>{clear();reject(error);});
  child.on('close',code=>{clear();if(signal?.aborted)return reject(Error('workbench/delivery-aborted'));if(timedOut)return reject(Error('workbench/delivery-command-timeout'));if(overflow)return reject(Error('workbench/delivery-output-limit'));if(code!==0)return reject(Error('workbench/delivery-command-failed'));accept(output);});
 });
 const stage=async(name,run)=>{
  signal?.throwIfAborted();const item={name,status:'running',startedAt:new Date().toISOString()},start=performance.now();report.stages.push(item);await save();
  try{const value=await run();signal?.throwIfAborted();item.status='passed';return value;}
  catch(error){item.status=signal?.aborted?'cancelled':'failed';item.errorCode=/^workbench\/[a-z-]+$/.test(error?.message??'')?error.message:'workbench/delivery-stage-failed';throw error;}
  finally{item.finishedAt=new Date().toISOString();item.durationMs=Math.round((performance.now()-start)*100)/100;await save();}
 };
 try{
  await save();
  await stage('build',()=>command(['run','build']));
  await stage('startup-check',async()=>{report.startup=await checkWorkbenchStartup(source,{timeoutMs:startupTimeoutMs,signal});if(report.startup.status!=='passed')throw Error(report.startup.errorCode??'workbench/delivery-startup-failed');});
  await stage('pack',async()=>{
   // Startup already ran: suppress package lifecycle scripts to avoid duplicate builds.
   const packed=JSON.parse(await command(['pack','--ignore-scripts','--offline','--json','--pack-destination',packDirectory]));
   const filename=packed?.[0]?.filename;if(packed.length!==1||typeof filename!=='string'||basename(filename)!==filename||!filename.endsWith('.tgz'))throw Error('workbench/delivery-invalid-pack-result');
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
