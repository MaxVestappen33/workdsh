# Shared tabular parsing

Source owner for bounded CSV decoding, delimiter/quote handling and CSV/XLSX retrieval text. Library and Office consume this package; it has no Cordis entry, editor, session service or feature activation. Parser limits describe retrieval/preview prefixes, not complete statistical input. Formula caches are read without recalculation.

The existing Office /tabular public facet delegates here. The Library build bundles this pure module and retains ExcelJS/PapaParse dependencies; it does not depend on the Office plugin. The shared source supports current Node 22.19+/24 and browser CSV previews. Runtime and installed-archive acceptance remain separate from source tests.

Build and typecheck from apps/web through its pinned pnpm workspace.

Structured analysis input: `readWorksheetTable` returns the complete explicitly selected XLSX worksheet with typed values and worksheet/header-row provenance. Multiple sheets require selection. Formula caches, errors and merged cells are rejected; this API never substitutes a retrieval prefix for a statistical dataset. Limits apply to output after workbook loading, not ZIP expansion or peak memory. The alpha3 candidate normalizes explicit SpreadsheetML namespace prefixes at the shared load boundary through XML parsing, retaining original bytes and the existing typed-cell/formula policy. SigmaPad consumes a fixed alpha3 artifact; native Desktop delivery remains pending.

Primitive workbook export: `writeWorksheetTables` writes complete named tables of strings, finite numbers, booleans and nulls. Limits are 20 sheets, 10000 data rows per sheet, 120 columns, 200000 total cells, 32767 UTF-16 units per string and 8 MiB primitive input / output. It rejects invalid worksheet names, duplicate names, formulas/objects, non-finite numbers and invalid XML text rather than silently truncating. Formula-like strings remain text. It returns bytes and never reads session state or writes files; authorization and provenance belong to the caller. Excel numeric display/15-digit precision is not a lossless interchange guarantee; callers needing exact floating-point or large integer values should include a textual exact-value table. Source tests are not native Office or desktop acceptance.

结构化 XLSX 读取在加载工作簿前执行实际解压字节预算检查（checkTabularArchiveBudget）：默认输入 8MiB、解压总量 64MiB、单条目 16MiB、1024 条目。逐条目读取有界数据块，不先进行会提前全量解压的 CRC 预检查；路径拒绝穿越。调用方仍须在可取消 Host worker 中执行，预算不等于完整工作簿内存峰值保证。公开 API/包版本在正式交付时统一推进；本地源码 build 不代表分发已完成。
