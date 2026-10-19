import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {retainWorkbenchArchives} from '../../scripts/retain-workbench-archives.mjs';
test('retained business archives survive optional omissions and reject altered archives',async()=>{
 const root=await mkdtemp(join(tmpdir(),'workdsh-archives-')),profile=join(root,'profile');
 try{
  const bytes=Buffer.from('quality package'),item={name:'quality',version:'1',filename:'quality-1.tgz',workbenchId:'company.quality',sha256:createHash('sha256').update(bytes).digest('hex')};
  await writeFile(join(root,item.filename),bytes);
  await retainWorkbenchArchives(profile,root,[item]);
  await retainWorkbenchArchives(profile,root,[]);
  await retainWorkbenchArchives(profile,root,[item]);
  const path=join(profile,'workdsh-bootstrap-archives','index.json'),prior=await readFile(path,'utf8');
  assert.equal(JSON.parse(prior).entries.length,1);
  await writeFile(join(root,item.filename),'tampered');
  await assert.rejects(retainWorkbenchArchives(profile,root,[item]),/checksum/);
  assert.equal(await readFile(path,'utf8'),prior);
  await assert.rejects(retainWorkbenchArchives(profile,root,[{...item,filename:'../bad.tgz'}]),/filename/);
  const repacked=Buffer.from('repacked quality package'),repackedItem={...item,sha256:createHash('sha256').update(repacked).digest('hex')};
  await writeFile(join(root,item.filename),repacked);
  await retainWorkbenchArchives(profile,root,[repackedItem]);
  assert.equal(JSON.parse(await readFile(path,'utf8')).entries[0].sha256,repackedItem.sha256);
  const updated={...item,version:'2',filename:'quality-2.tgz'};
  await writeFile(join(root,updated.filename),bytes);
  await retainWorkbenchArchives(profile,root,[updated]);
  const entries=JSON.parse(await readFile(path,'utf8')).entries;
  assert.equal(entries.length,1);assert.equal(entries[0].version,'2');
  assert.equal((await readFile(join(profile,'workdsh-bootstrap-archives',`workbench-${item.sha256}.tgz`))).toString(),bytes.toString());
 }finally{await rm(root,{recursive:true,force:true});}
});
