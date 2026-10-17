import {InstalledWorkbenchManifestReader} from './installed-manifest-reader.js';
import {readFile,lstat,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {inspectWorkbenchPackageArtifact} from './package-artifact.js';
import type {WorkbenchInstallationArchives} from './installation-archives.js';
/** A local installer may seed archives for CLI-installed bundles. This is not
 * an RPC: every archive and installed byte is verified before registration. */
export async function bootstrapInstalledWorkbenchArchives(root:string,archives:WorkbenchInstallationArchives,authorize:()=>void){
 const directory=join(root,'workdsh-bootstrap-archives'),index=join(directory,'index.json');
 let bytes:Buffer;
 try{const stat=await lstat(index);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>65536)throw Error('workbench/invalid-bootstrap-index');bytes=await readFile(index);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error;}
 if(await realpath(directory)!==directory||bytes.length>65536)throw Error('workbench/invalid-bootstrap-index');
 const data=JSON.parse(bytes.toString('utf8')) as {version:number;entries:unknown[]};
 if(data.version!==1||!Array.isArray(data.entries)||data.entries.length>12)throw Error('workbench/invalid-bootstrap-index');
 for(const value of data.entries){
  authorize();
  const row=value as {fileName:string;packageName:string;version:string;workbenchId:string;sha256:string};
  if(!row||typeof row.fileName!=='string'||! /^[a-zA-Z0-9._-]{1,214}\.tgz$/.test(row.fileName)||typeof row.packageName!=='string'||typeof row.version!=='string'||typeof row.workbenchId!=='string'||! /^[a-f0-9]{64}$/.test(row.sha256))throw Error('workbench/invalid-bootstrap-index');
  // Installer bootstrap entries are seeds, not a pin to an obsolete version.
  // An official package update must not make every workbench fail to start.
  // Skip old seeds without accepting any bytes or manufacturing a new receipt.
  let installed;
  try{installed=await new InstalledWorkbenchManifestReader(root).read(row.packageName);}
  catch(cause){if(!(cause&&typeof cause==='object'&&'code' in cause&&cause.code==='ENOENT'))throw cause;}
  authorize();
  if(installed&&installed.version!==row.version)continue;
  const path=join(directory,row.fileName),stat=await lstat(path);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>8*1024*1024||await realpath(path)!==path)throw Error('workbench/invalid-bootstrap-archive');
  const inspected=await inspectWorkbenchPackageArtifact(path,{packageName:row.packageName,version:row.version,workbenchId:row.workbenchId,sha256:row.sha256});
  authorize();
  let existing;
  try{existing=archives.resolve(row.packageName,row.version);}catch(error){if(!(error instanceof Error)||error.message!=='workbench/installation-archive-unavailable')throw error;}
  // Repacking unchanged files may change tar bytes. Preserve the original
  // retained archive, but require its installed-file verification to still pass.
  if(existing){
   if(existing.workbenchId!==row.workbenchId)throw Error('workbench/installation-version-conflict');
   await archives.retainVerified({packageName:row.packageName,version:row.version,workbenchId:existing.workbenchId,sha256:existing.sha256,path:existing.path},authorize);
  }else await archives.retainVerified({...inspected.receipt,workbenchId:row.workbenchId,path},authorize);
 }
}
