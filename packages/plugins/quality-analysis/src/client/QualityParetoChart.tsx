import React from 'react';
export function QualityParetoChart({rows}:{rows:readonly {defectCode:string;defectLabel:string;occurrences:number;cumulativeRate:number|null}[]}){
 const visible=rows.slice(0,10),left=44,right=676,top=16,bottom=168,max=Math.max(1,...visible.map(row=>row.occurrences));
 const step=(right-left)/Math.max(1,visible.length),x=(index:number)=>left+step*(index+.5),rateY=(rate:number)=>bottom-(bottom-top)*rate;
 let previousValid=false;
 const cumulativePath=visible.map((row,index)=>{
  if(row.cumulativeRate===null){previousValid=false;return '';}
  const command=previousValid?'L':'M';previousValid=true;
  return `${command}${x(index)},${rateY(row.cumulativeRate)}`;
 }).join(' ');
 return <figure style={{margin:'16px 0'}}><svg role="img" aria-label="主要缺陷次数柱形与累计比例折线，完整数值见明细" viewBox="0 0 740 226" style={{width:'100%',maxHeight:270}}>
  {[0,.5,1].map(rate=><g key={rate}><line x1={left} x2={right} y1={rateY(rate)} y2={rateY(rate)} stroke="#e2e8f0"/><text x={right+8} y={rateY(rate)+4} fontSize="11" fill="currentColor">{rate*100}%</text><text x={left-8} y={rateY(rate)+4} textAnchor="end" fontSize="11" fill="currentColor">{Math.round(max*rate)}</text></g>)}
  {visible.map((row,index)=><g key={row.defectCode}><rect x={x(index)-step*.3} y={bottom-(bottom-top)*row.occurrences/max} width={step*.6} height={(bottom-top)*row.occurrences/max} fill="#a8cbbf"><title>{`${row.defectLabel}（${row.defectCode}）· ${row.occurrences} 次 · 累计 ${row.cumulativeRate===null?"不可计算":`${(row.cumulativeRate*100).toFixed(2)}%`}`}</title></rect><text x={x(index)} y={bottom+18} textAnchor="middle" fontSize="11" fill="currentColor">{index+1}</text></g>)}
  <path d={cumulativePath} fill="none" stroke="#3b63c8" strokeWidth="2"/>
  {visible.map((row,index)=>row.cumulativeRate===null?null:<circle key={row.defectCode} cx={x(index)} cy={rateY(row.cumulativeRate)} r="3" fill="#3b63c8"/>)}
  <text x={left} y="216" fontSize="12" fill="currentColor">左轴：缺陷次数 · 右轴：累计比例</text>
 </svg><figcaption>{rows.length>10?'显示前 10 类缺陷，累计比例沿用完整统计。':'累计比例沿用完整统计。'}</figcaption><ol style={{display:'flex',flexWrap:'wrap',gap:24,fontSize:12}}>{visible.map(row=><li key={row.defectCode}>{row.defectLabel}（{row.defectCode}）</li>)}</ol></figure>;
}
