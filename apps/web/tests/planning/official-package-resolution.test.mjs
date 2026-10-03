import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {resolveLockedOfficialPackage} from '../../scripts/official-web-clients.mjs';

test('resolve official dependency from a shortened store directory and reject wrong versions',async()=>{
 const root=mkdtempSync(join(tmpdir(),'official-resolution-'));
 try{
  const store=join(root,'node_modules','.pnpm','short-hashed-store','node_modules');
  const dsh=join(store,'@deepseek-ai','dsh');const base=join(store,'@deepseek-ai','dsh-base');
  for(const path of [dsh,base])mkdirSync(path,{recursive:true});
  writeFileSync(join(root,'package.json'),'{}');
  writeFileSync(join(dsh,'package.json'),JSON.stringify({name:'@deepseek-ai/dsh',version:'0.2.0-rc.2'}));
  writeFileSync(join(base,'package.json'),JSON.stringify({name:'@deepseek-ai/dsh-base',version:'0.2.0-rc.2'}));
  mkdirSync(join(root,'node_modules','@deepseek-ai'),{recursive:true});
  symlinkSync(dsh,join(root,'node_modules','@deepseek-ai','dsh'),'junction');
  const runtime=await resolveLockedOfficialPackage('@deepseek-ai/dsh','0.2.0-rc.2',[join(root,'package.json')]);
  const resolved=await resolveLockedOfficialPackage('@deepseek-ai/dsh-base','0.2.0-rc.2',[runtime.path]);
  assert.equal(resolved.manifest.name,'@deepseek-ai/dsh-base');
  await assert.rejects(resolveLockedOfficialPackage('@deepseek-ai/dsh-base','0.1.0',[runtime.path]),/version mismatch/);
  await assert.rejects(resolveLockedOfficialPackage('@deepseek-ai/dsh-missing','0.2.0-rc.2',[runtime.path]),/Install the locked/);
 }finally{rmSync(root,{recursive:true,force:true})}
});
