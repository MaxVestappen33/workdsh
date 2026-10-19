import {createQualityExpertTasks} from './expert-tasks.js';
import {readQualityExpertInterpretation} from './expert-association.js';
import {ensureQualityAiRunSession,readQualityRunInterpretation} from './run-session.js';
import type {Context} from '@deepseek-ai/cordis';
import type {DomainFacility} from '@deepseek-ai/dsh-storage-domain';
import type {HostConnectionHandle} from '@deepseek-ai/dsh-client-connection';
import type {IdentityService,LibraryService,ProjectService} from 'workdsh-contracts';
import type {QualityAnalysisExecutor} from './analysis-executor.js';
import type {QualityArtifactExecutor} from './artifact-executor.js';
import {QualityAnalysisRunService,type QualityLibraryInputPorts} from './run-service.js';
import {handleQualityRecordsRequest,qualityRecordsPath} from './record-rpc.js';
import {createQualityAiTools,registerQualityAiTools} from './ai-tools.js';
/** Internal composition adapter, not a loadable plugin or Profile activation.
 * The enclosing Host owns worker executors and connection admission.
 */
export function mountQualityRecordsHost(ctx:Context,artifacts?:Pick<QualityArtifactExecutor,'execute'>,analysis?:Pick<QualityAnalysisExecutor,'execute'>,inputs?:QualityLibraryInputPorts):QualityAnalysisRunService{
  const storage=ctx.get('storageDomain') as DomainFacility|undefined;
  const identity=ctx.get('workdshIdentity') as IdentityService|undefined;
  const connection=ctx.get('connection') as HostConnectionHandle|undefined;
  if(!storage||!identity||!connection)throw new Error('quality/host/services-unavailable');
  const reports=ctx.get('workdshLibrary') as Pick<LibraryService,'importAsset'|'readOriginal'|'saveOriginalRevision'|'list'|'readContentDraft'|'saveContentDraft'|'archiveContentDraft'>|undefined;
  const service=new QualityAnalysisRunService(storage,identity,artifacts);
  const ai=createQualityAiTools(ctx,service,storage,identity,analysis,reports);
  if(ctx.get('tools'))registerQualityAiTools(ctx,ai);
  const expertTasks=createQualityExpertTasks(ctx,service);
  ctx.effect(()=>()=>service.close(),'workdsh.quality.records.close');
  ctx.effect(()=>connection.fetch.register({path:qualityRecordsPath,methods:['POST'],requestBody:'streaming',fetch:request=>handleQualityRecordsRequest(request,service,analysis,inputs,reports,ctx.get('workdshProjects') as ProjectService|undefined,(view,signal)=>ensureQualityAiRunSession(ctx,view,ai,(basis,runSignal)=>service.readRunView(basis.recordId,basis.runId,basis.contentHash,false,runSignal),signal),(view,signal)=>readQualityRunInterpretation(ctx,view,()=>service.readRunView(view.recordId,view.runId,view.contentHash,false,signal),signal),{...expertTasks,available:expertTasks.list,list:(view,signal)=>service.listExpertAssociations(view.recordId,view.runId,view.contentHash,signal),read:(association,signal)=>readQualityExpertInterpretation(ctx,association,()=>service.readRunView(association.recordId,association.runId,association.contentHash,false,signal),signal)},(recordId,sessionId,signal)=>ai.readContext(recordId,sessionId,signal),(view,sessionId,selection,signal)=>ai.selectFocus(view,sessionId,selection,signal))}),'workdsh.quality.records.rpc');
  ctx.provide('workdshQualityAnalysis',service);
  return service;
}
