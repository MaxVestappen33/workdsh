import {qualityCleaningFitsDraft,qualityCleaningFitsRequest} from './cleaning-budget.js';
import React,{useEffect,useRef,useState} from 'react';
import type {createQualityRecordClient} from './record-client.js';
import type {QualityCleaningPage} from './cleaning-rows.js';
import type {QualityConfigurationView} from './configuration-view.js';
import type {QualityCleaningRequest} from '../runtime/configuration-request.js';
import {matchingReview,replaceReviewDecision,reviewColumns,reviewFormChanged,reviewIssueMessage,reviewSourceMatches,reviewValue,reviewVisibleRows,type ReviewCheck,type ReviewBlocked,type ReviewDecision,type ReviewForm,type ReviewFormBaseline} from './review-presentation.js';
import {QualityReviewTable} from './QualityReviewTable.js';
import {QualityDrawer} from './QualityDrawer.js';
type Decisions={inspections:ReviewDecision[];defects:ReviewDecision[]};
const empty=():Decisions=>({inspections:[],defects:[]});
export interface QualityCleaningEditorProps {
 onInspectionFocus?:(inspectionId:string,sourceHash:string)=>Promise<void>;
 recordId:string;active:boolean;client:ReturnType<typeof createQualityRecordClient>;check?:ReviewCheck;
 compact?:boolean;sourceScopeKey?:string;analysisDisabled?:boolean;toolbar?:React.ReactNode;
 onRun:(run:{runId:string;contentHash:string})=>void;
 onBlocked:(result:ReviewBlocked,scope?:{sourceSnapshotId:string;generation:number})=>void;
 onLeaveGuard?:(guard:(()=>boolean)|undefined)=>void;
}
export function QualityCleaningEditor({recordId,client,active,check,onRun,onBlocked,onLeaveGuard,compact=false,sourceScopeKey,analysisDisabled=false,toolbar,onInspectionFocus}:QualityCleaningEditorProps){
 const [page,setPage]=useState<QualityCleaningPage>(),[configuration,setConfiguration]=useState<QualityConfigurationView>();
 const [table,setTable]=useState<'inspections'|'defects'>('inspections'),[offset,setOffset]=useState(0),[attempt,setAttempt]=useState(0);
 const [focusBusy,setFocusBusy]=useState(false);
 const [busy,setBusy]=useState(false),[freshData,setFreshData]=useState(false),[operation,setOperation]=useState(''),[error,setError]=useState<string>(),[notice,setNotice]=useState<string>();
 const [decisions,setDecisions]=useState<Decisions>(empty),[localCheck,setLocalCheck]=useState<ReviewCheck>();
 const [selected,setSelected]=useState<QualityCleaningPage['rows'][number]>(),[kind,setKind]=useState<'correct'|'exclude'>('correct');
 const [header,setHeader]=useState(''),[value,setValue]=useState(''),[reason,setReason]=useState('');
 const [formBaseline,setFormBaseline]=useState<ReviewFormBaseline>();
 const [draftRevision,setDraftRevision]=useState<number>(),[restore,setRestore]=useState<{revision:number;draft:QualityCleaningRequest}>();
 const [savedDecisions,setSavedDecisions]=useState(JSON.stringify(empty())),[showDecisions,setShowDecisions]=useState(false);
 const [filter,setFilter]=useState<'all'|'issues'|'reviewed'>('all'),[query,setQuery]=useState('');
 const scope=useRef<string|undefined>(undefined),pending=useRef<AbortController|undefined>(undefined),jump=useRef<number|undefined>(undefined);
 useEffect(()=>{
  // A hidden module stays mounted. Only its requests stop; row inputs stay intact.
  if(!active){pending.current?.abort();pending.current=undefined;setBusy(false);setFreshData(false);return;}
  const request=new AbortController();pending.current?.abort();pending.current=request;setBusy(true);setFreshData(false);setOperation('正在读取数据');setError(undefined);
  void (async()=>{
   const config=await client.configuration(recordId,request.signal);request.signal.throwIfAborted();
   const key=`${recordId}/${config.sourceSnapshotId}/${config.generation}`,sourceChanged=scope.current!==undefined&&scope.current!==key;
   // Invalidate stale inputs as soon as a changed source is observed, even if
   // reading its rows subsequently fails. They must never apply to new data.
   if(sourceChanged){clearForm();setPage(undefined);setDecisions(empty());setSavedDecisions(JSON.stringify(empty()));setLocalCheck(undefined);setRestore(undefined);setDraftRevision(undefined);setShowDecisions(false);setFilter('all');setQuery('');jump.current=undefined;setNotice('数据来源或规则已变化，原记录输入和本轮决定已失效，请重新核对。历史分析保留。');}
   scope.current=key;setConfiguration(config);
   if(sourceChanged&&offset!==0){setOffset(0);return;}
   if(table==='defects'&&!config.defects){setTable('inspections');setOffset(0);return;}
   const next=await client.cleaningRows(recordId,table,offset,config.generation,request.signal);request.signal.throwIfAborted();
   if(!reviewSourceMatches(next,config))throw Error('source-changed');
   setPage(next);setFreshData(true);
   if(jump.current!==undefined){const target=next.rows.find(row=>row.row===jump.current);jump.current=undefined;if(target)showRow(target,next,sourceChanged?empty():decisions,config);}
   try{const saved=await client.cleaningDraft(recordId,request.signal);request.signal.throwIfAborted();setDraftRevision(previous=>sourceChanged?saved.revision:previous??saved.revision);}
   catch{if(!request.signal.aborted){setDraftRevision(undefined);setError('数据已读取，保存状态未确认。请刷新后再保存核对决定。');}}
  })().catch(()=>{if(!request.signal.aborted)setError('数据读取失败，请检查数据来源和字段配置后重试。');}).finally(()=>{if(pending.current===request){pending.current=undefined;if(!request.signal.aborted)setBusy(false);}});
  return()=>request.abort();
 },[recordId,client,table,offset,attempt,active,sourceScopeKey]);
 useEffect(()=>()=>pending.current?.abort(),[]);
 const columns=page&&configuration?reviewColumns(page,configuration):[];
 const currentCheckScope=page&&matchingReview(check,page)?check:page&&matchingReview(localCheck,page)?localCheck:undefined;
 const currentCheck=page?matchingReview(currentCheckScope,page):undefined;
 const rowIssues=currentCheck?.issues.filter(issue=>issue.table===page?.tableKind&&issue.row!==undefined)??[];
 const allIssueRows=new Map<string,{table:'inspections'|'defects';row:number;issues:ReviewBlocked['issues'][number][]}>();
 for(const issue of currentCheck?.issues??[])if((issue.table==='inspections'||issue.table==='defects')&&issue.row!==undefined){const key=`${issue.table}/${issue.row}`;const entry=allIssueRows.get(key)??{table:issue.table,row:issue.row,issues:[]};entry.issues.push(issue);allIssueRows.set(key,entry);}
 const globalIssues=currentCheck?.issues.filter(issue=>issue.row===undefined||issue.table==='dataset')??[];
 const totalDecisions=decisions.inspections.length+decisions.defects.length,unsaved=JSON.stringify(decisions)!==savedDecisions;
 const formScope=page&&selected?{recordId,sourceSnapshotId:page.sourceSnapshotId,generation:page.generation,tableKind:page.tableKind,row:selected.row}:undefined;
 const formDirty=reviewFormChanged(formBaseline,formScope,{kind,header,value,reason});
 const selectedColumn=page?.headers.indexOf(header)??-1;
 const correctionField=columns.find(column=>column.header===header)?.field;
 const recordModified=!!selected&&(kind==='exclude'||selectedColumn>=0&&value!==String(selected.values[selectedColumn]??''));
 const canConfirm=formDirty&&recordModified&&(kind==='exclude'||!!correctionField)&&!!reason.trim();
 useEffect(()=>{
  onLeaveGuard?.(()=>{
   if(active&&(busy||focusBusy))return false;
   return !(unsaved||formDirty)||(typeof window!=='undefined'&&window.confirm('数据核对还有未保存修改。离开当前分析会丢失这些修改，是否继续？'));
  });
  return()=>onLeaveGuard?.(undefined);
 },[onLeaveGuard,active,busy,focusBusy,unsaved,formDirty]);
 useEffect(()=>{
  if(!(unsaved||formDirty)||typeof window==='undefined')return;
  const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};
  window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);
 },[unsaved,formDirty]);
 const usableData=active&&freshData&&!!page&&!!configuration&&reviewSourceMatches(page,configuration)&&page.tableKind===table&&page.offset===offset;
 const locked=busy||focusBusy||!usableData;
 const visibleRows=page?reviewVisibleRows(page,decisions[page.tableKind],currentCheckScope,filter,query):[];
 function clearForm(){setSelected(undefined);setFormBaseline(undefined);setKind('correct');setHeader('');setValue('');setReason('');}
 function discardBefore(action:()=>void,message='当前记录还有未确认修改。是否放弃修改并继续？'){
  if(!active||busy||focusBusy||pending.current)return;
  if(formDirty&&(typeof window==='undefined'||!window.confirm(message)))return;
  action();
 }
 function showRow(row:QualityCleaningPage['rows'][number],source:QualityCleaningPage,currentDecisions=decisions,currentConfiguration=configuration){
  if(!source)return;
  const mappedColumns=currentConfiguration?reviewColumns(source,currentConfiguration):[];
  const previous=currentDecisions[source.tableKind].find(item=>item.row===row.row&&(item.kind==='exclude'||mappedColumns.some(column=>column.header===item.header))),target=previous?.kind==='correct'?previous.header:mappedColumns[0]?.header??'';
  const initial:ReviewForm={kind:previous?.kind??'correct',header:target,value:previous?.kind==='correct'?previous.value:String(row.values[source.headers.indexOf(target)]??''),reason:previous?.reason??''};
  setSelected(row);setKind(initial.kind);setHeader(initial.header);setValue(initial.value);setReason(initial.reason);setError(undefined);
  setFormBaseline({scope:{recordId,sourceSnapshotId:source.sourceSnapshotId,generation:source.generation,tableKind:source.tableKind,row:row.row},form:initial});
 }
 function openRow(row:QualityCleaningPage['rows'][number]){
  if(!page||locked)return;if(selected?.row===row.row)return;
  discardBefore(()=>showRow(row,page));
 }
 function changeTable(next:'inspections'|'defects'){
  if(next===table)return;discardBefore(()=>{clearForm();setRestore(undefined);setFreshData(false);setTable(next);setOffset(0);setFilter('all');setQuery('');jump.current=undefined;});
 }
 function changePage(next:number){discardBefore(()=>{clearForm();setRestore(undefined);setFreshData(false);setOffset(next);jump.current=undefined;});}
 function refreshData(){discardBefore(()=>{clearForm();setRestore(undefined);setFreshData(false);jump.current=undefined;setAttempt(number=>number+1);});}
 function changeHeader(next:string){
  if(!page||!selected||next===header||locked)return;
  discardBefore(()=>{const previous=decisions[page.tableKind].find(item=>item.kind==='correct'&&item.row===selected.row&&item.header===next);setHeader(next);setValue(previous?.kind==='correct'?previous.value:String(selected.values[page.headers.indexOf(next)]??''));setReason(previous?.reason??'');setError(undefined);});
 }
 function changed(next:Decisions){setDecisions(next);setNotice(undefined);}
 function add(){
  if(!page||!selected||locked||!formDirty)return;const column=page.headers.indexOf(header);if(kind==='correct'&&(column<0||!columns.some(item=>item.header===header)))return;
  if(kind==='correct'&&value===String(selected.values[column]??'')){setError('修正值与原值相同，请填写实际修改内容。');return;}
  if(!reason.trim()){setError('请填写修改说明。');return;}
  const decision:ReviewDecision=kind==='exclude'?{kind,row:selected.row,reason:reason.trim()}:{kind,row:selected.row,header,expected:selected.values[column],value,reason:reason.trim()};
  try{changed({...decisions,[page.tableKind]:replaceReviewDecision(decisions[page.tableKind],decision)});clearForm();setError(undefined);setNotice('修改已确认。开始分析后，结果将采用本次处理。');}catch(cause){setError(cause instanceof Error?cause.message:'处理决定未保存。');}
 }
 async function inspectInAnalysis(){
  if(!onInspectionFocus||!page||!selected||!configuration||locked||formDirty||unsaved||page.tableKind!=='inspections')return;
  const identifier=columns.find(column=>column.field==='inspectionId');if(!identifier)return;
  const inspectionId=String(selected.values[identifier.index]??'');setFocusBusy(true);setError(undefined);
  try{await onInspectionFocus(inspectionId,configuration.inspections.sha256);clearForm();}catch{setError('当前已保存分析无法定位此记录。请先完成数据核对并重新分析。');}
  finally{setFocusBusy(false);}
 }
 function locate(entry:{table:'inspections'|'defects';row:number}){
  if(locked)return;const nextOffset=Math.floor((entry.row-1)/20)*20;
  if(page?.tableKind===entry.table&&selected?.row===entry.row){setQuery('');setFilter('all');return;}
  discardBefore(()=>{setQuery('');setFilter('all');if(page?.tableKind===entry.table&&page.offset===nextOffset){const row=page.rows.find(item=>item.row===entry.row);if(row)showRow(row,page);return;}
   clearForm();setRestore(undefined);setFreshData(false);jump.current=entry.row;setTable(entry.table);setOffset(nextOffset);
  });
 }
 async function draftAction(restoring:boolean){
  if(!page||locked||pending.current)return;const request=new AbortController();pending.current=request;setBusy(true);setOperation(restoring?'正在读取已保存决定':'正在保存核对决定');setError(undefined);setNotice(undefined);
  try{
   if(restoring){const saved=await client.cleaningDraft(recordId,request.signal);request.signal.throwIfAborted();
    if(!saved.draft){setNotice('没有与当前数据来源匹配的已保存决定。');return;}
    if(saved.draft.sourceSnapshotId!==page.sourceSnapshotId||saved.draft.expectedGeneration!==page.generation)throw Error('stale-draft');setRestore({revision:saved.revision,draft:saved.draft});
   }else{
    if(draftRevision===undefined)throw Error('draft-revision-unconfirmed');const draft={sourceSnapshotId:page.sourceSnapshotId,expectedGeneration:page.generation,...decisions};
    if(!qualityCleaningFitsDraft(draft)){setError('核对决定超过保存容量，请分批处理或修改源表。');return;}
    const receipt=await client.saveCleaningDraft(recordId,draft,draftRevision,request.signal);request.signal.throwIfAborted();setDraftRevision(receipt.revision);setSavedDecisions(JSON.stringify(decisions));setNotice('核对决定已保存，重新打开后可恢复。');
   }
  }catch{if(!request.signal.aborted)setError('保存状态未确认。请读取已保存决定核对版本后重试。');}
  finally{if(pending.current===request){pending.current=undefined;if(!request.signal.aborted)setBusy(false);}}
 }
 function confirmRestore(){
  if(!restore||!page||locked||restore.draft.sourceSnapshotId!==page.sourceSnapshotId||restore.draft.expectedGeneration!==page.generation)return;
  discardBefore(()=>{const next={inspections:restore.draft.inspections??[],defects:restore.draft.defects??[]};setDecisions(next);setSavedDecisions(JSON.stringify(next));setDraftRevision(restore.revision);setRestore(undefined);clearForm();setNotice('已恢复保存的核对决定。重新分析后核验结果。');},'当前记录还有未确认修改。恢复会放弃这些输入，并替换本次处理。是否继续？');
 }
 function submit(){if(locked||analysisDisabled)return;discardBefore(()=>{clearForm();void analyze();},'当前记录还有未确认修改，不会参与分析。是否放弃修改并继续分析？');}
 async function analyze(){
  if(!page||locked||analysisDisabled||pending.current)return;const request=new AbortController();pending.current=request;setBusy(true);setOperation('正在核验并生成分析');setError(undefined);setRestore(undefined);
  try{
   const record=await client.get(recordId,request.signal),cleaning={sourceSnapshotId:page.sourceSnapshotId,expectedGeneration:page.generation,...decisions};
   if(!qualityCleaningFitsRequest(recordId,record.revision,cleaning)){setError('本轮决定超过提交容量，请分批处理或用系统 Office 修改源表。');return;}
   const result=await client.analyze(recordId,record.revision,request.signal,cleaning);request.signal.throwIfAborted();
   if(result.status==='saved'){setDraftRevision(undefined);setDecisions(empty());setSavedDecisions(JSON.stringify(empty()));setLocalCheck(undefined);setNotice(undefined);onRun(result.run);}
   else{const next={sourceSnapshotId:page.sourceSnapshotId,generation:page.generation,result};setLocalCheck(next);setFilter('all');setNotice('核验仍发现问题，请处理后再次分析。');onBlocked(result,next);}
  }catch{if(!request.signal.aborted)setError('分析完成状态未确认。请先查看分析记录，确认后再重试。');}
  finally{if(pending.current===request){pending.current=undefined;if(!request.signal.aborted)setBusy(false);}}
 }
 const primary=<button className="wd-quality-primary" disabled={locked||analysisDisabled} onClick={submit}>{busy&&operation==='正在核验并生成分析'?'正在分析…':compact?totalDecisions?'确认修改并分析':'开始分析':totalDecisions?'确认决定并重新分析':'检查数据并生成分析'}</button>;
 const tableChoice=<select aria-label="核对数据表" disabled={busy||focusBusy||!active} value={table} onChange={event=>changeTable(event.currentTarget.value as typeof table)}><option value="inspections">检验记录</option>{configuration?.defects&&<option value="defects">缺陷记录</option>}</select>;
 const search=<input aria-label="筛选本页记录" placeholder="筛选本页记录" disabled={locked} value={query} onChange={event=>setQuery(event.currentTarget.value)}/>;
 return <section className={`wd-quality-review${compact?' is-compact':''}`} aria-label="数据核对">
  {compact?<header className="wd-quality-review-heading"><div className="wd-quality-review-toolbar"><h2>{table==='defects'?'缺陷记录':'检验记录'}</h2>{configuration?.defects&&tableChoice}{search}</div><div className="wd-quality-review-header-actions">{toolbar}{primary}</div></header>:<header className="wd-quality-review-heading"><div><h2>数据核对</h2><p>处理本次分析中的问题，原始资料保留。</p></div>{primary}</header>}
  {busy&&<p role="status">{operation}…</p>}{error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
  {active&&page&&!freshData&&!busy&&<p role="status">当前数据尚未重新确认，先前内容仅供查看。请刷新成功后再处理或分析。</p>}
  {currentCheck&&<section className="wd-quality-review-problems" aria-label="本次分析检出问题"><strong>本次分析检出 {currentCheck.totalIssueCount} 项问题</strong><p>以下为已返回的问题，处理决定还需重新分析核验。{currentCheck.totalIssueCount>currentCheck.issues.length?`当前返回 ${currentCheck.issues.length} 项，不代表全部问题。`:''}</p>
   {globalIssues.map((issue,index)=><p key={index}>{reviewIssueMessage(issue)}</p>)}
   {allIssueRows.size>0&&<details open={!compact}><summary>{compact?'查看问题记录':'定位问题记录'}（已返回 {allIssueRows.size} 条）</summary><ul>{[...allIssueRows.values()].map(entry=><li key={`${entry.table}/${entry.row}`}><button disabled={locked} onClick={()=>locate(entry)}>{entry.table==='inspections'?'检验':'缺陷'}记录第 {entry.row} 条</button><span>{entry.issues.map(reviewIssueMessage).join(' ')}</span></li>)}</ul></details>}
  </section>}
  {!compact&&<div className="wd-quality-review-toolbar"><label>数据表 {tableChoice}</label>{search}<button disabled={busy||focusBusy||!active} onClick={refreshData}>刷新数据</button></div>}
  {page&&configuration&&<><div className="wd-quality-review-filters" aria-label="本页记录筛选">{([['all','本页全部'],['issues','本页问题'],['reviewed','本页已填写决定']] as const).map(([key,title])=><button key={key} disabled={locked||key==='issues'&&!currentCheck} aria-pressed={filter===key} onClick={()=>setFilter(key)}>{title}</button>)}<span>共 {page.total} 条原始记录</span></div>
   <QualityReviewTable page={page} configuration={configuration} decisions={decisions[page.tableKind]} check={currentCheckScope} filter={filter} query={query} busy={locked} onOpen={openRow}/>
   {(!compact||page.total>20)&&<nav className="wd-quality-review-pagination" aria-label="原始记录分页"><span>第 {Math.floor(page.offset/20)+1} / {Math.max(1,Math.ceil(page.total/20))} 页 · 本页显示 {visibleRows.length} 条</span><button disabled={locked||page.offset===0} onClick={()=>changePage(Math.max(0,page.offset-20))}>上一页</button><button disabled={locked||page.offset+page.rows.length>=page.total} onClick={()=>changePage(page.offset+20)}>下一页</button></nav>}
  </>}
  {compact?<footer className="wd-quality-review-footer"><span>{totalDecisions?`${totalDecisions} 项修改${unsaved?' · 尚未保存':''}`:formDirty?'记录详情还有未确认修改':'点击记录可核对'}</span><div className="wd-quality-review-footer-actions">
   {(totalDecisions>0||unsaved||formDirty)&&<>{unsaved&&<button disabled={locked||draftRevision===undefined} onClick={()=>void draftAction(false)}>保存核对决定</button>}<button disabled={locked} onClick={()=>void draftAction(true)}>读取已保存决定</button>{totalDecisions>0&&<button disabled={busy} onClick={()=>setShowDecisions(previous=>!previous)}>{showDecisions?'收起':'查看'}本轮决定</button>}</>}
   <details className="wd-quality-review-more"><summary>核对记录</summary><div>{totalDecisions===0&&!unsaved&&!formDirty&&<button disabled={locked} onClick={()=>void draftAction(true)}>读取已保存决定</button>}<button disabled={busy||focusBusy||!active} onClick={refreshData}>刷新数据</button></div></details>
  </div></footer>:<footer className="wd-quality-review-footer"><span>本轮 {totalDecisions} 项决定{unsaved?' · 尚未保存':''} · 重新分析后生效{formDirty?' · 记录详情还有未加入决定的输入':''}</span><button disabled={locked||draftRevision===undefined||!unsaved} onClick={()=>void draftAction(false)}>保存核对决定</button><button disabled={locked} onClick={()=>void draftAction(true)}>读取已保存决定</button><button disabled={busy||!totalDecisions} onClick={()=>setShowDecisions(previous=>!previous)}>{showDecisions?'收起':'查看'}本轮决定</button></footer>}
  {formDirty&&<p>保存核对决定只保存已加入的决定，不包含记录详情中尚未加入的输入。</p>}
  {showDecisions&&<section className="wd-quality-review-decisions" aria-label="本轮核对决定"><ul>{(['inspections','defects'] as const).flatMap(t=>decisions[t].map((decision,index)=><li key={`${t}/${index}`}><span>{t==='inspections'?'检验':'缺陷'}记录第 {decision.row} 条 · {decision.kind==='exclude'?'排除本次分析':`${columns.find(column=>column.header===decision.header)?.label??decision.header} → ${decision.value}`} · {decision.reason}</span><button disabled={locked} onClick={()=>changed({...decisions,[t]:decisions[t].filter((_,number)=>number!==index)})}>撤销</button></li>))}</ul></section>}
  {restore&&<section className="wd-quality-review-restore" role="dialog" aria-label="恢复核对决定确认"><h3>是否恢复已保存决定？</h3><p>已保存 {(restore.draft.inspections?.length??0)+(restore.draft.defects?.length??0)} 项，当前 {totalDecisions} 项。恢复会替换当前决定，原始资料和历史分析保留。</p><button disabled={busy} onClick={()=>setRestore(undefined)}>取消</button><button disabled={locked} className="wd-quality-primary" onClick={confirmRestore}>确认替换当前决定</button></section>}
  {selected&&page&&configuration&&<QualityDrawer open={active&&!!selected} title={page.tableKind==='inspections'?'核对检验记录':'核对缺陷记录'} placement="center" className="wd-quality-record-dialog" closeLabel="关闭详情" closeDisabled={busy||focusBusy}
   subtitle={(()=>{const identifier=columns.find(column=>column.field===(page.tableKind==='inspections'?'inspectionId':'defectId'))??columns.find(column=>['inspectionId','productId','batchId','defectLabel'].includes(column.field));return identifier?<span>{identifier.label}：{reviewValue(identifier.field,selected.values[identifier.index],configuration)}</span>:<span>{page.tableKind==='inspections'?'查看检验信息并确认本次处理':'查看缺陷信息并确认本次处理'}</span>;})()}
   onClose={()=>discardBefore(clearForm,'当前记录还有未确认修改。是否放弃修改并关闭？')}
   footer={<>{onInspectionFocus&&page.tableKind==='inspections'&&<button disabled={locked||formDirty||unsaved} onClick={()=>void inspectInAnalysis()}>{focusBusy?'正在定位…':'在分析中定位'}</button>}<button disabled={busy||focusBusy} onClick={()=>discardBefore(clearForm,'当前记录还有未确认修改。是否放弃修改并关闭？')}>取消</button><button className="wd-quality-primary" disabled={locked||!canConfirm} onClick={add}>确认修改</button></>}>
   <div className="wd-quality-record-layout"><section className="wd-quality-record-summary"><h3>记录信息</h3>
    <dl>{columns.map(column=><div key={column.field}><dt>{column.label}</dt><dd>{reviewValue(column.field,selected.values[column.index],configuration)}</dd></div>)}</dl>
   </section><section className="wd-quality-record-form"><h3>本次处理</h3>
    {rowIssues.filter(issue=>issue.row===selected.row).map((issue,index)=><p className="wd-quality-review-problem" key={index}>{reviewIssueMessage(issue)}</p>)}
    <fieldset disabled={locked} aria-label="本次处理"><label>处理方式<select aria-label="记录处理方式" value={kind} onChange={event=>setKind(event.currentTarget.value as typeof kind)}><option value="correct">修正数据</option><option value="exclude">不纳入本次分析</option></select></label>
     {kind==='correct'&&<><label>修改项目<select aria-label="修正字段" value={header} onChange={event=>changeHeader(event.currentTarget.value)}>{columns.map(column=><option key={column.field} value={column.header}>{column.label}</option>)}</select></label><label>修改后的值{correctionField==='inspectionType'?<select aria-label="修正后的值" value={value} onChange={event=>setValue(event.currentTarget.value)}>
      {!Object.hasOwn(configuration.analysis.rules.inspectionTypes,value)&&<option value={value}>{value?'尚未对应检验类型':'请选择检验类型'}</option>}{Object.keys(configuration.analysis.rules.inspectionTypes).map(code=><option key={code} value={code}>{reviewValue('inspectionType',code,configuration)}</option>)}
     </select>:<input aria-label="修正后的值" maxLength={65536} value={value} onChange={event=>setValue(event.currentTarget.value)}/>}</label></>}
     <label>修改说明<textarea aria-label="核对说明" rows={3} maxLength={2000} placeholder="例如：已对照检验单确认" value={reason} onChange={event=>setReason(event.currentTarget.value)}/></label>
    </fieldset>
    <p className="wd-quality-record-state" role="status">{!formDirty?'当前没有未确认修改。':!recordModified?'修改后的值与原值相同。':!reason.trim()?'请填写修改说明后确认。':'确认后，开始分析即可采用本次处理。'}</p><p className="wd-quality-record-hint">本次处理用于分析，源文件保留原样。</p>{error&&<p role="alert">{error}</p>}
   </section></div>
  </QualityDrawer>}
 </section>;
}
