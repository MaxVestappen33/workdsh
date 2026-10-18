import {WorkbenchDevelopmentOverview} from './WorkbenchDevelopmentOverview.js';
import {createWorkbenchCreationClient,type CreationView} from './creation-client.js';
import React, { useEffect, useMemo, useState } from 'react';
import type { WorkbenchDevelopmentIndexEntry } from 'workdsh-contracts';
import { createWorkbenchDevelopmentClient } from './development-client.js';
import { WorkbenchDevelopments } from './WorkbenchDevelopments.js';
import { createWorkbenchCatalogClient, type WorkbenchCatalogEntry } from './catalog-client.js';
import { WorkbenchSourceCandidates } from './WorkbenchSourceCandidates.js';
export interface WorkbenchDevelopmentsPanelProps {
  readonly identityScopeKey: string;
  readonly canOpen?: (id:string)=>boolean;
  readonly onOpen?: (id:string)=>void;
  readonly onCreate: () => void;
  readonly onDiscuss?: (id:string)=>Promise<void>;
  readonly onContinue: (developmentId: string) => Promise<void>;
}
/** The platform remounts the panel on current UI identity scope changes. */
export function WorkbenchDevelopmentsPanel(props: WorkbenchDevelopmentsPanelProps) {
  return <Panel key={props.identityScopeKey} {...props} />;
}
function Panel(props: WorkbenchDevelopmentsPanelProps) {
  const [candidateDevelopment,setCandidateDevelopment]=useState<string>();
  const creationClient=useMemo(()=>createWorkbenchCreationClient(),[]);
  const [creations,setCreations]=useState<readonly CreationView[]>([]);
  const client = useMemo(() => createWorkbenchDevelopmentClient(), []);
  const catalogClient=useMemo(()=>createWorkbenchCatalogClient(),[]);
  const [catalog,setCatalog]=useState<readonly WorkbenchCatalogEntry[]>();
  const [catalogError,setCatalogError]=useState<string>();
  const [generation, setGeneration] = useState(0);
  const [entries, setEntries] = useState<readonly WorkbenchDevelopmentIndexEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  useEffect(() => {
    const request = new AbortController();
    setLoading(true); setError(undefined); setEntries([]);
    setCatalog(undefined);setCatalogError(undefined);
    void catalogClient(request.signal).then(rows=>{if(!request.signal.aborted)setCatalog(rows);}).catch(()=>{if(!request.signal.aborted)setCatalogError('无法确认安装状态');});
    void creationClient.list(request.signal).then(rows=>{if(!request.signal.aborted)setCreations(rows.filter(row=>row.phase==='discussing'));}).catch(()=>{if(!request.signal.aborted)setError('部分制作记录暂时无法读取，请刷新重试。');});
    void client.list(request.signal).then(rows => {
      if (!request.signal.aborted) { setEntries(rows); setLoading(false); }
    }).catch(() => {
      if (!request.signal.aborted) { setError('无法读取开发记录，请刷新或核对当前登录状态。'); setLoading(false); }
    });
    return () => request.abort();
  }, [client, catalogClient, generation]);
  if(candidateDevelopment)return <WorkbenchSourceCandidates key={candidateDevelopment} developmentId={candidateDevelopment} canOpen={props.canOpen} onOpen={props.onOpen} onClose={()=>{setCandidateDevelopment(undefined);setGeneration(value=>value+1);}} onRefresh={async()=>setGeneration(value=>value+1)}/>;
  return <>{props.onDiscuss&&creations.length>0&&<div className="wd-development-discussions"><WorkbenchDevelopmentOverview heading="需求讨论" limit={creations.length} developments={[]} creations={creations} onContinue={()=>{}} onDiscuss={id=>void props.onDiscuss?.(id).catch(()=>{})}/></div>}<WorkbenchDevelopments canOpen={props.canOpen} onOpen={props.onOpen} catalog={catalog} catalogError={catalogError} onCandidates={setCandidateDevelopment} loadCheckpoints={client.sourceCheckpoints} verifyCheckpoint={client.verifySourceCheckpoint} entries={entries} loading={loading} error={error} onCreate={props.onCreate} onContinue={props.onContinue} onRefresh={async () => setGeneration(value => value + 1)} /></>;
}
