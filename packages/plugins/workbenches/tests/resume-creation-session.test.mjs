import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {mkdtemp,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const web=createRequire(new URL('../../../../apps/web/package.json',import.meta.url));
const built=await web('esbuild').build({entryPoints:[fileURLToPath(new URL('../src/runtime/resume-creation-session.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false});
const {resumeWorkbenchCreationSession:resume}=await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const actor={principalId:'member',organizationId:'personal',resolvedBy:'fixture'};
test('a started native Session resumes by authorized cold reads and never invokes new-conversation create',async()=>{
 const directory=await realpath(await mkdtemp(join(tmpdir(),'workdsh-native-resume-')));
 try{for(const createBehavior of ['mint-new-id','reject-existing']){
  const calls=[];
  const native={create:async()=>{calls.push('create');if(createBehavior==='reject-existing')throw Error('already-exists');return {sessionId:'another-new-blank',agentPreset:'cordis'};},inspect:async id=>{calls.push('inspect');assert.equal(id,'started-original');return {meta:{id,cwd:directory,agentPreset:'cordis'},events:[{type:'turn/start',seq:1}]};},projections:async()=>{calls.push('projections');return {kind:'sequenced',asOfSeq:1,values:{agentPreset:'cordis'}};}};
  const restored=await resume(actor,'started-original','started-original',directory,{...native,authorize:async()=>{calls.push('authorize');}},()=>{});
  assert.equal(restored,'started-original');assert.deepEqual(calls,['authorize','inspect','projections','authorize']);
 }}finally{await rm(directory,{recursive:true,force:true});}
});
test('resume preserves identity, ownership, workspace and current preset fences; failed reads never create a substitute',async()=>{
 const directory=await realpath(await mkdtemp(join(tmpdir(),'workdsh-native-resume-fences-')));
 try{
  const expected='original';let creates=0;
  const normal={authorize:async()=>{},inspect:async()=>({meta:{id:expected,cwd:directory},events:[]}),projections:async()=>({kind:'sequenced',asOfSeq:0,values:{agentPreset:'cordis'}}),create:async()=>{creates++;}};
  await assert.rejects(resume(actor,'another',expected,directory,normal,()=>{}),/creation-conflict/);
  await assert.rejects(resume(actor,expected,expected,directory,{...normal,authorize:async()=>{throw Error('workbench/creation-access-denied');}},()=>{}),/creation-access-denied/);
  const readError=Object.assign(Error('not-readable'),{code:'session/not-found'});
  await assert.rejects(resume(actor,expected,expected,directory,{...normal,inspect:async()=>{throw readError;}},()=>{}),error=>error===readError);
  await assert.rejects(resume(actor,expected,expected,directory,{...normal,inspect:async()=>({meta:{id:expected,cwd:tmpdir()},events:[]})},()=>{}),/session-workspace-mismatch/);
  await assert.rejects(resume(actor,expected,expected,directory,{...normal,projections:async()=>({kind:'sequenced',asOfSeq:1,values:{agentPreset:'standard'}})},()=>{}),/development-creator-required/);
  await assert.rejects(resume(actor,expected,expected,directory,{...normal,projections:async()=>({kind:'migration-required',values:{agentPreset:'cordis'}})},()=>{}),/session-state-unavailable/);
  const controller=new AbortController();controller.abort();await assert.rejects(resume(actor,expected,expected,directory,normal,()=>controller.signal.throwIfAborted(),controller.signal),error=>error.name==='AbortError');
  assert.equal(creates,0);
 }finally{await rm(directory,{recursive:true,force:true});}
});
