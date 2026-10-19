import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';import {mkdtemp,mkdir,writeFile,readFile,realpath,rm,symlink,readdir} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
const require=createRequire(new URL('../../../../apps/web/package.json',import.meta.url));const built=await require('esbuild').build({entryPoints:[fileURLToPath(new URL('../src/runtime/source-checkpoint.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false});const {checkpointWorkbenchSource:save}=await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
test('source checkpoints retain old bytes across edits and reject linked files',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'source-checkpoint-'))),source=join(root,'source'),backups=join(root,'backups');await mkdir(source);
 try{
 await writeFile(join(source,'index.js'),'old');const old=await save(source,backups,()=>{});await writeFile(join(source,'index.js'),'new');const next=await save(source,backups,()=>{});assert.notEqual(old.sha256,next.sha256);assert.equal(await readFile(join(old.directory,'index.js'),'utf8'),'old');assert.equal(await readFile(join(next.directory,'index.js'),'utf8'),'new');
 const again=await save(source,backups,()=>{});assert.equal(again.sha256,next.sha256);
 await symlink(join(root,'outside'),join(source,'linked'));await assert.rejects(save(source,backups,()=>{}),/source-link-unsupported/);assert.equal((await readdir(backups)).some(n=>n.startsWith('.pending-')),false);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('corrupted retained checkpoint and nested destination are refused',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'source-checkpoint-'))),source=join(root,'source'),backups=join(root,'backups');await mkdir(source);
 try{
 await writeFile(join(source,'index.js'),'source');const receipt=await save(source,backups,()=>{});await writeFile(join(receipt.directory,'index.js'),'broken');await assert.rejects(save(source,backups,()=>{}),/checkpoint-corrupt/);
 await assert.rejects(save(source,join(source,'backups'),()=>{}),/checkpoint-inside-source/);assert.equal((await readdir(source)).includes('backups'),false);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('change during checkpoint creation rejects publication and cleans staging',async()=>{
 const {existsSync,readdirSync,writeFileSync}=await import('node:fs');
 const root=await realpath(await mkdtemp(join(tmpdir(),'source-checkpoint-'))),source=join(root,'source'),backups=join(root,'backups');await mkdir(source);await writeFile(join(source,'index.js'),'old');let changed=false;
 try{
 await assert.rejects(save(source,backups,()=>{
  if(!changed&&existsSync(backups))for(const name of readdirSync(backups))if(name.startsWith('.pending-')&&existsSync(join(backups,name,'index.js'))){writeFileSync(join(source,'index.js'),'new');changed=true;}
 }),/source-changed/);assert.equal(changed,true);assert.deepEqual(await readdir(backups),[]);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('package manager caches do not enter source snapshots or change their identity',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'source-checkpoint-cache-'))),source=join(root,'source'),backups=join(root,'backups');await mkdir(source);
 try{
  await writeFile(join(source,'index.js'),'source');
  for(const cache of ['.workdsh-npm-cache','.workdsh-pnpm-store']){await mkdir(join(source,cache));await writeFile(join(source,cache,'entry'),'old cache');}
  const before=await save(source,backups,()=>{});assert.equal(before.fileCount,1);assert.equal(before.byteLength,6);
  for(const cache of ['.workdsh-npm-cache','.workdsh-pnpm-store'])await writeFile(join(source,cache,'entry'),'new generated cache');
  const after=await save(source,backups,()=>{});assert.equal(after.sha256,before.sha256);assert.deepEqual((await readdir(before.directory)).sort(),['.workdsh-checkpoint.json','index.js']);
 }finally{await rm(root,{recursive:true,force:true});}
});
