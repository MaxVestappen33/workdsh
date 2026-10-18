import React,{useEffect,useState} from 'react';
import {QualityMappingForm} from './QualityMappingForm.js';
import type {createQualityRecordClient} from './record-client.js';
import type {QualityConfigurationView} from './configuration-view.js';
export interface QualityConfigurationEditorProps {readonly identityScopeKey:string;readonly recordId:string;readonly client:Pick<ReturnType<typeof createQualityRecordClient>,'configuration'|'configure'>;readonly beforeConfigure?:()=>boolean;readonly onChanged?:(signal:AbortSignal)=>Promise<void>;}
export function QualityConfigurationEditor(props:QualityConfigurationEditorProps){return <EditorBody key={`${props.identityScopeKey}/${props.recordId}`} {...props}/>;}
function EditorBody({identityScopeKey,recordId,client,onChanged,beforeConfigure}:QualityConfigurationEditorProps){
 const [view,setView]=useState<QualityConfigurationView>(),[error,setError]=useState<string>(),[attempt,setAttempt]=useState(0);
 useEffect(()=>{const controller=new AbortController();setError(undefined);void client.configuration(recordId,controller.signal).then(value=>{if(!controller.signal.aborted)setView(value);}).catch(()=>{if(!controller.signal.aborted)setError('配置无法读取，请核对数据来源或重新导入。');});return()=>controller.abort();},[client,recordId,attempt]);
 return <section aria-label="分析配置">{error&&<><p role="alert">{error}</p><button onClick={()=>setAttempt(value=>value+1)}>重新读取</button></>}
  {!view&&!error&&<p role="status">正在读取数据列…</p>}{view&&<><p className="wd-quality-data-caption">{view.inspections.rowCount} 条检验记录{view.defects?` · ${view.defects.rowCount} 条缺陷明细`:''}</p>
   <QualityMappingForm identityScopeKey={identityScopeKey} sourceKey={`${view.sourceSnapshotId}/${view.mappingRevision}/${view.generation}`} inspectionHeaders={view.inspections.headers} defectHeaders={view.defects?.headers} initial={view.analysis} onApply={async(analysis,signal)=>{if(beforeConfigure?.()===false)throw Error('unsaved-cleaning');await client.configure(recordId,view.title,view.sourceNamespace,view.sourceSnapshotId,analysis,view.generation,signal);const next=await client.configuration(recordId,signal);signal.throwIfAborted();setView(next);await onChanged?.(signal);}}/>
  </>}
 </section>;
}
