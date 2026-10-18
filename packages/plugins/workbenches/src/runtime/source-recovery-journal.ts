import {mkdir,realpath,open,rename,rm} from 'node:fs/promises';
import {constants} from 'node:fs';import {join,dirname,basename} from 'node:path';import {randomUUID} from 'node:crypto';
export interface SourceRecoveryJournal {schemaVersion:1;id:string;source:string;beforeSha256:string;targetSha256:string;state:'preparing'|'prepared'|'failed';candidate?:string;}
/** Internal Host paths and receipts only. Not exposed as filesystem instructions to Client. */
export async function writeSourceRecoveryJournal(directory:string,value:SourceRecoveryJournal,authorize:()=>void,signal?:AbortSignal){
 const check=()=>{signal?.throwIfAborted();authorize();signal?.throwIfAborted();};check();
 if(!/^[a-f0-9-]{36}$/.test(value.id)||value.schemaVersion!==1||!['preparing','prepared','failed'].includes(value.state)||!['beforeSha256','targetSha256'].every(key=>/^[a-f0-9]{64}$/.test(value[key as 'beforeSha256'|'targetSha256'])))throw Error('workbench/invalid-recovery-journal');
 await mkdir(directory,{recursive:true,mode:0o700});check();if(await realpath(directory)!==directory)throw Error('workbench/restore-directory-outside');
 const temp=join(directory,'.pending-'+randomUUID()),target=join(directory,value.id+'.json');
 try{
  const handle=await open(temp,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try{await handle.writeFile(JSON.stringify(value));await handle.sync();}finally{await handle.close();}
  check();await rename(temp,target);
 }finally{await rm(temp,{force:true});}
}

/** Read only within the Host-derived journal root; never trusts a stored source redirect. */
export async function readSourceRecoveryJournal(directory:string,id:string,expectedSource:string,authorize:()=>void,signal?:AbortSignal):Promise<Readonly<SourceRecoveryJournal>>{
 const check=()=>{signal?.throwIfAborted();authorize();signal?.throwIfAborted();};check();
 const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
 if(!uuid.test(id))throw Error('workbench/invalid-recovery-journal');
 if(await realpath(directory)!==directory)throw Error('workbench/restore-directory-outside');
 const path=join(directory,id+'.json');if(await realpath(path)!==path)throw Error('workbench/invalid-recovery-journal');
 const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);let bytes:Buffer;
 try{
  const before=await handle.stat();if(!before.isFile()||before.size>32768)throw Error('workbench/invalid-recovery-journal');
  bytes=Buffer.alloc(before.size+1);let length=0;
  while(length<bytes.length){check();const part=await handle.read(bytes,length,bytes.length-length,length);if(!part.bytesRead)break;length+=part.bytesRead;}
  const after=await handle.stat();if(length!==before.size||after.size!==before.size||after.mtimeMs!==before.mtimeMs)throw Error('workbench/invalid-recovery-journal');bytes=bytes.subarray(0,length);
 }finally{await handle.close();}
 let value:unknown;try{value=JSON.parse(bytes.toString('utf8'));}catch{throw Error('workbench/invalid-recovery-journal');}
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('workbench/invalid-recovery-journal');
 const row=value as Record<string,unknown>;
 if(Object.keys(row).some(key=>!['schemaVersion','id','source','beforeSha256','targetSha256','state','candidate'].includes(key))||row.schemaVersion!==1||row.id!==id||row.source!==expectedSource||!['preparing','prepared','failed'].includes(String(row.state))||!['beforeSha256','targetSha256'].every(key=>typeof row[key]==='string'&&/^[a-f0-9]{64}$/.test(row[key] as string)))throw Error('workbench/invalid-recovery-journal');
 if(row.state==='prepared'&&typeof row.candidate!=='string')throw Error('workbench/invalid-recovery-journal');
 if(row.candidate!==undefined&&(typeof row.candidate!=='string'||dirname(row.candidate)!==dirname(directory)||!uuid.test(basename(row.candidate).replace(/^candidate-/,''))||!basename(row.candidate).startsWith('candidate-')))throw Error('workbench/invalid-recovery-journal');
 check();return Object.freeze(row as unknown as SourceRecoveryJournal);
}
