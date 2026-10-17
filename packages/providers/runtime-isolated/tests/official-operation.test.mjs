import {test} from 'node:test';import assert from 'node:assert/strict';
import {executeOfflineOperation} from '../src/official-operation.mjs';
const exec=()=>({agent:{id:'s'},callId:'root',rootCallId:'root',token:Symbol('native'),signal:new AbortController().signal,deferContext(){}});
test('runtime discovery retains native root/token and policy refusal stops before shell',async()=>{
 const e=exec();let count=0;
 await assert.rejects(executeOfflineOperation({tools:{execute:async call=>{count++;assert.equal(call.name,'load_workspace_dependencies');assert.equal(call.parent,e.token);assert.equal(call.rootCallId,e.rootCallId);assert.equal(call.signal,e.signal);assert.equal(call.agent,e.agent);return {isError:true};}}},e,{directory:'/trusted/package',manifestSha256:'0'.repeat(64)},{operation:'fit'}),/DISPATCH_FAILED/);assert.equal(count,1);
});
test('missing session, oversized transport, relative runtime and cancelled call cannot launch computation',async()=>{
 const ctx={tools:{execute:async()=>({isError:false,value:{python:'relative'}})}};
 await assert.rejects(executeOfflineOperation(ctx,{...exec(),agent:undefined},{},{operation:'fit'}),/SESSION_REQUIRED/);
 await assert.rejects(executeOfflineOperation(ctx,exec(),{},{operation:'fit',data:'x'.repeat(8*1024*1024)}),/TRANSPORT_LIMIT/);
 await assert.rejects(executeOfflineOperation(ctx,exec(),{},{operation:'fit'}),/PYTHON_UNAVAILABLE/);
 const c=new AbortController();c.abort();await assert.rejects(executeOfflineOperation(ctx,{...exec(),signal:c.signal},{},{operation:'fit'}));
});
test('promoted or truncated shell results never appear as completed computation',async()=>{
 for(const value of [{kind:'promoted',jobId:'native-job'},{kind:'foreground',exitCode:0,stdout:{truncated:true,text:'{}'}}]){
 let calls=0;const ctx={tools:{execute:async()=>({isError:false,value:++calls===1?{python:'/trusted/python'}:value})}};
 await assert.rejects(executeOfflineOperation(ctx,exec(),{},{operation:'fit'}),/COMPUTE_JOB_CONTINUES:native-job|PROBE_TRUNCATED/);assert.equal(calls,2);
 }
});

test('bounded stage diagnostics distinguish shell refusal, timeout and process exit without exposing logs',async()=>{
 for(const [reason,value] of Object.entries({SANDBOX_DENIED:{sandbox:{denied:true}},SANDBOX_RUNNER:{sandbox:{runnerFailed:true}},TIMEOUT:{timedOut:true},EXIT:{exitCode:2}})){
 let calls=0;const ctx={tools:{execute:async()=>({isError:false,value:++calls===1?{python:'/trusted/python'}:{kind:'foreground',exitCode:0,stdout:{text:'private log'},...value}})}};
 await assert.rejects(executeOfflineOperation(ctx,exec(),{},{operation:'fit'}),new RegExp('^Error: HOST_COMPUTE_PROBE_'+reason+'$'));
 }
});
test('bootstrap diagnostics accept only bounded protocol stages and reasons',async()=>{
 for(const [error,expected] of [[{code:'COMPUTATION_FAILED',stage:'ARTIFACT_READ',reason:'FILE_NOT_FOUND'},'HOST_COMPUTE_ARTIFACT_READ_FILE_NOT_FOUND'],[{code:'COMPUTATION_FAILED',stage:'secret/path',reason:'secret'},'HOST_COMPUTE_OPERATION_COMPUTATION_FAILED'],[{code:'secret',stage:'ARTIFACT_READ',reason:'FAILED'},'HOST_COMPUTE_OPERATION_EXIT']]){
  // The complete operation path requires a verified locked bundle. Exercise the
  // parser in its actual module without exposing it as a production API.
  const {readFile}=await import('node:fs/promises');const source=await readFile(new URL('../src/official-operation.mjs',import.meta.url),'utf8');
  const start=source.indexOf('function stdout('),end=source.indexOf('export async function executeOfflineOperation');
  const parse=new Function(source.slice(start,end)+';return stdout')();
  assert.throws(()=>parse({kind:'foreground',exitCode:2,stdout:{text:JSON.stringify({contractVersion:1,ok:false,error})}},'OPERATION'),new RegExp('^Error: '+expected+'$'));
 }
});
