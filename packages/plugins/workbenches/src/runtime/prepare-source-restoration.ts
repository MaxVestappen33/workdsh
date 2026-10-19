import {mkdir,realpath,writeFile,rename,rm,open} from 'node:fs/promises';
import {join,dirname,isAbsolute} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {verifySourceCheckpoint} from './verify-source-checkpoint.js';
/** Internal Host-owned destination only. Produces a candidate; never swaps live source. */
export async function prepareSourceRestoration(checkpoints:string,sha256:string,destination:string,authorize:()=>void,signal?:AbortSignal){
 const check=()=>{signal?.throwIfAborted();authorize();signal?.throwIfAborted();};check();
 if(!isAbsolute(destination))throw Error('workbench/restore-directory-outside');
 await mkdir(destination,{recursive:true,mode:0o700});check();
 if(await realpath(destination)!==destination)throw Error('workbench/restore-directory-outside');
 const id=randomUUID(),staging=join(destination,'.pending-'+id),candidate=join(destination,'candidate-'+id);
 await mkdir(staging,{mode:0o700});
 const files:{path:string;bytes:number;sha256:string}[]=[];
 try{
  const receipt=await verifySourceCheckpoint(checkpoints,sha256,authorize,signal,async(path,bytes)=>{
   check();if(path.split('/').includes('.workdsh-checkpoint.json'))throw Error('workbench/source-reserved-name');
   const target=join(staging,path);await mkdir(dirname(target),{recursive:true,mode:0o700});check();
   await writeFile(target,bytes,{flag:'wx',mode:0o600});files.push({path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});check();
  });
  for(const file of files){
   check();const path=join(staging,file.path);
   if(await realpath(path)!==path)throw Error('workbench/restore-candidate-corrupt');
   const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
   try{
    const before=await handle.stat();if(!before.isFile()||before.size!==file.bytes)throw Error('workbench/restore-candidate-corrupt');
    const bytes=Buffer.alloc(file.bytes+1);let length=0;
    while(length<bytes.length){check();const part=await handle.read(bytes,length,bytes.length-length,length);if(!part.bytesRead)break;length+=part.bytesRead;}
    const after=await handle.stat();
    if(length!==file.bytes||after.size!==before.size||after.mtimeMs!==before.mtimeMs||createHash('sha256').update(bytes.subarray(0,length)).digest('hex')!==file.sha256)throw Error('workbench/restore-candidate-corrupt');
   }finally{await handle.close();}
  }
  check();await rename(staging,candidate);return Object.freeze({directory:candidate,...receipt});
 }finally{await rm(staging,{recursive:true,force:true});}
}
