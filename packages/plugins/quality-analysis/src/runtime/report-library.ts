import {createHash} from 'node:crypto';
import type {ActorContext,LibraryService} from 'workdsh-contracts';
import type {CompleteQualityAnalysisRun} from './analysis-run';
import {renderQualityMarkdownReport} from './report';
import {exportQualityStatisticsCsv} from './statistics-export';
import type {QualityRenderedArtifact} from './artifact-executor';
import {verifyQualityAnalysisRunHash} from './analysis-run';

export async function saveQualityRenderedArtifactToLibrary(library:Pick<LibraryService,'importAsset'>,actor:ActorContext,
  run:CompleteQualityAnalysisRun,title:string,artifact:QualityRenderedArtifact,authorizeCurrent:()=>void,signal?:AbortSignal) {
  if(!verifyQualityAnalysisRunHash(run)||artifact.runId!==run.runId||artifact.contentHash!==run.contentHash||!['markdown','trend','products','pareto'].includes(artifact.kind))throw new Error('quality/export/artifact-run-mismatch');
  return saveArtifact(library,actor,run,title,artifact.kind,artifact.content,authorizeCurrent,signal);
}

/** Called with a run read from the authorized owner's store. Library remains the
 * sole asset/version owner. A later account change never changes captured actor.
 */
export async function saveQualityReportToLibrary(library:Pick<LibraryService,'importAsset'>,actor:ActorContext,
  run:CompleteQualityAnalysisRun,title:string,authorizeCurrent:()=>void,signal?:AbortSignal) {
  return saveArtifact(library,actor,run,title,'markdown',renderQualityMarkdownReport(run,title),authorizeCurrent,signal);
}
export async function saveQualityStatisticsToLibrary(library:Pick<LibraryService,'importAsset'>,actor:ActorContext,
  run:CompleteQualityAnalysisRun,title:string,kind:'trend'|'products'|'pareto',authorizeCurrent:()=>void,signal?:AbortSignal) {
  const file=exportQualityStatisticsCsv(run).files.find(file=>file.kind===kind);
  if(!file)throw new Error('quality/export/invalid-detail-kind');
  return saveArtifact(library,actor,run,title,kind,file.content,authorizeCurrent,signal);
}
async function saveArtifact(library:Pick<LibraryService,'importAsset'>,actor:ActorContext,run:CompleteQualityAnalysisRun,
  title:string,kind:'markdown'|'trend'|'products'|'pareto',content:string,authorizeCurrent:()=>void,signal?:AbortSignal) {
  if(!title.trim()||title.length>256)throw new Error('quality/export/invalid-title');
  const captured=Object.freeze({...actor}),snapshot=structuredClone(run);
  signal?.throwIfAborted();authorizeCurrent();
  const bytes=new TextEncoder().encode(content);
  if(bytes.byteLength>8*1024*1024)throw new Error('quality/export/artifact-byte-budget-exceeded');
  const sha256=createHash('sha256').update(bytes).digest('hex');
  const operationId='quality-report-'+createHash('sha256').update(JSON.stringify([captured.organizationId,captured.principalId,snapshot.runId,snapshot.contentHash,sha256,kind,title])).digest('hex');
  const safeTitle=title.replace(/[\\/:*?"<>|\u0000-\u001f]/g,'_').slice(0,80);
  const name=`${safeTitle}-${kind}-${sha256.slice(0,12)}.${kind==='markdown'?'md':'csv'}`;
  const asset=await library.importAsset(captured,{name,bytes,operationId},signal);
  signal?.throwIfAborted();authorizeCurrent();
  if(!asset.asset||!asset.revision||asset.revision.assetId!==asset.asset.id||asset.revision.originalSha256!==sha256)throw new Error('quality/report/invalid-library-receipt');
  return Object.freeze({runId:snapshot.runId,contentHash:snapshot.contentHash,sha256,operationId,format:kind==='markdown'?'markdown' as const:'csv' as const,detailKind:kind,
    assetId:asset.asset.id,revisionId:asset.revision.id,nodeId:asset.id});
}
