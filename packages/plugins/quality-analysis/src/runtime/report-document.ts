import {createHash} from 'node:crypto';
import {z} from 'zod';
import {parseQualityReportFields,qualityReportFieldsSchema,qualityReportIdentifierSchema,qualityReportRevisionIdSchema,type QualityReportFields} from '../domain/report-document.js';
import {verifyQualityAnalysisRunHash,type CompleteQualityAnalysisRun} from './analysis-run.js';
import {renderQualityMarkdownReport} from './report.js';

export const QUALITY_REPORT_DOCUMENT_BYTE_LIMIT=1024*1024;
const hash=z.string().regex(/^[a-f0-9]{64}$/),id=qualityReportIdentifierSchema,revisionId=qualityReportRevisionIdSchema;
const scopeId=z.string().min(1).max(128).refine(value=>Boolean(value.trim())&&!/[\u0000-\u001f\u007f]/.test(value));
export const qualityStoredReportVersionSchema=z.object({version:z.number().int().positive().max(100),revisionId,sha256:hash,
  operationId:id,libraryOperationId:z.string().min(1).max(256),createdAt:z.string().datetime(),title:z.string().min(1).max(256)}).strict();
export const qualityStoredReportDocumentSchema=z.object({reportId:id,recordId:scopeId,runId:scopeId,contentHash:hash,
  assetId:revisionId,nodeId:revisionId,versions:z.array(qualityStoredReportVersionSchema).min(1).max(100)}).strict();
export type QualityStoredReportDocument=z.infer<typeof qualityStoredReportDocumentSchema>;
export type QualityStoredReportVersion=z.infer<typeof qualityStoredReportVersionSchema>;
export const qualityReportDocumentOperationSchema=z.object({operationId:id,requestHash:hash,reportId:id,revisionId}).strict();
export type QualityReportDocumentOperation=z.infer<typeof qualityReportDocumentOperationSchema>;
const metadataSchema=z.object({schemaVersion:z.literal(1),reportId:id,recordId:scopeId,runId:scopeId,contentHash:hash,fields:qualityReportFieldsSchema}).strict();
export interface QualityReportDocumentIdentity {readonly reportId:string;readonly recordId:string;readonly runId:string;readonly contentHash:string;}
const prefix='<!-- workdsh-quality-report-document:1 ',suffix=' -->';
export const qualityReportBytesHash=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
const heading=(value:string)=>value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/[\\`*_{}\[\]()#!|]/g,'\\$&');

/** The editable fields are a finite schema. Everything after the fixed-statistics
 * boundary is reconstructed from the immutable Host run, never from page input.
 * The metadata is encoded so field text cannot impersonate a boundary. */
export function encodeQualityReportDocument(identity:QualityReportDocumentIdentity,run:CompleteQualityAnalysisRun,input:QualityReportFields):string {
  if(!verifyQualityAnalysisRunHash(run)||identity.runId!==run.runId||identity.contentHash!==run.contentHash)throw Error('quality/report-document/run-mismatch');
  const fields=parseQualityReportFields(input),metadata=metadataSchema.parse({reportId:identity.reportId,recordId:identity.recordId,
    runId:identity.runId,contentHash:identity.contentHash,schemaVersion:1,fields});
  const marker=prefix+Buffer.from(JSON.stringify(metadata),'utf8').toString('base64url')+suffix;
  const statistics=run.content.statistics.summary,conformingRate=statistics.inspectedQuantity===0?'不可计算（分母为零）':(statistics.conformingQuantity/statistics.inspectedQuantity*100).toFixed(2)+'%';
  const markdown=[marker,`# ${heading(fields.title)}`,'','报告中的分析、结论和建议由用户加工；下方统计依据固定于原分析运行。','',
    '## 分析',fields.analysis,'','## 结论',fields.conclusion,'','## 建议',fields.recommendations,'',
    '<!-- workdsh-quality-report-fixed-statistics -->',`固定统计：检验数量 ${statistics.inspectedQuantity}；不合格数量 ${statistics.nonconformingQuantity}；合格率 ${conformingRate}。`,'',renderQualityMarkdownReport(run,'固定统计依据')].join('\n');
  if(Buffer.byteLength(markdown,'utf8')>QUALITY_REPORT_DOCUMENT_BYTE_LIMIT)throw Error('quality/report-document/byte-budget-exceeded');
  return markdown;
}

/** SHA checks happen before this codec at the Library boundary. Canonical exact
 * reconstruction also rejects external edits to metadata or fixed statistics. */
export function decodeQualityReportDocument(bytes:Uint8Array,identity:QualityReportDocumentIdentity,run:CompleteQualityAnalysisRun):{fields:QualityReportFields;markdown:string} {
  if(!bytes.byteLength||bytes.byteLength>QUALITY_REPORT_DOCUMENT_BYTE_LIMIT)throw Error('quality/report-document/byte-budget-exceeded');
  let markdown:string;try{markdown=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw Error('quality/report-document/invalid-encoding');}
  const line=markdown.split('\n',1)[0]!;
  if(!line.startsWith(prefix)||!line.endsWith(suffix))throw Error('quality/report-document/invalid-content');
  const encoded=line.slice(prefix.length,-suffix.length);
  if(!/^[A-Za-z0-9_-]+$/.test(encoded))throw Error('quality/report-document/invalid-content');
  let metadata:z.infer<typeof metadataSchema>;
  try{
    const decoded=Buffer.from(encoded,'base64url');if(decoded.toString('base64url')!==encoded)throw Error('noncanonical');
    metadata=metadataSchema.parse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(decoded)));
  }catch{throw Error('quality/report-document/invalid-content');}
  if(metadata.reportId!==identity.reportId||metadata.recordId!==identity.recordId||metadata.runId!==identity.runId||metadata.contentHash!==identity.contentHash)throw Error('quality/report-document/identity-mismatch');
  if(encodeQualityReportDocument(identity,run,metadata.fields)!==markdown)throw Error('quality/report-document/fixed-content-mismatch');
  return {fields:metadata.fields,markdown};
}
