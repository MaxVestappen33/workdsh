import type { QualityRawTable } from './raw-table';
export type QualityCleaningDecision = {
  readonly kind: 'correct'; readonly row: number; readonly header: string; readonly expected: string|number|boolean|null; readonly value: string; readonly reason: string;
} | { readonly kind: 'exclude'; readonly row: number; readonly reason: string };
export interface CleaningActor { readonly principalId: string; readonly decidedAt: string }

/** actor is captured by the authorized Host service, never accepted from page data.
 * Decisions address original one-based data rows, not a shifting cleaned index.
 */
export function cleanQualityTable(original: QualityRawTable, decisions: readonly QualityCleaningDecision[], actor: CleaningActor) {
  if (!actor.principalId || !Number.isFinite(Date.parse(actor.decidedAt))) throw new Error('quality/cleaning/invalid-actor');
  if (original.complete !== true || original.locations.length !== original.rows.length || decisions.length > 10000) throw new Error('quality/cleaning/invalid-source');
  const rows = original.rows.map(values=>[...values]);
  const excluded = new Set<number>(), corrected = new Set<string>(), correctedRows = new Set<number>();
  const audit = decisions.map(decision=> {
    if (!Number.isSafeInteger(decision.row) || decision.row < 1 || decision.row > rows.length || typeof decision.reason !== 'string' || !decision.reason.trim() || decision.reason.length > 2000) throw new Error('quality/cleaning/invalid-decision');
    const index=decision.row-1;
    if (excluded.has(index)) throw new Error('quality/cleaning/conflicting-decision');
    if (decision.kind === 'exclude') {
      if (correctedRows.has(index)) throw new Error('quality/cleaning/conflicting-decision');
      excluded.add(index);
      return Object.freeze({...decision,location:Object.freeze({...original.locations[index]}),actor:Object.freeze({...actor})});
    }
    if (decision.kind !== 'correct') throw new Error('quality/cleaning/invalid-kind');
    const column=original.headers.indexOf(decision.header), key=`${index}:${column}`;
    if (column < 0 || original.headers.lastIndexOf(decision.header)!==column || typeof decision.value !== 'string' || decision.value.length > 65536 || decision.value.includes('\0')) throw new Error('quality/cleaning/invalid-correction');
    if (corrected.has(key)) throw new Error('quality/cleaning/conflicting-decision');
    if (original.rows[index][column] !== decision.expected) throw new Error('quality/cleaning/stale-original-value');
    corrected.add(key); correctedRows.add(index); rows[index][column]=decision.value;
    return Object.freeze({...decision,location:Object.freeze({...original.locations[index]}),actor:Object.freeze({...actor})});
  });
  const retained = rows.map((values,index)=>({values,index})).filter(row=>!excluded.has(row.index));
  const table: QualityRawTable = Object.freeze({...original,headers:Object.freeze([...original.headers]),
    rows:Object.freeze(retained.map(row=>Object.freeze(row.values))),
    locations:Object.freeze(retained.map(row=>Object.freeze({...original.locations[row.index]})))});
  // Retained indexes address the complete imported table, not the compacted
  // cleaned table. Mapping and validation use these to locate later problems.
  const sourceRows=Object.freeze(retained.map(row=>row.index+1));
  return Object.freeze({table,audit:Object.freeze(audit),excludedCount:excluded.size,sourceRows});
}
