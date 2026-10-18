// Shared Host extraction; preview and Library use the same CSV parser and ExcelJS runtime.
import ExcelJS from 'exceljs';
import {compatibleXlsxBytes} from './xlsx-namespace.js';
import { decodeCsvBytes, parseCsv, csvLimits } from './csv.ts';
import {checkTabularArchiveBudget} from './archive-budget.js';
export {checkTabularArchiveBudget} from './archive-budget.js';
/** Bounded primitive-only workbook export. The caller owns authorization/provenance. */
export async function writeWorksheetTables(tables, signal) {
  signal?.throwIfAborted();
  if (!Array.isArray(tables) || tables.length < 1 || tables.length > 20) throw Error('WORKBOOK_EXPORT_TABLES_INVALID');
  let cells = 0, inputBytes = 0;
  const names = new Set();
  const validText = value => typeof value === 'string' && value.length <= 32767 &&
    [...value].every(c => { const n = c.codePointAt(0); return n === 9 || n === 10 || n === 13 || n >= 32 && n <= 0xd7ff || n >= 0xe000 && n <= 0xfffd || n >= 0x10000 && n <= 0x10ffff; });
  for (const table of tables) {
    signal?.throwIfAborted();
    if (!table || typeof table !== 'object' || Object.keys(table).sort().join(',') !== 'headers,name,rows' ||
        typeof table.name !== 'string' || !table.name.trim() || table.name.length > 31 ||
        /[\\/:*?\[\]]/.test(table.name) || table.name.startsWith("'") || table.name.endsWith("'") ||
        !validText(table.name) || names.has(table.name.toLowerCase()) ||
        !Array.isArray(table.headers) || table.headers.length < 1 || table.headers.length > 120 ||
        table.headers.some(v => !validText(v)) || !Array.isArray(table.rows) || table.rows.length > 10000)
      throw Error('WORKBOOK_EXPORT_TABLE_INVALID');
    names.add(table.name.toLowerCase());
    inputBytes += Buffer.byteLength(table.name) + table.headers.reduce((n,v) => n + Buffer.byteLength(v),0);
    cells += (table.rows.length + 1) * table.headers.length;
    if (cells > 200000) throw Error('WORKBOOK_EXPORT_CELL_LIMIT');
    for (const row of table.rows) {
      signal?.throwIfAborted();
      if (!Array.isArray(row) || row.length !== table.headers.length || row.some(v =>
          !(v === null || typeof v === 'boolean' || typeof v === 'number' && Number.isFinite(v) || validText(v))))
        throw Error('WORKBOOK_EXPORT_VALUE_INVALID');
      inputBytes += row.reduce((n,v) => n + (typeof v === 'string' ? Buffer.byteLength(v) : 8),0);
      if (inputBytes > 8 * 1024 * 1024) throw Error('WORKBOOK_EXPORT_INPUT_BYTE_LIMIT');
    }
  }
  const workbook = new ExcelJS.Workbook();
  for (const table of tables) {
    signal?.throwIfAborted();
    const sheet = workbook.addWorksheet(table.name);
    sheet.addRow(table.headers);
    for (const row of table.rows) { signal?.throwIfAborted(); sheet.addRow(row); }
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
  }
  signal?.throwIfAborted();
  const bytes = new Uint8Array(await workbook.xlsx.writeBuffer());
  signal?.throwIfAborted();
  if (bytes.length > 8 * 1024 * 1024) throw Error('WORKBOOK_EXPORT_BYTE_LIMIT');
  return bytes;
}
const escape = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\|/g, '&#124;').replace(/\r?\n/g, '<br>');
const tableMarkdown = rows => {
  if (!rows.length) return '';
  const width = Math.max(1, ...rows.map(row => row.length));
  const lines = rows.map(row => `| ${Array.from({ length: width }, (_, i) => escape(row[i])).join(' | ')} |`);
  lines.splice(1, 0, `| ${Array(width).fill('---').join(' | ')} |`);
  return lines.join('\n');
};
export async function extractTabularText(kind, bytes, signal) {
  signal?.throwIfAborted();
  if (kind === 'csv') {
    const decoded = decodeCsvBytes(bytes);
    if (decoded.binary) throw new Error('library/invalid-csv');
    const table = parseCsv(decoded.text);
    return { markdown: tableMarkdown(table.header.length ? [table.header, ...table.rows] : []) + '\n', warnings: table.truncatedRows || table.truncatedColumns ? ['CSV 检索文本仅包含前缀：最多 1500 行、120 列、24000 单元格；完整原件已保留。'] : [] };
  }
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await compatibleXlsxBytes(bytes,signal));
  signal?.throwIfAborted();
  const sections = [], warnings = ['公式不重新计算，仅提取已有缓存结果；图表、图片和格式不进入检索文本。'];
  let cells = 0, sheetCount = 0, truncated = false;
  workbook.eachSheet(sheet => {
    signal?.throwIfAborted();
    if (++sheetCount > 20 || cells >= csvLimits.cells) { truncated = true; return; }
    const width = Math.min(csvLimits.columns, sheet.columnCount);
    const count = Math.min(csvLimits.rows, sheet.rowCount, Math.floor((csvLimits.cells - cells) / Math.max(1, width)));
    if (width < sheet.columnCount || count < sheet.rowCount) truncated = true;
    const rows = [];
    for (let r = 1; r <= count; r++) {
      signal?.throwIfAborted();
      const row = [];
      for (let c = 1; c <= width; c++) {
        const cell = sheet.getCell(r, c);
        row.push(cell.text); cells++;
      }
      rows.push(row);
    }
    sections.push(`## ${escape(sheet.name)}\n\n${tableMarkdown(rows)}`);
  });
  if (truncated) warnings.push('XLSX 检索文本仅包含前缀：最多 20 个工作表、每表 1500 行/120 列、总计 24000 单元格；完整原件已保留。');
  return { markdown: sections.join('\n\n') + '\n', warnings };
}

