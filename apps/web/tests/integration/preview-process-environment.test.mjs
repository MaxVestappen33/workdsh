import test from 'node:test';import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join,delimiter} from 'node:path';import {fileURLToPath} from 'node:url';
import {previewProcessEnvironment} from '../../scripts/preview-process-environment.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
test('native preview children resolve the workspace pnpm even with a foreign pnpm first in inherited PATH',async()=>{
 const foreign=await mkdtemp(join(tmpdir(),'workdsh-foreign-pnpm-'));
 try{
  await writeFile(join(foreign,'pnpm'),'#!/bin/sh\necho 11.0.0\n',{mode:0o700});
  const original={...process.env,PATH:foreign+delimiter+process.env.PATH};
  const env=previewProcessEnvironment(root,original);
  const before=await promisify(execFile)('pnpm',['--version'],{env:original,cwd:root});assert.equal(before.stdout.trim(),'11.0.0');
  const after=await promisify(execFile)('pnpm',['--version'],{env,cwd:root});assert.equal(after.stdout.trim(),'10.34.5');assert.equal(original.PATH.startsWith(foreign),true);
 }finally{await rm(foreign,{recursive:true,force:true});}
});
test('mismatched workspace pnpm fails before launching instead of changing a Profile store',async()=>{
 const fixture=await mkdtemp(join(tmpdir(),'workdsh-pnpm-mismatch-'));
 try{
  await mkdir(join(fixture,'node_modules/pnpm'),{recursive:true});
  await writeFile(join(fixture,'package.json'),JSON.stringify({packageManager:'pnpm@10.34.5'}));await writeFile(join(fixture,'node_modules/pnpm/package.json'),JSON.stringify({version:'11.0.0'}));
  assert.throws(()=>previewProcessEnvironment(fixture),/does not match/);
 }finally{await rm(fixture,{recursive:true,force:true});}
});
