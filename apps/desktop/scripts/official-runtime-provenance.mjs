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

/** 官方未发布的平台（当前仅 linux）只能用上游官方构建组合出运行时。 */
export const DERIVED_TARGETS=Object.freeze(['linux-arm64','linux-x64'])
export function isDerivedTarget(target){ return DERIVED_TARGETS.includes(target) }
const sha256Hex=/^[a-f0-9]{64}$/
function derivedComponent(entry,name,lock){
 if(!entry||!exactVersion.test(entry.version??'')||entry.version!==lock.primaryRuntime?.[name])throw Error(`Derived runtime ${name} version is not the locked primary runtime version`)
 if(!/^https:\/\//.test(entry.url??'')||!sha256Hex.test(entry.sha256??''))throw Error(`Derived runtime ${name} URL/SHA-256 lock is invalid`)
 return {version:entry.version,url:entry.url,sha256:entry.sha256}
}
/** Validate the derived (composed) runtime lock for one target. */
export function derivedRuntimeLock(target,lock=officialRuntimeLock){
 const entry=lock.derivedRuntimes?.[target]
 if(!isDerivedTarget(target)||lock.distribution!=='published-packages-and-desktop-release'||
  !exactVersion.test(lock.version??'')||!entry||entry.version!==lock.version||!entry.components)throw Error('Derived runtime target/version is not explicitly locked: '+target)
 const node=derivedComponent(entry.components.node,'node',lock)
 const python=derivedComponent(entry.components.python,'python',lock)
 const pnpm=entry.components.pnpm
 if(pnpm?.version!==lock.primaryRuntime.pnpm||pnpm.source!=='mac-arm64')throw Error('Derived runtime pnpm must be the locked official macOS primary runtime pnpm: '+target)
 for(const name of ['officeSkills','cli']) if(entry.components[name]?.source!=='mac-arm64')throw Error(`Derived runtime ${name} must come from the official macOS release: `+target)
 const wheels=entry.pythonWheels??{}
 const names=Object.keys(wheels).sort()
 if(names.length===0||names.some(name=>!/\.whl$/.test(name)||!sha256Hex.test(wheels[name])))throw Error('Derived runtime python wheel lock is invalid: '+target)
 return {version:entry.version,node,python,pnpm:{version:pnpm.version,source:pnpm.source},wheelNames:names,wheels:Object.fromEntries(names.map(name=>[name,wheels[name]]))}
}
export function assertDerivedPrimaryRuntime(metadata,target,lock=officialRuntimeLock){
 const derived=derivedRuntimeLock(target,lock),[platform,arch]=target.split('-')
 if(!metadata||metadata.desktopVersion!==derived.version||metadata.platform!==platform||metadata.arch!==arch||
  metadata.node!==derived.node.version||metadata.pnpm!==derived.pnpm.version||metadata.python!==derived.python.version||
  !/^[a-f0-9]{64}$/.test(metadata.payloadDigest??''))throw Error('Derived primary runtime metadata does not match the locked component sources: '+target)
 return metadata
}
export function createDerivedRuntimeProvenance(metadataBytes,target,lock=officialRuntimeLock){
 const bytes=Buffer.from(metadataBytes)
 assertDerivedPrimaryRuntime(JSON.parse(bytes.toString('utf8')),target,lock)
 const derived=derivedRuntimeLock(target,lock)
 return {schemaVersion:1,source:'derived',npmDshVersion:lock.version,target,
  components:{node:derived.node,python:derived.python,pnpm:derived.pnpm},
  pythonWheelsSha256:createHash('sha256').update(derived.wheelNames.map(name=>`${name} ${derived.wheels[name]}\n`).join('')).digest('hex'),
  runtimeMetadataSha256:createHash('sha256').update(bytes).digest('hex')}
}
export function writeDerivedRuntimeProvenance(primary,target,lock=officialRuntimeLock){
 const receipt=createDerivedRuntimeProvenance(readFileSync(join(primary,'runtime.json')),target,lock)
 writeFileSync(join(primary,OFFICIAL_PROVENANCE_FILE),JSON.stringify(receipt,null,2)+'\n')
 return receipt
}
export function verifyDerivedRuntimeProvenance(primary,target,lock=officialRuntimeLock){
 const expected=createDerivedRuntimeProvenance(readFileSync(join(primary,'runtime.json')),target,lock)
 const actual=JSON.parse(readFileSync(join(primary,OFFICIAL_PROVENANCE_FILE),'utf8'))
 if(!isDeepStrictEqual(actual,expected))throw Error('Derived binary resource provenance mismatch: '+target)
 return expected
}
/** Verify whichever provenance applies to this target, never both. */
export function verifyRuntimeProvenance(primary,target,lock=officialRuntimeLock){
 return isDerivedTarget(target)?verifyDerivedRuntimeProvenance(primary,target,lock):verifyOfficialRuntimeProvenance(primary,target,lock)
}
