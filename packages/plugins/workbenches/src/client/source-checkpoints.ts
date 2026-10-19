export interface SourceCheckpointSummary {readonly sha256:string;readonly fileCount:number;readonly byteLength:number;readonly verified:false;}
/** A catalog entry is not a verified restore receipt. */
export function parseSourceCheckpoints(value:unknown):readonly SourceCheckpointSummary[]{
 if(!Array.isArray(value)||value.length>2000)throw Error('invalid-checkpoint-catalog');const ids=new Set<string>();
 return Object.freeze(value.map(item=>{
  if(!item||typeof item!=='object'||Array.isArray(item)||Object.keys(item).length!==4||Object.keys(item).some(key=>!['sha256','fileCount','byteLength','verified'].includes(key)))throw Error('invalid-checkpoint-catalog');
  const record=item as Record<string,unknown>;
  if(typeof record.sha256!=='string'||!/^[a-f0-9]{64}$/.test(record.sha256)||ids.has(record.sha256)||record.verified!==false||!Number.isSafeInteger(record.fileCount)||Number(record.fileCount)<0||Number(record.fileCount)>2000||!Number.isSafeInteger(record.byteLength)||Number(record.byteLength)<0||Number(record.byteLength)>64*1024*1024)throw Error('invalid-checkpoint-catalog');
  ids.add(record.sha256);return Object.freeze({sha256:record.sha256,fileCount:record.fileCount as number,byteLength:record.byteLength as number,verified:false as const});
 }));
}

export interface VerifiedSourceCheckpoint {readonly sha256:string;readonly fileCount:number;readonly byteLength:number;readonly verified:true;}
export function parseVerifiedSourceCheckpoint(value:unknown,expectedSha256:string):VerifiedSourceCheckpoint{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('invalid-checkpoint-receipt');
 const record=value as Record<string,unknown>;
 if(record.verified!==true||record.sha256!==expectedSha256)throw Error('invalid-checkpoint-receipt');
 const summary=parseSourceCheckpoints([{...record,verified:false}])[0]!;
 return Object.freeze({...summary,verified:true});
}
