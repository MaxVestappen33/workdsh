import {BoundedQualityWorker,QualityWorkerFailure} from './bounded-worker';
import type {CompleteQualityAnalysisRun} from './analysis-run';
export type QualityArtifactKind='markdown'|'trend'|'products'|'pareto';
export interface QualityArtifactInput {readonly run:CompleteQualityAnalysisRun;readonly title:string;readonly kind:QualityArtifactKind}
export interface QualityRenderedArtifact {readonly runId:string;readonly contentHash:string;readonly kind:QualityArtifactKind;readonly content:string}
export class QualityArtifactExecutor {
  private readonly worker:BoundedQualityWorker<QualityArtifactInput,QualityRenderedArtifact>;
  constructor(entry:URL,timeoutMs=10000){this.worker=new BoundedQualityWorker(entry,raw=>{
    const message=raw as {ok:boolean;code?:string;result:QualityRenderedArtifact};
    if(!message||message.ok!==true)throw new QualityWorkerFailure(message?.code??'artifact-failed');
    if(typeof message.result?.content!=='string'||message.result.content.length>16*1024*1024)throw new QualityWorkerFailure('artifact-budget-exceeded');
    return Object.freeze(message.result);
  },timeoutMs);}
  execute(input:QualityArtifactInput,signal?:AbortSignal){return this.worker.execute(input,signal);}
  close(){return this.worker.close();}
}