// Structured analysis input: complete selected worksheet, never a retrieval prefix.
export async function readWorksheetTable(bytes, options = {}, signal) {
  signal?.throwIfAborted();
  await checkTabularArchiveBudget(bytes,options.archiveLimits,signal);
  const headerRow = options.headerRow ?? 1;
  if (!Number.isInteger(headerRow) || headerRow < 1) throw Error('INVALID_HEADER_ROW');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await compatibleXlsxBytes(bytes,signal));
  signal?.throwIfAborted();
  const worksheets = workbook.worksheets.map(sheet => sheet.name);
  if (!options.worksheet && worksheets.length !== 1) return { status: 'worksheet_required', worksheets };
  const sheet = workbook.getWorksheet(options.worksheet ?? worksheets[0]);
  if (!sheet) throw Error('WORKSHEET_NOT_FOUND');
  if (headerRow > sheet.rowCount) throw Error('INVALID_HEADER_ROW');
  const limits = { rows: 10000, columns: 50, cells: 500000, ...options.limits };
  for (const limit of Object.values(limits)) if (!Number.isInteger(limit) || limit < 1) throw Error('INVALID_TABLE_LIMIT');
  const width = sheet.columnCount, count = sheet.rowCount - headerRow;
  if (width > limits.columns || count > limits.rows || (count + 1) * width > limits.cells) throw Error('DATASET_LIMIT');
  const value = cell => {
    if (cell.isMerged) throw Error('WORKSHEET_MERGED_CELLS');
    const v = cell.value;
    if (v == null) return null;
    if (typeof v === 'string' || typeof v === 'boolean') return v;
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (v instanceof Date && Number.isFinite(v.getTime())) return v.toISOString();
    if (typeof v === 'object') {
      if ('formula' in v || 'sharedFormula' in v) throw Error('WORKSHEET_FORMULA_REQUIRES_EVALUATION');
      if ('error' in v) throw Error('WORKSHEET_ERROR_VALUE');
      if (Array.isArray(v.richText)) return v.richText.map(part => part.text).join('');
      if ('hyperlink' in v && typeof v.text === 'string') return v.text;
    }
    throw Error('WORKSHEET_VALUE_UNSUPPORTED');
  };
  const row = r => Array.from({ length: width }, (_, c) => value(sheet.getCell(r, c + 1)));
  const headers = row(headerRow).map(v => String(v ?? ''));
  const rows = [];
  for (let r = headerRow + 1; r <= sheet.rowCount; r++) { signal?.throwIfAborted(); rows.push(row(r)); }
  return { status: 'ready', worksheets, worksheet: sheet.name, headerRow, headers, rows, valuePolicy: 'native-primitives-dates-iso-formulas-rejected' };
}
