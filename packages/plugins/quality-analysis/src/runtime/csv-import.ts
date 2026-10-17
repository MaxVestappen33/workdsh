import type { CompleteCsvTable } from '../domain/csv';
import { BoundedQualityWorker } from './bounded-worker';
export interface CsvImportResult {readonly sha256:string;readonly table:CompleteCsvTable}
export class CsvImportFailure extends Error {constructor(readonly code:string,readonly record?:number){super(`quality/import/${code}`);}}
/** Trusted package worker URL only; caller owns file authorization. */
export class QualityCsvImporter {
 private readonly worker:BoundedQualityWorker<Uint8Array,CsvImportResult>;
 constructor(entry:URL,timeoutMs=10000){this.worker=new BoundedQualityWorker(entry,raw=>{
  const message=raw as {ok:boolean;code?:string;record?:number;sha256:string;table:CompleteCsvTable};
  if(!message || message.ok!==true)throw new CsvImportFailure(message?.code??'worker-failed',message?.record);
  const table=message.table;
  if(!/^[a-f0-9]{64}$/.test(message.sha256)||table?.complete!==true||!Array.isArray(table.headers)||!Array.isArray(table.rows)||!Array.isArray(table.locations)||table.locations.length!==table.rows.length)throw new CsvImportFailure('invalid-worker-result');
  return Object.freeze({sha256:message.sha256,table:Object.freeze({...table,headers:Object.freeze(table.headers),rows:Object.freeze(table.rows.map(row=>Object.freeze(row))),locations:Object.freeze(table.locations.map(row=>Object.freeze(row)))})});
 },timeoutMs);}
 async import(bytes:Uint8Array,signal?:AbortSignal){if(bytes.byteLength>8*1024*1024)throw new CsvImportFailure('byte-budget-exceeded');return this.worker.execute(bytes,signal);}
 close(){return this.worker.close();}
}
