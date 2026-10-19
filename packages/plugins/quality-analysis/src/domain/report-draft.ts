import {z} from 'zod';
import {QUALITY_REPORT_FIELDS_BYTE_LIMIT,qualityReportIdentifierSchema,qualityReportRevisionIdSchema,type QualityReportFields} from './report-document.js';

const wellFormed=(value:string)=>![...value].some(character=>character.length===1&&character.charCodeAt(0)>=0xd800&&character.charCodeAt(0)<=0xdfff);
const body=z.string().max(8192).refine(value=>!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)&&wellFormed(value));
export const qualityReportDraftFieldsSchema=z.object({
  title:z.string().max(256).refine(value=>!/[\u0000-\u001f\u007f]/.test(value)&&wellFormed(value)),
  analysis:body,conclusion:body,recommendations:body,
}).strict().refine(value=>new TextEncoder().encode(JSON.stringify(value)).byteLength<=QUALITY_REPORT_FIELDS_BYTE_LIMIT);
export const qualitySaveReportDraftInputSchema=z.object({
  draftId:qualityReportIdentifierSchema.optional(),expectedDraftRevision:qualityReportRevisionIdSchema.optional(),
  reportId:qualityReportIdentifierSchema.optional(),baseRevisionId:qualityReportRevisionIdSchema.optional(),
  operationId:qualityReportIdentifierSchema,fields:qualityReportDraftFieldsSchema,
}).strict().refine(value=>Boolean(value.draftId)===Boolean(value.expectedDraftRevision)&&Boolean(value.reportId)===Boolean(value.baseRevisionId));
export type QualitySaveReportDraftInput=z.infer<typeof qualitySaveReportDraftInputSchema>;
export interface QualityReportDraftSummary {
  readonly draftId:string;readonly recordId:string;readonly runId:string;readonly contentHash:string;
  readonly reportId?:string;readonly baseRevisionId?:string;readonly draftRevision:string;readonly sha256:string;
  readonly updatedAt:string;readonly title:string;readonly status:'active'|'archived';
}
export interface QualityReportDraftView extends QualityReportDraftSummary {readonly fields:QualityReportFields;}
