import {readdir,realpath,open} from 'node:fs/promises';import {constants} from 'node:fs';import {join} from 'node:path';import {createHash} from 'node:crypto';
/** Directory must be derived by the authorized Host, never supplied by RPC. */
export async function listSourceCheckpoints(directory:string,authorize:()=>void,signal?:AbortSignal){
 const check=()=>{signal?.throwIfAborted();authorize();signal?.throwIfAborted();};check();
 let names:string[];try{if(await realpath(directory)!==directory)throw Error('workbench/checkpoint-directory-outside');names=await readdir(directory);}catch(cause){if(cause&&typeof cause==='object'&&'code' in cause&&cause.code==='ENOENT')return [];throw cause;}
 const hashes=names.filter(name=>/^[a-f0-9]{64}$/.test(name)).sort();if(hashes.length>2000)throw Error('workbench/checkpoint-catalog-limit');
 const result=[];
 for(const sha256 of hashes){
  check();const root=join(directory,sha256);if(await realpath(root)!==root)throw Error('workbench/checkpoint-corrupt');
  const handle=await open(join(root,'.workdsh-checkpoint.json'),constants.O_RDONLY|constants.O_NOFOLLOW);let bytes:Buffer;
  try{const stat=await handle.stat();if(!stat.isFile()||stat.size>1024*1024)throw Error('workbench/checkpoint-corrupt');const buffer=Buffer.alloc(1024*1024+1);let length=0;while(length<buffer.length){const part=await handle.read(buffer,length,buffer.length-length,length);if(!part.bytesRead)break;length+=part.bytesRead;}if(length>1024*1024)throw Error('workbench/checkpoint-corrupt');bytes=buffer.subarray(0,length);}finally{await handle.close();}
  if(createHash('sha256').update(bytes).digest('hex')!==sha256)throw Error('workbench/checkpoint-corrupt');
  const manifest=JSON.parse(bytes.toString('utf8'));if(manifest.schemaVersion!==1||!Array.isArray(manifest.files)||manifest.files.length>2000)throw Error('workbench/checkpoint-corrupt');
  let byteLength=0;for(const file of manifest.files){if(!Number.isSafeInteger(file.bytes)||file.bytes<0||file.bytes>16*1024*1024)throw Error('workbench/checkpoint-corrupt');byteLength+=file.bytes;}if(byteLength>64*1024*1024)throw Error('workbench/checkpoint-corrupt');
  result.push(Object.freeze({sha256,fileCount:manifest.files.length,byteLength,verified:false as const}));
 }
 check();return Object.freeze(result);
}
