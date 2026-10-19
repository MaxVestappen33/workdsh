import type {LibraryOriginalRevisionInput,LibraryTreeEntry} from 'workdsh-contracts/library';
const hash=async(bytes:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',Uint8Array.from(bytes))),byte=>byte.toString(16).padStart(2,'0')).join('');
/** The Library owner persists a new immutable revision; Office only supplies edited bytes. */
export function createLibraryOriginalRevisionSave(source:{assetId:string;revisionId:string;kind:string},
 save:(input:LibraryOriginalRevisionInput,signal:AbortSignal)=>Promise<LibraryTreeEntry>,
 onSaved:(entry:LibraryTreeEntry)=>void){
 let busy=false,savedHash:string|undefined;
 return async(bytes:Uint8Array,signal:AbortSignal)=>{
  if(busy)throw new Error('源文件正在保存，请等待结果。');
  busy=true;
  try{
   signal.throwIfAborted();
   if(source.kind!=='xlsx'||!bytes.byteLength||bytes.byteLength>10*1024*1024)throw new Error('此文件暂不支持保存修改。');
   const snapshot=Uint8Array.from(bytes),digest=await hash(snapshot);signal.throwIfAborted();
   if(savedHash&&savedHash!==digest)throw new Error('请先采用已保存的新版本，再重新打开源文件。');
   const operation=await hash(new TextEncoder().encode(JSON.stringify([source.assetId,source.revisionId,digest])));signal.throwIfAborted();
   const entry=await save({assetId:source.assetId,expectedRevisionId:source.revisionId,operationId:'library-office-'+operation,bytes:snapshot},signal);
   signal.throwIfAborted();
   if(!entry.asset||!entry.revision||entry.asset.id!==source.assetId||entry.revision.assetId!==source.assetId||entry.revision.id===source.revisionId||entry.revision.originalSha256!==digest)throw new Error('新版本保存结果未确认。');
   savedHash=digest;onSaved(entry);
  }finally{busy=false;}
 };
}
