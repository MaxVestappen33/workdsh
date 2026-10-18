import React,{useEffect,useRef,useState} from 'react';
import type {LibraryTreeEntry} from 'workdsh-contracts/library';
import {QualityCleaningEditor} from './QualityCleaningEditor.js';
import {QualityLibraryInput,type QualityLibraryInputProps} from './QualityLibraryInput.js';
import {QualityMappingForm} from './QualityMappingForm.js';
import {QualityConfigurationEditor} from './QualityConfigurationEditor.js';
import {QualitySourcePreview} from './QualitySourcePreview.js';
import {QualityHistoryResult} from './QualityHistoryResult.js';
import {QualityDrawer} from './QualityDrawer.js';
import {qualityDataStyles} from './data-styles.js';
import {qualitySourceLibraryChoice} from './data-presentation.js';
import {qualityLibraryChoice} from './library-choice.js';
import type {QualityLibraryImportResult} from './library-import-result.js';
import type {QualityLibraryChoice} from './QualityLibraryImport.js';
import type {QualityConfigurationView} from './configuration-view.js';
import type {createQualityRecordClient,QualityRecordDetail} from './record-client.js';
import type {ReviewCheck} from './review-presentation.js';

export interface QualityRecordWorkflowProps {
 readonly onInspectionFocus?:(inspectionId:string,sourceHash:string)=>Promise<void>;
 readonly active?:boolean;
 readonly view?:'data'|'cleaning'|'tasks'|'settings';
 readonly onNavigate?:(view:'data'|'cleaning'|'settings'|'tasks')=>void;
 readonly onBlocked?:()=>void;
 readonly onRun?:(run:{runId:string;contentHash:string})=>void;
 readonly onRecordChanged?:(record:QualityRecordDetail)=>void;
 readonly onLeaveGuard?:(guard:(()=>boolean)|undefined)=>void;
 readonly identityScopeKey:string;
 readonly record:QualityRecordDetail;
 readonly client:ReturnType<typeof createQualityRecordClient>;
 readonly management:QualityLibraryInputProps['management'];
 readonly previewRegistry?:QualityLibraryInputProps['previewRegistry'];
 readonly openOriginal?:QualityLibraryInputProps['openOriginal'];
 readonly originalRevisionSaved?:LibraryTreeEntry;
 readonly openLibrary:()=>void;
}
type Ready=Extract<QualityLibraryImportResult,{status:'ready'}>;
type SourceViews=Awaited<ReturnType<ReturnType<typeof createQualityRecordClient>['sources']>>;
export function QualityRecordWorkflow(props:QualityRecordWorkflowProps){return <Workflow key={`${props.identityScopeKey}/${props.record.id}`} {...props}/>;}
function Workflow(props:QualityRecordWorkflowProps){
 const [record,setRecord]=useState(props.record),[source,setSource]=useState<Ready>();
 const [mappingEpoch,setMappingEpoch]=useState(0),[savedSources,setSavedSources]=useState<SourceViews>();
 const [selectedSnapshot,setSelectedSnapshot]=useState(''),[importOpen,setImportOpen]=useState(false),[toolsOpen,setToolsOpen]=useState(false);
 const [configuration,setConfiguration]=useState<QualityConfigurationView>();
 const [sourceChoice,setSourceChoice]=useState<QualityLibraryChoice>(),[savedOfficeChoice,setSavedOfficeChoice]=useState<QualityLibraryChoice>();
 const [loading,setLoading]=useState(true),[loadError,setLoadError]=useState<string>(),[attempt,setAttempt]=useState(0);
 const [settingsOpened,setSettingsOpened]=useState(props.view==='settings');
 const [error,setError]=useState<string>(),[busy,setBusy]=useState(false),[run,setRun]=useState<{runId:string;contentHash:string}>(),[issues,setIssues]=useState<ReviewCheck>();
 const pending=useRef<AbortController|undefined>(undefined),active=useRef(false);
 const loadedScope=useRef<string|undefined>(undefined),cleaningGuard=useRef<(()=>boolean)|undefined>(undefined);
 useEffect(()=>{active.current=true;return()=>{active.current=false;pending.current?.abort();};},[]);
 useEffect(()=>{if(props.view==='settings')setSettingsOpened(true);},[props.view]);
 useEffect(()=>{setRecord(current=>props.record.revision>current.revision?props.record:current);},[props.record]);
 function updated(next:QualityRecordDetail){if(!active.current||next.id!==record.id)return;setRecord(next);props.onRecordChanged?.(next);}
 async function refresh(signal?:AbortSignal){const next=await props.client.get(record.id,signal);signal?.throwIfAborted();updated(next);return next;}
 useEffect(()=>{
  if(props.active===false)return;
  const controller=new AbortController();setLoading(true);setLoadError(undefined);
  const scope=`${record.generation}/${record.configuration?.sourceSnapshotId??'none'}`;
  if(loadedScope.current!==scope){loadedScope.current=scope;setConfiguration(undefined);setSourceChoice(undefined);setSavedOfficeChoice(undefined);}
  void(async()=>{
   const current=await props.client.get(record.id,controller.signal);controller.signal.throwIfAborted();updated(current);
   const views=await props.client.sources(record.id,controller.signal);controller.signal.throwIfAborted();
   if(views.generation!==current.generation)throw Error('changed-data');setSavedSources(views);
   if(!current.configuration)return;
   const config=await props.client.configuration(record.id,controller.signal);controller.signal.throwIfAborted();
   if(config.generation!==current.generation||config.sourceSnapshotId!==current.configuration.sourceSnapshotId)throw Error('changed-data');
   const confirmed=await props.client.get(record.id,controller.signal);controller.signal.throwIfAborted();
   if(confirmed.generation!==config.generation||confirmed.configuration?.sourceSnapshotId!==config.sourceSnapshotId)throw Error('changed-data');
   updated(confirmed);setConfiguration(config);setLoading(false);
   try{setSavedOfficeChoice(undefined);const choice=await qualitySourceLibraryChoice(config.inspections,id=>props.management.list(id),controller.signal,next=>{controller.signal.throwIfAborted();setSavedOfficeChoice(next);});controller.signal.throwIfAborted();setSourceChoice(previous=>previous?.assetId===choice?.assetId&&previous?.revisionId===choice?.revisionId&&previous?.title===choice?.title?previous:choice);}
   catch{controller.signal.throwIfAborted();}
  })().catch(()=>{if(!controller.signal.aborted)setLoadError('检验文件暂时无法读取，请重试。');}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  return()=>controller.abort();
 },[props.client,props.management,props.active,record.id,record.generation,record.configuration?.sourceSnapshotId,attempt]);
 useEffect(()=>{
  const receipt=props.originalRevisionSaved,snapshot=record.configuration?.sourceSnapshotId;
  if(!receipt||!snapshot||props.active===false)return;
  const saved=qualityLibraryChoice(receipt);
  if(!saved||saved.format!=='xlsx'||receipt.asset?.currentRevisionId!==saved.revisionId)return;
  const controller=new AbortController(),signal=controller.signal,generation=record.generation;
  void(async()=>{
   const current=await props.client.configuration(record.id,signal);signal.throwIfAborted();
   if(current.generation!==generation||current.sourceSnapshotId!==snapshot||
    current.inspections.provenance?.assetId!==saved.assetId||!current.inspections.format||
    current.inspections.provenance.revisionId===saved.revisionId)return;
   let latest:QualityLibraryChoice|undefined;
   await qualitySourceLibraryChoice(current.inspections,id=>props.management.list(id),signal,choice=>{latest=choice;});signal.throwIfAborted();
   if(!latest)return;
   const confirmed=await props.client.get(record.id,signal);signal.throwIfAborted();
   if(confirmed.generation!==generation||confirmed.configuration?.sourceSnapshotId!==snapshot)return;
   // Offer the Library-confirmed revision without remounting the cleaning editor
   // or replacing its pending decisions. Adoption remains an explicit action.
   setSavedOfficeChoice(latest);
  })().catch(()=>{if(!signal.aborted)setError('新版本已保存，暂时无法确认可采用版本。请重新读取检验文件后再试。');});
  return()=>controller.abort();
 },[props.client,props.management,props.active,props.originalRevisionSaved,record.id,record.generation,record.configuration?.sourceSnapshotId]);
 const namespace=record.configuration?.sourceNamespace??record.id;
 const settingsOpen=props.view==='settings';
 const editorActive=(props.active??true)&&!importOpen&&!settingsOpen;
 async function imported(next:Ready,kind:'inspections'|'defects'){
  if(!active.current)return;if(kind==='inspections')setMappingEpoch(value=>value+1);
  setSource(next);setImportOpen(true);setRun(undefined);setIssues(undefined);
  const request=new AbortController();pending.current?.abort();pending.current=request;setBusy(true);setError(undefined);
  try{await refresh(request.signal);setAttempt(value=>value+1);}catch{if(!request.signal.aborted)setError('文件已导入，状态暂未确认。请重新读取后继续。');}
  finally{if(pending.current===request){pending.current=undefined;if(!request.signal.aborted)setBusy(false);}}
 }
 async function reload(){
  if(pending.current)return;const request=new AbortController();pending.current=request;setBusy(true);setError(undefined);
  try{await refresh(request.signal);setAttempt(value=>value+1);}catch{if(!request.signal.aborted)setError('检验文件状态无法确认，请重试。');}
  finally{if(pending.current===request){pending.current=undefined;if(!request.signal.aborted)setBusy(false);}}
 }
 function restoreSource(){
  if(cleaningGuard.current?.()===false)return;
  const entry=savedSources?.entries.find(row=>row.sourceSnapshotId===selectedSnapshot);
  if(!entry||savedSources?.generation!==record.generation){setError('检验文件已有变化，请重新读取后选择。');return;}
  setSource({status:'ready',sourceSnapshotId:entry.sourceSnapshotId,inspectionRows:entry.inspections.rowCount,defectRows:entry.defects?.rowCount??null,inspectionHeaders:entry.inspections.headers,...(entry.defects?{defectHeaders:entry.defects.headers}:{})});
  setMappingEpoch(value=>value+1);setImportOpen(true);setRun(undefined);setIssues(undefined);
 }
 async function reconcileImport(signal:AbortSignal){
  const next=await refresh(signal);signal.throwIfAborted();
  if(next.generation!==record.generation){setSource(undefined);setRun(undefined);setIssues(undefined);setMappingEpoch(value=>value+1);}
  setAttempt(value=>value+1);
 }
 async function configure(next:Parameters<ReturnType<typeof createQualityRecordClient>['configure']>[4],signal:AbortSignal){
  if(!source||!namespace.trim())throw Error('quality/source-required');
  if(cleaningGuard.current?.()===false)throw Error('unsaved-cleaning');
  await props.client.configure(record.id,record.title,namespace.trim(),source.sourceSnapshotId,next,record.generation,signal);
  await refresh(signal);signal.throwIfAborted();setSource(undefined);setRun(undefined);setImportOpen(false);setAttempt(value=>value+1);props.onNavigate?.('data');
 }
 function useOfficeRevision(){if(!savedOfficeChoice||cleaningGuard.current?.()===false)return;setImportOpen(true);setSource(undefined);}
 function registerCleaningGuard(guard:(()=>boolean)|undefined){cleaningGuard.current=guard;props.onLeaveGuard?.(guard);}
 const tableTools=<>
  {sourceChoice&&props.previewRegistry&&<QualitySourcePreview label="在右侧打开源文件" active={editorActive} source={sourceChoice} registry={props.previewRegistry} openOriginal={props.openOriginal} beforeOpen={()=>cleaningGuard.current?.()!==false}/>}
  <div className="wd-quality-data-more" onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget))setToolsOpen(false);}} onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();setToolsOpen(false);event.currentTarget.querySelector('button')?.focus();}}}><button aria-label="检验数据更多操作" aria-expanded={toolsOpen} onClick={()=>setToolsOpen(value=>!value)}>更多 ···</button>{toolsOpen&&<div className="wd-quality-data-menu">
   <button disabled={busy} onClick={()=>{setToolsOpen(false);setImportOpen(true);}}>更换文件</button>
   <button disabled={busy} onClick={()=>{setToolsOpen(false);props.onNavigate?.('settings');}}>分析规则</button>
   <button disabled={busy} onClick={()=>{setToolsOpen(false);props.openLibrary();}}>在资料库查看</button>
  </div>}</div>
 </>;
 return <section className="wd-quality-data" aria-label="检验数据"><style>{qualityDataStyles}</style>
  {loading&&!record.configuration?<p role="status" className="wd-quality-data-caption">正在读取检验文件…</p>:record.configuration?<section className="wd-quality-data-workspace">
   <header className="wd-quality-data-file"><span className="wd-quality-file-icon" aria-hidden="true">▤</span><div><h2>{sourceChoice?.title??'当前检验文件'}</h2><p>{configuration?.inspections.rowCount??'…'} 条检验记录{configuration?.inspections.format?` · ${configuration.inspections.format.worksheet}`:' · CSV'}{configuration?.defects?` · ${configuration.defects.rowCount} 条缺陷明细`:''}</p></div></header>
   {source&&<div className="wd-quality-data-notice" data-tone="warning"><p>新文件已导入，确认数据列后即可分析。</p><button disabled={busy} onClick={()=>setImportOpen(true)}>确认数据列</button></div>}
   {savedOfficeChoice&&<div className="wd-quality-data-notice"><p>源文件已保存新版本。</p><button onClick={useOfficeRevision}>采用新版本</button></div>}
   <QualityCleaningEditor onInspectionFocus={props.onInspectionFocus} compact sourceScopeKey={`${record.generation}/${record.configuration.sourceSnapshotId}/${attempt}`} analysisDisabled={!!source||busy||loading} toolbar={tableTools} recordId={record.id} client={props.client} check={issues} active={editorActive} onLeaveGuard={registerCleaningGuard}
    onBlocked={(result,scope)=>{setIssues(scope?{...scope,result}:undefined);setRun(undefined);props.onBlocked?.();}}
    onRun={next=>{setIssues(undefined);setRun(next);void refresh().catch(()=>setError('结果已生成，文件状态暂未确认。'));props.onRun?.(next);}}/>
  </section>:!loadError&&<section className="wd-quality-data-empty"><span className="wd-quality-file-icon" aria-hidden="true">▤</span><h2>导入检验数据</h2><p>上传 Excel 或 CSV，查看质量趋势并生成报告。</p><button className="wd-quality-primary" onClick={()=>setImportOpen(true)}>导入文件</button></section>}
  {loadError&&<div className="wd-quality-data-notice"><p role="alert">{loadError}</p><button disabled={busy} onClick={()=>void reload()}>重新读取</button></div>}
  <div className="wd-quality-data-import-modal" hidden={!importOpen}><QualityDrawer open={importOpen&&(props.active??true)} title={record.configuration?'更换检验文件':'导入检验文件'} onClose={()=>{if(!busy)setImportOpen(false);}}>
   <section className="wd-quality-data-import" aria-label="导入检验表">
    <QualityLibraryInput identityScopeKey={props.identityScopeKey} recordId={record.id} generation={record.generation} client={props.client} management={props.management} previewRegistry={props.previewRegistry} openOriginal={props.openOriginal} openLibrary={props.openLibrary} tableKind="inspections" beforeImport={()=>cleaningGuard.current?.()!==false} onReconcile={reconcileImport} onReady={next=>void imported(next,'inspections')} initialSource={savedOfficeChoice}/>
    {source&&<details className="wd-quality-saved-sources"><summary>添加缺陷明细（可选）</summary><QualityLibraryInput identityScopeKey={props.identityScopeKey} recordId={record.id} generation={record.generation} baseSourceSnapshotId={source.sourceSnapshotId} client={props.client} management={props.management} previewRegistry={props.previewRegistry} openOriginal={props.openOriginal} openLibrary={props.openLibrary} tableKind="defects" beforeImport={()=>cleaningGuard.current?.()!==false} onReconcile={reconcileImport} onReady={next=>void imported(next,'defects')}/></details>}
    {!!savedSources?.entries.length&&<details className="wd-quality-saved-sources"><summary>使用之前导入的文件</summary><div className="wd-quality-data-actions"><select aria-label="此前导入的检验表" disabled={busy} value={selectedSnapshot} onChange={event=>setSelectedSnapshot(event.target.value)}><option value="">请选择文件</option>{savedSources.entries.map((entry,index)=><option key={entry.sourceSnapshotId} value={entry.sourceSnapshotId}>检验表 {index+1} · {entry.inspections.rowCount} 条 · {entry.inspections.format?.worksheet??'CSV'}{entry.defects?' · 含缺陷明细':''}</option>)}</select><button disabled={busy||!selectedSnapshot} onClick={restoreSource}>继续使用</button></div></details>}
    {source&&<section className="wd-quality-data-mapping"><header><h3>确认数据列</h3><p className="wd-quality-data-caption">已读取 {source.inspectionRows} 条检验记录{source.defectRows!==null?`、${source.defectRows} 条缺陷记录`:''}。</p></header><QualityMappingForm identityScopeKey={props.identityScopeKey} sourceKey={`${record.id}/${mappingEpoch}`} inputRevisionKey={source.sourceSnapshotId} inspectionHeaders={source.inspectionHeaders} defectHeaders={source.defectHeaders} onApply={configure}/></section>}
   </section>
  </QualityDrawer></div>
  <div className="wd-quality-data-settings-modal" hidden={!settingsOpen}><QualityDrawer open={settingsOpen&&(props.active??true)} title="分析规则" onClose={()=>props.onNavigate?.('data')}><section className="wd-quality-data-mapping">
   {record.configuration?(settingsOpened&&<QualityConfigurationEditor key={`${record.id}/${record.generation}/${record.configuration.sourceSnapshotId}`} identityScopeKey={props.identityScopeKey} recordId={record.id} client={props.client} beforeConfigure={()=>cleaningGuard.current?.()!==false} onChanged={async signal=>{await refresh(signal);signal.throwIfAborted();setAttempt(value=>value+1);props.onNavigate?.('data');}}/>):<p>导入文件后可设置分析规则。</p>}
  </section></QualityDrawer></div>
  {error&&<div className="wd-quality-data-notice"><p role="alert">{error}</p><button disabled={busy} onClick={()=>void reload()}>重新读取</button></div>}
  {!props.view&&run&&<QualityHistoryResult openLibrary={props.openLibrary} identityScopeKey={props.identityScopeKey} recordId={record.id} runId={run.runId} contentHash={run.contentHash} client={props.client}/>}
 </section>;
}
