import {qualityMappingFields,type QualityTableKind} from './mapping.js';
import type {QualityNormalizationRules} from './normalization.js';
import type {QualityFilter} from './statistics.js';
export interface QualityAnalysisConfiguration {readonly inspectionsMapping:Readonly<Record<string,string>>;readonly defectsMapping?:Readonly<Record<string,string>>;readonly rules:QualityNormalizationRules;readonly filter:QualityFilter;}
function mapping(headers:readonly string[],kind:QualityTableKind,input:Readonly<Record<string,string>>){
 if(!headers.length||headers.length>50||new Set(headers).size!==headers.length||headers.some(header=>!header.trim()))throw new Error('输入表头无效，请重新选择完整数据。');
 const fields:readonly string[]=qualityMappingFields[kind],required=kind==='inspections'?fields.slice(0,6):fields;
 if(Object.keys(input).some(key=>!fields.includes(key))||required.some(key=>!input[key]))throw new Error('请完成所有必填字段映射。');
 if(Object.values(input).some(header=>!headers.includes(header)))throw new Error('映射引用了不存在的列，请重新选择。');
 if(new Set(Object.values(input)).size!==Object.keys(input).length)throw new Error('同一列不能映射到多个业务字段。');
 return Object.freeze({...input});
}
/** Shared finite configuration validation; Host must additionally resolve authorized sources and revisions. */
export function defineQualityAnalysisConfiguration(headers:readonly string[],defectHeaders:readonly string[]|undefined,input:QualityAnalysisConfiguration):QualityAnalysisConfiguration{
 const inspectionsMapping=mapping(headers,'inspections',input.inspectionsMapping);
 if(defectHeaders===undefined&&input.defectsMapping!==undefined)throw new Error('尚未选择缺陷来源，不能保存缺陷映射。');
 const defectsMapping=defectHeaders===undefined?undefined:mapping(defectHeaders,'defects',input.defectsMapping??{});
 const rules=input.rules;if(!rules.timeZone.trim()||rules.timeZone.length>128)throw new Error('请输入明确的业务时区。');
 try{new Intl.DateTimeFormat('en',{timeZone:rules.timeZone});}catch{throw new Error('业务时区无效，例如 Asia/Shanghai。');}
 if(!['yyyy-mm-dd','yyyy/mm/dd','iso-offset'].includes(rules.dateFormat))throw new Error('请选择原表日期格式。');
 const entries=Object.entries(rules.inspectionTypes);if(!entries.length||entries.length>100||entries.some(([key,value])=>!key.trim()||key.length>256||!['initial','retest'].includes(value)))throw new Error('请明确原表检验类型与初检、复检的对应关系。');
 const filter=input.filter;
 if(Object.keys(filter).some(key=>!['trendGranularity','retestPolicy','productIds','lineIds','dateFrom','dateTo'].includes(key)))throw new Error('分析筛选配置无效。');
 if(filter.trendGranularity!==undefined&&!['day','week','month'].includes(filter.trendGranularity))throw new Error('趋势粒度无效。');
 if(filter.retestPolicy!==undefined&&!['include-separately','exclude'].includes(filter.retestPolicy))throw new Error('复检策略无效。');
 // Detailed dates, dimensions, and retest/data consistency are enforced by the statistics core.
 return Object.freeze({inspectionsMapping,...(defectsMapping?{defectsMapping}:{}),rules:Object.freeze({...rules,inspectionTypes:Object.freeze({...rules.inspectionTypes})}),filter:Object.freeze(structuredClone(filter))});
}
