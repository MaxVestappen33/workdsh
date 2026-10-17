import {parentPort,workerData} from 'node:worker_threads';
import {createQualityAnalysisRun} from './analysis-run';
if(!parentPort)throw new Error('quality/worker-only');
try{parentPort.postMessage({ok:true,result:createQualityAnalysisRun(workerData)});}
catch(cause){parentPort.postMessage({ok:false,code:cause instanceof Error?cause.message:'quality/analysis/failed'});}
