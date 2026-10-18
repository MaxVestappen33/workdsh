export interface QualityInspection {
  readonly inspectionId: string; readonly productId?: string; readonly batchId?: string; readonly lineId?: string;
  /** Business calendar date already mapped using dataset.timeZone. */
  readonly inspectionDate: string; readonly inspectedQuantity: number; readonly nonconformingQuantity: number;
  readonly quantityUnit: string; readonly inspectionType: 'initial' | 'retest';
}
export interface QualityDefect { readonly defectId: string; readonly inspectionId: string; readonly defectCode: string; readonly defectLabel: string; readonly occurrences: number }
export interface QualityDataset { readonly sourceNamespace: string; readonly timeZone: string; readonly complete: boolean; readonly inspections: readonly unknown[]; readonly defects: readonly unknown[] }
/** Host pipeline provenance, kept separate from the business data snapshot. */
export interface QualityStatisticsSourceRows {readonly inspections:readonly number[];readonly defects?:readonly number[];}
export type QualityTrendGranularity='day'|'week'|'month';
export interface QualityFilter { readonly trendGranularity?:QualityTrendGranularity; readonly productIds?: readonly string[]; readonly lineIds?: readonly string[]; readonly dateFrom?: string; readonly dateTo?: string; readonly retestPolicy?: 'include-separately' | 'exclude' }
export interface QualityIssue { readonly table: 'dataset' | 'inspections' | 'defects'; readonly row?: number; readonly code: string }
export interface QualitySummary {
  readonly inspectionCount: number; readonly inspectedQuantity: number; readonly nonconformingQuantity: number;
  readonly conformingQuantity: number; readonly nonconformingRate: number | null; readonly defectOccurrences: number;
}
export type QualityStatistics = { readonly status: 'blocked'; readonly issues: readonly QualityIssue[] } | {
  readonly status: 'complete'; readonly sourceNamespace: string; readonly timeZone: string; readonly quantityUnit: string | null;
  readonly summary: QualitySummary;
  readonly trendGranularity?:QualityTrendGranularity;
  readonly includedInspectionIds: readonly string[];
  readonly trend: readonly { readonly date: string; readonly summary: QualitySummary }[];
  readonly products: readonly { readonly productId: string | null; readonly summary: QualitySummary }[];
  readonly pareto: readonly { readonly defectCode: string; readonly defectLabel: string; readonly occurrences: number; readonly cumulativeRate: number | null }[];
};
const object = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const text = (value: unknown): value is string => typeof value === 'string' && !!value.trim() && value.length <= 256 && !/[\u0000-\u001f]/.test(value);
const quantity = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
function date(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
/** Dates are already business calendar dates; grouping does not apply a second timezone conversion. */
function periodStart(value:string,granularity:QualityTrendGranularity){
  if(granularity==='day')return value;
  if(granularity==='month')return value.slice(0,7)+'-01';
  const date=new Date(value+'T00:00:00.000Z');date.setUTCDate(date.getUTCDate()-(date.getUTCDay()+6)%7);
  const start=date.toISOString().slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(start))throw new Error('quality/period-out-of-range');return start;
}
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
function add(a: number, b: number) { const sum = a + b; if (!Number.isSafeInteger(sum)) throw new Error('quality/quantity-overflow'); return sum; }
function summarize(rows: readonly QualityInspection[], defects: readonly QualityDefect[]): QualitySummary {
  const inspectedQuantity = rows.reduce((sum, row) => add(sum, row.inspectedQuantity), 0);
  const nonconformingQuantity = rows.reduce((sum, row) => add(sum, row.nonconformingQuantity), 0);
  return Object.freeze({ inspectionCount: rows.length, inspectedQuantity, nonconformingQuantity,
    conformingQuantity: inspectedQuantity - nonconformingQuantity, nonconformingRate: inspectedQuantity === 0 ? null : nonconformingQuantity / inspectedQuantity,
    defectOccurrences: defects.reduce((sum, row) => add(sum, row.occurrences), 0) });
}

/** Deterministic core for complete, mapped snapshots. Invalid rows block statistics;
 * corrections/exclusions must first form an explicitly traced cleaned dataset.
 * No preview-prefix input, AI-generated quantities, or automatic row dropping.
 */
