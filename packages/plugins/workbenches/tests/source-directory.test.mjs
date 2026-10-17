import test from 'node:test';import assert from 'node:assert/strict';
import {createRequire} from 'node:module';import {realpathSync} from 'node:fs';
import {mkdtemp,mkdir,writeFile,symlink,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {fileURLToPath,pathToFileURL} from 'node:url';
const web=createRequire(new URL('../../../../apps/web/package.json',import.meta.url));const runtime=createRequire(realpathSync(fileURLToPath(new URL('../../../../apps/web/node_modules/@deepseek-ai/dsh/package.json',import.meta.url))));
const {build}=web('esbuild');const r=await build({entryPoints:[fileURLToPath(new URL('../src/runtime/source-directory.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false});
const {verifyWorkbenchSourceDirectory}=await import(`data:text/javascript;base64,${Buffer.from(r.outputFiles[0].text).toString('base64')}`);
const {Context}=await import(pathToFileURL(runtime.resolve('@deepseek-ai/cordis')).href);const {LocalFileSystem}=await import(pathToFileURL(runtime.resolve('@deepseek-ai/dsh-fs-local')).href);
test('actual official filesystem verifies source identity and rejects escaping metadata and revoked access',async()=>{
 const root=await mkdtemp(join(tmpdir(),'workdsh-source-dir-')),ctx=new Context();
 try{
  const source=join(root,'source');await mkdir(source);await ctx.plugin(LocalFileSystem,{cwd:root});
  const development={packageName:'quality-plugin',workbenchId:'company.quality'};
  const metadata={name:'quality-plugin',workdsh:{workbench:{id:'company.quality'}}};
  await writeFile(join(source,'package.json'),JSON.stringify(metadata));
  let reads=0;const authorize=async()=>{reads++;};
  assert.equal(await verifyWorkbenchSourceDirectory(ctx.fs,source,development,authorize),await ctx.fs.processPath(await ctx.fs.resolve(source)));assert.equal(reads,4);
  await assert.rejects(verifyWorkbenchSourceDirectory(ctx.fs,source,development,async()=>{throw new Error('denied');}),/denied/);
  await writeFile(join(source,'package.json'),JSON.stringify({...metadata,name:'different'}));await assert.rejects(verifyWorkbenchSourceDirectory(ctx.fs,source,development,authorize),/source-identity-mismatch/);
  await writeFile(join(source,'package.json'),JSON.stringify(metadata));
  let checks=0;
  await assert.rejects(verifyWorkbenchSourceDirectory(ctx.fs,source,development,async()=>{if(++checks===4) await writeFile(join(source,'package.json'),JSON.stringify({...metadata,name:'changed-during-authorization'}));}),/source-changed/);
  await writeFile(join(source,'package.json'),JSON.stringify(metadata));
  checks=0;
  await writeFile(join(root,'replacement.json'),JSON.stringify(metadata));
  await assert.rejects(verifyWorkbenchSourceDirectory(ctx.fs,source,development,async()=>{if(++checks===4){await rm(join(source,'package.json'));await symlink(join(root,'replacement.json'),join(source,'package.json'));}}),/source-changed/);
  await rm(join(source,'package.json'));await writeFile(join(root,'outside.json'),JSON.stringify(metadata));await symlink(join(root,'outside.json'),join(source,'package.json'));
  await assert.rejects(verifyWorkbenchSourceDirectory(ctx.fs,source,development,authorize),/source-metadata-outside/);
 }finally{await ctx.fiber.dispose();await rm(root,{recursive:true,force:true});}
});
