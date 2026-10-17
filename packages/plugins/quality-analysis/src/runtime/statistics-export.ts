import {createHash} from 'node:crypto';
import {verifyQualityAnalysisRunHash,type CompleteQualityAnalysisRun} from './analysis-run';
type Cell=string|number|null;
/** String cells are quoted; formula-leading strings get a literal apostrophe.
 * Numeric values retain full JS precision, rates are fractions, null stays empty.
 * Original labels are retained in the immutable run; safe export records counts.
 */
export function exportQualityStatisticsCsv(run:CompleteQualityAnalysisRun) {
  if(!verifyQualityAnalysisRunHash(run))throw new Error('quality/export/invalid-run');
  const statistics=run.content.statistics;
  const render=(kind:string,headers:readonly string[],rows:readonly (readonly Cell[])[])=>{
    let protectedTextCells=0;
    const cell=(value:Cell)=>{
      if(value===null)return '';
      if(typeof value==='number')return String(value);
      let text=value;
      if(/^[\s]*[=+\-@]/.test(text)||/^[\t\r\n]/.test(text)){text="'"+text;protectedTextCells++;}
      return '"'+text.replaceAll('"','""')+'"';
    };
    const content=[headers,...rows].map(row=>row.map(cell).join(',')).join('\r\n')+'\r\n';
    const bytes=new TextEncoder().encode(content);
    return Object.freeze({kind,filename:`quality-${kind}.csv`,mediaType:'text/csv;charset=utf-8',
      content,sha256:createHash('sha256').update(bytes).digest('hex'),rowCount:rows.length,
      cellPolicy:'spreadsheet-text-safe' as const,protectedTextCells});
  };
  const summary=(row:typeof statistics.summary):Cell[]=>[row.inspectionCount,row.inspectedQuantity,row.nonconformingQuantity,row.conformingQuantity,row.nonconformingRate,run.content.sources.defects?row.defectOccurrences:null];
  const headers=['检验记录数','检验数量','不合格数量','合格数量','不合格率（0–1）','已提供缺陷次数'];
  const exports=[
    render('trend',[`周期起始日期（${{day:'日',week:'周一开始的周',month:'月'}[statistics.trendGranularity??'day']}）`,...headers],statistics.trend.map(row=>[row.date,...summary(row.summary)])),
    render('products',['产品标识','产品标识是否缺失',...headers],statistics.products.map(row=>[row.productId,row.productId===null?'是':'否',...summary(row.summary)])),
    render('pareto',['缺陷代码','缺陷名称','次数','累计比例（0–1）'],statistics.pareto.map(row=>[row.defectCode,row.defectLabel,row.occurrences,row.cumulativeRate])),
  ];
  return Object.freeze({runId:run.runId,contentHash:run.contentHash,timeZone:statistics.timeZone,
    quantityUnit:statistics.quantityUnit,hasDefectSource:!!run.content.sources.defects,files:Object.freeze(exports)});
}
