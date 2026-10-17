import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir,mkdtemp,rm,link} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {patchNativeWorkbenchFrame,ensureNativeWorkbenchFrame} from '../../scripts/native-workbench-frame-patch.mjs';
const require=createRequire(new URL('../../../../packages/plugins/quality-analysis/package.json',import.meta.url));
const manifestPath=require.resolve('@deepseek-ai/dsh-client-ui-conversation/package.json');
const source=await readFile(join(dirname(manifestPath),'lib/client.js'),'utf8');
test('authorized rc.1 seam preserves the native subtree and refuses unknown bytes',()=>{
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
  await ensureNativeWorkbenchFrame(profile);assert.equal(await readFile(join(pkg,'lib/client.js'),'utf8'),patchNativeWorkbenchFrame(source));
  assert.equal(await readFile(untouched,'utf8'),source,'other hardlinked installations must remain unmodified');
  await ensureNativeWorkbenchFrame(profile);await ensureNativeWorkbenchFrame(profile,{rollback:true});
  assert.equal(await readFile(join(pkg,'lib/client.js'),'utf8'),source);
  await writeFile(join(pkg,'package.json'),JSON.stringify({...manifest,version:'0.0.0-unknown'}));
  await assert.rejects(ensureNativeWorkbenchFrame(profile),/version mismatch/);
  assert.equal(await readFile(join(pkg,'lib/client.js'),'utf8'),source);
 }finally{await rm(profile,{recursive:true,force:true});}
});