export function calculateQualityStatistics(dataset: QualityDataset, filter: QualityFilter = {}, sourceRows?:QualityStatisticsSourceRows): QualityStatistics {
  const issues: QualityIssue[] = [], inspections: QualityInspection[] = [], defects: QualityDefect[] = [];
  const issue = (table: QualityIssue['table'], code: string, row?: number) => issues.push(Object.freeze({ table, code, ...(row === undefined ? {} : { row }) }));
  const blocked = (): QualityStatistics => Object.freeze({ status: 'blocked', issues: Object.freeze(issues) });
  if (dataset.complete !== true) issue('dataset', 'incomplete-source');
  if (!text(dataset.sourceNamespace)) issue('dataset', 'invalid-source-namespace');
  try { if (!text(dataset.timeZone)) throw new Error(); new Intl.DateTimeFormat('en', { timeZone: dataset.timeZone }); } catch { issue('dataset', 'invalid-time-zone'); }
  if (!Array.isArray(dataset.inspections) || !Array.isArray(dataset.defects)) { issue('dataset', 'invalid-tables'); return blocked(); }
  for(const [rows,numbers] of [[dataset.inspections,sourceRows?.inspections],[dataset.defects,sourceRows?.defects]] as const){
    if(numbers!==undefined&&(numbers.length!==rows.length||numbers.some(row=>!Number.isSafeInteger(row)||row<1)||new Set(numbers).size!==numbers.length))throw new Error('quality/statistics/invalid-source-rows');
  }
  if (dataset.inspections.length > 10000 || dataset.defects.length > 10000) { issue('dataset', 'row-budget-exceeded'); return blocked(); }
  if ((filter.dateFrom !== undefined && !date(filter.dateFrom)) || (filter.dateTo !== undefined && !date(filter.dateTo)) ||
    (filter.dateFrom && filter.dateTo && filter.dateFrom > filter.dateTo) ||
    [filter.productIds, filter.lineIds].some(values => values !== undefined && (!Array.isArray(values) || values.some(value => !text(value)))) ||
    (filter.retestPolicy !== undefined && !['include-separately', 'exclude'].includes(filter.retestPolicy)) ||
    (filter.trendGranularity!==undefined&&!['day','week','month'].includes(filter.trendGranularity))) issue('dataset', 'invalid-filter');
  const inspectionIds = new Set<string>();
  for (const [index, raw] of dataset.inspections.entries()) {
    const row = object(raw), rowNumber = sourceRows?.inspections[index] ?? index + 1;
    if (row?.sourceNamespace !== undefined && row.sourceNamespace !== dataset.sourceNamespace) { issue('inspections', 'source-namespace-mismatch', rowNumber); continue; }
    if (!row || !['inspectionId', 'quantityUnit'].every(key => text(row[key])) || ['productId', 'batchId', 'lineId'].some(key => row[key] !== undefined && !text(row[key])) || !date(row.inspectionDate) ||
      !quantity(row.inspectedQuantity) || !quantity(row.nonconformingQuantity) || row.nonconformingQuantity > row.inspectedQuantity || !['initial', 'retest'].includes(String(row.inspectionType))) { issue('inspections', 'invalid-inspection', rowNumber); continue; }
    if (inspectionIds.has(row.inspectionId as string)) { issue('inspections', 'duplicate-inspection-id', rowNumber); continue; }
    inspectionIds.add(row.inspectionId as string);
    inspections.push(Object.freeze({ inspectionId: row.inspectionId as string, ...(row.productId === undefined ? {} : { productId: row.productId as string }), ...(row.batchId === undefined ? {} : { batchId: row.batchId as string }), ...(row.lineId === undefined ? {} : { lineId: row.lineId as string }),
      quantityUnit: row.quantityUnit as string, inspectionDate: row.inspectionDate, inspectedQuantity: row.inspectedQuantity, nonconformingQuantity: row.nonconformingQuantity, inspectionType: row.inspectionType as QualityInspection['inspectionType'] }));
  }
  const defectIds = new Set<string>(), labels = new Map<string, string>();
  for (const [index, raw] of dataset.defects.entries()) {
    const row = object(raw), rowNumber = sourceRows?.defects?.[index] ?? index + 1;
    if (row?.sourceNamespace !== undefined && row.sourceNamespace !== dataset.sourceNamespace) { issue('defects', 'source-namespace-mismatch', rowNumber); continue; }
    if (!row || !['defectId', 'inspectionId', 'defectCode', 'defectLabel'].every(key => text(row[key])) || !quantity(row.occurrences)) { issue('defects', 'invalid-defect', rowNumber); continue; }
    if (defectIds.has(row.defectId as string)) { issue('defects', 'duplicate-defect-id', rowNumber); continue; }
    defectIds.add(row.defectId as string);
    if (!inspectionIds.has(row.inspectionId as string)) { issue('defects', 'orphan-defect', rowNumber); continue; }
    const oldLabel = labels.get(row.defectCode as string);
    if (oldLabel !== undefined && oldLabel !== row.defectLabel) { issue('defects', 'conflicting-defect-label', rowNumber); continue; }
    labels.set(row.defectCode as string, row.defectLabel as string);
    defects.push(Object.freeze({ defectId: row.defectId as string, inspectionId: row.inspectionId as string, defectCode: row.defectCode as string, defectLabel: row.defectLabel as string, occurrences: row.occurrences }));
  }
  if (issues.length) return blocked();
  const productIds = filter.productIds ? new Set(filter.productIds) : undefined, lineIds = filter.lineIds ? new Set(filter.lineIds) : undefined;
  const selected = inspections.filter(row => (!productIds || (row.productId !== undefined && productIds.has(row.productId))) && (!lineIds || (row.lineId !== undefined && lineIds.has(row.lineId))) &&
    (!filter.dateFrom || row.inspectionDate >= filter.dateFrom) && (!filter.dateTo || row.inspectionDate <= filter.dateTo));
  if (selected.some(row => row.inspectionType === 'retest') && filter.retestPolicy === undefined) issue('dataset', 'retest-policy-required');
  const rows = filter.retestPolicy === 'exclude' ? selected.filter(row => row.inspectionType !== 'retest') : selected;
  const units = new Set(rows.map(row => row.quantityUnit));
  if (units.size > 1) issue('dataset', 'mixed-quantity-units');
  if (issues.length) return blocked();
  const included = new Set(rows.map(row => row.inspectionId)), linked = defects.filter(row => included.has(row.inspectionId));
  try {
    const summary = summarize(rows, linked);
    const byId = new Map(rows.map(row => [row.inspectionId, row]));
    const group = (select:(row:QualityInspection)=>string|null) => {
      const groups = new Map<string | null, { rows: QualityInspection[]; defects: QualityDefect[] }>();
      for (const row of rows) {
        let bucket = groups.get(select(row));
        if (!bucket) { bucket = { rows: [], defects: [] }; groups.set(select(row), bucket); }
        bucket.rows.push(row);
      }
      for (const defect of linked) groups.get(select(byId.get(defect.inspectionId)!))!.defects.push(defect);
      return [...groups.keys()].sort((a, b) => a === null ? (b === null ? 0 : -1) : b === null ? 1 : compare(a, b)).map(value => {
        const bucket = groups.get(value)!;
        return { value, summary: summarize(bucket.rows, bucket.defects) };
      });
    };
    const buckets = new Map<string, number>();
    for (const row of linked) buckets.set(row.defectCode, add(buckets.get(row.defectCode) ?? 0, row.occurrences));
    let cumulative = 0;
    const pareto = [...buckets.entries()].sort((a, b) => b[1] - a[1] || compare(a[0], b[0])).map(([defectCode, occurrences]) => {
      cumulative = add(cumulative, occurrences);
      return Object.freeze({ defectCode, defectLabel: labels.get(defectCode)!, occurrences, cumulativeRate: summary.defectOccurrences === 0 ? null : cumulative / summary.defectOccurrences });
    });
    return Object.freeze({ status: 'complete', sourceNamespace: dataset.sourceNamespace, timeZone: dataset.timeZone, quantityUnit: [...units][0] ?? null, summary,
      trendGranularity:filter.trendGranularity??'day', includedInspectionIds: Object.freeze([...included].sort(compare)), trend: Object.freeze(group(row=>periodStart(row.inspectionDate,filter.trendGranularity??'day')).map(row => Object.freeze({ date: row.value!, summary: row.summary }))),
      products: Object.freeze(group(row=>row.productId??null).map(row => Object.freeze({ productId: row.value, summary: row.summary }))), pareto: Object.freeze(pareto) });
  } catch (cause) {
    if(cause instanceof Error&&cause.message==='quality/period-out-of-range'){issue('dataset','period-out-of-range');return blocked();}
    if (cause instanceof Error && cause.message === 'quality/quantity-overflow') { issue('dataset', 'quantity-overflow'); return blocked(); }
    throw cause;
  }
}
