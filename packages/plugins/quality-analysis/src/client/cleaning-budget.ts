import type {QualityCleaningRequest} from '../runtime/configuration-request.js';
/** Matches the authenticated RPC body budget without truncating user decisions. */
export function qualityCleaningFitsRequest(recordId:string,expectedRevision:number,cleaning:QualityCleaningRequest){
 return new TextEncoder().encode(JSON.stringify({endpoint:'analyze',payload:{recordId,expectedRevision,cleaning}})).byteLength<=16*1024;
}

export function qualityCleaningFitsDraft(cleaning:QualityCleaningRequest){
 return new TextEncoder().encode(JSON.stringify(cleaning)).byteLength<=12*1024;
}
