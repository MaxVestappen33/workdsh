import {QualityParetoChart} from './QualityParetoChart.js';
import {QualityTrendChart} from './QualityTrendChart.js';
import {qualityCount,qualityPercentage,qualityResultMetrics,qualityResultSourceLabel} from './result-presentation.js';
import React,{useState} from 'react';
import type {QualityStatistics} from '../domain/statistics';

export interface QualityResultsProps {
 readonly title:string;
 readonly state:'empty'|'running'|'failed'|'ready';
 readonly statistics?:QualityStatistics;
 readonly hasDefectSource:boolean;
 readonly sourceDescription:string;
 readonly error?:string;
 readonly onCancel?:()=>void;
 readonly onPeriodSelect?:(date:string)=>void;
 readonly selectedPeriod?:string;
}
const border='var(--dsw-alias-border-l2, #dce2e9)';
const background='var(--dsw-alias-bg-layer-1, #fff)';
const secondary='var(--dsw-alias-label-secondary, #657185)';
const card:React.CSSProperties={padding:20,border:`1px solid ${border}`,borderRadius:12,background,minWidth:0};
const caption:React.CSSProperties={fontSize:12,color:secondary,lineHeight:1.5,margin:'6px 0 0'};
const heading:React.CSSProperties={display:'flex',alignItems:'baseline',justifyContent:'space-between',gap:12,flexWrap:'wrap'};
const title:React.CSSProperties={fontSize:16,fontWeight:650,margin:0};
const tableStyle:React.CSSProperties={width:'100%',borderCollapse:'collapse',textAlign:'left',fontSize:13,fontVariantNumeric:'tabular-nums'};
const cell:React.CSSProperties={padding:'9px 8px',borderBottom:`1px solid ${border}`,whiteSpace:'nowrap'};
const numericalCell:React.CSSProperties={...cell,textAlign:'right'};
const detail:React.CSSProperties={marginTop:12,paddingTop:10,borderTop:`1px solid ${border}`};
const periodButton=(selected:boolean):React.CSSProperties=>({minHeight:44,padding:'6px 8px',textAlign:'left',font:'inherit',color:'var(--wd-quality-result-accent, #277c69)',background:selected?'var(--dsw-alias-bg-layer-2, #eef6f3)':'transparent',border:`1px solid ${selected?'var(--wd-quality-result-accent, #277c69)':'transparent'}`,borderRadius:6,cursor:'pointer'});

function PagedTable<T>({rows,headings,render}:{rows:readonly T[];headings:readonly string[];render:(row:T,index:number)=>React.ReactNode}){
 const [page,setPage]=useState(0),pageSize=20,pages=Math.max(1,Math.ceil(rows.length/pageSize)),current=Math.min(page,pages-1);
 return <div style={{overflowX:'auto'}}><table style={tableStyle}><thead><tr>{headings.map((name,index)=><th key={name} style={{...cell,...(index>0?{textAlign:'right'}:{}),fontSize:12,color:secondary,fontWeight:500}} scope="col">{name}</th>)}</tr></thead>
  <tbody>{rows.slice(current*pageSize,(current+1)*pageSize).map((row,index)=>render(row,current*pageSize+index))}</tbody></table>
  {pages>1&&<nav aria-label="明细分页" style={{display:'flex',alignItems:'center',justifyContent:'flex-end',gap:10,marginTop:12}}><button disabled={current===0} onClick={()=>setPage(current-1)}>上一页</button><span style={caption}>第 {current+1} / {pages} 页 · 共 {qualityCount(rows.length)} 条</span><button disabled={current===pages-1} onClick={()=>setPage(current+1)}>下一页</button></nav>}</div>;
}

/** Result view consumes one fixed run. It does not resolve identity, read files
 * or substitute a browser calculation for the Host's statistical rules. */
