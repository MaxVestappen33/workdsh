import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,symlink} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {createHash} from 'node:crypto';
import {verifyLockedPackage} from '../src/locked-package.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');const target={platform:'darwin',architecture:'arm64',python:'3.12',systemVersion:'14.0'};
async function fixture(change=m=>m){const directory=await mkdtemp(join(tmpdir(),'compute-lock-'));const wheel=Buffer.from('Synthetic hash fixture, never installed');let m={contractVersion:1,id:'example',version:'1.0',platform:'darwin',architecture:'arm64',python:'3.12',minimumSystemVersion:'14.0',module:'example',operations:['fit'],artifacts:[{name:'example',version:'1.0',file:'example-1.0-py3-none-any.whl',bytes:wheel.length,sha256:hash(wheel)}]};m=change(m);const manifest=Buffer.from(JSON.stringify(m));await writeFile(join(directory,'compute-package.json'),manifest);await writeFile(join(directory,'example-1.0-py3-none-any.whl'),wheel);await writeFile(join(directory,'requirements.lock'),`example==1.0 --hash=sha256:${hash(wheel)}\n`);return {directory,manifestSha256:hash(manifest)};}
test('verified bundle locks dependencies and refuses bytes modified after staging',async()=>{const r=await fixture();try{const v=await verifyLockedPackage(r,target,new AbortController().signal);assert.equal(v.manifest.id,'example');assert.equal(v.dependencyLockSha256.length,64);await writeFile(join(r.directory,'requirements.lock'),'example==latest');await assert.rejects(verifyLockedPackage(r,target,new AbortController().signal),/LOCK_MISMATCH/);}finally{await rm(r.directory,{recursive:true,force:true});}});
test('wrong platform, traversal, symlinks, digest mismatch and cancellation fail closed',async()=>{
 const r=await fixture();try{await assert.rejects(verifyLockedPackage(r,{...target,architecture:'x64'},new AbortController().signal),/TARGET/);await assert.rejects(verifyLockedPackage({...r,manifestSha256:'0'.repeat(64)},target,new AbortController().signal),/DIGEST/);const c=new AbortController();c.abort();await assert.rejects(verifyLockedPackage(r,target,c.signal));await rm(join(r.directory,'example-1.0-py3-none-any.whl'));await symlink('compute-package.json',join(r.directory,'example-1.0-py3-none-any.whl'));await assert.rejects(verifyLockedPackage(r,target,new AbortController().signal),/FILE_MISMATCH/);}finally{await rm(r.directory,{recursive:true,force:true});}
 const bad=await fixture(m=>({...m,artifacts:[{...m.artifacts[0],file:'../outside.whl'}]}));try{await assert.rejects(verifyLockedPackage(bad,target,new AbortController().signal),/INVALID_ARTIFACT/);}finally{await rm(bad.directory,{recursive:true,force:true});}
});

test('explicit host dependency manifest allows only pinned numpy with pure Python artifacts',async()=>{
 const r=await fixture(m=>({...m,contractVersion:2,hostDependencies:[{name:'numpy',version:'2.3.5'}]}));
 try{assert.equal((await verifyLockedPackage(r,target,new AbortController().signal)).manifest.contractVersion,2);}finally{await rm(r.directory,{recursive:true,force:true});}
 for(const change of [m=>({...m,contractVersion:2,hostDependencies:[{name:'numpy',version:'latest'}]}),m=>({...m,contractVersion:2,hostDependencies:[{name:'scipy',version:'1.16.3'}]})]){
  const bad=await fixture(change);try{await assert.rejects(verifyLockedPackage(bad,target,new AbortController().signal),/HOST_DEPENDENCIES/);}finally{await rm(bad.directory,{recursive:true,force:true});}
 }
});
