import type { MappedQualityTable } from './mapping';

export interface QualityNormalizationRules {
  readonly timeZone: string;
  readonly dateFormat: 'yyyy-mm-dd' | 'yyyy/mm/dd' | 'iso-offset';
  readonly inspectionTypes: Readonly<Record<string, 'initial' | 'retest'>>;
}
export interface NormalizationChange { readonly row: number; readonly field: string; readonly before: string; readonly after: string }
export interface NormalizedQualityTable {
  readonly table: MappedQualityTable;
  readonly changes: readonly NormalizationChange[];
  readonly issues: readonly { readonly row: number; readonly field: string; readonly code: string }[];
  readonly rules: QualityNormalizationRules;
}
function calendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function convertDate(value: string, rules: QualityNormalizationRules): string | undefined {
  if (rules.dateFormat === 'yyyy-mm-dd') return calendarDate(value) ? value : undefined;
  if (rules.dateFormat === 'yyyy/mm/dd') {
    const result = value.replaceAll('/', '-');
    return /^\d{4}\/\d{2}\/\d{2}$/.test(value) && calendarDate(result) ? result : undefined;
  }
  // No timezone-less timestamp or permissive Date parsing / rollover.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !calendarDate(value.slice(0,10))) return;
  const time = value.slice(11,19).split(':').map(Number);
  if (time[0] > 23 || time[1] > 59 || time[2] > 59) return;
  if (!value.endsWith('Z')) {
    const offset = value.slice(-5).split(':').map(Number);
    if (offset[0] > 23 || offset[1] > 59) return;
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return;
  const parts = new Intl.DateTimeFormat('en', { timeZone: rules.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const part = (key: string) => parts.find(value => value.type === key)!.value;
  const result = `${part('year')}-${part('month')}-${part('day')}`;
  return calendarDate(result) ? result : undefined;
}

/** Explicit normalization creates a new snapshot; original mapped rows stay intact. */
export function normalizeQualityTable(input: MappedQualityTable, rules: QualityNormalizationRules): NormalizedQualityTable {
  if (!['yyyy-mm-dd','yyyy/mm/dd','iso-offset'].includes(rules.dateFormat)) throw new Error('quality/normalization/invalid-format');
  try { new Intl.DateTimeFormat('en', {timeZone: rules.timeZone}); } catch { throw new Error('quality/normalization/invalid-time-zone'); }
  if (!rules.timeZone || Object.entries(rules.inspectionTypes).some(([key,value]) => !key || !['initial','retest'].includes(value))) throw new Error('quality/normalization/invalid-types');
  const sourceRows=input.sourceRows??input.rows.map((_,index)=>index+1);
  if(sourceRows.length!==input.rows.length||sourceRows.some(row=>!Number.isSafeInteger(row)||row<1)||new Set(sourceRows).size!==sourceRows.length)throw new Error('quality/normalization/invalid-source-rows');
  const changes: NormalizationChange[] = [], issues = [...input.issues];
  const rows = input.rows.map((original,index) => {
    const row = {...original};
    if (input.kind === 'inspections') {
      for (const field of ['inspectionDate','inspectionType']) {
        const before = original[field];
        const after = typeof before !== 'string' ? undefined : field === 'inspectionDate' ? convertDate(before,rules) : Object.hasOwn(rules.inspectionTypes,before) ? rules.inspectionTypes[before] : undefined;
        if (after === undefined) issues.push(Object.freeze({row:sourceRows[index],field,code:field==='inspectionDate'?'invalid-date':'unmapped-inspection-type'}));
        else { row[field]=after; if (after!==before) changes.push(Object.freeze({row:sourceRows[index],field,before:before as string,after})); }
      }
    }
    return Object.freeze(row);
  });
  return Object.freeze({ table: Object.freeze({...input, rows:Object.freeze(rows), issues:Object.freeze(issues)}), changes:Object.freeze(changes), issues:Object.freeze(issues),
    rules:Object.freeze({...rules,inspectionTypes:Object.freeze({...rules.inspectionTypes})}) });
}
