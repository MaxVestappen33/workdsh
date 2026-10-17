import {parseQualityReportFields,type QualityReportDocumentView,type QualityReportFields,type QualitySaveReportDocumentInput} from '../domain/report-document.js';
import type {QualityRunView} from './run-view.js';
import {qualitySaveReportDraftInputSchema,type QualityReportDraftView,type QualitySaveReportDraftInput} from '../domain/report-draft.js';

export const reportFieldsEqual=(left:QualityReportFields,right:QualityReportFields)=>
 (['title','analysis','conclusion','recommendations'] as const).every(field=>left[field]===right[field]);
export const initialReportFields=():QualityReportFields=>({title:'质量分析报告',analysis:'',conclusion:'',recommendations:''});

export function reportDocumentMatchesRun(document:QualityReportDocumentView,run:Pick<QualityRunView,'recordId'|'runId'|'contentHash'>):boolean{
 const version=document.versions.find(item=>item.revisionId===document.revisionId);
 return document.recordId===run.recordId&&document.runId===run.runId&&document.contentHash===run.contentHash&&
  document.receipt.runId===run.runId&&document.receipt.contentHash===run.contentHash&&
  document.receipt.revisionId===document.revisionId&&!!version&&version.version===document.version&&
  version.sha256===document.receipt.sha256&&version.title===document.fields.title;
}
export function reportSaveInput(fields:QualityReportFields,operationId:string,document?:QualityReportDocumentView):QualitySaveReportDocumentInput{
 if(document&&document.revisionId!==document.currentRevisionId)throw Error('请先读取最新版，再继续加工。');
 return {...(document?{reportId:document.reportId,expectedRevisionId:document.revisionId}:{}),operationId,fields:parseQualityReportFields(fields)};
}
/** A save receipt alone is insufficient. The fixed version read back must agree
 * with the submitted text and the actual Library receipt, including no-op saves. */
export function reportSaveReadbackMatches(candidate:QualityReportDocumentView,readback:QualityReportDocumentView,input:QualitySaveReportDocumentInput,run:Pick<QualityRunView,'recordId'|'runId'|'contentHash'>):boolean{
 return reportDocumentMatchesRun(candidate,run)&&reportDocumentMatchesRun(readback,run)&&
  (!input.reportId||candidate.reportId===input.reportId)&&candidate.reportId===readback.reportId&&
  candidate.revisionId===readback.revisionId&&reportFieldsEqual(candidate.fields,input.fields)&&reportFieldsEqual(readback.fields,input.fields)&&
  candidate.markdown===readback.markdown&&
  (['assetId','revisionId','operationId','sha256','nodeId'] as const).every(key=>candidate.receipt[key]===readback.receipt[key]);
}

export function reportDraftMatchesRun(draft:QualityReportDraftView,run:Pick<QualityRunView,'recordId'|'runId'|'contentHash'>):boolean{
 return draft.recordId===run.recordId&&draft.runId===run.runId&&draft.contentHash===run.contentHash&&draft.title===draft.fields.title;
}
export function reportDraftParentMatches(draft:QualityReportDraftView,document?:QualityReportDocumentView):boolean{
 return document?draft.reportId===document.reportId&&draft.baseRevisionId===document.revisionId&&document.revisionId===document.currentRevisionId:!draft.reportId&&!draft.baseRevisionId;
}
export function reportDraftSaveInput(fields:QualityReportFields,operationId:string,document?:QualityReportDocumentView,draft?:QualityReportDraftView):QualitySaveReportDraftInput{
 if(document&&document.revisionId!==document.currentRevisionId||draft&&!reportDraftParentMatches(draft,document))throw Error('draft-parent-changed');
 return qualitySaveReportDraftInputSchema.parse({...(draft?{draftId:draft.draftId,expectedDraftRevision:draft.draftRevision}:{}),...(document?{reportId:document.reportId,baseRevisionId:document.revisionId}:{}),operationId,fields});
}
export function reportDraftReadbackMatches(candidate:QualityReportDraftView,readback:QualityReportDraftView,input:QualitySaveReportDraftInput,run:Pick<QualityRunView,'recordId'|'runId'|'contentHash'>):boolean{
 return reportDraftMatchesRun(candidate,run)&&reportDraftMatchesRun(readback,run)&&candidate.status==='active'&&readback.status==='active'&&
  (!input.draftId||candidate.draftId===input.draftId)&&candidate.draftId===readback.draftId&&candidate.draftRevision===readback.draftRevision&&candidate.sha256===readback.sha256&&
  candidate.reportId===input.reportId&&readback.reportId===input.reportId&&candidate.baseRevisionId===input.baseRevisionId&&readback.baseRevisionId===input.baseRevisionId&&
  reportFieldsEqual(candidate.fields,input.fields)&&reportFieldsEqual(readback.fields,input.fields);
}

/** Archiving changes the Library revision while retaining the exact draft body.
 * Acknowledge the archived revision only after reading that revision back. */
export function reportDraftArchiveReadbackMatches(candidate:QualityReportDraftView,readback:QualityReportDraftView,previous:QualityReportDraftView,run:Pick<QualityRunView,'recordId'|'runId'|'contentHash'>):boolean{
 return reportDraftMatchesRun(previous,run)&&previous.status==='active'&&
  [candidate,readback].every(value=>reportDraftMatchesRun(value,run)&&value.status==='archived'&&value.draftId===previous.draftId&&
   value.reportId===previous.reportId&&value.baseRevisionId===previous.baseRevisionId&&value.sha256===previous.sha256&&reportFieldsEqual(value.fields,previous.fields))&&
  candidate.draftRevision===readback.draftRevision&&candidate.updatedAt===readback.updatedAt;
}
