/** Binary-tool provenance is independent of the one npm Host/Client version. */
import {createHash} from 'node:crypto'
import {readFileSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {isDeepStrictEqual} from 'node:util'

export const officialRuntimeLock=JSON.parse(readFileSync(new URL('../../../upstream.json',import.meta.url),'utf8'))
export const OFFICIAL_PROVENANCE_FILE='.workdsh-source-artifact.json'
const exactVersion=/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
export function officialDesktopArtifact(target,lock=officialRuntimeLock){
 const artifact=lock.desktopArtifacts?.[target]
 if(!['mac-arm64','mac-x64','win-x64'].includes(target)||lock.distribution!=='published-packages-and-desktop-release'||
  !exactVersion.test(lock.version??'')||!artifact||!exactVersion.test(artifact.version??''))throw Error('Official binary artifact target/version is not explicitly locked: '+target)
 const expected=`https://download.deepseek.com/dsh-desk/bin/${target}/deepseek-harness-${artifact.version}-${target}.${target==='win-x64'?'exe':'zip'}`
 if(artifact.url!==expected||!Number.isSafeInteger(artifact.size)||artifact.size<=0||!/^[A-Za-z0-9+/]{86}==$/.test(artifact.sha512??'')||Buffer.from(artifact.sha512,'base64').length!==64)throw Error('Official binary artifact URL/size/SHA-512 lock is invalid: '+target)
 return {version:artifact.version,url:artifact.url,size:artifact.size,sha512:artifact.sha512}
}
export function assertOfficialPrimaryRuntime(metadata,target,lock=officialRuntimeLock){
 const artifact=officialDesktopArtifact(target,lock),[platform,arch]=target.split('-')
 if(!metadata||metadata.desktopVersion!==artifact.version||metadata.platform!==(platform==='mac'?'darwin':'win32')||metadata.arch!==arch||
  !['node','pnpm','python'].every(name=>/^\d+\.\d+\.\d+$/.test(lock.primaryRuntime?.[name]??'')&&metadata[name]===lock.primaryRuntime[name])||
  !/^[a-f0-9]{64}$/.test(metadata.payloadDigest??''))throw Error('Official primary runtime metadata does not match the locked binary source: '+target)
 return metadata
}
export function createOfficialRuntimeProvenance(metadataBytes,target,lock=officialRuntimeLock){
 const bytes=Buffer.from(metadataBytes)
 assertOfficialPrimaryRuntime(JSON.parse(bytes.toString('utf8')),target,lock)
 return {schemaVersion:1,npmDshVersion:lock.version,target,artifact:officialDesktopArtifact(target,lock),
  runtimeMetadataSha256:createHash('sha256').update(bytes).digest('hex')}
}
/** Preserve upstream runtime.json verbatim; this separate record is owned. */
export function writeOfficialRuntimeProvenance(primary,target,lock=officialRuntimeLock){
 const receipt=createOfficialRuntimeProvenance(readFileSync(join(primary,'runtime.json')),target,lock)
 writeFileSync(join(primary,OFFICIAL_PROVENANCE_FILE),JSON.stringify(receipt,null,2)+'\n')
 return receipt
}
export function verifyOfficialRuntimeProvenance(primary,target,lock=officialRuntimeLock){
 const expected=createOfficialRuntimeProvenance(readFileSync(join(primary,'runtime.json')),target,lock)
 const actual=JSON.parse(readFileSync(join(primary,OFFICIAL_PROVENANCE_FILE),'utf8'))
 if(!isDeepStrictEqual(actual,expected))throw Error('Official binary resource provenance mismatch: '+target)
 return expected
}
