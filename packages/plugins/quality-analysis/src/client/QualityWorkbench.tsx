import React,{useEffect,useRef,useState} from 'react';
import {QualityResults,type QualityResultsProps} from './QualityResults';

export interface QualityDataPage {
  readonly headers:readonly string[];
  readonly rows:readonly (readonly (string|number|boolean|null)[])[];
  readonly offset:number;
  readonly total:number;
  readonly loading:boolean;
}
export interface QualityWorkbenchProps {
  readonly identityScopeKey:string;
  readonly records:readonly {readonly id:string;readonly title:string}[];
  readonly current?:{readonly id:string;readonly title:string;readonly projectName?:string;readonly generation:number};
  readonly result:Omit<QualityResultsProps,'title'|'onCancel'>;
  readonly inspections?:QualityDataPage;
  readonly defects?:QualityDataPage;
  readonly report?:{readonly runId:string;readonly markdown:string;readonly savedAssetId?:string};
  readonly onSelectRecord:(id:string,signal:AbortSignal)=>Promise<void>;
  readonly onCreateRecord:(signal:AbortSignal)=>Promise<void>;
  readonly onImport:(signal:AbortSignal)=>Promise<void>;
  readonly onConfigure:(signal:AbortSignal)=>Promise<void>;
  readonly onAnalyze:(signal:AbortSignal)=>Promise<void>;
  readonly onCancelAnalysis?:()=>void;
  readonly onDataPage:(kind:'inspections'|'defects',offset:number,signal:AbortSignal)=>Promise<void>;
  readonly onSaveReport:(signal:AbortSignal)=>Promise<void>;
  readonly onExportCsv:(signal:AbortSignal)=>Promise<void>;
  readonly onAiAnalysis?:(signal:AbortSignal)=>Promise<void>;
}
const labels={overview:'质量总览',inspections:'检验数据',defects:'缺陷分析',report:'报告'} as const;
type Tab=keyof typeof labels;
const button:React.CSSProperties={padding:'8px 14px',border:'1px solid var(--border-color, #ddd)',borderRadius:8,background:'var(--background-color, white)',color:'inherit',cursor:'pointer'};
/** Unmounted page shell; callbacks must consume authorized Host services.
 * Record/identity changes remount and abort outstanding page operations.
 */
export function QualityWorkbench(props:QualityWorkbenchProps) {
  return <WorkbenchBody key={`${props.identityScopeKey}/${props.current?.id??'empty'}`} {...props}/>;
}
function WorkbenchBody(props:QualityWorkbenchProps) {
  const [tab,setTab]=useState<Tab>('overview'),[busy,setBusy]=useState(false),[error,setError]=useState<string>();
  const pending=useRef<AbortController|undefined>(undefined);
  useEffect(()=>()=>pending.current?.abort(),[]);
  async function run(action:(signal:AbortSignal)=>Promise<void>) {
    if(pending.current)return;
    const controller=new AbortController();pending.current=controller;setBusy(true);setError(undefined);
    try{await action(controller.signal);}catch{if(!controller.signal.aborted)setError('操作未完成，请刷新当前记录后重试。');}
    finally{if(!controller.signal.aborted){setBusy(false);pending.current=undefined;}}
  }
  const hasRecord=!!props.current,ready=props.result.state==='ready'&&props.result.statistics?.status==='complete';
  function data(kind:'inspections'|'defects',page?:QualityDataPage) {
    if(!page)return <p>{kind==='inspections'?'尚未导入检验数据。':'尚未提供缺陷明细。'}</p>;
    if(page.loading)return <p role="status">正在读取数据…</p>;
    if(page.rows.length>50)return <p role="alert">明细超过页面预算，请重新读取分页数据。</p>;
    return <div style={{overflowX:'auto'}}><p>共 {page.total} 条，当前 {page.total? page.offset+1:0}–{page.offset+page.rows.length} 条。</p>
      <table style={{width:'100%',textAlign:'left'}}><thead><tr>{page.headers.map((header,index)=><th key={index}>{header}</th>)}</tr></thead><tbody>{page.rows.map((row,index)=><tr key={page.offset+index}>{row.map((cell,column)=><td key={column}>{cell===null?'':String(cell)}</td>)}</tr>)}</tbody></table>
      <nav aria-label="原始明细分页"><button style={button} disabled={busy||page.offset===0} onClick={()=>void run(signal=>props.onDataPage(kind,Math.max(0,page.offset-50),signal))}>上一页</button>
        <button style={button} disabled={busy||page.offset+page.rows.length>=page.total} onClick={()=>void run(signal=>props.onDataPage(kind,page.offset+50,signal))}>下一页</button></nav>
    </div>;
  }
  return <section aria-label="质量分析工作台" style={{padding:24,color:'var(--text-color, #1f2937)'}}>
    <header><h1>质量分析工作台</h1><div style={{display:'flex',gap:12,flexWrap:'wrap'}}>
      <select aria-label="当前分析记录" value={props.current?.id??''} disabled={busy} onChange={event=>void run(signal=>props.onSelectRecord(event.target.value,signal))}><option value="" disabled>选择分析记录</option>{props.records.map(record=><option key={record.id} value={record.id}>{record.title}</option>)}</select>
      <button style={button} disabled={busy} onClick={()=>void run(props.onCreateRecord)}>新建记录</button>
      <button style={button} disabled={busy||!hasRecord} onClick={()=>void run(props.onImport)}>导入数据</button>
      <button style={button} disabled={busy||!hasRecord} onClick={()=>void run(props.onConfigure)}>映射与统计口径</button>
      <button style={button} disabled={busy||!hasRecord||props.result.state==='running'} onClick={()=>void run(props.onAnalyze)}>开始分析</button>
      {props.onAiAnalysis&&<button style={button} disabled={busy||!ready} onClick={()=>void run(props.onAiAnalysis!)}>AI 解读</button>}
    </div><p>{props.current?.projectName?`关联项目：${props.current.projectName}`:'未关联项目'} · {props.result.sourceDescription}</p></header>
    {busy&&<p role="status">正在处理操作… <button style={button} onClick={()=>{pending.current?.abort();pending.current=undefined;setBusy(false);}}>取消操作</button></p>}
    {error&&<p role="alert">{error}</p>}
    <nav aria-label="质量分析页面" style={{display:'flex',gap:12,margin:'20px 0'}}>{(Object.keys(labels) as Tab[]).map(key=><button key={key} style={{...button,fontWeight:tab===key?700:400}} aria-current={tab===key?'page':undefined} onClick={()=>setTab(key)}>{labels[key]}</button>)}</nav>
    {tab==='overview'&&<QualityResults {...props.result} title={props.current?.title??'质量总览'} onCancel={props.onCancelAnalysis}/>}
    {tab==='inspections'&&<section><h2>检验数据</h2>{data('inspections',props.inspections)}</section>}
    {tab==='defects'&&<section><h2>缺陷明细</h2>{data('defects',props.defects)}</section>}
    {tab==='report'&&<section><h2>分析报告</h2>{props.report?<><p>引用运行：{props.report.runId}{props.report.savedAssetId?' · 已保存至资料库':''}</p><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{props.report.markdown}</pre>
      <button style={button} disabled={busy} onClick={()=>void run(props.onSaveReport)}>保存到资料库</button></>:<p>完成正式分析后生成报告。</p>}
      <button style={button} disabled={busy||!ready} onClick={()=>void run(props.onExportCsv)}>导出统计明细 CSV</button>
    </section>}
  </section>;
}
