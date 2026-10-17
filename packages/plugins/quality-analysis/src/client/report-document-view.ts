import {parseQualityReportFields,type QualityReportDocumentSummary,type QualityReportDocumentView,type QualitySaveReportDocumentInput} from '../domain/report-document.js';

function invalid():never{throw Error('quality/response/invalid');}
const text=(value:unknown,max=256):value is string=>typeof value==='string'&&!!value.trim()&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value);
const hash=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const date=(value:unknown):value is string=>text(value,64)&&Number.isFinite(Date.parse(value));
const count=(value:unknown):value is number=>Number.isSafeInteger(value)&&(value as number)>=1&&(value as number)<=100;
function object(value:unknown,keys:readonly string[],optional:readonly string[]=[]):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value))return invalid();const row=value as Record<string,unknown>;
 if(Object.keys(row).some(key=>!keys.includes(key))||keys.some(key=>!optional.includes(key)&&!Object.hasOwn(row,key)))return invalid();return row;
}
function scope(row:Record<string,unknown>,recordId:string,runId:string,contentHash:string){
 if(row.recordId!==recordId||row.runId!==runId||row.contentHash!==contentHash||!text(row.reportId,128)||!/^[A-Za-z0-9._:-]+$/.test(row.reportId))invalid();
}
const freeze=<T>(value:T):T=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};
export function parseQualityReportDocuments(value:unknown,recordId:string,runId:string,contentHash:string):readonly QualityReportDocumentSummary[]{
 if(!Array.isArray(value)||value.length>100)return invalid();const ids=new Set<string>();
 return freeze(value.map(item=>{const row=object(item,['reportId','recordId','runId','contentHash','title','currentRevisionId','version','updatedAt']);scope(row,recordId,runId,contentHash);
  if(!text(row.title)||!text(row.currentRevisionId)||!count(row.version)||!date(row.updatedAt)||ids.has(row.reportId as string))invalid();ids.add(row.reportId as string);
  return {...row} as unknown as QualityReportDocumentSummary;
 }));
}
/** A page only accepts the selected report/run/version and a matching durable
 * receipt. It never treats an unrelated asset or generated template as saved. */
export async function parseQualityReportDocument(value:unknown,recordId:string,runId:string,contentHash:string,
 expected?:{reportId?:string;revisionId?:string;save?:QualitySaveReportDocumentInput}):Promise<QualityReportDocumentView>{
 const row=object(value,['reportId','recordId','runId','contentHash','fields','revisionId','currentRevisionId','version','versions','markdown','receipt']);scope(row,recordId,runId,contentHash);
 if(expected?.reportId!==undefined&&row.reportId!==expected.reportId||expected?.revisionId!==undefined&&row.revisionId!==expected.revisionId||
  !text(row.revisionId)||!text(row.currentRevisionId)||!count(row.version)||typeof row.markdown!=='string')invalid();
 const fields=parseQualityReportFields(row.fields);
 // Do not silently normalize a malformed response title.
 if(Object.entries(fields).some(([key,value])=>(row.fields as Record<string,unknown>)[key]!==value))invalid();
 if(!Array.isArray(row.versions)||!row.versions.length||row.versions.length>100)invalid();
 const revisions=new Set<string>(),operations=new Set<string>();
 const versions=(row.versions as unknown[]).map((item,index)=>{const version=object(item,['version','revisionId','sha256','operationId','createdAt','title']);
  if(version.version!==index+1||!text(version.revisionId)||!hash(version.sha256)||!text(version.operationId,128)||!date(version.createdAt)||!text(version.title)||
   revisions.has(version.revisionId as string)||operations.has(version.operationId as string))invalid();revisions.add(version.revisionId as string);operations.add(version.operationId as string);return {...version};
 });
 const selected=versions.find(version=>version.revisionId===row.revisionId),latest=versions.at(-1)!;
 if(!selected||selected.version!==row.version||selected.title!==fields.title||latest.revisionId!==row.currentRevisionId)invalid();
 const receipt=object(row.receipt,['runId','contentHash','sha256','operationId','assetId','revisionId','nodeId','format','detailKind']);
 if(receipt.runId!==runId||receipt.contentHash!==contentHash||receipt.sha256!==selected.sha256||receipt.revisionId!==row.revisionId||receipt.format!=='markdown'||receipt.detailKind!=='markdown'||
  !['operationId','assetId','revisionId','nodeId'].every(key=>text(receipt[key])))invalid();
 if(expected?.save){const saved=expected.save;
  if(JSON.stringify(fields)!==JSON.stringify(saved.fields))invalid();
  if(saved.reportId!==undefined&&row.reportId!==saved.reportId)invalid();
  // An unchanged-content save may return the existing version.
  if(row.revisionId!==saved.expectedRevisionId&&selected.operationId!==saved.operationId)invalid();
 }
 const bytes=new TextEncoder().encode(row.markdown as string);if(bytes.byteLength>8*1024*1024)invalid();
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),value=>value.toString(16).padStart(2,'0')).join('');
 if(digest!==receipt.sha256)invalid();
 return freeze({...row,fields,versions,receipt}) as unknown as QualityReportDocumentView;
}
