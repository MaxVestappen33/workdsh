import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';import {mkdtemp,writeFile,realpath,rm,symlink} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {randomUUID} from 'node:crypto';
const require=createRequire(new URL('../../../../apps/web/package.json',import.meta.url));const built=await require('esbuild').build({entryPoints:[fileURLToPath(new URL('../src/runtime/source-recovery-journal.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false});const {writeSourceRecoveryJournal:write,readSourceRecoveryJournal:read}=await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
test('journal reread checks source ownership, candidate containment, corrupt bytes and links',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'recovery-journal-')));
 try{
  const directory=join(root,'journals'),id=randomUUID(),source=join(root,'source'),value={schemaVersion:1,id,source,beforeSha256:'a'.repeat(64),targetSha256:'b'.repeat(64),state:'prepared',candidate:join(root,'candidate-'+randomUUID())};
  await write(directory,value,()=>{});assert.deepEqual(await read(directory,id,source,()=>{}),value);
  await assert.rejects(read(directory,id,join(root,'foreign'),()=>{}),/invalid-recovery-journal/);
  const path=join(directory,id+'.json');for(const bad of [{...value,candidate:'/tmp/candidate-'+randomUUID()},{...value,token:'private'}]){await writeFile(path,JSON.stringify(bad));await assert.rejects(read(directory,id,source,()=>{}),/invalid-recovery-journal/);}
  await writeFile(path,'{broken');await assert.rejects(read(directory,id,source,()=>{}),/invalid-recovery-journal/);
  await rm(path);await writeFile(join(root,'outside'),JSON.stringify(value));await symlink(join(root,'outside'),path);await assert.rejects(read(directory,id,source,()=>{}),/invalid-recovery-journal/);
 }finally{await rm(root,{recursive:true,force:true});}
});
