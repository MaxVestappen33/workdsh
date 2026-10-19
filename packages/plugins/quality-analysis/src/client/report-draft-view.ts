import {qualityReportDraftFieldsSchema,type QualityReportDraftSummary,type QualityReportDraftView,type QualitySaveReportDraftInput} from '../domain/report-draft.js';
import {qualityReportIdentifierSchema,qualityReportRevisionIdSchema} from '../domain/report-document.js';

function invalid():never{throw Error('quality/response/invalid');}
const hash=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const summaryKeys=['draftId','recordId','runId','contentHash','reportId','baseRevisionId','draftRevision','sha256','updatedAt','title','status'] as const;
const optionalKeys=['reportId','baseRevisionId'];
const freeze=<T>(value:T):T=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};
function object(value:unknown,keys:readonly string[]):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value))return invalid();const row=value as Record<string,unknown>;
 if(Object.keys(row).some(key=>!keys.includes(key))||keys.some(key=>!optionalKeys.includes(key)&&!Object.hasOwn(row,key)))return invalid();return row;
}
function summary(row:Record<string,unknown>,recordId:string,runId:string,contentHash:string):QualityReportDraftSummary{
 if(row.recordId!==recordId||row.runId!==runId||row.contentHash!==contentHash||!qualityReportIdentifierSchema.safeParse(row.draftId).success||
  !qualityReportRevisionIdSchema.safeParse(row.draftRevision).success||!hash(row.sha256)||typeof row.updatedAt!=='string'||row.updatedAt.length>64||!Number.isFinite(Date.parse(row.updatedAt))||
  !['active','archived'].includes(row.status as string)||typeof row.title!=='string'||row.title.length>256||/[\u0000-\u001f\u007f]/.test(row.title)||
  Object.hasOwn(row,'reportId')!==Object.hasOwn(row,'baseRevisionId')||row.reportId!==undefined&&(!qualityReportIdentifierSchema.safeParse(row.reportId).success||!qualityReportRevisionIdSchema.safeParse(row.baseRevisionId).success))invalid();
 return {...row} as unknown as QualityReportDraftSummary;
}
/** Draft pointers and text stay bound to one fixed analysis; the page cannot
 * supply a Library id, owner, or another run's report as a save target. */
export function parseQualityReportDrafts(value:unknown,recordId:string,runId:string,contentHash:string):readonly QualityReportDraftSummary[]{
 if(!Array.isArray(value)||value.length>100)return invalid();const ids=new Set<string>();
 return freeze(value.map(item=>{const parsed=summary(object(item,summaryKeys),recordId,runId,contentHash);if(ids.has(parsed.draftId))invalid();ids.add(parsed.draftId);return parsed;}));
}
export function parseQualityReportDraft(value:unknown,recordId:string,runId:string,contentHash:string,
 expected?:{draftId?:string;save?:QualitySaveReportDraftInput;status?:'active'|'archived'}):QualityReportDraftView{
 const row=object(value,[...summaryKeys,'fields']);const {fields:rawFields,...metadata}=row;
 const parsed=summary(metadata,recordId,runId,contentHash),fields=qualityReportDraftFieldsSchema.safeParse(rawFields);if(!fields.success)return invalid();
 if(parsed.title!==fields.data.title||expected?.draftId!==undefined&&parsed.draftId!==expected.draftId||expected?.status!==undefined&&parsed.status!==expected.status)invalid();
 if(expected?.save){const saved=expected.save;
  if(saved.draftId!==undefined&&parsed.draftId!==saved.draftId||parsed.status!=='active'||parsed.reportId!==saved.reportId||parsed.baseRevisionId!==saved.baseRevisionId||
   ['title','analysis','conclusion','recommendations'].some(key=>fields.data[key as keyof typeof fields.data]!==saved.fields[key as keyof typeof saved.fields]))invalid();
 }
 return freeze({...parsed,fields:fields.data});
}
