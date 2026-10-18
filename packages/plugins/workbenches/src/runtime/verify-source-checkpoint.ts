import {open,realpath} from 'node:fs/promises';import {constants} from 'node:fs';import {join} from 'node:path';import {createHash} from 'node:crypto';
/** Checks every declared byte before recovery. No write to current source. */
export async function verifySourceCheckpoint(directory:string,sha256:string,authorize:()=>void,signal?:AbortSignal,onVerifiedFile?:(path:string,bytes:Buffer)=>Promise<void>){
 const check=()=>{signal?.throwIfAborted();authorize();signal?.throwIfAborted();};check();
 if(!/^[a-f0-9]{64}$/.test(sha256))throw Error('workbench/checkpoint-invalid');
 if(await realpath(directory)!==directory)throw Error('workbench/checkpoint-directory-outside');const root=join(directory,sha256);
 if(await realpath(root)!==root)throw Error('workbench/checkpoint-corrupt');
 async function read(path:string,limit:number){
  check();if(await realpath(path)!==path)throw Error('workbench/checkpoint-corrupt');
  const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{const before=await handle.stat();if(!before.isFile()||before.size>limit)throw Error('workbench/checkpoint-corrupt');const bytes=Buffer.alloc(before.size+1);let length=0;while(length<bytes.length){const part=await handle.read(bytes,length,bytes.length-length,length);if(!part.bytesRead)break;length+=part.bytesRead;}const after=await handle.stat();if(length!==before.size||before.size!==after.size||before.mtimeMs!==after.mtimeMs)throw Error('workbench/checkpoint-corrupt');check();return bytes.subarray(0,length);}finally{await handle.close();}
 }
 const metadata=await read(join(root,'.workdsh-checkpoint.json'),1024*1024);
 if(createHash('sha256').update(metadata).digest('hex')!==sha256)throw Error('workbench/checkpoint-corrupt');
 const manifest=JSON.parse(metadata.toString('utf8'));
 if(manifest.schemaVersion!==1||!Array.isArray(manifest.files)||manifest.files.length>2000)throw Error('workbench/checkpoint-corrupt');
 let byteLength=0;const paths=new Set<string>();
 for(const file of manifest.files){
  check();if(!file||typeof file!=='object'||Object.keys(file).length!==3||Object.keys(file).some(key=>!['path','bytes','sha256'].includes(key))||typeof file.path!=='string'||!file.path||file.path.length>4096||/[\\:\u0000-\u001f]/.test(file.path)||file.path.split('/').some((part:string)=>!part||part==='.'||part==='..')||paths.has(file.path)||!Number.isSafeInteger(file.bytes)||file.bytes<0||file.bytes>16*1024*1024||typeof file.sha256!=='string'||!/^[a-f0-9]{64}$/.test(file.sha256))throw Error('workbench/checkpoint-corrupt');
  paths.add(file.path);byteLength+=file.bytes;if(byteLength>64*1024*1024)throw Error('workbench/checkpoint-corrupt');
  const bytes=await read(join(root,file.path),16*1024*1024);if(bytes.length!==file.bytes||createHash('sha256').update(bytes).digest('hex')!==file.sha256)throw Error('workbench/checkpoint-corrupt');
  if(onVerifiedFile){check();await onVerifiedFile(file.path,bytes);check();}
 }
 check();return Object.freeze({sha256,fileCount:manifest.files.length,byteLength,verified:true as const});
}
