import {createWorkbenchStarter} from './development-starter.js';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, realpath, writeFile, lstat, link, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { parseWorkbenchSystemDefinition, type WorkbenchSystemDefinition, parseWorkbenchDescriptor, type WorkbenchDevelopment, type WorkbenchDescriptor } from 'workdsh-contracts';

/** Publish complete bytes without replacing a developer-owned destination. */
async function writeNewSourceFile(directory:string,name:string,content:string,check:()=>void){
  const temporary=join(directory,`.workdsh-new-${randomUUID()}`);
  try{
    check();await writeFile(temporary,content,{flag:'wx',mode:0o600});check();
    try{await link(temporary,join(directory,name));}
    catch(cause){if(!(cause instanceof Error)||!('code' in cause)||cause.code!=='EEXIST')throw cause;}
  }finally{await rm(temporary,{force:true});}
}

/** Prepare identity metadata in a Host-managed development root. This is not a
 * business implementation, source backup or full-tree snapshot. Agent development
 * must supply and validate real entries before packaging. Never overwrite code. */
export async function prepareWorkbenchDevelopmentSource(root: string, development: WorkbenchDevelopment,
  declaration: WorkbenchDescriptor, authorize: () => void, signal?: AbortSignal, system?:WorkbenchSystemDefinition,sdkPackageVersion?:string) {
  signal?.throwIfAborted(); authorize();
  if (!isAbsolute(root)) throw new Error('workbench/invalid-development-root');
  const descriptor = parseWorkbenchDescriptor(declaration);
  if (descriptor.id !== development.workbenchId) throw new Error('workbench/source-identity-mismatch');
  const canonicalRoot = await realpath(root);
  const key = createHash('sha256').update(JSON.stringify([development.owner.organizationId, development.owner.ownerPrincipalId,
    development.target.hostId, development.id])).digest('hex');
  const directory = join(canonicalRoot, key);
  if (development.source && (development.source.hostId !== development.target.hostId || development.source.directory !== directory))
    throw new Error('workbench/source-identity-mismatch');
  // A previously bound source is not a new project. Missing files must not
  // silently become a fresh starter while the old Session remains attached.
  if(development.source){
    try{if(!(await lstat(directory)).isDirectory())throw Error('workbench/development-source-unavailable');}
    catch(cause){if(cause instanceof Error&&'code' in cause&&cause.code==='ENOENT')throw Error('workbench/development-source-unavailable');throw cause;}
  }
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (await realpath(directory) !== directory) throw new Error('workbench/source-directory-outside');
  signal?.throwIfAborted(); authorize();
  const path = join(directory, 'package.json');
  const starter=createWorkbenchStarter(development.packageName,descriptor,system?parseWorkbenchSystemDefinition(system):undefined,sdkPackageVersion);
  const metadata=starter.manifest;
  let missing=false;
  try{await lstat(path);}catch(cause){if(cause instanceof Error&&'code' in cause&&cause.code==='ENOENT')missing=true;else throw cause;}
  // The manifest is the completion boundary. A cancelled first attempt leaves
  // only partial files; retry fills missing files without replacing any edits.
  if(missing&&development.source)throw Error('workbench/development-source-unavailable');
  if(missing){
    for(const [name,content] of Object.entries(starter.files)){
      signal?.throwIfAborted();authorize();signal?.throwIfAborted();
      await writeNewSourceFile(directory,name,content,()=>{signal?.throwIfAborted();authorize();signal?.throwIfAborted();});
    }
    signal?.throwIfAborted();authorize();signal?.throwIfAborted();
    await writeNewSourceFile(directory,'package.json',`${JSON.stringify(metadata,null,2)}\n`,()=>{signal?.throwIfAborted();authorize();signal?.throwIfAborted();});
  }
  // Existing source belongs to the developer. Verify identity, retain all edits,
  // and do not silently replace its manifest with the initial declaration.
  if (await realpath(path) !== path) throw new Error('workbench/source-metadata-outside');
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  let bytes: Buffer;
  try {
    const stat = await handle.stat();
    const limit = 256 * 1024;
    if (!stat.isFile() || stat.size > limit) throw new Error('workbench/source-package-invalid');
    // Bound the read even if another process grows the manifest after stat.
    const buffer = Buffer.alloc(limit + 1);
    let length = 0;
    while (length < buffer.length) {
      const result = await handle.read(buffer, length, buffer.length - length, length);
      if (!result.bytesRead) break;
      length += result.bytesRead;
    }
    if (length > limit) throw new Error('workbench/source-package-invalid');
    bytes = buffer.subarray(0, length);
  } finally { await handle.close(); }
  let current;
  try { current = JSON.parse(bytes.toString('utf8')); } catch { throw new Error('workbench/source-package-invalid'); }
  if (current?.name !== development.packageName || current?.workdsh?.workbench?.id !== descriptor.id) throw new Error('workbench/source-identity-mismatch');
  signal?.throwIfAborted(); authorize();
  return Object.freeze({ directory, metadataSha256: createHash('sha256').update(bytes).digest('hex') });
}
