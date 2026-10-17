import type {QualityReportDraftSummary} from '../domain/report-draft.js';
import {parseQualityReportDrafts} from './report-draft-view.js';
import {qualityFocusSelectionSchema,type QualityFocusSelection} from '../domain/analysis-focus.js';

export interface QualityAiContext {
 readonly recordId:string;readonly sessionId:string;
 readonly originRunId:string;readonly originContentHash:string;
 readonly runId:string;readonly contentHash:string;readonly revision:number;
 readonly reportDraft?:QualityReportDraftSummary;
 readonly selectedReport?:{readonly reportId:string;readonly revisionId:string};
 readonly selectedFocus?:QualityFocusSelection;
}
/** A server-authorized Session pointer, never a model completion claim. */
export function parseQualityAiContext(value:unknown,recordId:string,sessionId:string):QualityAiContext {
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('quality/invalid-ai-context');
 const row=value as Record<string,unknown>,keys=['recordId','sessionId','originRunId','originContentHash','runId','contentHash','revision','reportDraft','selectedReport','selectedFocus'];
 if(Object.keys(row).some(key=>!keys.includes(key))||row.recordId!==recordId||row.sessionId!==sessionId||
  !['originRunId','runId'].every(key=>typeof row[key]==='string'&&(row[key] as string).trim()&&(row[key] as string).length<=128)||
  !['originContentHash','contentHash'].every(key=>typeof row[key]==='string'&&/^[a-f0-9]{64}$/.test(row[key] as string))||
  !Number.isSafeInteger(row.revision)||(row.revision as number)<0)throw Error('quality/invalid-ai-context');
 const reportDraft=row.reportDraft===undefined?undefined:parseQualityReportDrafts([row.reportDraft],recordId,row.runId as string,row.contentHash as string)[0];
 if(row.selectedReport!==undefined){
  const target=row.selectedReport as Record<string,unknown>;
  if(!target||typeof target!=='object'||Array.isArray(target)||Object.keys(target).length!==2||Object.keys(target).some(key=>!['reportId','revisionId'].includes(key))||!['reportId','revisionId'].every(key=>typeof target[key]==='string'&&(target[key] as string).trim()&&(target[key] as string).length<=256))throw Error('quality/invalid-ai-context');
 }
 const selectedFocus=row.selectedFocus===undefined?undefined:qualityFocusSelectionSchema.safeParse(row.selectedFocus);
 if(selectedFocus&&!selectedFocus.success)throw Error('quality/invalid-ai-context');
 return Object.freeze({...row,...(reportDraft?{reportDraft}:{}),...(selectedFocus?.success?{selectedFocus:Object.freeze(selectedFocus.data)}:{})}) as unknown as QualityAiContext;
}

/** Only the currently selected origin or the last applied AI result may advance.
 * Selecting a historical run prevents a background task from replacing it. */
export function qualityAiUpdateMatchesSelection(context:QualityAiContext,recordId:string,
 selected:{runId:string;contentHash:string}|undefined,lastApplied?:{runId:string;contentHash:string}):boolean {
 return context.recordId===recordId&&!!selected&&(
  selected.runId===context.originRunId&&selected.contentHash===context.originContentHash||
  !!lastApplied&&selected.runId===lastApplied.runId&&selected.contentHash===lastApplied.contentHash||
  selected.runId===context.runId&&selected.contentHash===context.contentHash);
}
