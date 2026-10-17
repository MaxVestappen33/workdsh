import type {LibraryOriginalRevisionInput, LibraryTreeEntry} from 'workdsh-contracts/library';
import type {QualityLibraryChoice} from './QualityLibraryImport.js';
import {qualityLibraryChoice} from './library-choice.js';
const digest=async(bytes:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes))),v=>v.toString(16).padStart(2,'0')).join('');
/** A save receipt proposes a source; its owner must explicitly adopt it. */
export function createQualitySourceRevisionSave(source:QualityLibraryChoice,
 save:(input:LibraryOriginalRevisionInput,signal:AbortSignal)=>Promise<LibraryTreeEntry>,
 propose:(source:QualityLibraryChoice)=>void){
 let savedHash:string|undefined;
 let saving=false;
 return async(bytes:Uint8Array,signal:AbortSignal)=>{
  if(saving)throw new Error('源表正在保存，请等待保存结果。');
  saving=true;
  try{
  signal.throwIfAborted();
  if(source.format!=='xlsx'||!bytes.byteLength||bytes.byteLength>10*1024*1024)throw new Error('不支持保存此源表');
  const snapshot=new Uint8Array(bytes),hash=await digest(snapshot);
  signal.throwIfAborted();
  if(savedHash&&savedHash!==hash)throw new Error('请先采用已保存版本并重新打开源表。');
  const operationHash=await digest(new TextEncoder().encode(JSON.stringify([source.assetId,source.revisionId,hash])));
  signal.throwIfAborted();
  const entry=await save({assetId:source.assetId,expectedRevisionId:source.revisionId,operationId:'quality-office-'+operationHash,bytes:snapshot},signal);
  signal.throwIfAborted();
  const choice=qualityLibraryChoice(entry);
  if(!choice||choice.assetId!==source.assetId||choice.format!==source.format||choice.revisionId===source.revisionId||entry.revision?.originalSha256!==hash)throw new Error('保存回执无效');
  savedHash=hash;propose(choice);
  }finally{saving=false;}
 };
}
