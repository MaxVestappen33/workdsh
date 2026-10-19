import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, symlink, readdir, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const { build } = createRequire(new URL('../../../../apps/web/package.json', import.meta.url))('esbuild');
const built = await build({ entryPoints: [fileURLToPath(new URL('../src/runtime/prepare-development-source.ts', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false, alias: { 'workdsh-contracts': fileURLToPath(new URL('../../../contracts/src/index.ts', import.meta.url)) } });
const { prepareWorkbenchDevelopmentSource: prepare } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const development = { id: 'dev-1', packageName: 'quality-workbench', workbenchId: 'techflag.quality-analysis', owner: { organizationId: 'personal', ownerPrincipalId: 'user-1' }, target: { hostId: 'host-1' } };
const descriptor = { id: development.workbenchId, title: '质量分析', description: '', protocolVersion: '1.0', layout: 'full-page', hostCompatibility: { sdk: '^1.0.0', harness: '0.2.1-rc.1' }, capabilities: [] };
test('source preparation is repeatable, preserves developer edits and separates ownership', async () => {
 const root = await mkdtemp(join(tmpdir(), 'workbench-source-'));
 try {
  const first = await prepare(root, development, descriptor, () => {});
  const path = join(first.directory, 'package.json');
  const manifest = JSON.parse(await readFile(path, 'utf8')); manifest.scripts = { build: 'developer-command' };
  const edited = JSON.stringify(manifest); await writeFile(path, edited);
  const next = await prepare(root, development, descriptor, () => {});
  assert.equal(next.directory, first.directory); assert.equal(await readFile(path, 'utf8'), edited);
  assert.notEqual(next.metadataSha256, first.metadataSha256);
  const other = await prepare(root, { ...development, owner: { ...development.owner, ownerPrincipalId: 'user-2' } }, descriptor, () => {});
  assert.notEqual(other.directory, first.directory);
 } finally { await rm(root, { recursive: true, force: true }); }
});
test('rejects oversized, foreign and linked manifests without overwriting them', async () => {
 const root = await mkdtemp(join(tmpdir(), 'workbench-source-'));
 try {
  const { directory } = await prepare(root, development, descriptor, () => {}); const path = join(directory, 'package.json');
  await writeFile(path, 'x'.repeat(256 * 1024 + 1)); await assert.rejects(prepare(root, development, descriptor, () => {}), /source-package-invalid/);
  await writeFile(path, JSON.stringify({ name: 'foreign' })); await assert.rejects(prepare(root, development, descriptor, () => {}), /source-identity-mismatch/);
  await rm(path); const outside = join(root, 'outside.json'); await writeFile(outside, '{}'); await symlink(outside, path);
  await assert.rejects(prepare(root, development, descriptor, () => {}), /source-metadata-outside/); assert.equal(await readFile(outside, 'utf8'), '{}');
 } finally { await rm(root, { recursive: true, force: true }); }
});

test('existing source cannot be redirected and rejection creates no replacement directory', async () => {
 const root = await mkdtemp(join(tmpdir(), 'workbench-source-'));
 try {
  await assert.rejects(prepare(root, { ...development, source: { hostId: development.target.hostId, directory: '/different/source', revision: 'old' } }, descriptor, () => {}), /source-identity-mismatch/);
  assert.deepEqual(await readdir(root), []);
 } finally { await rm(root, { recursive: true, force: true }); }
});

test('cancelled first scaffold resumes missing files and preserves edits',async()=>{
 const root=await mkdtemp(join(tmpdir(),'workbench-source-'));
 try{
  const controller=new AbortController();let checks=0;
  await assert.rejects(prepare(root,development,descriptor,()=>{if(++checks===4)controller.abort();},controller.signal));
  const directory=join(root,(await readdir(root))[0]);
  await assert.rejects(readFile(join(directory,'package.json')),{code:'ENOENT'});
  await writeFile(join(directory,'index.js'),'// developer edit\n');
  const resumed=await prepare(root,development,descriptor,()=>{});
  assert.equal(resumed.directory,await realpath(directory));assert.equal(await readFile(join(directory,'index.js'),'utf8'),'// developer edit\n');
  for(const name of ['client.jsx','build.mjs','cordis.patch.yml','README.md','package.json'])assert.ok((await readFile(join(directory,name))).length);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('concurrent initial preparation publishes complete files without temporary leftovers',async()=>{
 const root=await mkdtemp(join(tmpdir(),'workbench-source-'));
 try{
  const [first,second]=await Promise.all([prepare(root,development,descriptor,()=>{}),prepare(root,development,descriptor,()=>{})]);
  assert.equal(first.directory,second.directory);assert.equal(first.metadataSha256,second.metadataSha256);
  const files=await readdir(first.directory);assert.equal(files.some(name=>name.startsWith('.workdsh-new-')),false);
  const manifest=JSON.parse(await readFile(join(first.directory,'package.json'),'utf8'));
  assert.equal(manifest.name,development.packageName);assert.ok((await readFile(join(first.directory,'client.jsx'),'utf8')).includes('registerManaged'));
 }finally{await rm(root,{recursive:true,force:true});}
});

test('a bound source missing its manifest or directory is never recreated as a starter',async()=>{
 const root=await mkdtemp(join(tmpdir(),'workbench-missing-bound-source-'));
 try{
  const first=await prepare(root,development,descriptor,()=>{}),bound={...development,source:{hostId:'host-1',directory:first.directory,revision:'existing'}};
  const manifest=join(first.directory,'package.json');await rm(manifest);
  await assert.rejects(prepare(root,bound,descriptor,()=>{}),/development-source-unavailable/);
  assert.equal((await readdir(first.directory)).includes('package.json'),false);
  await rm(first.directory,{recursive:true});
  await assert.rejects(prepare(root,bound,descriptor,()=>{}),/development-source-unavailable/);
  assert.deepEqual(await readdir(root),[]);
 }finally{await rm(root,{recursive:true,force:true});}
});
