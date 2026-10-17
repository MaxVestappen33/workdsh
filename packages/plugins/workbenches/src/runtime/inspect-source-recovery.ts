import {join} from 'node:path';
import {readSourceRecoveryJournal} from './source-recovery-journal.js';
import {verifySourceCheckpoint} from './verify-source-checkpoint.js';
import {checkpointWorkbenchSource} from './source-checkpoint.js';
/** Inspection is not a source switch. Host must separately stop writers and commit. */
export async function inspectSourceRecovery(source:string,checkpoints:string,destination:string,journalId:string,authorize:()=>void,signal?:AbortSignal){
 const check=()=>{signal?.throwIfAborted();authorize();signal?.throwIfAborted();};check();
 const journal=await readSourceRecoveryJournal(join(destination,'journals'),journalId,source,authorize,signal);check();
 if(journal.state!=='prepared'||!journal.candidate)throw Error('workbench/source-recovery-not-prepared');
 await verifySourceCheckpoint(checkpoints,journal.beforeSha256,authorize,signal);check();
 await verifySourceCheckpoint(checkpoints,journal.targetSha256,authorize,signal);check();
 const candidate=await checkpointWorkbenchSource(journal.candidate,checkpoints,authorize,signal);check();
 if(candidate.sha256!==journal.targetSha256)throw Error('workbench/restore-candidate-corrupt');
 const current=await checkpointWorkbenchSource(source,checkpoints,authorize,signal);check();
 return Object.freeze({journalId,state:current.sha256===journal.beforeSha256?'prepared' as const:'source-changed' as const,beforeSha256:journal.beforeSha256,targetSha256:journal.targetSha256,currentSha256:current.sha256});
}
