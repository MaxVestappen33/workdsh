import type {QualityInterpretationReceipt,QualityReportReceipt} from '../runtime/run-store.js';
import type {QualityStatistics} from '../domain/statistics.js';
import type {QualityFilter} from '../domain/statistics.js';
import type {QualityNormalizationRules} from '../domain/normalization.js';
import {qualityMappingFields,type QualityTableKind} from '../domain/mapping.js';
export interface QualityRunSourceBasis {
 readonly sha256:string;readonly rowCount:number;readonly mapping:Readonly<Record<string,string>>;
 readonly format?:{readonly kind:'xlsx';readonly worksheet:string;readonly headerRow:number;readonly valuePolicy:string};
 readonly provenance?:{readonly kind:'library';readonly assetId:string;readonly revisionId:string};
}
export interface QualityRunReviewCounts {readonly correctedRows:number|null;readonly correctedCells:number|null;readonly excludedRows:number|null;readonly normalizationChanges:number|null;}
/** Optional only for compatibility with responses predating the immutable basis
 * projection. A missing audit count is null so the page can show “未记录”. */
export interface QualityRunBasis {
 readonly algorithmVersion:string;readonly sourceNamespace:string;
 readonly sources:{readonly inspections:QualityRunSourceBasis;readonly defects?:QualityRunSourceBasis};
 readonly rules:QualityNormalizationRules;readonly filter:QualityFilter;
 readonly review:{readonly inspections:QualityRunReviewCounts;readonly defects?:QualityRunReviewCounts};
}
export interface QualityRunView {readonly recordId:string;readonly runId:string;readonly createdAt:string;readonly contentHash:string;readonly statistics:Extract<QualityStatistics,{status:'complete'}>;readonly hasDefectSource:boolean;readonly basis?:QualityRunBasis;readonly markdown?:string;readonly reports?:readonly QualityReportReceipt[];readonly interpretations?:readonly QualityInterpretationReceipt[];}
const invalid=()=>{throw new Error('quality/response/invalid');};
function object(value:unknown,keys:readonly string[]):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))return invalid();const row=value as Record<string,unknown>;if(Object.keys(row).some(key=>!keys.includes(key)))return invalid();return row;}
const text=(value:unknown):value is string=>typeof value==='string'&&!!value.trim()&&value.length<=256;
const quantity=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;
const rate=(value:unknown)=>value===null||(typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=1);
const calendarDate=(value:unknown):value is string=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
function array(value:unknown):unknown[]{if(!Array.isArray(value)||value.length>10000)return invalid();return value;}
function summary(value:unknown){const row=object(value,['inspectionCount','inspectedQuantity','nonconformingQuantity','conformingQuantity','nonconformingRate','defectOccurrences']);
 for(const key of ['inspectionCount','inspectedQuantity','nonconformingQuantity','conformingQuantity','defectOccurrences'])if(!quantity(row[key]))invalid();
 if(!rate(row.nonconformingRate)||(row.nonconformingQuantity as number)+(row.conformingQuantity as number)!==row.inspectedQuantity||(row.inspectedQuantity===0&&row.nonconformingRate!==null)||(row.inspectedQuantity!==0&&row.nonconformingRate===null))invalid();
}
function freeze<T>(value:T):T{if(value&&typeof value==='object'){for(const item of Object.values(value))freeze(item);Object.freeze(value);}return value;}
function validateBasis(value:unknown,stats:Record<string,unknown>,hasDefectSource:boolean){
 if(new TextEncoder().encode(JSON.stringify(value)).byteLength>256*1024)invalid();
 const basis=object(value,['algorithmVersion','sourceNamespace','sources','rules','filter','review']);
 if(Object.keys(basis).length!==6||!text(basis.algorithmVersion)||basis.sourceNamespace!==stats.sourceNamespace)invalid();
 const sources=object(basis.sources,['inspections','defects']),review=object(basis.review,['inspections','defects']);
 if((sources.defects!==undefined)!==hasDefectSource||(review.defects!==undefined)!==hasDefectSource)invalid();
 for(const kind of ['inspections',...(hasDefectSource?['defects']:[])] as QualityTableKind[]){
  const source=object(sources[kind],['sha256','rowCount','mapping','format','provenance']);
  if(typeof source.sha256!=='string'||!/^[a-f0-9]{64}$/.test(source.sha256)||!quantity(source.rowCount)||source.rowCount>10000)invalid();
  const rowCount=source.rowCount as number;
  const fields:readonly string[]=qualityMappingFields[kind],mapping=object(source.mapping,fields),required=kind==='inspections'?fields.slice(0,6):fields;
  if(required.some(field=>!Object.hasOwn(mapping,field))||Object.values(mapping).some(header=>typeof header!=='string'||!header.trim()||header.length>65536||/[\u0000-\u001f]/.test(header))||new Set(Object.values(mapping)).size!==Object.keys(mapping).length)invalid();
  if(source.format!==undefined){const format=object(source.format,['kind','worksheet','headerRow','valuePolicy']);if(Object.keys(format).length!==4||format.kind!=='xlsx'||!text(format.worksheet)||!text(format.valuePolicy)||!quantity(format.headerRow)||format.headerRow<1)invalid();}
  if(source.provenance!==undefined){const provenance=object(source.provenance,['kind','assetId','revisionId']);if(Object.keys(provenance).length!==3||provenance.kind!=='library'||!text(provenance.assetId)||!text(provenance.revisionId))invalid();}
  const counts=object(review[kind],['correctedRows','correctedCells','excludedRows','normalizationChanges']);
  if(Object.keys(counts).length!==4||Object.values(counts).some(count=>count!==null&&!quantity(count)))invalid();
  const {correctedRows,correctedCells,excludedRows,normalizationChanges}=counts as unknown as QualityRunReviewCounts;
  if((correctedRows===null)!==(correctedCells===null)||(correctedRows===null)!==(excludedRows===null)||
   correctedRows!==null&&(correctedRows>rowCount||(correctedCells as number)<correctedRows||(correctedCells as number)>rowCount*50||correctedRows+(excludedRows as number)>rowCount)||
   normalizationChanges!==null&&normalizationChanges>rowCount*50)invalid();
 }
 const rules=object(basis.rules,['timeZone','dateFormat','inspectionTypes']);
 if(Object.keys(rules).length!==3||rules.timeZone!==stats.timeZone||!['yyyy-mm-dd','yyyy/mm/dd','iso-offset'].includes(rules.dateFormat as string))invalid();
 const types=object(rules.inspectionTypes,Object.keys(rules.inspectionTypes as object??{}));
 if(Object.keys(types).length>10000||Object.entries(types).some(([label,kind])=>!text(label)||!['initial','retest'].includes(kind as string)))invalid();
 const filter=object(basis.filter,['trendGranularity','retestPolicy','productIds','lineIds','dateFrom','dateTo']);
 if(filter.trendGranularity!==undefined&&!['day','week','month'].includes(filter.trendGranularity as string)||filter.retestPolicy!==undefined&&!['include-separately','exclude'].includes(filter.retestPolicy as string)||
  filter.dateFrom!==undefined&&!calendarDate(filter.dateFrom)||filter.dateTo!==undefined&&!calendarDate(filter.dateTo)||filter.dateFrom!==undefined&&filter.dateTo!==undefined&&(filter.dateFrom as string)>(filter.dateTo as string))invalid();
 for(const key of ['productIds','lineIds'])if(filter[key]!==undefined&&array(filter[key]).some(id=>!text(id)))invalid();
 if((filter.trendGranularity??'day')!==(stats.trendGranularity??'day'))invalid();
}
export function parseQualityRunView(value:unknown,recordId:string,runId:string,contentHash:string,includeReport:boolean):QualityRunView{
 const row=object(value,['recordId','runId','createdAt','contentHash','statistics','hasDefectSource','basis','markdown','reports','interpretations']);
 if(row.recordId!==recordId||row.runId!==runId||row.contentHash!==contentHash||typeof row.createdAt!=='string'||!Number.isFinite(Date.parse(row.createdAt))||typeof row.hasDefectSource!=='boolean'||(includeReport&&typeof row.markdown!=='string')||(row.markdown!==undefined&&(typeof row.markdown!=='string'||row.markdown.length>16*1024*1024)))invalid();
 if(row.interpretations!==undefined){
  if(!Array.isArray(row.interpretations)||row.interpretations.length>1000)invalid();const candidates=new Set<string>();
  for(const value of row.interpretations as unknown[]){const receipt=object(value,['recordId','runId','contentHash','candidateHash','assetId','revisionId','operationId']);
   if(Object.keys(receipt).length!==7||receipt.recordId!==recordId||receipt.runId!==runId||receipt.contentHash!==contentHash||typeof receipt.candidateHash!=='string'||!/^[a-f0-9]{64}$/.test(receipt.candidateHash)||!['assetId','revisionId','operationId'].every(key=>text(receipt[key]))||receipt.operationId!=='quality-interpretation-'+receipt.candidateHash||candidates.has(receipt.candidateHash))invalid();candidates.add(receipt.candidateHash as string);
  }
 }
 if(row.reports!==undefined){
  if(!Array.isArray(row.reports)||row.reports.length>1000)invalid();
  const operations=new Set<string>();
  for(const value of row.reports as unknown[]){const report=object(value,['runId','contentHash','sha256','operationId','assetId','revisionId','nodeId','format','detailKind']);
   if(report.runId!==runId||report.contentHash!==contentHash||typeof report.sha256!=='string'||!/^[a-f0-9]{64}$/.test(report.sha256)||!['operationId','assetId','revisionId','nodeId'].every(key=>text(report[key]))||operations.has(report.operationId as string))invalid();
   if(report.format!==undefined&&!['markdown','csv'].includes(report.format as string))invalid();
   if(report.detailKind!==undefined&&!['markdown','trend','products','pareto'].includes(report.detailKind as string))invalid();
   if(report.format==='markdown'&&report.detailKind!==undefined&&report.detailKind!=='markdown'||report.format==='csv'&&report.detailKind==='markdown')invalid();
   operations.add(report.operationId as string);
  }
 }
 const stats=object(row.statistics,['status','sourceNamespace','timeZone','quantityUnit','summary','trendGranularity','includedInspectionIds','trend','products','pareto']);
 if(stats.status!=='complete'||!text(stats.sourceNamespace)||!text(stats.timeZone)||(stats.quantityUnit!==null&&!text(stats.quantityUnit)))invalid();
 if(stats.trendGranularity!==undefined&&!['day','week','month'].includes(stats.trendGranularity as string))invalid();
 new Intl.DateTimeFormat('en',{timeZone:stats.timeZone as string});summary(stats.summary);
 const ids=array(stats.includedInspectionIds);if(ids.some(id=>!text(id))||new Set(ids).size!==ids.length)invalid();
 const dates=new Set<string>();for(const value of array(stats.trend)){const item=object(value,['date','summary']);if(typeof item.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(item.date)||!Number.isFinite(Date.parse(item.date))||new Date(item.date).toISOString().slice(0,10)!==item.date||dates.has(item.date))invalid();dates.add(item.date as string);summary(item.summary);}
 const products=new Set<unknown>();for(const value of array(stats.products)){const item=object(value,['productId','summary']);if((item.productId!==null&&!text(item.productId))||products.has(item.productId))invalid();products.add(item.productId);summary(item.summary);}
 const defects=new Set<string>();for(const value of array(stats.pareto)){const item=object(value,['defectCode','defectLabel','occurrences','cumulativeRate']);if(!text(item.defectCode)||!text(item.defectLabel)||!quantity(item.occurrences)||!rate(item.cumulativeRate)||defects.has(item.defectCode as string))invalid();defects.add(item.defectCode as string);}
 if(row.basis!==undefined)validateBasis(row.basis,stats,row.hasDefectSource as boolean);
 return freeze(structuredClone(row)) as unknown as QualityRunView;
}
