import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir,mkdtemp,rm,link,cp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {patchNativeWorkbenchFrame,ensureNativeWorkbenchFrame,verifyNativeWorkbenchFrame} from '../../scripts/native-workbench-frame-patch.mjs';
const require=createRequire(new URL('../../../../packages/plugins/quality-analysis/package.json',import.meta.url));
const manifestPath=require.resolve('@deepseek-ai/dsh-client-ui-conversation/package.json');
const source=await readFile(join(dirname(manifestPath),'lib/client.js'),'utf8');
test('authorized rc.2 seam preserves the native subtree and refuses unknown bytes',async()=>{
 assert.equal(JSON.parse(await readFile(manifestPath,'utf8')).version,'0.2.1-rc.2');
 const patched=patchNativeWorkbenchFrame(source);
 assert.notEqual(patched,source);assert.equal(patchNativeWorkbenchFrame(patched),patched);
 assert.match(patched,/const conversation = renderSlot\("main.conversation", \{\}\)/);
 assert.throws(()=>patchNativeWorkbenchFrame(source+'\n'),/unsupported runtime bytes/);
});
test('local copy applies idempotently, rolls back exactly and rejects unknown versions',async()=>{
 const profile=await mkdtemp(join(tmpdir(),'workdsh-frame-guard-'));
 const pkg=join(profile,'node_modules/@deepseek-ai/dsh-client-ui-conversation');
 try{
  await mkdir(join(pkg,'lib'),{recursive:true});await writeFile(join(profile,'package.json'),'{}');
  const manifest=JSON.parse(await readFile(manifestPath,'utf8'));
  await writeFile(join(pkg,'package.json'),JSON.stringify(manifest));await writeFile(join(pkg,'lib/client.js'),source);
  const untouched=join(profile,'other-profile-original.js');await link(join(pkg,'lib/client.js'),untouched);
  await assert.rejects(verifyNativeWorkbenchFrame(profile),/adapter is missing/);
  await ensureNativeWorkbenchFrame(profile);assert.equal(await readFile(join(pkg,'lib/client.js'),'utf8'),patchNativeWorkbenchFrame(source));
  const verified=await verifyNativeWorkbenchFrame(profile);
  assert.equal(verified.version,'0.2.1-rc.2');assert.equal(verified.sha256,'aafebc0109b8d60eb1e1b5e1f3a686c72b86eaf7a3dae8fdd699e1756debc80f');
  assert.equal(await readFile(untouched,'utf8'),source,'other hardlinked installations must remain unmodified');
  await ensureNativeWorkbenchFrame(profile);await ensureNativeWorkbenchFrame(profile,{rollback:true});
  assert.equal(await readFile(join(pkg,'lib/client.js'),'utf8'),source);
  await assert.rejects(verifyNativeWorkbenchFrame(profile),/adapter is missing/);
  await writeFile(join(pkg,'package.json'),JSON.stringify({...manifest,version:'0.2.1-rc.1'}));
  await assert.rejects(ensureNativeWorkbenchFrame(profile),/version mismatch/);
  await assert.rejects(verifyNativeWorkbenchFrame(profile),/version mismatch/);
  assert.equal(await readFile(join(pkg,'lib/client.js'),'utf8'),source,'identical rc.1 bytes do not bypass the exact rc.2 package-version guard');
  await writeFile(join(pkg,'package.json'),JSON.stringify({...manifest,version:'0.0.0-unknown'}));
  await assert.rejects(ensureNativeWorkbenchFrame(profile),/version mismatch/);
  assert.equal(await readFile(join(pkg,'lib/client.js'),'utf8'),source);
 }finally{await rm(profile,{recursive:true,force:true});}
});
test('packaged verification reads copied Resources bytes and refuses missing, changed or mismatched adapters',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'workdsh-packaged-frame-'));
 const sourceProfile=join(directory,'build/profile');
 const pkg=join(sourceProfile,'node_modules/@deepseek-ai/dsh-client-ui-conversation');
 const packaged=join(directory,'WorkDSH.app/Contents/Resources/workdsh-runtime/profiles/workdsh');
 try{
  await mkdir(join(pkg,'lib'),{recursive:true});await writeFile(join(sourceProfile,'package.json'),'{}');
  const manifest=JSON.parse(await readFile(manifestPath,'utf8'));
  await writeFile(join(pkg,'package.json'),JSON.stringify(manifest));await writeFile(join(pkg,'lib/client.js'),source);
  await ensureNativeWorkbenchFrame(sourceProfile);await mkdir(dirname(packaged),{recursive:true});await cp(sourceProfile,packaged,{recursive:true});
  assert.deepEqual(await verifyNativeWorkbenchFrame(packaged),await verifyNativeWorkbenchFrame(sourceProfile));
  const copied=join(packaged,'node_modules/@deepseek-ai/dsh-client-ui-conversation');
  await writeFile(join(copied,'lib/client.js'),source);
  await assert.rejects(verifyNativeWorkbenchFrame(packaged),/adapter is missing/);
  await writeFile(join(copied,'lib/client.js'),patchNativeWorkbenchFrame(source)+'\n');
  await assert.rejects(verifyNativeWorkbenchFrame(packaged),/unsupported packaged runtime bytes/);
  assert.equal((await verifyNativeWorkbenchFrame(sourceProfile)).sha256,'aafebc0109b8d60eb1e1b5e1f3a686c72b86eaf7a3dae8fdd699e1756debc80f','unchanged source receipts cannot hide a changed installer copy');
  await writeFile(join(copied,'package.json'),JSON.stringify({...manifest,version:'0.2.1-unknown'}));
  await assert.rejects(verifyNativeWorkbenchFrame(packaged),/version mismatch/);
 }finally{await rm(directory,{recursive:true,force:true});}
});
