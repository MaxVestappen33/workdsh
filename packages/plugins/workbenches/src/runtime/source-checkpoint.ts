import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readdir,realpath,lstat,open,writeFile,rename,rm,readFile} from 'node:fs/promises';
import {constants} from 'node:fs';import {join,relative,isAbsolute,sep} from 'node:path';
const excludedDirectories=['node_modules','.git','dist','.workdsh-npm-cache','.workdsh-pnpm-store'];
/** Source files only; not a live business database backup. */
export async function checkpointWorkbenchSource(source:string,destination:string,authorize:()=>void,signal?:AbortSignal){
 const check=()=>{signal?.throwIfAborted();authorize();signal?.throwIfAborted();};check();
 const root=await realpath(source);if(root!==source)throw Error('workbench/source-directory-outside');
 const nesting=relative(root,destination);if(!isAbsolute(destination))throw Error('workbench/checkpoint-directory-outside');if(!nesting||(!nesting.startsWith('..'+sep)&&nesting!=='..'&&!isAbsolute(nesting)))throw Error('workbench/checkpoint-inside-source');
 await mkdir(destination,{recursive:true,mode:0o700});if(await realpath(destination)!==destination)throw Error('workbench/checkpoint-directory-outside');
 const staging=join(destination,'.pending-'+randomUUID());await mkdir(staging,{mode:0o700});
 const entries:{path:string;bytes:number;sha256:string}[]=[];let total=0,directories=0;
 async function walk(relative:string){
  if(++directories>2000||relative.split('/').length>32)throw Error('workbench/source-checkpoint-limit');
  check();const directory=join(root,relative);if(await realpath(directory)!==directory)throw Error('workbench/source-directory-outside');
  for(const entry of (await readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)){
   if(excludedDirectories.includes(entry.name))continue;
   if(entry.name==='.workdsh-checkpoint.json')throw Error('workbench/source-reserved-name');
   check();const name=relative?relative+'/'+entry.name:entry.name,path=join(root,name);
   if(entry.isSymbolicLink())throw Error('workbench/source-link-unsupported');
   if(entry.isDirectory()){await mkdir(join(staging,name),{recursive:true,mode:0o700});await walk(name);continue;}
   if(!entry.isFile()||entries.length>=2000)throw Error('workbench/source-checkpoint-limit');
   const before=await lstat(path);if(!before.isFile()||before.size>16*1024*1024||total+before.size>64*1024*1024)throw Error('workbench/source-checkpoint-limit');
   const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);let bytes:Buffer;
   try{const stat=await handle.stat();if(stat.ino!==before.ino||stat.size!==before.size)throw Error('workbench/source-changed');bytes=Buffer.alloc(before.size+1);let offset=0;while(offset<bytes.length){const part=await handle.read(bytes,offset,bytes.length-offset,offset);if(!part.bytesRead)break;offset+=part.bytesRead;}const after=await handle.stat();if(offset!==before.size||after.mtimeMs!==stat.mtimeMs||after.size!==stat.size)throw Error('workbench/source-changed');bytes=bytes.subarray(0,offset);}finally{await handle.close();}
   check();total+=bytes.length;await writeFile(join(staging,name),bytes,{flag:'wx',mode:0o600});entries.push({path:name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
  }
 }
 async function verifySource(){
  const expected=new Map(entries.map(entry=>[entry.path,entry]));let seen=0,visited=0;
  async function scan(relative:string){
   check();if(++visited>2000||relative.split('/').length>32)throw Error('workbench/source-checkpoint-limit');
   const directory=join(root,relative);if(await realpath(directory)!==directory)throw Error('workbench/source-changed');
   for(const item of await readdir(directory,{withFileTypes:true})){
    if(excludedDirectories.includes(item.name))continue;
    const name=relative?relative+'/'+item.name:item.name;
    if(item.isDirectory()){await scan(name);continue;}
    const entry=expected.get(name);if(!entry||!item.isFile())throw Error('workbench/source-changed');
    const handle=await open(join(root,name),constants.O_RDONLY|constants.O_NOFOLLOW);
    try{
     const before=await handle.stat();if(!before.isFile()||before.size!==entry.bytes)throw Error('workbench/source-changed');
     const bytes=Buffer.alloc(entry.bytes+1);let length=0;while(length<bytes.length){const part=await handle.read(bytes,length,bytes.length-length,length);if(!part.bytesRead)break;length+=part.bytesRead;}
     const after=await handle.stat();if(length!==entry.bytes||after.size!==before.size||after.mtimeMs!==before.mtimeMs||createHash('sha256').update(bytes.subarray(0,length)).digest('hex')!==entry.sha256)throw Error('workbench/source-changed');
    }finally{await handle.close();}
    seen++;
   }
  }
  await scan('');if(seen!==entries.length)throw Error('workbench/source-changed');check();
 }
 try{
  await walk('');check();await verifySource();const manifest={schemaVersion:1,excludes:excludedDirectories,files:entries};
  const hash=createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
  await writeFile(join(staging,'.workdsh-checkpoint.json'),JSON.stringify(manifest),{flag:'wx',mode:0o600});check();const directory=join(destination,hash);
  try{await rename(staging,directory);}catch(cause){
   if(!(cause instanceof Error)||!('code' in cause)||!['EEXIST','ENOTEMPTY'].includes(String(cause.code)))throw cause;
   check();if(await realpath(directory)!==directory)throw Error('workbench/checkpoint-corrupt');
   const metadata=await readFile(join(directory,'.workdsh-checkpoint.json'),'utf8');
   if(metadata!==JSON.stringify(manifest))throw Error('workbench/checkpoint-corrupt');
   for(const entry of entries){check();const path=join(directory,entry.path);if(await realpath(path)!==path)throw Error('workbench/checkpoint-corrupt');const stat=await lstat(path);if(!stat.isFile()||stat.size!==entry.bytes)throw Error('workbench/checkpoint-corrupt');const bytes=await readFile(path);if(createHash('sha256').update(bytes).digest('hex')!==entry.sha256)throw Error('workbench/checkpoint-corrupt');}
  }
  return Object.freeze({directory,sha256:hash,fileCount:entries.length,byteLength:total});
 }finally{await rm(staging,{recursive:true,force:true});}
}
