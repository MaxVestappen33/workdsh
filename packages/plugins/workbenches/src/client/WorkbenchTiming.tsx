import React,{useEffect,useState} from 'react';
const labels={sdk:'SDK 查阅',coding:'代码写入',delivery:'构建与检查命令',installation:'安装与核对',preparation:'开发准备',approval:'等待原生工具授权'};
type Category=keyof typeof labels;
type Event={category:Category;startedAt:string;finishedAt?:string;durationMs?:number;status:'running'|'passed'|'failed'|'interrupted'};
type Report={measurement:'tool-dispatch-only';events:Event[];limitReached:boolean};
const seconds=(ms:number)=>ms>0&&ms<100?'<0.1 秒':`${(ms/1000).toFixed(1)} 秒`;
export function WorkbenchTiming({developmentId,iterationId}:{developmentId:string;iterationId:string}){
 const [report,setReport]=useState<Report>(),[unavailable,setUnavailable]=useState(false);
 useEffect(()=>{let active=true,busy=false;const controller=new AbortController();setReport(undefined);setUnavailable(false);
  const refresh=async()=>{if(busy)return;busy=true;try{const response=await fetch('/api/workdsh-workbench-timing',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({developmentId}),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(10000)])});const value=await response.json();if(!response.ok||value.ok!==true||value.value?.measurement!=='tool-dispatch-only'||!Array.isArray(value.value.events))throw Error();if(active){setReport(value.value);setUnavailable(false);}}catch{if(active)setUnavailable(true);}finally{busy=false;}};
  void refresh();const timer=setInterval(()=>void refresh(),5000);return()=>{active=false;controller.abort();clearInterval(timer);};
 },[developmentId,iterationId]);
 const latest=report?.events.at(-1);
 const start=report?.events.length?Math.min(...report.events.map(e=>Date.parse(e.startedAt))):undefined;
 const end=report?.events.length?Math.max(...report.events.map(e=>Date.parse(e.finishedAt??e.startedAt))):undefined;
 return <details className="wd-delivery-criteria"><summary>制作计时{latest?` · ${labels[latest.category]}${latest.status==='running'?'执行中':latest.status==='interrupted'?'已中断':latest.status==='failed'?'未完成':'已记录'}`:''}</summary>
 {start!==undefined&&end!==undefined&&<p>已观测工具首尾跨度：{seconds(Math.max(0,end-start))}。这是已发生工具之间的时间，尚非整轮完成回执。</p>}
 <p>记录原生工具实际执行耗时，模型思考不计入工具用时；原生工具明确请求授权时单独记录等待；并行调用的累计用时不等于总制作时间。</p>
 {unavailable?<p role="status">计时暂不可读取，不影响开发；不会显示为零耗时或完成。</p>:!report?.events.length?<p>本轮尚无计时记录。旧版本已发生的开发不会补造耗时。</p>:<ul>{(Object.keys(labels) as Category[]).map(type=>{const rows=report.events.filter(e=>e.category===type);return <li key={type}>{labels[type]}：{rows.length?`${seconds(rows.reduce((sum,e)=>sum+(e.durationMs??0),0))} · ${rows.length} 次${rows.some(e=>e.status==='running')?'，执行中':''}${rows.some(e=>e.status==='interrupted')?'，含中断记录':''}${rows.some(e=>e.status==='failed')?'，含失败调用':''}`:'尚未观测'}</li>;})}</ul>}
 {report?.limitReached&&<p>已达到本轮计时记录上限，统计不完整。</p>}
 </details>;
}
