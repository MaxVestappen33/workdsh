import {defineQualityAnalysisConfiguration,type QualityAnalysisConfiguration} from '../domain/configuration.js';
export interface QualitySourceDescription {readonly headers:readonly string[];readonly rowCount:number;readonly sha256:string;readonly format?:Readonly<{kind:'xlsx';worksheet:string;headerRow:number;valuePolicy:string}>;readonly provenance?:Readonly<{kind:'library';assetId:string;revisionId:string}>;}
export interface QualityConfigurationView {readonly recordId:string;readonly generation:number;readonly sourceSnapshotId:string;readonly title:string;readonly sourceNamespace:string;readonly mappingRevision:string;readonly analysis:QualityAnalysisConfiguration;readonly inspections:QualitySourceDescription;readonly defects?:QualitySourceDescription;}
const text=(value:unknown):value is string=>typeof value==='string'&&!!value.trim()&&value.length<=256;
const hash=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
function object(value:unknown,keys:readonly string[]){if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('invalid-configuration-view');const row=value as Record<string,unknown>;if(Object.keys(row).some(key=>!keys.includes(key)))throw new Error('invalid-configuration-view');return row;}
export function parseQualitySourceDescription(value:unknown):QualitySourceDescription{
 const row=object(value,['headers','rowCount','sha256','format','provenance']);
 if(!Array.isArray(row.headers)||!row.headers.length||row.headers.length>50||row.headers.some(header=>typeof header!=='string'||!header.trim())||new Set(row.headers).size!==row.headers.length||!Number.isSafeInteger(row.rowCount)||(row.rowCount as number)<0||(row.rowCount as number)>10000||!hash(row.sha256))throw new Error('invalid-source-description');
 let format:QualitySourceDescription['format'],provenance:QualitySourceDescription['provenance'];
 if(row.format!==undefined){const item=object(row.format,['kind','worksheet','headerRow','valuePolicy']);if(item.kind!=='xlsx'||!text(item.worksheet)||!Number.isSafeInteger(item.headerRow)||(item.headerRow as number)<1||!text(item.valuePolicy))throw new Error('invalid-format');format=Object.freeze({kind:'xlsx',worksheet:item.worksheet,headerRow:item.headerRow as number,valuePolicy:item.valuePolicy});}
 if(row.provenance!==undefined){const item=object(row.provenance,['kind','assetId','revisionId']);if(item.kind!=='library'||!text(item.assetId)||!text(item.revisionId))throw new Error('invalid-provenance');provenance=Object.freeze({kind:'library',assetId:item.assetId,revisionId:item.revisionId});}
 return Object.freeze({headers:Object.freeze([...row.headers] as string[]),rowCount:row.rowCount as number,sha256:row.sha256,...(format?{format}:{}),...(provenance?{provenance}:{})});
}
export function parseQualityConfigurationView(value:unknown,recordId:string):QualityConfigurationView{
 const row=object(value,['recordId','generation','sourceSnapshotId','title','sourceNamespace','mappingRevision','analysis','inspections','defects']);
 if(row.recordId!==recordId||!Number.isSafeInteger(row.generation)||(row.generation as number)<0||!hash(row.sourceSnapshotId)||!hash(row.mappingRevision)||!text(row.title)||!text(row.sourceNamespace))throw new Error('invalid-configuration-view');
 const inspections=parseQualitySourceDescription(row.inspections),defects=row.defects===undefined?undefined:parseQualitySourceDescription(row.defects),raw=object(row.analysis,['inspectionsMapping','defectsMapping','rules','filter']);
 const rules=object(raw.rules,['timeZone','dateFormat','inspectionTypes']);if(!text(rules.timeZone)||!['yyyy-mm-dd','yyyy/mm/dd','iso-offset'].includes(rules.dateFormat as string))throw new Error('invalid-rules');
 const types=object(rules.inspectionTypes,Object.keys((rules.inspectionTypes??{}) as object));if(Object.keys(types).length>100)throw new Error('invalid-types');
 const fields=(value:unknown)=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.values(value).some(header=>typeof header!=='string'))throw new Error('invalid-mapping');return value as Record<string,string>;};
 const filter=object(raw.filter,['trendGranularity','retestPolicy','productIds','lineIds','dateFrom','dateTo']);
 for(const key of ['productIds','lineIds'])if(filter[key]!==undefined&&(!Array.isArray(filter[key])||(filter[key] as unknown[]).length>10000||(filter[key] as unknown[]).some(value=>!text(value))))throw new Error('invalid-filter');
 for(const key of ['dateFrom','dateTo'])if(filter[key]!==undefined&&(typeof filter[key]!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(filter[key] as string)))throw new Error('invalid-filter');
 const analysis=defineQualityAnalysisConfiguration(inspections.headers,defects?.headers,{inspectionsMapping:fields(raw.inspectionsMapping),...(raw.defectsMapping!==undefined?{defectsMapping:fields(raw.defectsMapping)}:{}),rules:{timeZone:rules.timeZone,dateFormat:rules.dateFormat as QualityAnalysisConfiguration['rules']['dateFormat'],inspectionTypes:types as Record<string,'initial'|'retest'>},filter});
 return Object.freeze({recordId,generation:row.generation as number,sourceSnapshotId:row.sourceSnapshotId,title:row.title,sourceNamespace:row.sourceNamespace,mappingRevision:row.mappingRevision,analysis,inspections,...(defects?{defects}:{})});
}
