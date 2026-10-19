import {z} from 'zod';
import type {QualityReportReceipt} from '../runtime/run-store.js';

export const QUALITY_REPORT_FIELDS_BYTE_LIMIT=12*1024;
const wellFormed=(value:string)=>![...value].some(character=>character.length===1&&character.charCodeAt(0)>=0xd800&&character.charCodeAt(0)<=0xdfff);
const body=z.string().max(8192).refine(value=>!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)&&wellFormed(value));
const fieldsSchema=z.object({
  title:z.string().max(256).refine(value=>!/[\u0000-\u001f\u007f]/.test(value)&&wellFormed(value)).transform(value=>value.trim()).pipe(z.string().min(1).max(256)),
  analysis:body,conclusion:body,recommendations:body,
}).strict();
export const qualityReportFieldsSchema=fieldsSchema.refine(value=>new TextEncoder().encode(JSON.stringify(value)).byteLength<=QUALITY_REPORT_FIELDS_BYTE_LIMIT);
export type QualityReportFields=z.infer<typeof qualityReportFieldsSchema>;
export const qualityReportIdentifierSchema=z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/);
export const qualityReportRevisionIdSchema=z.string().min(1).max(256).refine(value=>!/[\s\u0000-\u001f\u007f]/.test(value));
export const qualitySaveReportDocumentInputSchema=z.object({
  reportId:qualityReportIdentifierSchema.optional(),expectedRevisionId:qualityReportRevisionIdSchema.optional(),
  operationId:qualityReportIdentifierSchema,fields:qualityReportFieldsSchema,
}).strict().refine(value=>Boolean(value.reportId)===Boolean(value.expectedRevisionId));
export type QualitySaveReportDocumentInput=z.infer<typeof qualitySaveReportDocumentInputSchema>;
export type SaveInput=QualitySaveReportDocumentInput;
export interface QualityReportDocumentVersion {
  readonly version:number;readonly revisionId:string;readonly sha256:string;readonly operationId:string;readonly createdAt:string;readonly title:string;
}
export interface QualityReportDocumentSummary {
  readonly reportId:string;readonly recordId:string;readonly runId:string;readonly contentHash:string;
  readonly title:string;readonly currentRevisionId:string;readonly version:number;readonly updatedAt:string;
}
export interface QualityReportDocumentView {
  readonly reportId:string;readonly recordId:string;readonly runId:string;readonly contentHash:string;readonly fields:QualityReportFields;
  readonly revisionId:string;readonly currentRevisionId:string;readonly version:number;readonly versions:readonly QualityReportDocumentVersion[];
  readonly markdown:string;readonly receipt:QualityReportReceipt;
}
export function parseQualityReportFields(value:unknown):QualityReportFields {
  const parsed=fieldsSchema.safeParse(value);if(!parsed.success)throw Error('quality/report/invalid-fields');
  if(new TextEncoder().encode(JSON.stringify(parsed.data)).byteLength>QUALITY_REPORT_FIELDS_BYTE_LIMIT)throw Error('quality/report/fields-size-limit');
  return parsed.data;
}
