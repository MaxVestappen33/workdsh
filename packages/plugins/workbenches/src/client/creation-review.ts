import type {WorkbenchRequirementsDraft,WorkbenchRequirementsRevision} from 'workdsh-contracts';
import type {CreationView} from './creation-client.js';

export interface WorkbenchCreationReview {
 readonly revision:string;
 /** A persisted draft can change without changing the optimistic creation revision. */
 readonly seed:string;
 readonly draft:WorkbenchRequirementsDraft;
}
export function creationProposalReview(creation:CreationView):WorkbenchCreationReview|undefined {
 if(!creation.proposal)return;
 return {revision:creation.revision,seed:`proposal:${creation.revision}`,draft:{title:'',scenario:'',users:'',dataSources:'',workflow:'',firstIteration:'',acceptance:'',...creation.proposal}};
}
/** History has already passed the requirements client's ownership/chain validation.
 * Reading it never appends a revision or advances the creation conflict token. */
export function restoreCreationReview(creation:CreationView,history:readonly WorkbenchRequirementsRevision[],current?:WorkbenchCreationReview,preserveCurrent=false):WorkbenchCreationReview|undefined {
 if(preserveCurrent)return current;
 const saved=history.at(-1);
 if(saved){
  if(saved.developmentId!==creation.id)throw Error('workbench/requirements-revision-conflict');
  return {revision:creation.revision,seed:`requirements:${saved.id}`,draft:saved.requirements};
 }
 return current??creationProposalReview(creation);
}
