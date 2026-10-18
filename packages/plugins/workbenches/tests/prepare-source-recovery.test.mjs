import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';import {mkdtemp,mkdir,writeFile,readFile,readdir,realpath,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
const require=createRequire(new URL('../../../../apps/web/package.json',import.meta.url));
async function load(file){const built=await require('esbuild').build({entryPoints:[fileURLToPath(new URL('../src/runtime/'+file,import.meta.url))],bundle:true,platform:'node',format:'esm',write:false});return import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);}
const {checkpointWorkbenchSource:checkpoint}=await load('source-checkpoint.ts'),{prepareSourceRecovery:prepare}=await load('prepare-source-recovery.ts');
const {inspectSourceRecovery:inspect}=await load('inspect-source-recovery.ts');
test('recovery preparation backs up current source and rejects a stale baseline',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'source-recovery-')));
 try{
 const source=join(root,'source'),checkpoints=join(root,'checkpoints'),candidates=join(root,'candidates');await mkdir(source);await writeFile(join(source,'index.js'),'old');const old=await checkpoint(source,checkpoints,()=>{});
 await writeFile(join(source,'index.js'),'current');const current=await checkpoint(source,checkpoints,()=>{});
 const result=await prepare(source,checkpoints,candidates,current.sha256,old.sha256,()=>{});
 assert.equal(await readFile(join(result.candidate.directory,'index.js'),'utf8'),'old');assert.equal(await readFile(join(source,'index.js'),'utf8'),'current');const journal=JSON.parse(await readFile(join(candidates,'journals',result.journalId+'.json'),'utf8'));assert.equal(journal.state,'prepared');assert.equal(journal.beforeSha256,current.sha256);assert.equal(journal.targetSha256,old.sha256);assert.equal(journal.candidate,result.candidate.directory);assert.equal(result.before.sha256,current.sha256);assert.equal(await readFile(join(checkpoints,current.sha256,'index.js'),'utf8'),'current');
 assert.equal((await inspect(source,checkpoints,candidates,result.journalId,()=>{})).state,'prepared');
 await writeFile(join(source,'index.js'),'new edits');assert.equal((await inspect(source,checkpoints,candidates,result.journalId,()=>{})).state,'source-changed');
 await writeFile(join(result.candidate.directory,'index.js'),'tampered');await assert.rejects(inspect(source,checkpoints,candidates,result.journalId,()=>{}),/restore-candidate-corrupt/);
 await assert.rejects(prepare(source,checkpoints,candidates,current.sha256,old.sha256,()=>{}),/source-revision-conflict/);assert.equal((await readdir(candidates)).filter(name=>name.startsWith('candidate-')).length,1);assert.equal(await readFile(join(source,'index.js'),'utf8'),'new edits');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('edits during candidate preparation are preserved and invalidate the candidate',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'source-recovery-edits-')));
 try{
  const source=join(root,'source'),checkpoints=join(root,'checkpoints'),candidates=join(root,'candidates');await mkdir(source);await writeFile(join(source,'index.js'),'old');const old=await checkpoint(source,checkpoints,()=>{});await writeFile(join(source,'index.js'),'current');const current=await checkpoint(source,checkpoints,()=>{});
  const {existsSync,readdirSync,writeFileSync}=require('node:fs');let modified=false;
  const guard=()=>{if(!modified&&existsSync(candidates)&&readdirSync(candidates).some(name=>name.startsWith('candidate-'))){modified=true;writeFileSync(join(source,'index.js'),'concurrent edits');}};
  await assert.rejects(prepare(source,checkpoints,candidates,current.sha256,old.sha256,guard),/source-revision-conflict/);
  assert.equal(modified,true);assert.deepEqual((await readdir(candidates)).filter(name=>name.startsWith('candidate-')),[]);assert.equal(await readFile(join(source,'index.js'),'utf8'),'concurrent edits');assert.equal(await readFile(join(checkpoints,current.sha256,'index.js'),'utf8'),'current');
 }finally{await rm(root,{recursive:true,force:true});}
});
