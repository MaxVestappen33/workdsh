import React,{useEffect,useRef,useState} from 'react';

export interface QualityTrendChartProps {
 readonly rows:readonly {readonly date:string;readonly summary:{readonly nonconformingRate:number|null;readonly inspectedQuantity:number;readonly nonconformingQuantity:number}}[];
 readonly granularity?:'day'|'week'|'month';
 readonly quantityUnit?:string;
 readonly onPeriodSelect?:(date:string)=>void;
 readonly selectedPeriod?:string;
}
const axisPercentage=(value:number)=>`${Number((value*100).toFixed(2))}%`;
const dateLabel=(value:string)=>value.slice(5).replace('-','/');
const accent='var(--wd-quality-result-accent, #277c69)';
const secondary='var(--dsw-alias-label-secondary, #657185)';

/** Plot only Host-calculated periods. Observe our own SVG rather than changing
 * a parent Slot; one viewBox unit is one CSS pixel after its width is measured. */
export function QualityTrendChart({rows,granularity='day',quantityUnit,onPeriodSelect,selectedPeriod}:QualityTrendChartProps){
 const svgRef=useRef<SVGSVGElement>(null),[width,setWidth]=useState(720),[focusedPeriod,setFocusedPeriod]=useState<string>();
 useEffect(()=>{
  const svg=svgRef.current;if(!svg)return;
  const measure=(value:number)=>{if(Number.isFinite(value)&&value>0){const next=Math.round(value);if(next>0)setWidth(current=>current===next?current:next);}};
  measure(svg.getBoundingClientRect().width);
  if(typeof ResizeObserver==='undefined')return;
  const observer=new ResizeObserver(entries=>{for(const entry of entries)if(entry.target===svg)measure(entry.contentRect.width);});
  observer.observe(svg);return()=>observer.disconnect();
 },[]);
 const visible=rows.slice(-30),height=260,left=Math.min(60,width*.22),right=width-Math.min(34,width*.11),top=30,bottom=204;
 const x=(index:number)=>visible.length<=1?(left+right)/2:left+(right-left)*index/(visible.length-1);
 const maximum=Math.min(1,Math.max(.1,Math.ceil(Math.max(0,...visible.map(row=>row.summary.nonconformingRate??0))*10)/10));
 const y=(rate:number)=>bottom-rate/maximum*(bottom-top);
 const segments:string[]=[];let current='';visible.forEach((row,index)=>{const rate=row.summary.nonconformingRate;if(rate===null){if(current)segments.push(current);current='';}else current+=`${current?' L':'M'}${x(index)},${y(rate)}`;});if(current)segments.push(current);
 // Choose date labels by the actual plot width; first and last dates stay in
 // the chart, while the full year and range remain in its visible caption.
 const labelCount=Math.max(2,Math.floor((right-left)/75)+1),labelStep=Math.max(1,Math.ceil((visible.length-1)/(labelCount-1)));
 const hasMissingRate=visible.some(row=>row.summary.nonconformingRate===null),unit=quantityUnit==='piece'?'件':quantityUnit;
 const axisLabel=granularity==='week'?'周起始日期（周一）':granularity==='month'?'月起始日期':'检验日期';
 return <figure className="wd-quality-trend-chart" style={{margin:'16px 0 0',minWidth:0}}><svg ref={svgRef} role={onPeriodSelect?'group':'img'} aria-label={`最近最多30个周期的不合格率趋势，详细数值可展开明细查看${visible.length?'：'+visible.map(row=>`${row.date} ${row.summary.nonconformingRate===null?'无法计算':axisPercentage(row.summary.nonconformingRate)}`).join('，'):''}`} viewBox={`0 0 ${width} ${height}`} style={{display:'block',width:'100%',height}}>
  {Array.from({length:5},(_,index)=>maximum*index/4).map(value=><g key={value}><line x1={left} x2={right} y1={y(value)} y2={y(value)} stroke="var(--dsw-alias-border-l2, #e1e8e5)" strokeWidth="1"/><text x={left-10} y={y(value)+4} textAnchor="end" fontSize="12" fill={secondary}>{axisPercentage(value)}</text></g>)}
  {segments.map((path,index)=><path key={index} d={path} fill="none" stroke={accent} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round"/>)}
  {visible.map((row,index)=>{const rate=row.summary.nonconformingRate;return rate===null?null:<g key={row.date} role={onPeriodSelect?'button':undefined} tabIndex={onPeriodSelect?0:undefined} aria-label={onPeriodSelect?`查看 ${row.date} 的检验记录`:undefined} aria-pressed={onPeriodSelect?selectedPeriod===row.date:undefined}
   onClick={onPeriodSelect?()=>onPeriodSelect(row.date):undefined} onKeyDown={onPeriodSelect?event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();onPeriodSelect(row.date);}}:undefined}
   onFocus={onPeriodSelect?()=>setFocusedPeriod(row.date):undefined} onBlur={onPeriodSelect?()=>setFocusedPeriod(undefined):undefined} style={onPeriodSelect?{cursor:'pointer',outline:'none'}:undefined}>
   {onPeriodSelect&&<circle aria-hidden="true" cx={x(index)} cy={y(rate)} r="22" fill="transparent"/>}
   {onPeriodSelect&&(selectedPeriod===row.date||focusedPeriod===row.date)&&<circle aria-hidden="true" cx={x(index)} cy={y(rate)} r="10" fill="none" stroke={accent} strokeWidth="2" strokeDasharray={focusedPeriod===row.date?'3 2':undefined}/>}
   <circle cx={x(index)} cy={y(rate)} r="4" fill={accent} stroke="var(--dsw-alias-bg-layer-1, #fff)" strokeWidth="1.5"><title>{`${row.date} · 不合格率 ${(rate*100).toFixed(2)}% · 检验 ${row.summary.inspectedQuantity}${unit?' '+unit:''} · 不合格 ${row.summary.nonconformingQuantity}${unit?' '+unit:''}`}</title></circle>
   {visible.length<=8&&<text x={x(index)} y={y(rate)-12} textAnchor="middle" fontSize="12" fontWeight="600" fill={accent}>{axisPercentage(rate)}</text>}
  </g>;})}
  {visible.map((row,index)=>{const last=visible.length-1,selected=index===0||index===last||index%labelStep===0&&last-index>=labelStep;return selected?<text key={row.date} x={x(index)} y={height-25} textAnchor={visible.length===1?'middle':index===0?'start':index===last?'end':'middle'} fontSize="12" fill={secondary}>{dateLabel(row.date)}</text>:null;})}
 </svg><figcaption className="wd-quality-trend-caption" style={{fontSize:12,lineHeight:1.6,color:secondary}}>
  <span>不合格率 · {axisLabel}</span>{visible.length>0&&<span>{visible[0].date.replaceAll('-','/')} — {visible.at(-1)!.date.replaceAll('-','/')}</span>}
  {onPeriodSelect&&<span className="wd-quality-trend-limit">点击趋势点查看检验记录，也可选中后按 Enter 或空格。</span>}
  {(rows.length>30||hasMissingRate)&&<span className="wd-quality-trend-limit">{rows.length>30?'显示最近 30 个周期；全部数据见明细。':''}{hasMissingRate?'检验数量为 0 的周期无法计算比例，图中保留断点。':''}</span>}
 </figcaption></figure>;
}
