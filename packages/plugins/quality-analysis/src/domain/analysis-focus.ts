import {z} from 'zod';
import type {QualityInspection,QualityStatistics,QualityTrendGranularity} from './statistics.js';

const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value=>{const parsed=new Date(value+'T00:00:00Z');return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===value;});
const id=z.string().min(1).max(256).refine(value=>!!value.trim()&&!/[\u0000-\u001f]/.test(value));
export const qualityFocusSelectionSchema=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('period'),date}).strict(),
 z.object({kind:z.literal('inspection'),inspectionId:id}).strict(),
]);
/** A business selection inside one immutable result; never another data source
 * or a model-supplied Session/record identity. */
export type QualityFocusSelection=z.infer<typeof qualityFocusSelectionSchema>;
export interface QualityFocusRange{readonly dateFrom:string;readonly dateTo:string;readonly trendGranularity:QualityTrendGranularity;}
export interface QualityFocusInspectionRow{readonly sourceRow:number;readonly location:{readonly record:number;readonly line:number};readonly inspection:QualityInspection;}
export interface QualityFocusedInspectionPage{
 readonly recordId:string;readonly runId:string;readonly contentHash:string;readonly selection:QualityFocusSelection;
 readonly range:QualityFocusRange;readonly offset:number;readonly total:number;readonly rows:readonly QualityFocusInspectionRow[];readonly nextOffset:number|null;
}
/** Same business-calendar grouping used by deterministic statistics. No second
 * timezone conversion is applied to the normalized inspection dates. */
export function qualityFocusPeriodStart(value:string,granularity:QualityTrendGranularity){
 if(granularity==='day')return value;
 if(granularity==='month')return value.slice(0,7)+'-01';
 const parsed=new Date(value+'T00:00:00Z');parsed.setUTCDate(parsed.getUTCDate()-(parsed.getUTCDay()+6)%7);
 const start=parsed.toISOString().slice(0,10);if(!date.safeParse(start).success)throw Error('quality/focus/invalid-selection');return start;
}
/** Resolve against the actual included IDs, so date/product/line/retest filters
 * and cleaning exclusions cannot be bypassed by a guessed inspection ID. */
export function resolveQualityFocus(statistics:QualityStatistics,inspections:readonly QualityInspection[],input:QualityFocusSelection){
 const parsed=qualityFocusSelectionSchema.safeParse(input);if(!parsed.success)throw Error('quality/focus/invalid-selection');const selection=parsed.data;
 if(statistics.status!=='complete')throw Error('quality/focus/unavailable');
 const trendGranularity=statistics.trendGranularity??'day',included=new Set(statistics.includedInspectionIds);
 if(selection.kind==='period'&&(!statistics.trend.some(point=>point.date===selection.date)||qualityFocusPeriodStart(selection.date,trendGranularity)!==selection.date))throw Error('quality/focus/not-found');
 const matched=inspections.filter(row=>included.has(row.inspectionId)&&(selection.kind==='inspection'?row.inspectionId===selection.inspectionId:qualityFocusPeriodStart(row.inspectionDate,trendGranularity)===selection.date));
 if(!matched.length||selection.kind==='inspection'&&matched.length!==1)throw Error('quality/focus/not-found');
 const dates=matched.map(row=>row.inspectionDate).sort(),range:QualityFocusRange={dateFrom:dates[0]!,dateTo:dates.at(-1)!,trendGranularity};
 return {selection,range,inspectionIds:new Set(matched.map(row=>row.inspectionId))};
}
const quantity=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const inspection=z.object({inspectionId:id,productId:id.optional(),batchId:id.optional(),lineId:id.optional(),inspectionDate:date,inspectedQuantity:quantity,nonconformingQuantity:quantity,quantityUnit:id,inspectionType:z.enum(['initial','retest'])}).strict().refine(row=>row.nonconformingQuantity<=row.inspectedQuantity);
const page=z.object({recordId:id,runId:id,contentHash:z.string().regex(/^[a-f0-9]{64}$/),selection:qualityFocusSelectionSchema,
 range:z.object({dateFrom:date,dateTo:date,trendGranularity:z.enum(['day','week','month'])}).strict().refine(range=>range.dateFrom<=range.dateTo),
 offset:quantity,total:quantity,rows:z.array(z.object({sourceRow:z.number().int().positive(),location:z.object({record:z.number().int().positive(),line:z.number().int().positive()}).strict(),inspection}).strict()).max(20),nextOffset:quantity.nullable(),
}).strict();
/** Decode one Host receipt without trusting a stale selection or foreign run. */
export function parseQualityFocusedInspectionPage(value:unknown,expected:{recordId:string;runId:string;contentHash:string;selection:QualityFocusSelection;offset:number}):QualityFocusedInspectionPage{
 const parsed=page.safeParse(value);if(!parsed.success)throw Error('quality/focus/invalid-page');const result=parsed.data;
 if(result.recordId!==expected.recordId||result.runId!==expected.runId||result.contentHash!==expected.contentHash||JSON.stringify(result.selection)!==JSON.stringify(qualityFocusSelectionSchema.parse(expected.selection))||result.offset!==expected.offset||result.total<1||result.rows.length!==Math.min(20,Math.max(0,result.total-result.offset))||result.nextOffset!==(result.offset+result.rows.length<result.total?result.offset+result.rows.length:null)||new Set(result.rows.map(row=>row.inspection.inspectionId)).size!==result.rows.length||result.rows.some(row=>row.inspection.inspectionDate<result.range.dateFrom||row.inspection.inspectionDate>result.range.dateTo||result.selection.kind==='inspection'&&row.inspection.inspectionId!==result.selection.inspectionId||result.selection.kind==='period'&&qualityFocusPeriodStart(row.inspection.inspectionDate,result.range.trendGranularity)!==result.selection.date))throw Error('quality/focus/invalid-page');
 return Object.freeze(result);
}
