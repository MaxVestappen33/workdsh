export interface QualityLibraryImportError {readonly message:string;readonly reconcile:boolean;}
/** Present known causes only; transport failures do not prove whether an import was saved. */
export function describeLibraryImportError(cause:unknown,operation:'import'|'select'|'reconcile'='import'):QualityLibraryImportError{
 if(operation==='select')return {message:'未能打开资料库，请稍后重新选择文件。',reconcile:false};
 if(operation==='reconcile')return {message:'未能读取当前检验数据，请稍后重新读取。',reconcile:true};
 const code=cause&&typeof cause==='object'&&'code' in cause&&typeof cause.code==='string'?cause.code:'';
 const messages:Record<string,string>={
  'quality/source/merged-cells':'所选工作表含合并单元格。请选择检验明细表，并将“列名所在行”设为实际表头；如果明细中仍有合并格，请在 Office 中整理为每行一条记录后再导入。',
  'quality/source/header-row-invalid':'列名所在行超出了工作表范围，请确认实际表头的行号。',
  'quality/source/header-missing':'所选列名行有空白列名，请选择实际表头行，或在源文件中补齐列名。',
  'quality/source/header-duplicate':'所选列名行有重复列名，请选择实际表头行，或在源文件中区分重复的列名。',
  'quality/source/worksheet-empty':'所选工作表没有明细数据，请选择包含检验记录的工作表。',
  'quality/source/worksheet-not-found':'文件中没有这个工作表，请重新选择工作表或文件。',
  'quality/source/formula-values-required':'所选数据含公式。请在 Office 中核对计算结果，将要导入的明细另存为数值后重新选择文件。',
  'quality/source/cell-error':'所选数据含 Excel 错误值，请在 Office 中修正后重新选择文件。',
  'quality/source/size-limit':'文件或工作表超过导入上限（8 MB、10,000 条记录、50 列），请缩小明细范围后重试。',
  'quality/source/invalid-file':'所选文件无法作为明细表读取，请选择包含完整列名和数据的 Excel 或 CSV 文件。',
  'quality/source/library-unavailable':'所选资料版本无法读取，请从资料库重新选择文件。',
  'quality/worker/busy':'导入服务正在处理其他任务，请稍后重试。',
  'quality/service/input-executor-unavailable':'导入服务尚未就绪，请稍后重试。',
  'quality/service/closed':'服务连接已关闭，请重新连接后重试。',
  'quality/source/inspection-source-required':'请先导入检验数据，再添加缺陷明细。',
 };
 if(code==='quality/store/generation-conflict')return {message:'检验数据已有变化，请重新读取后再导入。',reconcile:true};
 if(Object.hasOwn(messages,code))return {message:messages[code],reconcile:false};
 return {message:'导入结果尚未确认，请先重新读取检验数据，核对后再重试。',reconcile:true};
}
