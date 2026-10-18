import type {ActorContext,LibraryService,ProjectService} from 'workdsh-contracts';
import type {QualityReportReceipt} from './run-store';
import {createHash} from 'node:crypto';

/** Separate retryable association; report remains in Library if linking fails.
 * The caller selects a project explicitly. This never changes the run's context.
 */
export async function linkQualityReportToProject(library:Pick<LibraryService,'readOriginal'|'list'>,
  projects:Pick<ProjectService,'get'|'addAsset'>,actor:ActorContext,receipt:QualityReportReceipt,
  projectId:string,authorizeCurrent:()=>void,signal?:AbortSignal) {
  const captured=Object.freeze({...actor}),report=Object.freeze({...receipt});
  if(!projectId.trim()||projectId.length>256)throw new Error('quality/project/invalid-project');
  signal?.throwIfAborted();authorizeCurrent();
  // Validate the exact historical revision through the library owner first.
  const bytes=await library.readOriginal(captured,report.assetId,report.revisionId,signal);
  if(createHash('sha256').update(bytes).digest('hex')!==report.sha256)throw new Error('quality/project/report-hash-mismatch');
  signal?.throwIfAborted();authorizeCurrent();
  const entries=await library.list(captured,undefined,signal);
  const entry=entries.find(entry=>entry.id===report.nodeId&&entry.asset?.id===report.assetId);
  if(!entry?.asset)throw new Error('quality/project/report-node-unavailable');
  const project=await projects.get(captured,projectId,signal);
  signal?.throwIfAborted();authorizeCurrent();
  if(project.project.id!==projectId)throw new Error('quality/project/invalid-project-receipt');
  const reference=await projects.addAsset(captured,projectId,{nodeId:report.nodeId,assetId:report.assetId,
    revisionId:report.revisionId,name:entry.name,kind:entry.asset.kind},signal);
  signal?.throwIfAborted();authorizeCurrent();
  if(reference.projectId!==projectId||reference.assetId!==report.assetId||reference.revisionId!==report.revisionId)throw new Error('quality/project/invalid-asset-receipt');
  return reference;
}
