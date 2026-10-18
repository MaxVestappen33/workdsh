import { createHash, randomUUID } from 'node:crypto';
import { link, mkdir, open, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { inspectWorkbenchPackageArtifact } from './package-artifact.js';

/** Host-owned, bounded, content-addressed copy. Existing archives are verified,
 * never overwritten. This retains installation artifacts, not source backups. */
export async function retainWorkbenchArtifact(installationRoot:string, source:string,
  expected:{packageName:string;version:string;workbenchId:string;sha256:string}, signal?:AbortSignal) {
  const captured={...expected};
  if (!/^[a-f0-9]{64}$/.test(captured.sha256)) throw new Error('workbench/package-hash-mismatch');
  signal?.throwIfAborted();
  const root=await realpath(installationRoot);
  const directory=join(root,'.workdsh-workbench-archives');
  await mkdir(directory,{recursive:true,mode:0o700});
  if (await realpath(directory)!==directory) throw new Error('workbench/archive-directory-outside');
  const destination=join(directory,`${captured.sha256}.tgz`);
  const input=await open(source,'r');
  let bytes:Buffer;
  try {
    const stat=await input.stat();
    if (!stat.isFile() || stat.size>8*1024*1024) throw new Error('workbench/package-archive-size-limit');
    const buffer=Buffer.alloc(8*1024*1024+1);let length=0;
    while(length<buffer.length){
      signal?.throwIfAborted();
      const read=await input.read(buffer,length,Math.min(64*1024,buffer.length-length),length);
      if(!read.bytesRead)break;length+=read.bytesRead;
    }
    if(length>8*1024*1024)throw new Error('workbench/package-archive-size-limit');
    bytes=buffer.subarray(0,length);
  } finally {await input.close();}
  if(createHash('sha256').update(bytes).digest('hex')!==captured.sha256)throw new Error('workbench/package-hash-mismatch');
  const temporary=join(directory,`.pending-${randomUUID()}`);
  const output=await open(temporary,'wx',0o600);
  try {
    await output.writeFile(bytes);await output.sync();await output.chmod(0o400);
  } catch(cause) {await rm(temporary,{force:true});throw cause;} finally {await output.close();}
  try {
    signal?.throwIfAborted();
    // Inspect this copied generation before making it discoverable.
    await inspectWorkbenchPackageArtifact(temporary,captured,signal);
    if(await realpath(directory)!==directory)throw new Error('workbench/archive-directory-outside');
    try {await link(temporary,destination);}
    catch(cause){if(!(cause instanceof Error) || !('code' in cause) || cause.code!=='EEXIST')throw cause;}
    if(await realpath(destination)!==destination)throw new Error('workbench/archive-path-outside');
    await inspectWorkbenchPackageArtifact(destination,captured,signal);
    return destination;
  } finally {await rm(temporary,{force:true});}
}
