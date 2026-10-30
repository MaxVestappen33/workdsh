export interface OfficialDesktopArtifact {version:string;url:string;size:number;sha512:string}
export interface DerivedComponent {version:string;url:string;sha256:string}
export interface DerivedRuntimeLock {
 version:string
 components:{
  node:DerivedComponent
  python:DerivedComponent
  pnpm:{version:string;source:string}
  officeSkills:{source:string}
  cli:{source:string}
 }
 pythonWheels:Record<string,string>
}
export interface OfficialRuntimeLock {
 version:string
 distribution:string
 desktopArtifacts:Record<string,OfficialDesktopArtifact>
 primaryRuntime:{node:string;pnpm:string;python:string}
 derivedRuntimes?:Record<string,DerivedRuntimeLock>
}
export interface OfficialRuntimeProvenance {
 schemaVersion:number
 npmDshVersion:string
 target:string
 artifact:OfficialDesktopArtifact
 runtimeMetadataSha256:string
}
export interface DerivedRuntimeProvenance {
 schemaVersion:number
 source:'derived'
 npmDshVersion:string
 target:string
 components:{node:DerivedComponent;python:DerivedComponent;pnpm:{version:string;source:string}}
 pythonWheelsSha256:string
 runtimeMetadataSha256:string
}
export interface ResolvedDerivedRuntime {
 version:string
 node:DerivedComponent
 python:DerivedComponent
 pnpm:{version:string;source:string}
 wheelNames:string[]
 wheels:Record<string,string>
}
export const officialRuntimeLock:OfficialRuntimeLock
export const OFFICIAL_PROVENANCE_FILE:string
export function officialDesktopArtifact(target:string,lock?:OfficialRuntimeLock):OfficialDesktopArtifact
export function assertOfficialPrimaryRuntime(metadata:unknown,target:string,lock?:OfficialRuntimeLock):unknown
export function createOfficialRuntimeProvenance(metadataBytes:Uint8Array|string,target:string,lock?:OfficialRuntimeLock):OfficialRuntimeProvenance
export function writeOfficialRuntimeProvenance(primary:string,target:string,lock?:OfficialRuntimeLock):OfficialRuntimeProvenance
export function verifyOfficialRuntimeProvenance(primary:string,target:string,lock?:OfficialRuntimeLock):OfficialRuntimeProvenance
export const DERIVED_TARGETS:readonly string[]
export function isDerivedTarget(target:string):boolean
export function derivedRuntimeLock(target:string,lock?:OfficialRuntimeLock):ResolvedDerivedRuntime
export function assertDerivedPrimaryRuntime(metadata:unknown,target:string,lock?:OfficialRuntimeLock):unknown
export function createDerivedRuntimeProvenance(metadataBytes:Uint8Array|string,target:string,lock?:OfficialRuntimeLock):DerivedRuntimeProvenance
export function writeDerivedRuntimeProvenance(primary:string,target:string,lock?:OfficialRuntimeLock):DerivedRuntimeProvenance
export function verifyDerivedRuntimeProvenance(primary:string,target:string,lock?:OfficialRuntimeLock):DerivedRuntimeProvenance
export function verifyRuntimeProvenance(primary:string,target:string,lock?:OfficialRuntimeLock):OfficialRuntimeProvenance|DerivedRuntimeProvenance
