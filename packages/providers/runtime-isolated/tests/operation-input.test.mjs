import {test} from 'node:test';
import assert from 'node:assert/strict';
import {encodeOperationInput,stageOperationInput,MAX_INPUT_BYTES} from '../src/operation-input.mjs';
import {mkdtemp,writeFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
test('bounded large payload uses guarded file write instead of a command argument',async()=>{
 const content=encodeOperationInput({rows:Array.from({length:10000},(_,i)=>[i,10+i/10000])});
 const calls=[];
 const dispatch=async(name,args)=>{calls.push({name,args});if(name==='bash'){
  const prefix=args.command.match(/\.workdsh-compute-input-[a-f0-9-]+-/)[0];
  return {directory:'/workspace/'+prefix+'abc'};
 }return {};};
 const result=await stageOperationInput(dispatch,x=>x,'/python',content);
 assert.deepEqual(calls.map(x=>x.name),['bash','write']);
 assert.equal(calls[1].args.content,content);assert.equal(calls[1].args.file_path,result.cleanup.path);
 assert.ok(result.argument.startsWith('--payload-file '));assert.ok(result.argument.length<250);
 assert.ok(!calls[0].args.command.includes(content));
});
test('small input stays inline, oversized and invalid staging responses fail closed',async()=>{
 const result=await stageOperationInput(()=>{throw Error('must not dispatch')},x=>x,'/python','{}');
 assert.equal(result.argument,Buffer.from('{}').toString('base64'));
 assert.throws(()=>encodeOperationInput({data:'x'.repeat(MAX_INPUT_BYTES)}),/TRANSPORT_LIMIT/);
 for(const directory of ['/private/arbitrary','relative'])await assert.rejects(stageOperationInput(async()=>({directory}),x=>x,'/python','x'.repeat(32769)),/INVALID_OUTPUT/);
});
test('write denial preserves cleanup identity and never dispatches an operation',async()=>{
 let calls=0;
 const error=Error('DENIED');
 await assert.rejects(stageOperationInput(async(name,args)=>{calls++;if(name==='write')throw error;const prefix=args.command.match(/\.workdsh-compute-input-[a-f0-9-]+-/)[0];return {directory:'/workspace/'+prefix+'abc'};},x=>x,'/python','x'.repeat(32769)),e=>e===error&&e.computeInputCleanup.path.endsWith('/payload.json'));
 assert.equal(calls,2);
});
test('Python consumes all 10000 rows, rejects changed bytes and removes staged input',async()=>{
 const root=await mkdtemp(join(tmpdir(),'workdsh-input-test-'));
 try{for(const changed of [false,true]){
  const directory=await mkdtemp(join(root,'.workdsh-compute-input-test-'));
  const path=join(directory,'payload.json');
  const content=JSON.stringify({manifest:{operations:[]},input:{operation:'unsupported',rows:Array.from({length:10000},(_,i)=>[i,10+i/10000])}});
  await writeFile(path,content);
  const checksum=changed?'0'.repeat(64):createHash('sha256').update(content).digest('hex');
  const run=spawnSync(process.env.WORKDSH_TEST_PYTHON??'python3',['-I',fileURLToPath(new URL('../src/offline-operation.py',import.meta.url)),'--payload-file',path,checksum],{encoding:'utf8'});
  assert.equal(run.status,2,run.stderr);assert.equal(JSON.parse(run.stdout).error.code,changed?'INPUT_CHANGED':'UNSUPPORTED_OPERATION');
  await assert.rejects(stat(directory),{code:'ENOENT'});
 }}finally{await rm(root,{recursive:true,force:true});}
});
