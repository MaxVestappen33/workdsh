import {BoundedQualityWorker,QualityWorkerFailure} from './bounded-worker';
import {type CreateAnalysisInput,type createQualityAnalysisRun} from './analysis-run';
type AnalysisResult=ReturnType<typeof createQualityAnalysisRun>;
/** Host-only input from authorized snapshots; never accepts page owner/token data. */
export class QualityAnalysisExecutor {
 private readonly worker:BoundedQualityWorker<CreateAnalysisInput,AnalysisResult>;
 constructor(entry:URL,timeoutMs=10000){this.worker=new BoundedQualityWorker(entry,raw=>{
  const message=raw as {ok:boolean;code?:string;result:AnalysisResult};
  if(!message||message.ok!==true)throw new QualityWorkerFailure(message?.code??'analysis-failed');
  if(!message.result||!['complete','blocked'].includes(message.result.status))throw new QualityWorkerFailure('invalid-result');
  const pending:object[]=[message.result];
  while(pending.length){const value=pending.pop()!;for(const child of Object.values(value))if(child&&typeof child==='object')pending.push(child);Object.freeze(value);}
  return message.result;
 },timeoutMs);}
 execute(input:CreateAnalysisInput,signal?:AbortSignal){return this.worker.execute(input,signal);}
 close(){return this.worker.close();}
}
