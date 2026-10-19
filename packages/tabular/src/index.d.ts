export declare function extractTabularText(kind: 'csv' | 'xlsx', bytes: Uint8Array, signal?: AbortSignal): Promise<{ markdown: string; warnings: readonly string[] }>;

/** Complete primitive-only tables; no formulas, styling API, filesystem or session access. */
export declare function writeWorksheetTables(tables: readonly { name: string; headers: readonly string[]; rows: readonly (readonly (string | number | boolean | null)[])[] }[], signal?: AbortSignal): Promise<Uint8Array>;

export declare function checkTabularArchiveBudget(bytes: Uint8Array, limits?: { inputBytes?:number; expandedBytes?:number; entryBytes?:number; entries?:number }, signal?:AbortSignal):Promise<{readonly inputBytes:number;readonly expandedBytes:number;readonly entries:number}>;
export declare function readWorksheetTable(bytes: Uint8Array, options?: { worksheet?: string; headerRow?: number; limits?: { rows?: number; columns?: number; cells?: number }; archiveLimits?: { inputBytes?:number; expandedBytes?:number; entryBytes?:number; entries?:number } }, signal?: AbortSignal): Promise<
 { status: 'worksheet_required'; worksheets: string[] } |
 { status: 'ready'; worksheets: string[]; worksheet: string; headerRow: number; headers: string[]; rows: (string | number | boolean | null)[][]; valuePolicy: 'native-primitives-dates-iso-formulas-rejected' }>;
