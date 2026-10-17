import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';import {mkdtemp,mkdir,writeFile,realpath,rm,symlink} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {createHash} from 'node:crypto';
const require=createRequire(new URL('../../../../apps/web/package.json',import.meta.url));const built=await require('esbuild').build({entryPoints:[fileURLToPath(new URL('../src/runtime/verify-source-checkpoint.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false});const {verifySourceCheckpoint:verify}=await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);const digest=b=>createHash('sha256').update(b).digest('hex');
test('restore verification checks actual file bytes and refuses corruption or links',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'checkpoint-verify-')));
 try{const bytes='original',manifest=JSON.stringify({schemaVersion:1,files:[{path:'index.js',bytes:bytes.length,sha256:digest(bytes)}]}),hash=digest(manifest),dir=join(root,hash);await mkdir(dir);await writeFile(join(dir,'.workdsh-checkpoint.json'),manifest);await writeFile(join(dir,'index.js'),bytes);
 assert.deepEqual(await verify(root,hash,()=>{}),{sha256:hash,fileCount:1,byteLength:8,verified:true});await writeFile(join(dir,'index.js'),'modified');await assert.rejects(verify(root,hash,()=>{}),/checkpoint-corrupt/);await rm(join(dir,'index.js'));await symlink(join(root,'outside'),join(dir,'index.js'));await writeFile(join(root,'outside'),bytes);await assert.rejects(verify(root,hash,()=>{}),/checkpoint-corrupt/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('valid manifest hash cannot authorize a traversal path',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'checkpoint-verify-')));
 try{const manifest=JSON.stringify({schemaVersion:1,files:[{path:'../outside',bytes:0,sha256:digest('')}]}),hash=digest(manifest);await mkdir(join(root,hash));await writeFile(join(root,hash,'.workdsh-checkpoint.json'),manifest);await assert.rejects(verify(root,hash,()=>{}),/checkpoint-corrupt/);
 }finally{await rm(root,{recursive:true,force:true});}
});
