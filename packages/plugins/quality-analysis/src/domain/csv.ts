export interface CompleteCsvTable {
  readonly complete: true;
  readonly encoding: 'utf-8';
  readonly byteLength: number;
  readonly headers: readonly string[];
  readonly rows: readonly (readonly string[])[];
  readonly locations: readonly { readonly record: number; readonly line: number }[];
  readonly ignoredBlankRecords: number;
}
export class QualityCsvError extends Error {
  constructor(readonly code: string, readonly record: number) { super(`quality/csv/${code}`); }
}

/** Full UTF-8 parsing, never a preview prefix. Run in a cancellable Host worker.
 * Empty physical records are ignored; quoted empty fields remain data.
 * Values stay strings, including leading zeroes and spreadsheet-like formulas.
 */
export function parseCompleteQualityCsv(bytes: Uint8Array, signal?: AbortSignal): CompleteCsvTable {
  const fail = (code: string): never => { throw new QualityCsvError(code, record); };
  let record = 1;
  if (bytes.byteLength > 8 * 1024 * 1024) fail('byte-budget-exceeded');
  signal?.throwIfAborted();
  let source: string;
  try { source = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return fail('invalid-utf8'); }
  const records: string[][] = [];
  const locations: { readonly record: number; readonly line: number }[] = [];
  let line = 1, startLine = 1;
  let row: string[] = [], field = '', state: 'plain' | 'quoted' | 'closed' = 'plain', touched = false, blanks = 0;
  const cell = () => { row.push(field); field = ''; if (row.length > 50) fail('column-budget-exceeded'); };
  const finish = () => {
    if (!touched && row.length === 0 && field === '') blanks++;
    else { cell(); records.push(row); locations.push(Object.freeze({record, line:startLine})); if (records.length > 10001) fail('row-budget-exceeded'); }
    row = []; field = ''; state = 'plain'; touched = false; record++;
  };
  for (let i = 0; i < source.length; i++) {
    if ((i & 4095) === 0) signal?.throwIfAborted();
    const c = source[i];
    if (c === '\0') fail('nul-character');
    if (state === 'quoted') {
      if (c === '"') {
        if (source[i + 1] === '"') { field += '"'; i++; }
        else state = 'closed';
      } else {
        field += c;
        if (c === '\n' || (c === '\r' && source[i + 1] !== '\n')) line++;
      }
      continue;
    }
    if (c === ',') { cell(); state = 'plain'; touched = true; continue; }
    if (c === '\r' || c === '\n') { if (c === '\r' && source[i + 1] === '\n') i++; finish(); line++; startLine = line; continue; }
    if (state === 'closed') fail('characters-after-quote');
    if (c === '"') { if (field !== '') fail('quote-in-unquoted-field'); state = 'quoted'; touched = true; }
    else { field += c; touched = true; }
  }
  if (state === 'quoted') fail('unterminated-quote');
  if (touched || row.length || field) finish();
  signal?.throwIfAborted();
  if (!records.length) fail('missing-header');
  const headers = records.shift()!.map(value => value.trim());
  const headerLocation = locations.shift()!;
  record = headerLocation.record;
  if (headers.some(value => !value)) fail('empty-header');
  if (new Set(headers).size !== headers.length) fail('duplicate-header');
  for (const [index, values] of records.entries()) {
    record = locations[index].record;
    if (values.length !== headers.length) fail('column-count-mismatch');
  }
  return Object.freeze({ complete: true, encoding: 'utf-8', byteLength: bytes.byteLength,
    headers: Object.freeze(headers), rows: Object.freeze(records.map(values => Object.freeze(values))), locations:Object.freeze(locations), ignoredBlankRecords: blanks });
}
