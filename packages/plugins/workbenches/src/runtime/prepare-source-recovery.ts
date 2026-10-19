import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {writeSourceRecoveryJournal,type SourceRecoveryJournal} from './source-recovery-journal.js';
import {withSourceRecoveryLock} from './source-recovery-lock.js';
import {rm} from 'node:fs/promises';
import {checkpointWorkbenchSource} from './source-checkpoint.js';
import {prepareSourceRestoration} from './prepare-source-restoration.js';
/** Host-owned paths only. A prepared recovery is not permission to swap live source. */
async function prepareLockedSourceRecovery(source:string,checkpoints:string,destination:string,expectedCurrentSha256:string,targetSha256:string,authorize:()=>void,signal?:AbortSignal){
 const check=()=>{signal?.throwIfAborted();authorize();signal?.throwIfAborted();};check();
 if(!/^[a-f0-9]{64}$/.test(expectedCurrentSha256)||!/^[a-f0-9]{64}$/.test(targetSha256))throw Error('workbench/invalid-request');
 const before=await checkpointWorkbenchSource(source,checkpoints,authorize,signal);check();
 if(before.sha256!==expectedCurrentSha256)throw Error('workbench/source-revision-conflict');
 const journal:SourceRecoveryJournal={schemaVersion:1,id:randomUUID(),source,beforeSha256:before.sha256,targetSha256,state:'preparing'};
 const journals=join(destination,'journals');
 await writeSourceRecoveryJournal(journals,journal,authorize,signal);
 const candidate=await prepareSourceRestoration(checkpoints,targetSha256,destination,authorize,signal);
 try{
  check();const after=await checkpointWorkbenchSource(source,checkpoints,authorize,signal);check();
  if(after.sha256!==before.sha256)throw Error('workbench/source-revision-conflict');
  await writeSourceRecoveryJournal(journals,{...journal,state:'prepared',candidate:candidate.directory},authorize,signal);
 }catch(cause){await rm(candidate.directory,{recursive:true,force:true});throw cause;}
 return Object.freeze({before:Object.freeze({sha256:before.sha256,fileCount:before.fileCount,byteLength:before.byteLength}),candidate,journalId:journal.id});
}

export async function prepareSourceRecovery(source:string,checkpoints:string,destination:string,expectedCurrentSha256:string,targetSha256:string,authorize:()=>void,signal?:AbortSignal){
 return withSourceRecoveryLock(source,authorize,()=>prepareLockedSourceRecovery(source,checkpoints,destination,expectedCurrentSha256,targetSha256,authorize,signal),signal);
}
