import type {QualityStatistics} from '../domain/statistics.js';

type CompleteStatistics=Extract<QualityStatistics,{status:'complete'}>;
export interface QualityResultMetric {readonly label:string;readonly value:string;readonly caption:string;readonly primary?:boolean;}
const counts=new Intl.NumberFormat('zh-CN');
export const qualityCount=(value:number)=>counts.format(value);
export const qualityPercentage=(value:number|null)=>value===null?'无法计算':`${(value*100).toFixed(2)}%`;

/** Presentation of Host-calculated statistics only. Missing detail and a zero
 * denominator remain distinct from a measured zero. */
export function qualityResultMetrics(result:CompleteStatistics,hasDefectSource:boolean):readonly QualityResultMetric[]{
 const summary=result.summary;
 return [
  {label:'合格率',value:qualityPercentage(summary.nonconformingRate===null?null:1-summary.nonconformingRate),
   caption:summary.nonconformingRate===null?'检验数量为 0，无法计算比例':`合格 ${qualityCount(summary.conformingQuantity)} · 按检验数量计算`,primary:true},
  {label:'检验数量',value:qualityCount(summary.inspectedQuantity),caption:`来自 ${qualityCount(summary.inspectionCount)} 条检验记录`},
  {label:'不合格数量',value:qualityCount(summary.nonconformingQuantity),caption:`不合格率 ${qualityPercentage(summary.nonconformingRate)}`},
  {label:'缺陷次数',value:hasDefectSource?qualityCount(summary.defectOccurrences):'未提供',
   caption:hasDefectSource?'按缺陷明细独立累计':'尚未导入缺陷明细，不能视为 0'},
 ];
}

/** The caller retains the original source description. Display a leading saved
 * timestamp as a business-local date rather than an ISO transport timestamp. */
export function qualityResultSourceLabel(description:string,timeZone:string):string{
 const match=/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))(.*)$/.exec(description);
 if(!match||!Number.isFinite(Date.parse(match[1])))return description;
 const formatted=new Intl.DateTimeFormat('zh-CN',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(match[1]));
 return formatted+match[2];
}
