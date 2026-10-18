export interface OfficialDesktopArtifact {version:string;url:string;size:number;sha512:string}
export interface OfficialRuntimeLock {
 version:string
 distribution:string
 desktopArtifacts:Record<string,OfficialDesktopArtifact>
 primaryRuntime:{node:string;pnpm:string;python:string}
}
export interface OfficialRuntimeProvenance {
 schemaVersion:number
 npmDshVersion:string
 target:string
 artifact:OfficialDesktopArtifact
 runtimeMetadataSha256:string
}
export const officialRuntimeLock:OfficialRuntimeLock
export const OFFICIAL_PROVENANCE_FILE:string
export function officialDesktopArtifact(target:string,lock?:OfficialRuntimeLock):OfficialDesktopArtifact
export function assertOfficialPrimaryRuntime(metadata:unknown,target:string,lock?:OfficialRuntimeLock):unknown
export function createOfficialRuntimeProvenance(metadataBytes:Uint8Array|string,target:string,lock?:OfficialRuntimeLock):OfficialRuntimeProvenance
export function writeOfficialRuntimeProvenance(primary:string,target:string,lock?:OfficialRuntimeLock):OfficialRuntimeProvenance
export function verifyOfficialRuntimeProvenance(primary:string,target:string,lock?:OfficialRuntimeLock):OfficialRuntimeProvenance
