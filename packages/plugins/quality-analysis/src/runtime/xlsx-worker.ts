import {parentPort,workerData} from 'node:worker_threads';
import {createHash} from 'node:crypto';
import {readWorksheetTable} from 'workdsh-tabular';
if(!parentPort)throw new Error('quality/worker-only');
try {
  const result=await readWorksheetTable(workerData.bytes,{worksheet:workerData.worksheet,headerRow:workerData.headerRow});
  if(result.status==='worksheet_required')parentPort.postMessage({ok:true,result});
  else {
    if(!result.headers.length||!result.rows.some(row=>row.some(value=>value!==null&&(typeof value!=='string'||value.trim()))))throw new Error('quality/xlsx/worksheet-empty');
    if(result.headers.some(header=>!header.trim()))throw new Error('quality/xlsx/header-missing');
    if(new Set(result.headers.map(header=>header.trim())).size!==result.headers.length)throw new Error('quality/xlsx/header-duplicate');
    const table={complete:true,byteLength:workerData.bytes.byteLength,headers:result.headers,rows:result.rows,
      locations:result.rows.map((_,index)=>({record:result.headerRow+1+index,line:result.headerRow+1+index}))};
    parentPort.postMessage({ok:true,result:{status:'ready',imported:{sha256:createHash('sha256').update(workerData.bytes).digest('hex'),table},
      format:{kind:'xlsx',worksheet:result.worksheet,headerRow:result.headerRow,valuePolicy:result.valuePolicy}}});
  }
} catch(cause) {parentPort.postMessage({ok:false,code:cause instanceof Error?cause.message:'quality/xlsx/failed'});}