export function QualityResults(props:QualityResultsProps){
 if(props.state==='running')return <section aria-live="polite" className="wd-quality-result-section" style={card}><h2 style={title}>正在分析</h2><p style={{margin:'8px 0 12px',color:secondary}}>正在核对检验数据并计算结果。</p>{props.onCancel&&<button onClick={props.onCancel}>取消分析</button>}</section>;
 if(props.state==='failed')return <section role="alert" className="wd-quality-result-section" style={card}><h2 style={title}>分析未完成</h2><p style={{margin:'8px 0 0'}}>{props.error??'请检查输入数据并重试。'}</p></section>;
 if(props.state==='empty'||!props.statistics)return <section className="wd-quality-result-section" style={card}><h2 style={title}>开始质量分析</h2><p style={{margin:'8px 0 0',color:secondary}}>导入检验数据，核对字段与分析范围后查看结果。</p></section>;
 const result=props.statistics;
 if(result.status==='blocked')return <section role="alert" className="wd-quality-result-section" style={card}><h2 style={title}>数据需要核对</h2><p>发现 {qualityCount(result.issues.length)} 个核对问题，处理后才能生成分析结果。</p>
  <details><summary>查看问题位置</summary><ul style={{margin:'8px 0',paddingLeft:20}}>{result.issues.slice(0,20).map((issue,index)=><li key={index}>{{dataset:'分析范围',inspections:'检验数据',defects:'缺陷明细'}[issue.table]}{issue.row===undefined?'':` · 第 ${issue.row} 条数据`}：校验未通过</li>)}</ul>{result.issues.length>20&&<p style={caption}>这里只显示前 20 个问题，请在数据核对中处理完整记录。</p>}</details></section>;
 const metrics=qualityResultMetrics(result,props.hasDefectSource).slice(0,3),period={day:'日',week:'周',month:'月'}[result.trendGranularity??'day'];
 const quantityUnit=result.quantityUnit==='piece'?'件':result.quantityUnit;
 const hasProductDimension=result.products.some(row=>row.productId!==null);
 const recentPeriods=result.trend.slice(-5);
 const dateHeading=result.trendGranularity==='week'?'周起始日期（周一）':result.trendGranularity==='month'?'月起始日期':'检验日期';
 const quantities=(inspected:number,nonconforming:number)=>`检验 ${qualityCount(inspected)}${quantityUnit?' '+quantityUnit:''} · 不合格 ${qualityCount(nonconforming)}${quantityUnit?' '+quantityUnit:''}`;
 const renderProduct=(row:typeof result.products[number],index:number)=><tr key={index}><td style={cell}>{row.productId??'未标注产品'}</td><td style={numericalCell}>{qualityCount(row.summary.inspectedQuantity)}</td><td style={numericalCell}>{qualityCount(row.summary.nonconformingQuantity)}</td><td style={numericalCell}>{qualityPercentage(row.summary.nonconformingRate)}</td></tr>;
 return <div className="wd-quality-results">
  <header className="wd-quality-result-heading" style={heading}><div><h2 style={{...title,fontSize:18}}>{props.title}</h2>{props.sourceDescription&&<p style={caption}>{qualityResultSourceLabel(props.sourceDescription,result.timeZone)}</p>}</div><span style={{...caption,margin:0}}>固定数据版本的分析结果</span></header>
  <section aria-label="质量指标" className="wd-quality-result-metrics">
   {metrics.map((metric,index)=><article key={metric.label} className={`wd-quality-result-metric${metric.primary?' wd-quality-result-metric-primary':''}`}><div className="wd-quality-result-metric-label">{metric.label}</div>
    <strong className={`wd-quality-result-metric-value${metric.value==='无法计算'?' is-unavailable':''}`}>{metric.value}{index>0&&quantityUnit&&<span className="wd-quality-result-metric-unit">{quantityUnit}</span>}</strong><p className="wd-quality-result-metric-caption">{metric.caption}</p></article>)}
  </section>
  <div className={`wd-quality-result-overview${recentPeriods.length?' has-periods':''}`}>
   <section className="wd-quality-result-panel wd-quality-result-trend" aria-label="检验趋势">
    <header style={heading}><h3 style={title}>检验{period}趋势</h3><span style={{...caption,margin:0}}>{qualityCount(result.trend.length)} 个统计周期</span></header>
    {result.trend.length===0?<p style={{margin:'16px 0 0',color:secondary}}>当前分析范围没有检验记录。</p>:<><p style={caption}>不合格数量 ÷ 当期检验数量</p><QualityTrendChart rows={result.trend} granularity={result.trendGranularity} quantityUnit={quantityUnit??undefined} onPeriodSelect={props.onPeriodSelect} selectedPeriod={props.selectedPeriod}/>
     <details style={detail}><summary>查看全部趋势明细</summary><PagedTable rows={result.trend} headings={[dateHeading,`检验数量${quantityUnit?'（'+quantityUnit+'）':''}`,`不合格数量${quantityUnit?'（'+quantityUnit+'）':''}`,'不合格率']} render={row=><tr key={row.date}><td style={cell}>{props.onPeriodSelect?<button type="button" aria-label={`查看 ${row.date} 的检验记录`} aria-pressed={props.selectedPeriod===row.date} style={periodButton(props.selectedPeriod===row.date)} onClick={()=>props.onPeriodSelect?.(row.date)}>{row.date}</button>:row.date}</td><td style={numericalCell}>{qualityCount(row.summary.inspectedQuantity)}</td><td style={numericalCell}>{qualityCount(row.summary.nonconformingQuantity)}</td><td style={numericalCell}>{qualityPercentage(row.summary.nonconformingRate)}</td></tr>}/></details></>}
   </section>
   {recentPeriods.length>0&&<section className="wd-quality-result-panel wd-quality-result-periods" aria-label="周期对比">
    <header style={heading}><h3 style={title}>各{period}对比</h3>{result.trend.length>5&&<span style={{...caption,margin:0}}>最近 5 个周期</span>}</header>
    <p style={caption}>数量与不合格率</p><ol className="wd-quality-result-period-list">{recentPeriods.map(row=><li key={row.date}>
     {props.onPeriodSelect?<button type="button" className="wd-quality-result-period-date" aria-label={`查看 ${row.date} 的检验记录`} aria-pressed={props.selectedPeriod===row.date} style={periodButton(props.selectedPeriod===row.date)} onClick={()=>props.onPeriodSelect?.(row.date)}>{row.date.replaceAll('-','/')}</button>:<span className="wd-quality-result-period-date">{row.date.replaceAll('-','/')}</span>}<strong className="wd-quality-result-period-rate">{qualityPercentage(row.summary.nonconformingRate)}</strong>
     <span className="wd-quality-result-period-quantities">{quantities(row.summary.inspectedQuantity,row.summary.nonconformingQuantity)}</span>
    </li>)}</ol>
   </section>}
  </div>
  {(!props.hasDefectSource||!hasProductDimension)&&<aside className="wd-quality-result-data-note" aria-label="数据说明">
   {!hasProductDimension&&<p>{result.products.length===0?'当前分析范围没有产品统计。':'未提供产品信息，暂不能按产品比较。'}</p>}
   {!props.hasDefectSource&&<p>尚未导入缺陷明细，不能据此判断缺陷为零。</p>}
  </aside>}
  {(hasProductDimension||props.hasDefectSource)&&<div className={`wd-quality-result-splits${hasProductDimension&&props.hasDefectSource?' has-two-panels':''}`}>
   {hasProductDimension&&<section className="wd-quality-result-panel" aria-label="产品对比"><header style={heading}><h3 style={title}>产品对比</h3><span style={{...caption,margin:0}}>{qualityCount(result.products.filter(row=>row.productId!==null).length)} 项产品{result.products.some(row=>row.productId===null)?' · 含未标注记录':''}</span></header>
    <div style={{marginTop:12,overflowX:'auto'}}><table style={tableStyle}><thead><tr>{['产品','检验数量','不合格数量','不合格率'].map((name,index)=><th key={name} style={{...cell,...(index>0?{textAlign:'right'}:{}),fontSize:12,color:secondary,fontWeight:500}} scope="col">{name}</th>)}</tr></thead><tbody>{result.products.slice(0,5).map(renderProduct)}</tbody></table></div>
    {result.products.length>5&&<details style={detail}><summary>查看全部产品明细（{qualityCount(result.products.length)} 行）</summary><PagedTable rows={result.products} headings={['产品','检验数量','不合格数量','不合格率']} render={renderProduct}/></details>}
   </section>}
   {props.hasDefectSource&&<section className="wd-quality-result-panel" aria-label="缺陷分布"><header style={heading}><h3 style={title}>缺陷分布</h3><span style={{...caption,margin:0}}>{qualityCount(result.summary.defectOccurrences)} 次 · {qualityCount(result.pareto.length)} 类缺陷</span></header>
    {result.pareto.length===0?<p style={{margin:'16px 0 0',color:secondary}}>当前分析范围内没有缺陷记录。</p>:<><QualityParetoChart rows={result.pareto}/><details style={detail}><summary>查看全部缺陷明细</summary><PagedTable rows={result.pareto} headings={['缺陷','次数','累计比例']} render={row=><tr key={row.defectCode}><td style={cell}>{row.defectLabel}<span style={{...caption,display:'block',margin:0}}>{row.defectCode}</span></td><td style={numericalCell}>{qualityCount(row.occurrences)}</td><td style={numericalCell}>{qualityPercentage(row.cumulativeRate)}</td></tr>}/></details></>}
   </section>}
  </div>}
 </div>;
}
