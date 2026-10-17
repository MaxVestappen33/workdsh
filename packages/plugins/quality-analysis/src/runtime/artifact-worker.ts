import {parentPort,workerData} from 'node:worker_threads';
import {renderQualityMarkdownReport} from './report';
import {exportQualityStatisticsCsv} from './statistics-export';
import type {QualityArtifactInput} from './artifact-executor';
if(!parentPort)throw new Error('quality/worker-only');
try {
  const input=workerData as QualityArtifactInput;
  const content=input.kind==='markdown'?renderQualityMarkdownReport(input.run,input.title):
    exportQualityStatisticsCsv(input.run).files.find(file=>file.kind===input.kind)?.content;
  if(content===undefined)throw new Error('quality/export/invalid-kind');
  parentPort.postMessage({ok:true,result:{runId:input.run.runId,contentHash:input.run.contentHash,kind:input.kind,content}});
}catch(cause){parentPort.postMessage({ok:false,code:cause instanceof Error?cause.message:'quality/export/failed'});}
