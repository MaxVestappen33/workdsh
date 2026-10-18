import {createHash} from 'node:crypto';
import type {ActorContext,LibraryService,LibraryTreeEntry} from 'workdsh-contracts';
import type {QualityReportDocumentView,QualityReportFields} from '../domain/report-document.js';
import type {CompleteQualityAnalysisRun} from './analysis-run.js';
import type {QualityReportReceipt} from './run-store.js';
import {decodeQualityReportDocument,encodeQualityReportDocument,qualityReportBytesHash,type QualityReportDocumentIdentity,type QualityStoredReportDocument,type QualityStoredReportVersion} from './report-document.js';

export type QualityReportDocumentLibrary=Pick<LibraryService,'importAsset'|'readOriginal'|'saveOriginalRevision'>;
export function qualityReportLibraryOperation(actor:ActorContext,identity:QualityReportDocumentIdentity,operationId:string):string {
  return 'quality-report-document-'+createHash('sha256').update(JSON.stringify([actor.organizationId,actor.principalId,identity.recordId,identity.runId,identity.contentHash,identity.reportId,operationId])).digest('hex');
}
export function qualityReportDocumentReceipt(document:QualityStoredReportDocument,version:QualityStoredReportVersion):QualityReportReceipt {
  return {runId:document.runId,contentHash:document.contentHash,sha256:version.sha256,operationId:version.libraryOperationId,
    assetId:document.assetId,revisionId:version.revisionId,nodeId:document.nodeId,format:'markdown',detailKind:'markdown'};
}
export async function readQualityReportDocument(library:Pick<LibraryService,'readOriginal'>,actor:ActorContext,run:CompleteQualityAnalysisRun,
  document:QualityStoredReportDocument,revisionId:string|undefined,guard:()=>void,signal?:AbortSignal):Promise<QualityReportDocumentView> {
  const snapshot=structuredClone(document),current=snapshot.versions.at(-1)!;
  const selected=revisionId===undefined?current:snapshot.versions.find(version=>version.revisionId===revisionId);
  if(!selected)throw Error('quality/report-document/revision-not-found');
  signal?.throwIfAborted();guard();
  const bytes=await library.readOriginal(Object.freeze({...actor}),snapshot.assetId,selected.revisionId,signal);
  signal?.throwIfAborted();guard();
  if(qualityReportBytesHash(bytes)!==selected.sha256)throw Error('quality/report-document/hash-mismatch');
  const decoded=decodeQualityReportDocument(bytes,snapshot,run);
  if(decoded.fields.title!==selected.title)throw Error('quality/report-document/metadata-mismatch');
  return {reportId:snapshot.reportId,recordId:snapshot.recordId,runId:snapshot.runId,contentHash:snapshot.contentHash,
    fields:decoded.fields,revisionId:selected.revisionId,currentRevisionId:current.revisionId,version:selected.version,
    versions:snapshot.versions.map(({libraryOperationId:_libraryOperationId,...version})=>version),markdown:decoded.markdown,
    receipt:qualityReportDocumentReceipt(snapshot,selected)};
}
function verifyEntry(entry:LibraryTreeEntry,actor:ActorContext,sha256:string,previous?:QualityStoredReportDocument):void {
  const asset=entry.asset,revision=entry.revision;
  if(!asset||!revision||asset.kind!=='markdown'||asset.status!=='active'||asset.owner.organizationId!==actor.organizationId||asset.owner.ownerPrincipalId!==actor.principalId||
    !asset.id||!revision.id||revision.assetId!==asset.id||revision.originalSha256!==sha256||asset.nodeId!==entry.id||entry.assetId!==asset.id||
    (previous&&(asset.id!==previous.assetId||entry.id!==previous.nodeId||revision.id===previous.versions.at(-1)!.revisionId))||
    revision.number!==(previous?previous.versions.at(-1)!.version+1:1))throw Error('quality/report-document/invalid-library-receipt');
}

/** Stable canonical bytes + scoped operation ID recover an actual Library commit
 * whose Quality metadata acknowledgement was lost. No report body is stored here. */
export async function persistQualityReportDocument(library:QualityReportDocumentLibrary,actor:ActorContext,run:CompleteQualityAnalysisRun,
  identity:QualityReportDocumentIdentity,fields:QualityReportFields,operationId:string,previous:QualityStoredReportDocument|undefined,
  guard:()=>void,signal?:AbortSignal):Promise<QualityStoredReportDocument> {
  const captured=Object.freeze({...actor}),markdown=encodeQualityReportDocument(identity,run,fields),bytes=new TextEncoder().encode(markdown),sha256=qualityReportBytesHash(bytes);
  const libraryOperationId=qualityReportLibraryOperation(captured,identity,operationId);
  signal?.throwIfAborted();guard();
  const entry=previous
    ? await (()=>{if(!library.saveOriginalRevision)throw Error('quality/report-document/revision-save-unavailable');
      return library.saveOriginalRevision(captured,{assetId:previous.assetId,expectedRevisionId:previous.versions.at(-1)!.revisionId,operationId:libraryOperationId,bytes},signal,guard);})()
    : await library.importAsset(captured,{name:`质量分析报告-${identity.reportId}.md`,bytes,mediaType:'text/markdown',source:'created',operationId:libraryOperationId},signal);
  signal?.throwIfAborted();guard();verifyEntry(entry,captured,sha256,previous);
  const version:QualityStoredReportVersion={version:entry.revision!.number,revisionId:entry.revision!.id,sha256,operationId,libraryOperationId,createdAt:entry.revision!.createdAt,title:fields.title};
  return {...identity,assetId:entry.asset!.id,nodeId:entry.id,versions:[...(previous?.versions??[]),version]};
}
