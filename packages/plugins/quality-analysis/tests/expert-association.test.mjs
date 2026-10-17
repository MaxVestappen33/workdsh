import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(new URL('../../../../apps/web/package.json',import.meta.url));
const built=await require('esbuild').build({entryPoints:[fileURLToPath(new URL('../src/runtime/expert-association.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false});
const {verifyQualityExpertAssociation:verify,readQualityExpertInterpretation:read}=await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const view={recordId:'record',runId:'run',contentHash:'a'.repeat(64)};
function fixture(){
 let principal='member',active=true;
 const actor={principalId:'member',organizationId:'org',resolvedBy:'identity'};
 const binding={sessionId:'session-expert',expertRevisionRef:{expertId:'expert',revisionId:'revision'},presetRevisionRef:'preset',compositionDigest:'b'.repeat(64),skillRevisionRefs:[],owner:{organizationId:'org',ownerPrincipalId:'member'},creationOperationId:'create',createdAt:'2026-10-11T00:00:00Z'};
 const services={workdshIdentity:{resolve:async()=>actor,profile:()=>({principalId:principal,resolvedBy:'identity',organization:{id:'org',kind:'personal'}}),membership:()=>({state:active?'active':'revoked'})},workdshAccess:{sessionOwner:()=>({organizationId:'org',ownerPrincipalId:'member'})},workdshExperts:{verifyBinding:async()=>structuredClone(binding)}};
 return {ctx:{get:key=>services[key],fiber:{assertActive(){}}},services,binding,creation:{sessionId:binding.sessionId,binding:structuredClone(binding),handoffId:'handoff'},switchAccount:()=>{principal='other'},revoke:()=>{active=false}};
}
test('Host creation is matched to current expert binding and only fixed provenance is returned',async()=>{
 const f=fixture();let reads=0;const result=await verify(f.ctx,{...view,untrusted:'excluded'},f.creation,async()=>reads++);
 assert.equal(reads,2);assert.deepEqual(result,{...view,sessionId:'session-expert',expertId:'expert',expertRevisionId:'revision',compositionDigest:'b'.repeat(64),creationOperationId:'create'});assert.ok(Object.isFrozen(result));
});
test('unrelated, foreign or drifted expert creation cannot be admitted',async()=>{
 for(const mutate of [f=>{f.binding.expertRevisionRef.revisionId='different'},f=>{f.binding.owner.ownerPrincipalId='other'},f=>{f.binding.creationOperationId='other'},f=>{f.binding.sessionId='other'},f=>{f.binding.delegation={parentSessionId:'old'}}]){
  const f=fixture();mutate(f);await assert.rejects(verify(f.ctx,view,f.creation,async()=>{}),/binding-conflict/);
 }
 const f=fixture();f.services.workdshAccess.sessionOwner=()=>undefined;await assert.rejects(verify(f.ctx,view,f.creation,async()=>{}),/access-denied/);
});
test('account switch, revoked membership, run denial and cancellation prevent association',async()=>{
 const f=fixture();await assert.rejects(verify(f.ctx,view,f.creation,async()=>f.switchAccount()),/access-denied/);
 const g=fixture();g.services.workdshExperts.verifyBinding=async()=>{g.revoke();return g.binding};await assert.rejects(verify(g.ctx,view,g.creation,async()=>{}),/access-denied/);
 const h=fixture();await assert.rejects(verify(h.ctx,view,h.creation,async()=>{throw Error('run-denied')}),/run-denied/);
 const c=new AbortController();c.abort();await assert.rejects(verify(h.ctx,view,h.creation,async()=>{},c.signal),{name:'AbortError'});
});

 test('associated expert candidate uses existing native events and rechecks after inspection',async()=>{
  const f=fixture();const association=await verify(f.ctx,view,f.creation,async()=>{});let inspected=0;
  f.services.sessionController={inspect:async id=>{assert.equal(id,association.sessionId);inspected++;return {events:[{seq:0,type:'turn/start',data:{turn:1}},{seq:1,type:'assistant/message',data:{turn:1,message:{content:[{type:'text',text:'专家核查意见'}]}}},{seq:2,type:'turn/end',data:{turn:1,reason:{kind:'completed'}}}]}}};
  const result=await read(f.ctx,association,async()=>{});assert.equal(result.candidate.text,'专家核查意见');assert.equal(result.candidate.runId,view.runId);assert.equal(inspected,1);
  f.services.sessionController.inspect=async()=>{f.revoke();return {events:[]}};
  await assert.rejects(read(f.ctx,association,async()=>{}),/access-denied/);
  const g=fixture();g.services.sessionController={inspect:async()=>{throw Error('must-not-read')}};const profile=g.services.workdshIdentity.profile;
  g.services.workdshIdentity.profile=()=>({...profile(),organization:{id:'org',kind:'enterprise'}});
  await assert.rejects(read(g.ctx,association,async()=>{}),/session-unavailable/);
 });
