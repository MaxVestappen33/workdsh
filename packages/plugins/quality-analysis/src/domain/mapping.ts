import type { QualityRawTable } from './raw-table';

export const qualityMappingFields = {
  inspections: ['inspectionId', 'inspectionDate', 'inspectedQuantity', 'nonconformingQuantity', 'quantityUnit', 'inspectionType', 'productId', 'batchId', 'lineId'],
  defects: ['defectId', 'inspectionId', 'defectCode', 'defectLabel', 'occurrences'],
} as const;
Object.freeze(qualityMappingFields.inspections);Object.freeze(qualityMappingFields.defects);Object.freeze(qualityMappingFields);
export type QualityTableKind = keyof typeof qualityMappingFields;
export interface MappingIssue { readonly row: number; readonly field: string; readonly code: string }
export interface MappedQualityTable {
  readonly kind: QualityTableKind;
  readonly rows: readonly Readonly<Record<string, string | number | boolean | null>>[];
  readonly issues: readonly MappingIssue[];
  readonly mapping: Readonly<Record<string, string>>;
  readonly locations: QualityRawTable['locations'];
  /** One-based rows in the original imported data, before exclusions. */
  readonly sourceRows?: readonly number[];
}

/** Explicit header mapping, no inferred units, dates, quantities or retest rules.
 * Invalid cells remain their original strings so downstream validation blocks.
 * row identifies the one-based data record, matching the statistics validator.
 */
export function mapQualityTable(table: QualityRawTable, kind: QualityTableKind, mapping: Readonly<Record<string, string>>, sourceRows?: readonly number[]): MappedQualityTable {
  if (table.complete !== true || !Object.hasOwn(qualityMappingFields, kind)) throw new Error('quality/mapping/invalid-table');
  const originalRows=sourceRows===undefined?table.rows.map((_,index)=>index+1):[...sourceRows];
  if(originalRows.length!==table.rows.length||originalRows.some(row=>!Number.isSafeInteger(row)||row<1)||new Set(originalRows).size!==originalRows.length)throw new Error('quality/mapping/invalid-source-rows');
  const allowed: readonly string[] = qualityMappingFields[kind];
  const required = kind === 'inspections' ? allowed.slice(0, 6) : allowed;
  const keys = Object.keys(mapping);
  if (keys.some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(mapping, key))) throw new Error('quality/mapping/invalid-fields');
  const indexes = new Map<string, number>();
  for (const key of keys) {
    const header = mapping[key];
    const index = table.headers.indexOf(header);
    if (typeof header !== 'string' || index < 0 || table.headers.lastIndexOf(header) !== index) throw new Error('quality/mapping/missing-header');
    indexes.set(key, index);
  }
  if (new Set(Object.values(mapping)).size !== keys.length) throw new Error('quality/mapping/reused-header');
  const numeric = new Set(['inspectedQuantity', 'nonconformingQuantity', 'occurrences']);
  const issues: MappingIssue[] = [];
  const rows = table.rows.map((values, index) => {
    if (values.length !== table.headers.length) throw new Error('quality/mapping/invalid-row');
    const row: Record<string, string | number | boolean | null> = {};
    for (const key of keys) {
      const original = values[indexes.get(key)!];
      if (numeric.has(key)) {
        if ((typeof original==='number' && Number.isSafeInteger(original) && original>=0) || (typeof original==='string' && /^(0|[1-9]\d*)$/.test(original) && Number.isSafeInteger(Number(original)))) row[key] = Number(original);
        else { row[key] = original; issues.push(Object.freeze({ row: originalRows[index], field: key, code: 'invalid-integer' })); }
      } else if ((original === '' || original === null) && !required.includes(key)) {
        // Empty optional dimensions stay absent, not an invented category.
      } else row[key] = original;
    }
    return Object.freeze(row);
  });
  if (table.locations.length !== rows.length) throw new Error('quality/mapping/invalid-locations');
  return Object.freeze({ kind, rows: Object.freeze(rows), issues: Object.freeze(issues), mapping: Object.freeze({ ...mapping }),
    locations:Object.freeze(table.locations.map(location=>Object.freeze({...location}))),sourceRows:Object.freeze(originalRows) });
}
