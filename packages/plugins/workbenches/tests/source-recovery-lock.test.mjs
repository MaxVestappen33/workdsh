import {fork} from 'node:child_process';import {once} from 'node:events';
import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';import {mkdtemp,mkdir,realpath,rm,readdir,writeFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
const require=createRequire(new URL('../../../../apps/web/package.json',import.meta.url));const built=await require('esbuild').build({entryPoints:[fileURLToPath(new URL('../src/runtime/source-recovery-lock.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false});const {withSourceRecoveryLock:locked}=await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
test('concurrent recoveries are excluded and rejected operations release their own lock',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'recovery-lock-')));
 try{
  const source=join(root,'source');await mkdir(source);let release,started;const ready=new Promise(resolve=>started=resolve),gate=new Promise(resolve=>release=resolve);
  const first=locked(source,()=>{},async()=>{started();await gate;return 'done';});await ready;
  await assert.rejects(locked(source,()=>{},async()=>{throw Error('must-not-run');}),/source-recovery-busy/);release();assert.equal(await first,'done');
  await assert.rejects(locked(source,()=>{},async()=>{throw Error('operation-failed');}),/operation-failed/);assert.deepEqual(await readdir(root),['source']);
  await mkdir(join(root,'.source.workdsh-recovery-lock'));await assert.rejects(locked(source,()=>{},async()=>{}),/source-recovery-busy/);assert.deepEqual((await readdir(root)).sort(),['.source.workdsh-recovery-lock','source']);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('actual competing process is excluded and a crashed owner leaves its lock intact',{timeout:15000},async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'recovery-lock-process-')));let child;
 try{
  const source=join(root,'source');await mkdir(source);
  await writeFile(join(root,'lock.mjs'),built.outputFiles[0].text);
  await writeFile(join(root,'owner.mjs'),`import {withSourceRecoveryLock} from './lock.mjs';
await withSourceRecoveryLock(process.argv[2],()=>{},async()=>{
 process.send('locked');await new Promise(resolve=>process.once('message',resolve));
});process.disconnect();`);
  async function start(){
   const owner=fork(join(root,'owner.mjs'),[source],{stdio:['ignore','ignore','ignore','ipc']});child=owner;
   const ready=new Promise((resolve,reject)=>{owner.once('message',resolve);owner.once('error',reject);owner.once('exit',()=>reject(Error('owner-exited-before-ready')));});
   assert.equal(await ready,'locked');return owner;
  }
  let owner=await start();await assert.rejects(locked(source,()=>{},async()=>{}),/source-recovery-busy/);
  const finished=once(owner,'exit');owner.send('release');assert.deepEqual(await finished,[0,null]);child=undefined;
  assert.equal(await locked(source,()=>{},async()=> 'available'),'available');
  owner=await start();const crashed=once(owner,'exit');owner.kill('SIGKILL');const [,signal]=await crashed;assert.equal(signal,'SIGKILL');child=undefined;
  await assert.rejects(locked(source,()=>{},async()=>{}),/source-recovery-busy/);
  assert.ok((await readdir(root)).includes('.source.workdsh-recovery-lock'));
 }finally{if(child){const exited=once(child,'exit');child.kill('SIGKILL');await exited;}await rm(root,{recursive:true,force:true});}
});
