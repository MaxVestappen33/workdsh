import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {join,basename} from 'node:path';
import {randomUUID} from 'node:crypto';
/** Retain immutable verified installation assets; do not remove prior optional plugins. */
export async function retainWorkbenchArchives(profile,directory,items){
 const target=join(profile,'workdsh-bootstrap-archives');
 const verified=[];
 for(const item of items){
  if(!item.workbenchId)continue;
  if(typeof item.filename!=='string'||basename(item.filename)!==item.filename||!item.filename.endsWith('.tgz'))throw new Error('Invalid workbench archive filename');
  const bytes=await readFile(join(directory,item.filename));
  if(createHash('sha256').update(bytes).digest('hex')!==item.sha256)throw new Error('Workbench archive checksum mismatch');
  verified.push({item,bytes});
 }
 if(!verified.length)return;
 await mkdir(target,{recursive:true});
 let index={version:1,entries:[]};
 try{index=JSON.parse(await readFile(join(target,'index.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
 if(index.version!==1||!Array.isArray(index.entries))throw new Error('Unsupported workbench archive index');
 for(const {item,bytes} of verified){
  const fileName=`workbench-${item.sha256}.tgz`;
  const path=join(target,fileName);
  try{const old=await readFile(path);if(!old.equals(bytes))throw new Error('Immutable workbench archive conflict');}
  catch(error){if(error.code!=='ENOENT')throw error;await writeFile(path,bytes,{flag:'wx'});}
  const entry={fileName,packageName:item.name,version:item.version,workbenchId:item.workbenchId,sha256:item.sha256};
  const old=index.entries.find(row=>row.fileName===entry.fileName);
  if(old&&JSON.stringify(old)!==JSON.stringify(entry))throw new Error('Workbench archive index conflict');
  // Only the currently installed version is bootstrapped; older files stay immutable.
  index.entries=index.entries.filter(row=>row.packageName!==entry.packageName);
  index.entries.push(entry);
 }
 const temporary=join(target,`index-${randomUUID()}.tmp`);
 await writeFile(temporary,JSON.stringify(index,null,2)+'\n',{flag:'wx'});
 await rename(temporary,join(target,'index.json'));
}
