import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';import {mkdtemp,mkdir,writeFile,realpath,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {createHash} from 'node:crypto';
const require=createRequire(new URL('../../../../apps/web/package.json',import.meta.url));const built=await require('esbuild').build({entryPoints:[fileURLToPath(new URL('../src/runtime/source-checkpoint-catalog.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false});const {listSourceCheckpoints:list}=await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
test('catalog returns bounded metadata, not source bytes or paths, and rejects corrupt manifest',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'checkpoint-list-')));
 try{const manifest=JSON.stringify({schemaVersion:1,files:[{path:'index.js',bytes:3,sha256:'a'.repeat(64)}]}),hash=createHash('sha256').update(manifest).digest('hex'),dir=join(root,hash);await mkdir(dir);await writeFile(join(dir,'.workdsh-checkpoint.json'),manifest);
 assert.deepEqual(await list(root,()=>{}),[{sha256:hash,fileCount:1,byteLength:3,verified:false}]);await writeFile(join(dir,'.workdsh-checkpoint.json'),'{}');await assert.rejects(list(root,()=>{}),/checkpoint-corrupt/);
 }finally{await rm(root,{recursive:true,force:true});}
});
