import {parseQualitySourceDescription} from './configuration-view.js';
export function parseQualitySourceViews(value:unknown,recordId:string){
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('invalid-source-views');
 if(new TextEncoder().encode(JSON.stringify(value)).byteLength>256*1024)throw Error('invalid-source-views');
 const row=value as Record<string,unknown>;
 if(Object.keys(row).length!==3||row.recordId!==recordId||!Number.isSafeInteger(row.generation)||(row.generation as number)<0||!Array.isArray(row.entries)||row.entries.length>10)throw Error('invalid-source-views');
 const ids=new Set<string>();
 const entries=row.entries.map(value=>{
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('invalid-source-views');const entry=value as Record<string,unknown>;
  if(Object.keys(entry).some(key=>!['sourceSnapshotId','inspections','defects'].includes(key))||typeof entry.sourceSnapshotId!=='string'||!/^[a-f0-9]{64}$/.test(entry.sourceSnapshotId)||ids.has(entry.sourceSnapshotId))throw Error('invalid-source-views');
  ids.add(entry.sourceSnapshotId);
  return Object.freeze({sourceSnapshotId:entry.sourceSnapshotId,inspections:parseQualitySourceDescription(entry.inspections),...(entry.defects!==undefined?{defects:parseQualitySourceDescription(entry.defects)}:{})});
 });return Object.freeze({recordId,generation:row.generation as number,entries:Object.freeze(entries)});
}
