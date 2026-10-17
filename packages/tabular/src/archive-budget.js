import JSZip from 'jszip';

/** Counts actual inflated chunks before workbook loading. No full entry buffers.
 * Execute inside a cancellable Host worker; limits are not ZIP metadata claims.
 */
export async function checkTabularArchiveBudget(bytes, limits = {}, signal) {
  const budget={inputBytes:8*1024*1024,expandedBytes:64*1024*1024,entryBytes:16*1024*1024,entries:1024,...limits};
  if(Object.values(budget).some(value=>!Number.isSafeInteger(value)||value<1))throw Error('ARCHIVE_INVALID_BUDGET');
  signal?.throwIfAborted();
  if(bytes.byteLength>budget.inputBytes)throw Error('ARCHIVE_INPUT_LIMIT');
  let zip;
  // CRC checking here would inflate every entry before our actual-byte guard.
  try{zip=await JSZip.loadAsync(bytes,{checkCRC32:false});}catch{throw Error('ARCHIVE_INVALID');}
  const entries=Object.values(zip.files);
  if(entries.length>budget.entries)throw Error('ARCHIVE_ENTRY_LIMIT');
  let expandedBytes=0;
  for(const entry of entries){
    signal?.throwIfAborted();
    const path=entry.unsafeOriginalName??entry.name;
    if(path.startsWith('/')||/[\\:\u0000]/.test(path)||path.split('/').some(part=>part==='..'))throw Error('ARCHIVE_UNSAFE_PATH');
    if(entry.dir)continue;
    let entryBytes=0;
    const stream=entry.internalStream('uint8array');
    await new Promise((resolve,reject)=>{
      let finished=false;
      const end=error=>{if(finished)return;finished=true;stream.pause();signal?.removeEventListener('abort',abort);error?reject(error):resolve();};
      const abort=()=>end(signal.reason??new Error('ARCHIVE_ABORTED'));
      signal?.addEventListener('abort',abort,{once:true});
      stream.on('data',chunk=>{
        if(finished)return;
        entryBytes+=chunk.byteLength;expandedBytes+=chunk.byteLength;
        if(entryBytes>budget.entryBytes)end(new Error('ARCHIVE_SINGLE_ENTRY_LIMIT'));
        else if(expandedBytes>budget.expandedBytes)end(new Error('ARCHIVE_EXPANDED_LIMIT'));
      });
      stream.on('error',error=>end(error));stream.on('end',()=>end());
      if(signal?.aborted)abort();else stream.resume();
    });
  }
  signal?.throwIfAborted();
  return Object.freeze({inputBytes:bytes.byteLength,expandedBytes,entries:entries.length});
}
