import {mkdir,realpath,lstat,rmdir} from 'node:fs/promises';
import {dirname,basename,join} from 'node:path';
/** Cross-process recovery exclusion only. Never steals abandoned or foreign locks. */
export async function withSourceRecoveryLock<T>(source:string,authorize:()=>void,operation:()=>Promise<T>,signal?:AbortSignal):Promise<T>{
 const check=()=>{signal?.throwIfAborted();authorize();signal?.throwIfAborted();};check();
 if(await realpath(source)!==source)throw Error('workbench/source-directory-outside');check();
 const lock=join(dirname(source),'.'+basename(source)+'.workdsh-recovery-lock');
 try{await mkdir(lock,{mode:0o700});}catch(cause){
  if(cause&&typeof cause==='object'&&'code' in cause&&cause.code==='EEXIST')throw Error('workbench/source-recovery-busy');
  throw cause;
 }
 const owned=await lstat(lock);
 try{check();return await operation();}
 finally{
  const current=await lstat(lock);
  if(!current.isDirectory()||current.isSymbolicLink()||current.ino!==owned.ino||current.dev!==owned.dev)throw Error('workbench/source-recovery-lock-changed');
  await rmdir(lock);
 }
}
