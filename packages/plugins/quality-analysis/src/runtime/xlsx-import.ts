import {BoundedQualityWorker,QualityWorkerFailure} from './bounded-worker';
import type {QualityTabularSource} from './analysis-run';
export interface QualityXlsxInput {readonly bytes:Uint8Array;readonly worksheet?:string;readonly headerRow:number}
export type QualityXlsxResult={readonly status:'worksheet_required';readonly worksheets:readonly string[]}|{
  readonly status:'ready';readonly imported:QualityTabularSource['imported'];readonly format:NonNullable<QualityTabularSource['format']>;
};
export class QualityXlsxImporter {
  private readonly worker:BoundedQualityWorker<QualityXlsxInput,QualityXlsxResult>;
  constructor(entry:URL,timeoutMs=10000){this.worker=new BoundedQualityWorker(entry,raw=>{
    const message=raw as {ok:boolean;code?:string;result:QualityXlsxResult};
    if(!message||message.ok!==true)throw new QualityWorkerFailure(message?.code??'xlsx-failed');
    if(!message.result||!['ready','worksheet_required'].includes(message.result.status))throw new QualityWorkerFailure('invalid-result');
    const pending:object[]=[message.result];while(pending.length){const value=pending.pop()!;for(const child of Object.values(value))if(child&&typeof child==='object')pending.push(child);Object.freeze(value);}
    return message.result;
  },timeoutMs);}
  async import(input:QualityXlsxInput,signal?:AbortSignal){
    if(input.bytes.byteLength>8*1024*1024)throw new QualityWorkerFailure('input-budget-exceeded');
    if(!Number.isSafeInteger(input.headerRow)||input.headerRow<1)throw new QualityWorkerFailure('invalid-header-row');
    return this.worker.execute(input,signal);
  }
  close(){return this.worker.close();}
}
