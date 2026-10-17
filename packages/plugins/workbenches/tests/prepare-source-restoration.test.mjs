import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';import {mkdtemp,mkdir,writeFile,readFile,readdir,realpath,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {createHash} from 'node:crypto';
const require=createRequire(new URL('../../../../apps/web/package.json',import.meta.url));const built=await require('esbuild').build({entryPoints:[fileURLToPath(new URL('../src/runtime/prepare-source-restoration.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false});const {prepareSourceRestoration:prepare}=await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);const hash=b=>createHash('sha256').update(b).digest('hex');
test('restoration candidate preserves verified bytes and refuses partial publication',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'source-restore-')));
 try{
 const checkpoints=join(root,'checkpoints'),destination=join(root,'candidates'),bytes='old source',metadata=JSON.stringify({schemaVersion:1,files:[{path:'src/index.js',bytes:bytes.length,sha256:hash(bytes)}]}),sha=hash(metadata),backup=join(checkpoints,sha);
 await mkdir(join(backup,'src'),{recursive:true});await writeFile(join(backup,'.workdsh-checkpoint.json'),metadata);await writeFile(join(backup,'src/index.js'),bytes);
 const candidate=await prepare(checkpoints,sha,destination,()=>{});assert.equal(await readFile(join(candidate.directory,'src/index.js'),'utf8'),bytes);assert.equal(candidate.verified,true);
 await writeFile(join(backup,'src/index.js'),'corrupt');await assert.rejects(prepare(checkpoints,sha,destination,()=>{}),/checkpoint-corrupt/);assert.deepEqual(await readdir(destination),[candidate.directory.split('/').at(-1)]);
 const controller=new AbortController();controller.abort();await assert.rejects(prepare(checkpoints,sha,destination,()=>{},controller.signal),/abort/i);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('cancellation, revoked authority and modified staging never publish a candidate',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'source-restore-fault-')));
 try{
  const checkpoints=join(root,'checkpoints'),destination=join(root,'candidates'),bytes='original',metadata=JSON.stringify({schemaVersion:1,files:[{path:'index.js',bytes:8,sha256:hash(bytes)}]}),sha=hash(metadata),backup=join(checkpoints,sha);
  await mkdir(backup,{recursive:true});await writeFile(join(backup,'.workdsh-checkpoint.json'),metadata);await writeFile(join(backup,'index.js'),bytes);
  // Authority callbacks remain synchronous, as in the Host identity guard.
  const {existsSync,readdirSync,writeFileSync}=require('node:fs');
  for(const mode of ['cancel','revoke','corrupt']){
   const controller=new AbortController();let fired=false;
   const guard=()=>{
    if(fired)return;
    const pending=existsSync(destination)&&readdirSync(destination).find(name=>name.startsWith('.pending-'));
    const file=pending&&join(destination,pending,'index.js');
    if(file&&existsSync(file)){fired=true;if(mode==='cancel')controller.abort();else if(mode==='revoke')throw Error('access-revoked');else writeFileSync(file,'modified');}
   };
   await assert.rejects(prepare(checkpoints,sha,destination,guard,controller.signal),mode==='cancel'?/abort/i:mode==='revoke'?/access-revoked/:/restore-candidate-corrupt/);
   assert.equal(fired,true);assert.deepEqual(await readdir(destination),[]);
  }
 }finally{await rm(root,{recursive:true,force:true});}
});
