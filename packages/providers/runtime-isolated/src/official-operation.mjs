/** Fixed offline operations through published DSH Tools, never a Host subprocess.
 * Trusted same-process helper. The domain caller authorizes its task; official
 * tool guards, native scope, cancellation, shell sandbox and jobs remain in force.
 */
import {readFile} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import {verifyLockedPackage} from './locked-package.mjs';
import {recoverOperationOutput} from './operation-output.mjs';
import {encodeOperationInput,stageOperationInput,cleanupOperationInputCommand} from './operation-input.mjs';
const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
const probe=`import hashlib,json,platform,sys;print(json.dumps({'platform':sys.platform,'architecture':platform.machine(),'python':str(sys.version_info.major)+'.'+str(sys.version_info.minor),'systemVersion':platform.mac_ver()[0],'interpreterSha256':hashlib.sha256(open(sys.executable,'rb').read()).hexdigest()}))`;

async function dispatch(ctx,exec,name,args,suffix){
 exec.signal.throwIfAborted();
 const result=await ctx.tools.execute({name,arguments:args,callId:`${exec.callId}:compute:${suffix}`,rootCallId:exec.rootCallId,parent:exec.token,agent:exec.agent,signal:exec.signal});
 for(const context of result.additionalContexts??[])exec.deferContext(context);
 if(result.isError)throw Error('HOST_COMPUTE_DISPATCH_FAILED');
 exec.signal.throwIfAborted();return result.value;
}
function stdout(value,stage){
 if(value?.kind==='promoted'||value?.kind==='background')throw Error(`COMPUTE_JOB_CONTINUES:${value.jobId}`);
 const reason=value?.kind!=='foreground'?'OUTPUT_KIND':value.sandbox?.runnerFailed?'SANDBOX_RUNNER':value.sandbox?.denied?'SANDBOX_DENIED':value.aborted?'ABORTED':value.timedOut?'TIMEOUT':value.signal?'SIGNAL':value.exitCode!==0?'EXIT':value.stdout?.truncated?'TRUNCATED':null;
 if(reason==='EXIT'&&stage==='OPERATION'&&!value.stdout?.truncated){
  let failure;try{failure=JSON.parse(value.stdout?.text);}catch{}
  const known=new Set(['INPUT_CHANGED','INPUT_INVALID_PATH','OFFLINE_INSTALL_FAILED','ARTIFACT_CHANGED','COMPUTATION_FAILED','COMPUTE_CANCELLED','RESULT_SIZE_LIMIT','STATISTICS_MODULE_MISSING','STATISTICS_IMPORT_FAILED','STATISTICS_ACCESS_DENIED','STATISTICS_PROCESS_FAILED','HOST_DEPENDENCY_UNAVAILABLE','HOST_DEPENDENCY_SIGNATURE_FAILED','HOST_DEPENDENCY_CHANGED']);
  if(failure?.contractVersion===1&&failure.ok===false&&['STATISTICS_MODULE_MISSING','STATISTICS_IMPORT_FAILED','STATISTICS_ACCESS_DENIED','STATISTICS_PROCESS_FAILED'].includes(failure.error?.code))throw Error(`HOST_COMPUTE_${failure.error.code}`);
  const stages=new Set(['TEMPORARY_DIRECTORY','ARTIFACT_READ','ENVIRONMENT_CREATE','OFFLINE_INSTALL','HOST_DEPENDENCY','STATISTICS']);
  const reasons=new Set(['ACCESS_DENIED','FILE_NOT_FOUND','TIMEOUT','INVALID_OUTPUT','FAILED']);
  if(failure?.contractVersion===1&&failure.ok===false&&known.has(failure.error?.code)&&stages.has(failure.error.stage)&&reasons.has(failure.error.reason))throw Error(`HOST_COMPUTE_${failure.error.stage}_${failure.error.reason}`);
  if(failure?.contractVersion===1&&failure.ok===false&&known.has(failure.error?.code))throw Error(`HOST_COMPUTE_OPERATION_${failure.error.code}`);
 }
 if(reason)throw Error(stage?`HOST_COMPUTE_${stage}_${reason}`:'HOST_COMPUTE_NOT_COMPLETED');
 if(typeof value.stdout?.text!=='string')throw Error('HOST_COMPUTE_INVALID_OUTPUT');
 return JSON.parse(value.stdout.text);
}
export async function executeOfflineOperation(ctx,exec,registration,input){
 if(!exec.agent)throw Error('COMPUTE_SESSION_REQUIRED');
 encodeOperationInput(input);
 const runtime=await dispatch(ctx,exec,'load_workspace_dependencies',{},'runtime');
 if(typeof runtime?.python!=='string'||!isAbsolute(runtime.python))throw Error('HOST_PYTHON_UNAVAILABLE');
 const target=stdout(await dispatch(ctx,exec,'bash',{command:`${quote(runtime.python)} -I -c ${quote(probe)}`,description:'核查专业计算 Python 版本与平台',timeoutMs:10000},'probe'),'PROBE');
 const bundle=await verifyLockedPackage(registration,target,exec.signal);
 if(!bundle.manifest.operations.includes(input.operation))throw Error('UNSUPPORTED_OPERATION');
 const script=await readFile(new URL('./offline-operation.py',import.meta.url),'utf8');
 if(bundle.manifest.contractVersion===2&&(typeof runtime.pythonPackages!=='string'||!isAbsolute(runtime.pythonPackages)||runtime.pythonDistributions?.numpy!=='2.3.5'))throw Error('HOST_DEPENDENCY_UNAVAILABLE');
 const encoded=encodeOperationInput({manifest:bundle.manifest,directory:bundle.directory,input,hostPackages:runtime.pythonPackages});
 const script64=Buffer.from(script).toString('base64');
 const bootstrap=`import base64;exec(compile(base64.b64decode('${script64}'),'<workdsh-offline-operation>','exec'))`;
 let staged;
 let value;
 try{
  staged=await stageOperationInput((name,args,suffix)=>dispatch(ctx,exec,name,args,suffix),stdout,runtime.python,encoded);
  const argument=staged.cleanup?staged.argument:quote(staged.argument);
  value=await dispatch(ctx,exec,'bash',{command:`${quote(runtime.python)} -I -c ${quote(bootstrap)} ${argument}`,description:'在隔离环境执行锁定专业计算包',timeoutMs:60000},'operation');
 }catch(error){
  const cleanup=staged?.cleanup??error.computeInputCleanup;
  if(cleanup&&!exec.signal.aborted)try{await dispatch(ctx,exec,'bash',{command:cleanupOperationInputCommand(runtime.python,cleanup),description:'清理本次未完成的专业计算临时输入',timeoutMs:10000},'input-cleanup');}catch{}
  throw error;
 }
 const output=stdout(await recoverOperationOutput(ctx,exec,value),'OPERATION');
 if(output?.contractVersion!==1||output.ok!==true||!output.result)throw Error('COMPUTE_PROTOCOL_FAILED');
 return {output:output.result,provenance:{package:{id:bundle.manifest.id,version:bundle.manifest.version,manifestSha256:bundle.manifestSha256},dependencyLockSha256:bundle.dependencyLockSha256,interpreterSha256:target.interpreterSha256,platform:target.platform,architecture:target.architecture,environment:bundle.manifest.contractVersion===2?'ephemeral-pure-python-with-verified-host-numpy':'ephemeral-offline-venv',...(output.hostDependency?{hostDependency:output.hostDependency}:{})}};
}
