import type {createQualityExpertTasks} from './expert-tasks.js';
import type {QualityExpertAssociation} from './expert-association.js';
import type {QualityInterpretationCandidate} from './interpretation-candidate.js';
import type { LibraryService, ProjectService } from 'workdsh-contracts';
import {qualityCleaningRequestSchema,qualityConfigurationRequestSchema,qualityAnalyzeRequestSchema,qualityLibraryImportRequestSchema} from './configuration-request.js';
import type {QualityAnalysisExecutor} from './analysis-executor.js';
import type {QualityAnalysisRunService,QualityLibraryInputPorts} from './run-service.js';
import {qualitySaveReportDocumentInputSchema,qualityReportIdentifierSchema,qualityReportRevisionIdSchema} from '../domain/report-document.js';
import {qualitySaveReportDraftInputSchema} from '../domain/report-draft.js';
import {qualityAiReportTargetSchema} from './ai-session-store.js';
import {qualityFocusSelectionSchema,type QualityFocusSelection} from '../domain/analysis-focus.js';
import type {QualityAiRunSessionRequest} from './run-session.js';
export const qualityRecordsPath='/api/workdsh-quality-records';
const object=(value:unknown):Record<string,unknown>|undefined=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:undefined;
const fail=(code:string,message:string,status:number)=>Response.json({ok:false,error:{code,message}},{status});
async function readBody(request:Request):Promise<unknown>{
  const reader=request.body?.getReader();if(!reader)throw new Error('quality/request/invalid');
  const abort=()=>{void reader.cancel(request.signal.reason).catch(()=>undefined);};
  request.signal.addEventListener('abort',abort,{once:true});
  const chunks:Uint8Array[]=[];let length=0;
  try{
    while(true){request.signal.throwIfAborted();const part=await reader.read();request.signal.throwIfAborted();if(part.done)break;
      length+=part.value.byteLength;if(length>16*1024){await reader.cancel();throw new Error('quality/request/size-limit');}chunks.push(part.value.slice());}
    const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
    try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new Error('quality/request/invalid');}
  }finally{request.signal.removeEventListener('abort',abort);reader.releaseLock();}
}
/** Planned Host handler: route registration and transport authorization belong to Host composition. */
export async function handleQualityRecordsRequest(request:Request,service:Pick<QualityAnalysisRunService,'listReportDrafts'|'readReportDraft'|'saveReportDraft'|'archiveReportDraft'|'listReportDocuments'|'readReportDocument'|'saveReportDocument'|'adoptInterpretation'|'listSourceViews'|'listRecords'|'createRecord'|'getRecord'|'listRuns'|'readRunView'|'readRunFocusInspections'|'bindSourceConfiguration'|'analyzeConfiguredAndSave'|'readConfiguration'|'readCleaningRows'|'readCleaningDraft'|'saveCleaningDraft'|'importLibrarySource'|'saveReport'|'saveStatistics'|'linkReport'|'listProjects'>,executor?:Pick<QualityAnalysisExecutor,'execute'>,inputs?:QualityLibraryInputPorts,reports?:Pick<LibraryService,'importAsset'|'readOriginal'|'saveOriginalRevision'|'list'|'readContentDraft'|'saveContentDraft'|'archiveContentDraft'>,projects?:Pick<ProjectService,'list'|'get'|'addAsset'>,sessions?:(view:QualityAiRunSessionRequest,signal:AbortSignal)=>Promise<unknown>,interpretations?:(view:{recordId:string;runId:string;contentHash:string},signal:AbortSignal)=>Promise<unknown>,expertSources?:{available?:ReturnType<typeof createQualityExpertTasks>['list'];prepare?:ReturnType<typeof createQualityExpertTasks>['prepare'];create?:ReturnType<typeof createQualityExpertTasks>['create'];list:(view:{recordId:string;runId:string;contentHash:string},signal:AbortSignal)=>Promise<readonly QualityExpertAssociation[]>;read:(association:QualityExpertAssociation,signal:AbortSignal)=>Promise<{association:QualityExpertAssociation;candidate:QualityInterpretationCandidate|undefined}>},aiContext?:(recordId:string,sessionId:string,signal:AbortSignal)=>Promise<unknown>,aiFocus?:(view:{recordId:string;runId:string;contentHash:string},sessionId:string,selection:QualityFocusSelection|null,signal:AbortSignal)=>Promise<unknown>):Promise<Response>{
  if(request.method!=='POST')return fail('quality/request/method','请使用POST请求。',405);
  try{
    const body=object(await readBody(request)),payload=object(body?.payload);
    if(!body||!payload||Object.keys(body).some(key=>!['endpoint','payload'].includes(key)))throw new Error('quality/request/invalid');
    const keys=Object.keys(payload);
    if(body.endpoint==='ai-context'){
      if(keys.length!==2||!keys.every(key=>['recordId','sessionId'].includes(key))||!['recordId','sessionId'].every(key=>typeof payload[key]==='string'&&(payload[key] as string).trim()&&(payload[key] as string).length<=(key==='recordId'?128:256)))throw Error('quality/request/invalid');
      if(!aiContext)throw Error('quality/service/session-unavailable');
      return Response.json({ok:true,value:await aiContext(payload.recordId as string,payload.sessionId as string,request.signal)});
    }
    if(body.endpoint==='focus-inspections'||body.endpoint==='ai-focus'){
      const sourceKeys=['recordId','runId','contentHash','selection'],required=body.endpoint==='focus-inspections'?[...sourceKeys,'offset']:[...sourceKeys,'sessionId'];
      if(keys.length!==required.length||keys.some(key=>!required.includes(key))||!['recordId','runId'].every(key=>qualityReportIdentifierSchema.safeParse(payload[key]).success)||typeof payload.contentHash!=='string'||!/^[a-f0-9]{64}$/.test(payload.contentHash))throw Error('quality/request/invalid');
      const view={recordId:payload.recordId as string,runId:payload.runId as string,contentHash:payload.contentHash};
      if(body.endpoint==='focus-inspections'){
        const selected=qualityFocusSelectionSchema.safeParse(payload.selection);
        if(!selected.success||!Number.isSafeInteger(payload.offset)||(payload.offset as number)<0)throw Error('quality/request/invalid');
        return Response.json({ok:true,value:await service.readRunFocusInspections(view.recordId,view.runId,view.contentHash,selected.data,payload.offset as number,request.signal)});
      }
      if(typeof payload.sessionId!=='string'||!payload.sessionId.trim()||payload.sessionId.length>256||payload.selection!==null&&!qualityFocusSelectionSchema.safeParse(payload.selection).success)throw Error('quality/request/invalid');
      if(!aiFocus)throw Error('quality/service/session-unavailable');
      return Response.json({ok:true,value:await aiFocus(view,payload.sessionId,payload.selection===null?null:qualityFocusSelectionSchema.parse(payload.selection),request.signal)});
    }
    if(['report-drafts','report-draft','save-report-draft','archive-report-draft'].includes(String(body.endpoint))){
      if(!['recordId','runId'].every(key=>qualityReportIdentifierSchema.safeParse(payload[key]).success)||typeof payload.contentHash!=='string'||!/^[a-f0-9]{64}$/.test(payload.contentHash))throw Error('quality/request/invalid');
      const recordId=payload.recordId as string,runId=payload.runId as string,contentHash=payload.contentHash,sourceKeys=['recordId','runId','contentHash'];
      if(body.endpoint==='report-drafts'){
        if(keys.length!==3||keys.some(key=>!sourceKeys.includes(key)))throw Error('quality/request/invalid');
        return Response.json({ok:true,value:await service.listReportDrafts(recordId,runId,contentHash,request.signal)});
      }
      if(!reports)throw Error('quality/service/report-library-unavailable');
      if(body.endpoint==='report-draft'){
        if(keys.length!==4||keys.some(key=>![...sourceKeys,'draftId'].includes(key))||!qualityReportIdentifierSchema.safeParse(payload.draftId).success)throw Error('quality/request/invalid');
        return Response.json({ok:true,value:await service.readReportDraft(recordId,runId,contentHash,payload.draftId as string,reports,request.signal)});
      }
      if(body.endpoint==='archive-report-draft'){
        if(keys.length!==6||keys.some(key=>![...sourceKeys,'draftId','expectedDraftRevision','operationId'].includes(key))||!['draftId','operationId'].every(key=>qualityReportIdentifierSchema.safeParse(payload[key]).success)||!qualityReportRevisionIdSchema.safeParse(payload.expectedDraftRevision).success)throw Error('quality/request/invalid');
        return Response.json({ok:true,value:await service.archiveReportDraft(recordId,runId,contentHash,payload.draftId as string,payload.expectedDraftRevision as string,payload.operationId as string,reports,request.signal)});
      }
      const {recordId:ignoredRecord,runId:ignoredRun,contentHash:ignoredHash,...input}=payload;
      const parsed=qualitySaveReportDraftInputSchema.safeParse(input);if(!parsed.success)throw Error('quality/request/invalid');
      return Response.json({ok:true,value:await service.saveReportDraft(recordId,runId,contentHash,parsed.data,reports,request.signal)});
    }
    if(['report-documents','report-document','save-report-document'].includes(String(body.endpoint))){
      if(!['recordId','runId'].every(key=>typeof payload[key]==='string'&&(payload[key] as string).trim()&&(payload[key] as string).length<=128)||typeof payload.contentHash!=='string'||!/^[a-f0-9]{64}$/.test(payload.contentHash))throw Error('quality/request/invalid');
      const recordId=payload.recordId as string,runId=payload.runId as string,contentHash=payload.contentHash;
      const sourceKeys=['recordId','runId','contentHash'];
      if(body.endpoint==='report-documents'){
        if(keys.length!==3||keys.some(key=>!sourceKeys.includes(key)))throw Error('quality/request/invalid');
        return Response.json({ok:true,value:await service.listReportDocuments(recordId,runId,contentHash,request.signal)});
      }
      if(body.endpoint==='report-document'){
        if(keys.some(key=>![...sourceKeys,'reportId','revisionId'].includes(key))||!qualityReportIdentifierSchema.safeParse(payload.reportId).success||payload.revisionId!==undefined&&!qualityReportRevisionIdSchema.safeParse(payload.revisionId).success)throw Error('quality/request/invalid');
        if(!reports)throw Error('quality/service/report-library-unavailable');
        return Response.json({ok:true,value:await service.readReportDocument(recordId,runId,contentHash,payload.reportId as string,payload.revisionId as string|undefined,reports,request.signal)});
      }
      const {recordId:ignoredRecord,runId:ignoredRun,contentHash:ignoredHash,...input}=payload;
      const parsed=qualitySaveReportDocumentInputSchema.safeParse(input);if(!parsed.success)throw Error('quality/request/invalid');
      if(!reports)throw Error('quality/service/report-library-unavailable');
      return Response.json({ok:true,value:await service.saveReportDocument(recordId,runId,contentHash,parsed.data,reports,request.signal)});
    }
    if(body.endpoint==='available-experts'){
      if(keys.length!==3||!keys.every(key=>['recordId','runId','contentHash'].includes(key))||!['recordId','runId'].every(key=>typeof payload[key]==='string'&&(payload[key] as string).trim()&&(payload[key] as string).length<=128)||typeof payload.contentHash!=='string'||!/^[a-f0-9]{64}$/.test(payload.contentHash))throw Error('quality/request/invalid');
      if(!expertSources?.available)throw Error('quality/service/expert-unavailable');
      return Response.json({ok:true,value:await expertSources.available({recordId:payload.recordId as string,runId:payload.runId as string,contentHash:payload.contentHash},request.signal)});
    }
    if(body.endpoint==='prepare-expert-task'||body.endpoint==='create-expert-task'){
      const field=body.endpoint==='prepare-expert-task'?'expertId':'executionPlanId';
      if(keys.length!==4||!keys.every(key=>['recordId','runId','contentHash',field].includes(key))||!['recordId','runId'].every(key=>typeof payload[key]==='string'&&(payload[key] as string).trim()&&(payload[key] as string).length<=128)||typeof payload.contentHash!=='string'||!/^[a-f0-9]{64}$/.test(payload.contentHash)||typeof payload[field]!=='string'||!(payload[field] as string).trim()||(payload[field] as string).length>256)throw Error('quality/request/invalid');
      const source={recordId:payload.recordId as string,runId:payload.runId as string,contentHash:payload.contentHash};
      const handler=body.endpoint==='prepare-expert-task'?expertSources?.prepare:expertSources?.create;
      if(!handler)throw Error('quality/service/expert-unavailable');
      return Response.json({ok:true,value:await handler(source,payload[field] as string,request.signal)});
    }
    if(['expert-sources','expert-candidate','adopt-expert-interpretation'].includes(String(body.endpoint))){
      const required=body.endpoint==='expert-sources'?['recordId','runId','contentHash']:body.endpoint==='expert-candidate'?['recordId','runId','contentHash','sessionId']:['recordId','runId','contentHash','sessionId','candidateHash'];
      if(keys.length!==required.length||!keys.every(key=>required.includes(key))||!['recordId','runId'].every(key=>typeof payload[key]==='string'&&(payload[key] as string).trim()&&(payload[key] as string).length<=128)||typeof payload.contentHash!=='string'||!/^[a-f0-9]{64}$/.test(payload.contentHash)||(required.includes('sessionId')&&(typeof payload.sessionId!=='string'||!payload.sessionId.trim()||payload.sessionId.length>256))||(required.includes('candidateHash')&&(typeof payload.candidateHash!=='string'||!/^[a-f0-9]{64}$/.test(payload.candidateHash))))throw Error('quality/request/invalid');
      if(!expertSources)throw Error('quality/service/expert-unavailable');
      const view=await service.readRunView(payload.recordId as string,payload.runId as string,payload.contentHash,false,request.signal);
      const associations=await expertSources.list(view,request.signal);
      if(body.endpoint==='expert-sources')return Response.json({ok:true,value:associations});
      const association=associations.find(row=>row.sessionId===payload.sessionId);
      if(!association)throw Error('quality/service/access-denied');
      const result=await expertSources.read(association,request.signal);
      if(body.endpoint==='expert-candidate')return Response.json({ok:true,value:{association:result.association,candidate:result.candidate??null}});
      if(!reports)throw Error('quality/service/report-library-unavailable');
      if(!result.candidate||result.candidate.candidateHash!==payload.candidateHash)throw Error('quality/interpretation/candidate-conflict');
      return Response.json({ok:true,value:await service.adoptInterpretation(result.candidate,reports,request.signal,{association,reverify:async()=>{const current=await expertSources.read(association,request.signal);if(current.candidate?.candidateHash!==payload.candidateHash)throw Error('quality/interpretation/candidate-conflict');}})});
    }
    if(body.endpoint==='ai-session'||body.endpoint==='ai-candidate'){
      const allowedKeys=body.endpoint==='ai-session'?['recordId','runId','contentHash','reportTarget']:['recordId','runId','contentHash'];
      if(![3,4].includes(keys.length)||!keys.every(key=>allowedKeys.includes(key))||!['recordId','runId'].every(key=>typeof payload[key]==='string'&&(payload[key] as string).trim()&&(payload[key] as string).length<=128)||typeof payload.contentHash!=='string'||!/^[a-f0-9]{64}$/.test(payload.contentHash)||Object.hasOwn(payload,'reportTarget')&&payload.reportTarget!==null&&!qualityAiReportTargetSchema.safeParse(payload.reportTarget).success)throw Error('quality/request/invalid');
      const view=await service.readRunView(payload.recordId as string,payload.runId as string,payload.contentHash,false,request.signal);
      if(body.endpoint==='ai-session'){
        if(!sessions)throw Error('quality/service/session-unavailable');
        const reportTarget=payload.reportTarget===null?null:payload.reportTarget===undefined?undefined:qualityAiReportTargetSchema.parse(payload.reportTarget);
        return Response.json({ok:true,value:(await sessions({...view,...(reportTarget!==undefined?{reportTarget}:{})},request.signal))??null});
      }
      if(!interpretations)throw Error('quality/service/session-unavailable');
      return Response.json({ok:true,value:(await interpretations(view,request.signal))??null});
    }
    if(body.endpoint==='adopt-interpretation'){
      if(keys.length!==4||!keys.every(key=>['recordId','runId','contentHash','candidateHash'].includes(key))||!['recordId','runId'].every(key=>typeof payload[key]==='string'&&(payload[key] as string).trim()&&(payload[key] as string).length<=128)||!['contentHash','candidateHash'].every(key=>typeof payload[key]==='string'&&/^[a-f0-9]{64}$/.test(payload[key] as string)))throw Error('quality/request/invalid');
      if(!interpretations||!reports)throw Error('quality/service/session-unavailable');
      const view=await service.readRunView(payload.recordId as string,payload.runId as string,payload.contentHash as string,false,request.signal);
      const candidate=await interpretations(view,request.signal) as QualityInterpretationCandidate|undefined;
      if(!candidate||candidate.candidateHash!==payload.candidateHash)throw Error('quality/interpretation/candidate-conflict');
      return Response.json({ok:true,value:await service.adoptInterpretation(candidate,reports,request.signal)});
    }
    if(body.endpoint==='projects'&&keys.length===0){
      if(!projects)throw new Error('quality/service/projects-unavailable');
      return Response.json({ok:true,value:await service.listProjects(projects,request.signal)});
    }
    if(body.endpoint==='link-report'){
      if(keys.length!==3||!keys.every(key=>['recordId','operationId','projectId'].includes(key))||
         !keys.every(key=>typeof payload[key]==='string'&&(payload[key] as string).trim()&&(payload[key] as string).length<=256))throw new Error('quality/request/invalid');
      if(!projects||!reports)throw new Error('quality/service/projects-unavailable');
      return Response.json({ok:true,value:await service.linkReport(payload.recordId as string,payload.operationId as string,payload.projectId as string,reports,projects,request.signal)});
    }
    if(body.endpoint==='save-statistics'){
      if(keys.length!==5||!keys.every(key=>['recordId','runId','contentHash','title','kind'].includes(key))||!['recordId','runId','title'].every(key=>typeof payload[key]==='string'&&(payload[key] as string).trim()&&(payload[key] as string).length<=256)||typeof payload.contentHash!=='string'||!/^[a-f0-9]{64}$/.test(payload.contentHash)||!['trend','products','pareto'].includes(payload.kind as string))throw new Error('quality/request/invalid');
      if(!reports)throw new Error('quality/service/report-library-unavailable');
      await service.readRunView(payload.recordId as string,payload.runId as string,payload.contentHash,false,request.signal);
      return Response.json({ok:true,value:await service.saveStatistics(payload.recordId as string,payload.runId as string,payload.title as string,payload.kind as 'trend'|'products'|'pareto',reports,request.signal)});
    }
    if(body.endpoint==='save-report'){
      if(keys.length!==4||!keys.every(key=>['recordId','runId','contentHash','title'].includes(key))||
         !['recordId','runId','title'].every(key=>typeof payload[key]==='string'&&(payload[key] as string).trim()&&(payload[key] as string).length<=256)||
         typeof payload.contentHash!=='string'||!/^[a-f0-9]{64}$/.test(payload.contentHash))throw new Error('quality/request/invalid');
      if(!reports)throw new Error('quality/service/report-library-unavailable');
      // Check the selected immutable run before generating or exporting its report.
      await service.readRunView(payload.recordId as string,payload.runId as string,payload.contentHash,false,request.signal);
      return Response.json({ok:true,value:await service.saveReport(payload.recordId as string,payload.runId as string,payload.title as string,reports,request.signal)});
    }
    if(body.endpoint==='import-library'){
      const parsed=qualityLibraryImportRequestSchema.safeParse(payload);if(!parsed.success)throw new Error('quality/request/invalid');
      if(!inputs)throw new Error('quality/service/input-executor-unavailable');const p=parsed.data;
      return Response.json({ok:true,value:await service.importLibrarySource(p.recordId,p.reference,{format:p.format,tableKind:p.tableKind,headerRow:p.headerRow,worksheet:p.worksheet,baseSourceSnapshotId:p.baseSourceSnapshotId},p.expectedGeneration,inputs,request.signal)});
    }
    if(body.endpoint==='cleaning-draft'&&keys.length===1&&typeof payload.recordId==='string'&&payload.recordId.trim()&&payload.recordId.length<=128)return Response.json({ok:true,value:await service.readCleaningDraft(payload.recordId,request.signal)});
    if(body.endpoint==='save-cleaning-draft'){
      const draft=qualityCleaningRequestSchema.safeParse(payload.draft);
      if(keys.length!==3||!keys.every(key=>['recordId','draft','expectedRevision'].includes(key))||typeof payload.recordId!=='string'||!payload.recordId.trim()||payload.recordId.length>128||!draft.success||!Number.isSafeInteger(payload.expectedRevision)||(payload.expectedRevision as number)<0)throw new Error('quality/request/invalid');
      return Response.json({ok:true,value:await service.saveCleaningDraft(payload.recordId,draft.data,payload.expectedRevision as number,request.signal)});
    }
    if(body.endpoint==='cleaning-rows'){
      if(keys.length!==5||!keys.every(key=>['recordId','tableKind','offset','limit','expectedGeneration'].includes(key))||typeof payload.recordId!=='string'||!payload.recordId.trim()||payload.recordId.length>128||!['inspections','defects'].includes(payload.tableKind as string)||!Number.isSafeInteger(payload.expectedGeneration)||(payload.expectedGeneration as number)<0)throw new Error('quality/request/invalid');
      return Response.json({ok:true,value:await service.readCleaningRows(payload.recordId,payload.tableKind as 'inspections'|'defects',payload.offset as number,payload.limit as number,payload.expectedGeneration as number,request.signal)});
    }
    if(body.endpoint==='configuration' &&keys.length===1&&typeof payload.recordId==='string'&&payload.recordId.trim()&&payload.recordId.length<=128)return Response.json({ok:true,value:await service.readConfiguration(payload.recordId,request.signal)});
    if(body.endpoint==='configure'){
      const parsed=qualityConfigurationRequestSchema.safeParse(payload);if(!parsed.success)throw new Error('quality/request/invalid');const p=parsed.data;
      const generation=await service.bindSourceConfiguration(p.recordId,p.title,p.sourceNamespace,p.sourceSnapshotId,p.analysis,p.expectedGeneration,request.signal);
      return Response.json({ok:true,value:{recordId:p.recordId,generation}});
    }
    if(body.endpoint==='analyze'){
      const parsed=qualityAnalyzeRequestSchema.safeParse(payload);if(!parsed.success)throw new Error('quality/request/invalid');
      if(!executor)throw new Error('quality/service/analysis-executor-unavailable');
      const result=await service.analyzeConfiguredAndSave(parsed.data.recordId,parsed.data.expectedRevision,executor,request.signal,parsed.data.cleaning);
      return Response.json({ok:true,value:result.status==='saved'?{status:'saved',revision:result.revision,run:{runId:result.run.runId,createdAt:result.run.createdAt,contentHash:result.run.contentHash}}:{status:'blocked',issues:result.issues.slice(0,100),totalIssueCount:result.issues.length}});
    }
    if(body.endpoint==='sources'&&keys.length===1&&typeof payload.recordId==='string'&&payload.recordId.trim()&&payload.recordId.length<=128)return Response.json({ok:true,value:await service.listSourceViews(payload.recordId,request.signal)});
    if(body.endpoint==='list' &&keys.length===0)return Response.json({ok:true,value:await service.listRecords(request.signal)});
    if(body.endpoint==='run-view'&&keys.length===4&&keys.every(key=>['recordId','runId','contentHash','includeReport'].includes(key))&&typeof payload.recordId==='string'&&payload.recordId.trim()&&payload.recordId.length<=128&&typeof payload.runId==='string'&&payload.runId.trim()&&payload.runId.length<=128&&typeof payload.contentHash==='string'&&/^[a-f0-9]{64}$/.test(payload.contentHash)&&typeof payload.includeReport==='boolean')return Response.json({ok:true,value:await service.readRunView(payload.recordId,payload.runId,payload.contentHash,payload.includeReport,request.signal)});
    if(body.endpoint==='runs'&&keys.every(key=>['recordId','offset','limit','expectedRevision'].includes(key))&&typeof payload.recordId==='string'&&payload.recordId.trim()&&payload.recordId.length<=128&&Number.isSafeInteger(payload.offset)&&(payload.offset as number)>=0&&Number.isSafeInteger(payload.limit)&&(payload.limit as number)>=1&&(payload.limit as number)<=20&&(payload.expectedRevision===undefined||(Number.isSafeInteger(payload.expectedRevision)&&(payload.expectedRevision as number)>=0)))return Response.json({ok:true,value:await service.listRuns(payload.recordId,payload.offset as number,payload.limit as number,payload.expectedRevision as number|undefined,request.signal)});
    if(body.endpoint==='get'&&keys.length===1&&typeof payload.recordId==='string'&&payload.recordId.trim()&&payload.recordId.length<=128)return Response.json({ok:true,value:await service.getRecord(payload.recordId,request.signal)});
    if(body.endpoint==='create'&&keys.every(key=>['title','operationId'].includes(key))&&typeof payload.title==='string'&&payload.title.trim().length>0&&payload.title.length<=256&&typeof payload.operationId==='string'&&payload.operationId.trim().length>0&&payload.operationId.length<=128){
      return Response.json({ok:true,value:await service.createRecord(payload.title,payload.operationId,request.signal)});
    }
    throw new Error('quality/request/invalid');
  }catch(cause){
    if(request.signal.aborted)return fail('quality/request/cancelled','操作已取消，请刷新核对实际保存结果。',408);
    const expertCode=cause instanceof Error&&'code' in cause&&typeof cause.code==='string'?cause.code:undefined;
    if(expertCode==='experts/plan-expired')return fail('quality/expert/plan-expired','专家计划已过期，请重新准备任务。',409);
    if(['experts/forbidden','experts/not-found'].includes(expertCode??''))return fail('quality/expert/unavailable','专家不存在或无权使用，请重新选择。',403);
    if(['experts/disabled','experts/archived','experts/not-published','experts/dependency-missing','experts/preset-broken'].includes(expertCode??''))return fail('quality/expert/not-ready','专家状态或依赖已变化，请在专家管理中核对后重新准备。',409);
    if(expertCode==='experts/outcome-unknown')return fail('quality/expert/outcome-unknown','创建结果尚未确认，请重试同一计划并核对已有任务。',409);
    if(expertCode==='experts/unavailable')return fail('quality/expert/service-unavailable','专家服务尚未就绪，请稍后重试同一计划。',503);
    const code=cause instanceof Error?cause.message:'';
    if(['quality/report-draft/service-unavailable'].includes(code))return fail(code,'资料库草稿服务尚未就绪，可继续保存正式报告。',503);
    if(['quality/report-draft/not-found','library/content-draft-not-found'].includes(code))return fail(code,'草稿不存在或无权读取，请刷新草稿列表。',404);
    if(['quality/report-draft/budget-exceeded','quality/report-draft/size-limit','library/content-draft-size-limit','library/content-draft-budget-exceeded'].includes(code))return fail(code,'草稿内容或数量超过保存限制，当前文字未替换。',413);
    if(['quality/report-draft/invalid-input','quality/report-draft/invalid-content','library/content-draft-invalid-input','library/content-draft-invalid-content'].includes(code))return fail(code,'草稿文字格式或请求不符合要求，请核对。',400);
    if(code.startsWith('quality/report-draft/')||code.startsWith('quality/store/report-draft-')||['library/content-draft-revision-conflict','library/content-draft-archived','library/content-draft-operation-conflict','library/content-draft-operation-superseded','library/content-draft-content-mismatch'].includes(code))return fail(code,'草稿或报告依据已有变化。当前文字仍保留，请重新读取后核对。',409);
    if(['library/base-revision-conflict','library/operation-conflict','quality/report-document/revision-conflict','quality/report-document/version-conflict','quality/report-document/operation-conflict','quality/store/report-document-conflict'].includes(code))return fail(code,'报告已有变化，请保留修改并读取最新版核对。',409);
    if(['quality/report-document/not-found','quality/report-document/revision-not-found'].includes(code))return fail(code,'报告或选定版本不存在，请重新选择。',404);
    if(['quality/report-document/version-service-unavailable','quality/report-document/revision-save-unavailable'].includes(code))return fail(code,'报告版本保存服务尚未就绪，修改尚未保存。',503);
    if(['quality/report-document/invalid-fields','quality/report/invalid-fields'].includes(code))return fail(code,'报告文字格式或长度不符合要求，请核对。',400);
    if(['quality/report-document/invalid-content','quality/report-document/content-mismatch','quality/report-document/hash-mismatch','quality/report-document/fixed-content-mismatch','quality/report-document/identity-mismatch','quality/report-document/metadata-mismatch','quality/report-document/invalid-encoding','quality/report-document/invalid-library-receipt'].includes(code))return fail(code,'报告版本内容与保存依据不一致，请核对资料库原件。',409);
    if(['quality/report-document/budget-exceeded','quality/report-document/byte-budget-exceeded','quality/report/fields-size-limit'].includes(code))return fail(code,'报告或文字内容超过保存预算。',413);
    if(['library/asset-inactive','library/not-active','library/disabled'].includes(code))return fail(code,'报告资料已停用，请在资料库核对状态。',409);
    if(['quality/service/access-denied','quality/index/owner-mismatch'].includes(code))return fail('quality/service/access-denied','当前身份无权访问这些记录。',403);
    if(code==='quality/service/record-not-found')return fail(code,'记录不存在或无权访问。',404);
    if(code==='projects/not-found')return fail('quality/project/not-found','项目不存在或无权访问，报告仍保留在资料库。',404);
    if(code==='quality/service/run-not-found')return fail(code,'历史分析不存在。',404);
    if(code==='quality/store/run-hash-conflict')return fail(code,'历史分析指纹不一致，请核对来源。',409);
    if(code==='quality/service/session-unavailable')return fail(code,'原生会话服务尚未就绪。',503);
    if(code==='quality/interpretation/candidate-conflict')return fail(code,'解读候选已有变化，请重新读取并确认后采纳。',409);
    if(code==='quality/service/session-conflict')return fail(code,'会话创建回执不一致，请核对后重试。',409);
    if(code==='quality/service/projects-unavailable')return fail(code,'项目服务尚未就绪，报告仍保留在资料库。',503);
    if(code==='quality/service/report-library-unavailable')return fail(code,'资料库尚未就绪，请稍后重试。',503);
    if(code==='quality/service/artifact-executor-unavailable')return fail(code,'报告生成服务尚未就绪。',503);
    if(code==='quality/store/source-view-budget-exceeded')return fail(code,'来源字段说明超过读取预算，请核对源表表头。',413);
    if(code==='quality/store/expert-plan-not-found')return fail(code,'专家计划不存在，请重新选择专家准备任务。',404);
    if(code==='quality/service/expert-not-ready')return fail(code,'专家依赖尚未就绪，请在专家管理中核对。',409);
    if(code==='quality/service/expert-unavailable')return fail(code,'专家服务尚未就绪。',503);
    if(code==='quality/service/expert-binding-conflict')return fail(code,'专家任务绑定已有变化，请重新核对。',409);
    if(code==='quality/store/corrupt-run')return fail(code,'历史分析完整性校验失败，请核对备份。',409);
    if(code.startsWith('quality/cleaning/')||code.startsWith('quality/worker/quality/cleaning/'))return fail('quality/cleaning/invalid-decision','清洗决定与原始来源不一致，请核对原始行、单元格和原因。',400);
    if(code==='quality/store/cleaning-draft-conflict')return fail(code,'清洗草稿已有变化，请重新读取后核对。',409);
    if(code==='quality/store/generation-conflict')return fail(code,'配置已有变化，请刷新后核对。',409);
    if(code==='quality/worker/busy')return fail(code,'导入或分析任务繁忙，请稍后重试。',429);
    if(code==='quality/worker/timeout')return fail(code,'任务超时，请核对文件规模并重试。',504);
    if(['quality/import/byte-budget-exceeded','quality/worker/input-budget-exceeded','quality/store/source-budget-exceeded','quality/worker/DATASET_LIMIT','quality/worker/WORKSHEET_XML_LIMIT','quality/worker/ARCHIVE_INPUT_LIMIT','quality/worker/ARCHIVE_ENTRY_LIMIT','quality/worker/ARCHIVE_SINGLE_ENTRY_LIMIT','quality/worker/ARCHIVE_EXPANDED_LIMIT'].includes(code))return fail('quality/source/size-limit','文件或工作表超过导入上限，请缩小明细范围。',413);
    const worksheetErrors:Record<string,[string,string]>={
      'quality/worker/WORKSHEET_MERGED_CELLS':['merged-cells','所选工作表含合并单元格，请选择明细表和实际列名行。'],
      'quality/worker/WORKSHEET_NOT_FOUND':['worksheet-not-found','工作表不存在，请重新选择。'],
      'quality/worker/INVALID_HEADER_ROW':['header-row-invalid','列名所在行超出工作表范围。'],
      'quality/worker/invalid-header-row':['header-row-invalid','列名所在行无效。'],
      'quality/worker/quality/xlsx/worksheet-empty':['worksheet-empty','所选工作表没有明细数据。'],
      'quality/worker/quality/xlsx/header-missing':['header-missing','所选列名行含空白列名。'],
      'quality/worker/quality/xlsx/header-duplicate':['header-duplicate','所选列名行含重复列名。'],
      'quality/worker/WORKSHEET_FORMULA_REQUIRES_EVALUATION':['formula-values-required','所选数据含公式，请核对结果并另存为数值后导入。'],
      'quality/worker/WORKSHEET_ERROR_VALUE':['cell-error','所选数据含 Excel 错误值，请先修正。'],
    };
    if(Object.hasOwn(worksheetErrors,code)){const [category,message]=worksheetErrors[code]!;return fail('quality/source/'+category,message,400);}
    if(['quality/worker/ARCHIVE_INVALID','quality/worker/ARCHIVE_UNSAFE_PATH'].includes(code))return fail('quality/source/invalid-file','文件无法作为 Excel 明细表读取，请核对文件格式。',400);
    if(code.startsWith('quality/import/')||code.startsWith('quality/worker/WORKSHEET_')||code.startsWith('quality/worker/quality/xlsx/'))return fail('quality/source/invalid-file','文件格式或工作表内容不符合完整导入要求，请核对。',400);
    if(code==='quality/service/input-executor-unavailable')return fail(code,'数据导入服务尚未就绪。',503);
    if(code==='quality/source/inspection-source-required')return fail(code,'请先选择检验数据，再关联缺陷明细。',400);
    if(['library/not-found','library/revision-asset-mismatch','library/access-denied'].includes(code))return fail('quality/source/library-unavailable','资料版本不存在或无权访问，请重新选择。',403);
    if(code==='quality/service/analysis-executor-unavailable')return fail(code,'分析服务尚未就绪。',503);
    if(['quality/store/source-not-found','quality/store/configuration-not-found','quality/store/configuration-unresolved'].includes(code))return fail(code,'请重新选择数据并保存完整配置。',409);
    if(code==='quality/store/invalid-analysis-configuration')return fail(code,'映射或统计口径无效，请核对原表字段。',400);
    if(['quality/store/configuration-budget-exceeded','quality/store/configuration-history-budget-exceeded','quality/store/run-budget-exceeded','quality/store/history-budget-exceeded'].includes(code))return fail(code,'记录内容超过保存预算，请核对数据规模。',413);
    if(code==='quality/store/revision-conflict')return fail(code,'历史结果已有变化，请刷新列表。',409);
    if(code==='quality/index/operation-conflict')return fail(code,'重复操作的内容发生变化，请核对原记录。',409);
    if(code==='quality/index/record-budget-exceeded')return fail(code,'记录数量已达上限。',409);
    if(code==='quality/request/size-limit')return fail(code,'请求内容超过限制。',413);
    if(['quality/request/invalid','quality/index/invalid-input'].includes(code))return fail('quality/request/invalid','记录请求无效。',400);
    if(code==='quality/focus/not-found')return fail(code,'所选记录或统计周期不在当前分析范围内，请重新选择。',404);
    if(code==='quality/focus/invalid-selection')return fail(code,'核查对象无效，请从当前图表或检验记录选择。',400);
    if(['quality/focus/not-selected','quality/focus/unavailable'].includes(code))return fail(code,'当前没有可核查的分析对象，请先选择已完成的分析结果。',409);
    if(code==='quality/ai/not-bound')return fail(code,'本次分析对话尚未绑定，请重新打开分析助手。',409);
    if(code==='quality/ai/session-busy')return fail(code,'对话正在执行，请先完成当前任务。',409);
    if(['quality/ai/binding-conflict','quality/ai/context-conflict','quality/ai/draft-binding-conflict','quality/ai/session-selection-conflict'].includes(code))return fail(code,'分析对话的工作对象已有变化，请重新核对。',409);
    if(['quality/service/closed','quality/index/closed','quality/store/closed','quality/ai/closed'].includes(code))return fail('quality/service/closed','服务已关闭，请重新连接。',503);
    return fail('quality/request/internal','操作未完成，请核对实际状态。',500);
  }
}
