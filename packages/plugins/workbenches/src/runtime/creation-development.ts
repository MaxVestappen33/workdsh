import type {WorkbenchRequirementsDraft} from 'workdsh-contracts';
import type {CreationRecord} from './creation-service.js';
import type {WorkbenchRequirementsService} from './requirements-service.js';
import type {WorkbenchDevelopmentService,VerifyWorkbenchDevelopmentSource,VerifyWorkbenchDevelopmentSession} from './development-service.js';

/** Requirements have already committed. Preserve the safe underlying code and
 * the failed continuation stage without exposing arbitrary exception text. */
export class WorkbenchCreationPreparationError extends Error {
 readonly requirementsSaved=true;
 constructor(readonly preparationStage:'development'|'source'|'session',cause:unknown){
  super(cause instanceof Error&&/^workbench\/[a-z0-9-]+$/.test(cause.message)?cause.message:'workbench/creation-development-preparation-failed',{cause});
  this.name='WorkbenchCreationPreparationError';
 }
}
export async function confirmCreationDevelopment(row:CreationRecord,requirements:WorkbenchRequirementsDraft,
 ports:{requirements:Pick<WorkbenchRequirementsService,'history'|'append'>;development:Pick<WorkbenchDevelopmentService,'create'|'bindVerifiedSource'|'bindVerifiedSession'>;source:VerifyWorkbenchDevelopmentSource;session:VerifyWorkbenchDevelopmentSession},
 check:()=>void,signal?:AbortSignal){
 check();let saved=(await ports.requirements.history(row.id,signal)).at(-1);check();
 if(saved&&JSON.stringify(saved.requirements)!==JSON.stringify(requirements))throw Error('workbench/creation-conflict');
 if(!saved){saved=await ports.requirements.append(row.id,requirements,undefined,signal);check();}
 let stage:'development'|'source'|'session'='development';
 try{
  let entry=await ports.development.create(row.id,`workdsh.user-${row.id}`,`workdsh-workbench-${row.id}`,saved.id,signal);check();
  if(row.phase==='confirmed')return entry;
  stage='source';entry=await ports.development.bindVerifiedSource(row.id,entry.development.revision,ports.source,signal);check();
  stage='session';entry=await ports.development.bindVerifiedSession(row.id,entry.development.revision,ports.session,signal);check();
  return entry;
 }catch(cause){throw new WorkbenchCreationPreparationError(stage,cause);}
}
