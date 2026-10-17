import type {QualityExpertAssociation} from '../runtime/expert-association.js';
import {parseQualitySourceViews} from './source-views.js';
import {parseQualityCleaningPage} from './cleaning-rows.js';
import {qualityCleaningRequestSchema,type QualityCleaningRequest} from '../runtime/configuration-request.js';
import {parseQualityLibraryImportResult,type QualityLibraryImportRequest} from './library-import-result.js';
import {parseQualityConfigurationView} from './configuration-view.js';
import type {QualityAnalysisConfiguration} from '../domain/configuration.js';
import {parseQualityRunView} from './run-view.js';
import {qualitySaveReportDocumentInputSchema,type QualitySaveReportDocumentInput} from '../domain/report-document.js';
import {parseQualityReportDocument,parseQualityReportDocuments} from './report-document-view.js';
import {qualitySaveReportDraftInputSchema,type QualitySaveReportDraftInput} from '../domain/report-draft.js';
import {parseQualityReportDraft,parseQualityReportDrafts} from './report-draft-view.js';
import {parseQualityAiContext} from './ai-context.js';
import {qualityFocusSelectionSchema,parseQualityFocusedInspectionPage,type QualityFocusSelection} from '../domain/analysis-focus.js';
export interface QualityRecordSummary {readonly id:string;readonly title:string;readonly createdAt:string;readonly operationId:string;}
export interface QualityRecordDetail extends QualityRecordSummary {readonly revision:number;readonly generation:number;readonly configuration?:Readonly<{title:string;sourceNamespace:string;timeZone:string;mappingRevision:string;sourceSnapshotId:string}>;}
function parseDetail(value:unknown):QualityRecordDetail{
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('invalid-detail');
  const row=value as Record<string,unknown>,{revision,generation,configuration,...summary}=row;
  const record=parseRecord(summary);
  if(!Number.isSafeInteger(revision)||(revision as number)<0||!Number.isSafeInteger(generation)||(generation as number)<0)throw new Error('invalid-detail');
  let config:QualityRecordDetail['configuration'];
  if(configuration!==undefined){
    if(!configuration||typeof configuration!=='object'||Array.isArray(configuration))throw new Error('invalid-config');
    const item=configuration as Record<string,unknown>,limits={title:256,sourceNamespace:256,timeZone:128,mappingRevision:128,sourceSnapshotId:256};
    if(Object.keys(item).length!==5||Object.entries(limits).some(([key,limit])=>typeof item[key]!=='string'||!(item[key] as string).trim()||(item[key] as string).length>limit))throw new Error('invalid-config');
    new Intl.DateTimeFormat('en',{timeZone:item.timeZone as string});
    config=Object.freeze({...item}) as QualityRecordDetail['configuration'];
  }
  return Object.freeze({...record,revision:revision as number,generation:generation as number,...(config?{configuration:config}:{})});
}
export interface QualityRunSummary {readonly runId:string;readonly createdAt:string;readonly contentHash:string;readonly inspectedQuantity:number;readonly nonconformingQuantity:number;}
export interface QualityRunPage {readonly revision:number;readonly offset:number;readonly total:number;readonly entries:readonly QualityRunSummary[];}
function parseRunPage(value:unknown,offset:number,limit:number,revision?:number):QualityRunPage{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('invalid-page');const page=value as Record<string,unknown>;
 if(Object.keys(page).some(key=>!['revision','offset','total','entries'].includes(key))||!Number.isSafeInteger(page.revision)||(page.revision as number)<0||page.offset!==offset||!Number.isSafeInteger(page.total)||(page.total as number)<0||(page.total as number)>100||!Array.isArray(page.entries)||page.entries.length>limit||(revision!==undefined&&page.revision!==revision))throw new Error('invalid-page');
 if(page.entries.length!==Math.min(limit,Math.max(0,(page.total as number)-offset)))throw new Error('invalid-page');
 const ids=new Set<string>();const entries=page.entries.map(value=>{
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('invalid-summary');const row=value as Record<string,unknown>;
  if(Object.keys(row).length!==5||typeof row.runId!=='string'||!row.runId.trim()||typeof row.createdAt!=='string'||!Number.isFinite(Date.parse(row.createdAt))||typeof row.contentHash!=='string'||! /^[a-f0-9]{64}$/.test(row.contentHash)||!Number.isSafeInteger(row.inspectedQuantity)||(row.inspectedQuantity as number)<0||!Number.isSafeInteger(row.nonconformingQuantity)||(row.nonconformingQuantity as number)<0||(row.nonconformingQuantity as number)>(row.inspectedQuantity as number)||ids.has(row.runId))throw new Error('invalid-summary');
  ids.add(row.runId);return Object.freeze({...row}) as unknown as QualityRunSummary;
 });return Object.freeze({revision:page.revision as number,offset,total:page.total as number,entries:Object.freeze(entries)});
}
export class QualityRecordRequestError extends Error {
  constructor(readonly code:string,readonly status:number){super('记录操作未完成，请核对实际状态。');}
}
function parseRecord(value:unknown):QualityRecordSummary{
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('invalid-record');
  const row=value as Record<string,unknown>;
  if(Object.keys(row).some(key=>!['id','title','createdAt','operationId'].includes(key))||typeof row.id!=='string'||!row.id.trim()||row.id.length>128||typeof row.title!=='string'||!row.title.trim()||row.title.length>256||typeof row.createdAt!=='string'||row.createdAt.length>64||!Number.isFinite(Date.parse(row.createdAt))||typeof row.operationId!=='string'||!row.operationId.trim()||row.operationId.length>128)throw new Error('invalid-record');
  return Object.freeze({id:row.id,title:row.title,createdAt:row.createdAt,operationId:row.operationId});
}
function parseCandidate(value:unknown,recordId:string,runId:string,contentHash:string){
      if(value===null)return null;if(!value||typeof value!=='object'||Array.isArray(value))throw Error('invalid-candidate');const row=value as Record<string,unknown>;
      if(Object.keys(row).length!==8||row.recordId!==recordId||row.runId!==runId||row.contentHash!==contentHash||typeof row.sessionId!=='string'||!/^session-[a-f0-9]{32}$/.test(row.sessionId)||!Number.isSafeInteger(row.eventSeq)||(row.eventSeq as number)<0||!Number.isSafeInteger(row.turn)||(row.turn as number)<0||typeof row.text!=='string'||!row.text.trim()||new TextEncoder().encode(row.text).byteLength>64*1024||typeof row.candidateHash!=='string'||!/^[a-f0-9]{64}$/.test(row.candidateHash))throw Error('invalid-candidate');
      return Object.freeze({recordId,runId,contentHash,sessionId:row.sessionId,eventSeq:row.eventSeq as number,turn:row.turn as number,text:row.text,candidateHash:row.candidateHash});
}
function parseAdoption(value:unknown,recordId:string,runId:string,contentHash:string,candidateHash:string){
      if(!value||typeof value!=='object'||Array.isArray(value))throw Error('invalid-adoption');const row=value as Record<string,unknown>;
      if(Object.keys(row).length!==7||row.recordId!==recordId||row.runId!==runId||row.contentHash!==contentHash||row.candidateHash!==candidateHash||!['assetId','revisionId','operationId'].every(key=>typeof row[key]==='string'&&(row[key] as string).trim()&&(row[key] as string).length<=256))throw Error('invalid-adoption');
      return Object.freeze({recordId,runId,contentHash,candidateHash,assetId:row.assetId as string,revisionId:row.revisionId as string,operationId:row.operationId as string});
}
function parseExpertSources(value:unknown,recordId:string,runId:string,contentHash:string):readonly QualityExpertAssociation[]{
 if(!Array.isArray(value)||value.length>1000)throw Error('invalid-expert-sources');const ids=new Set<string>();
 return Object.freeze(value.map(item=>{
  if(!item||typeof item!=='object'||Array.isArray(item))throw Error('invalid-expert-source');const row=item as Record<string,unknown>;
  const keys=['recordId','runId','contentHash','sessionId','expertId','expertRevisionId','compositionDigest','creationOperationId'];
  if(Object.keys(row).length!==8||Object.keys(row).some(key=>!keys.includes(key))||row.recordId!==recordId||row.runId!==runId||row.contentHash!==contentHash||typeof row.sessionId!=='string'||!/^session-[a-f0-9]{32}$/.test(row.sessionId)||ids.has(row.sessionId)||typeof row.compositionDigest!=='string'||!/^[a-f0-9]{64}$/.test(row.compositionDigest)||!['expertId','expertRevisionId','creationOperationId'].every(key=>typeof row[key]==='string'&&(row[key] as string).trim()&&(row[key] as string).length<=256))throw Error('invalid-expert-source');
  ids.add(row.sessionId);return Object.freeze({...row}) as unknown as QualityExpertAssociation;
 }));
}

/** Uses Host transport; no token, owner or storage path is accepted from the page. */
export function createQualityRecordClient(transport:typeof fetch=fetch){
  async function invoke<T>(endpoint:string,payload:unknown,parse:(value:unknown)=>T|Promise<T>,signal?:AbortSignal):Promise<T>{
    const requestSignal=AbortSignal.any([AbortSignal.timeout(30_000),...(signal?[signal]:[])]);requestSignal.throwIfAborted();
    const response=await transport('/api/workdsh-quality-records',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({endpoint,payload}),signal:requestSignal});requestSignal.throwIfAborted();
    let result:unknown;try{result=await response.json();}catch{requestSignal.throwIfAborted();throw new QualityRecordRequestError('quality/response/invalid',response.status);}
    requestSignal.throwIfAborted();
    if(!result||typeof result!=='object'||Array.isArray(result))throw new QualityRecordRequestError('quality/response/invalid',response.status);
    const envelope=result as {ok?:unknown;value?:unknown;error?:{code?:unknown}};
    if(!response.ok||envelope.ok!==true)throw new QualityRecordRequestError(typeof envelope.error?.code==='string'?envelope.error.code:'quality/request/failed',response.status);
    try{const parsed=await parse(envelope.value);requestSignal.throwIfAborted();return parsed;}catch{requestSignal.throwIfAborted();throw new QualityRecordRequestError('quality/response/invalid',response.status);}
  }
  return {
    aiContext:(recordId:string,sessionId:string,signal?:AbortSignal)=>invoke('ai-context',{recordId,sessionId},value=>parseQualityAiContext(value,recordId,sessionId),signal),
    focusInspections:(recordId:string,runId:string,contentHash:string,selection:QualityFocusSelection,offset=0,signal?:AbortSignal)=>{
      const selected=qualityFocusSelectionSchema.parse(selection);
      return invoke('focus-inspections',{recordId,runId,contentHash,selection:selected,offset},value=>parseQualityFocusedInspectionPage(value,{recordId,runId,contentHash,selection:selected,offset}),signal);
    },
    aiFocus:(recordId:string,runId:string,contentHash:string,sessionId:string,selection:QualityFocusSelection|null,signal?:AbortSignal)=>{
      const selected=selection===null?null:qualityFocusSelectionSchema.parse(selection);
      return invoke('ai-focus',{recordId,runId,contentHash,sessionId,selection:selected},value=>{
        const context=parseQualityAiContext(value,recordId,sessionId);
        if(context.runId!==runId||context.contentHash!==contentHash||JSON.stringify(context.selectedFocus)!==JSON.stringify(selected??undefined))throw Error('quality/invalid-ai-context');
        return context;
      },signal);
    },
    reportDrafts:(recordId:string,runId:string,contentHash:string,signal?:AbortSignal)=>invoke('report-drafts',{recordId,runId,contentHash},value=>parseQualityReportDrafts(value,recordId,runId,contentHash),signal),
    reportDraft:(recordId:string,runId:string,contentHash:string,draftId:string,signal?:AbortSignal)=>invoke('report-draft',{recordId,runId,contentHash,draftId},value=>parseQualityReportDraft(value,recordId,runId,contentHash,{draftId}),signal),
    saveReportDraft:(recordId:string,runId:string,contentHash:string,input:QualitySaveReportDraftInput,signal?:AbortSignal)=>{
      const captured=qualitySaveReportDraftInputSchema.parse(structuredClone(input));
      return invoke('save-report-draft',{recordId,runId,contentHash,...captured},value=>parseQualityReportDraft(value,recordId,runId,contentHash,{draftId:captured.draftId,save:captured}),signal);
    },
    archiveReportDraft:(recordId:string,runId:string,contentHash:string,draftId:string,expectedDraftRevision:string,operationId:string,signal?:AbortSignal)=>invoke('archive-report-draft',{recordId,runId,contentHash,draftId,expectedDraftRevision,operationId},value=>parseQualityReportDraft(value,recordId,runId,contentHash,{draftId,status:'archived'}),signal),
    reportDocuments:(recordId:string,runId:string,contentHash:string,signal?:AbortSignal)=>invoke('report-documents',{recordId,runId,contentHash},value=>parseQualityReportDocuments(value,recordId,runId,contentHash),signal),
    reportDocument:(recordId:string,runId:string,contentHash:string,reportId:string,revisionId?:string,signal?:AbortSignal)=>invoke('report-document',{recordId,runId,contentHash,reportId,...(revisionId!==undefined?{revisionId}:{})},value=>parseQualityReportDocument(value,recordId,runId,contentHash,{reportId,revisionId}),signal),
    saveReportDocument:(recordId:string,runId:string,contentHash:string,input:QualitySaveReportDocumentInput,signal?:AbortSignal)=>{
      const captured=qualitySaveReportDocumentInputSchema.parse(structuredClone(input));
      return invoke('save-report-document',{recordId,runId,contentHash,...captured},value=>parseQualityReportDocument(value,recordId,runId,contentHash,{reportId:captured.reportId,save:captured}),signal);
    },
    availableExperts:(recordId:string,runId:string,contentHash:string,signal?:AbortSignal)=>invoke('available-experts',{recordId,runId,contentHash},value=>{
      if(!Array.isArray(value)||value.length>1000)throw Error('invalid-expert-choices');const ids=new Set<string>();
      return Object.freeze(value.map(item=>{if(!item||typeof item!=='object'||Array.isArray(item))throw Error('invalid-expert-choice');const row=item as Record<string,unknown>;
        if(Object.keys(row).length!==3||!['id','name','revisionId'].every(key=>typeof row[key]==='string'&&(row[key] as string).trim()&&(row[key] as string).length<=256)||ids.has(row.id as string))throw Error('invalid-expert-choice');ids.add(row.id as string);return Object.freeze({id:row.id as string,name:row.name as string,revisionId:row.revisionId as string});}));
    },signal),
    prepareExpertTask:(recordId:string,runId:string,contentHash:string,expertId:string,signal?:AbortSignal)=>invoke('prepare-expert-task',{recordId,runId,contentHash,expertId},value=>{
      if(!value||typeof value!=='object'||Array.isArray(value))throw Error('invalid-expert-plan');const row=value as Record<string,unknown>;
      if(Object.keys(row).length!==7||row.recordId!==recordId||row.runId!==runId||row.contentHash!==contentHash||row.expertId!==expertId||!['executionPlanId','expertRevisionId'].every(key=>typeof row[key]==='string'&&(row[key] as string).trim()&&(row[key] as string).length<=256)||typeof row.expiresAt!=='string'||!Number.isFinite(Date.parse(row.expiresAt)))throw Error('invalid-expert-plan');
      return Object.freeze({recordId,runId,contentHash,expertId,executionPlanId:row.executionPlanId as string,expertRevisionId:row.expertRevisionId as string,expiresAt:row.expiresAt});
    },signal),
    createExpertTask:(recordId:string,runId:string,contentHash:string,executionPlanId:string,signal?:AbortSignal)=>invoke('create-expert-task',{recordId,runId,contentHash,executionPlanId},value=>{
      if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==2||Object.keys(value).some(key=>!['association','instruction'].includes(key)))throw Error('invalid-expert-task');const row=value as Record<string,unknown>;
      const association=parseExpertSources([row.association],recordId,runId,contentHash)[0]!;
      if(typeof row.instruction!=='string'||!row.instruction.trim()||new TextEncoder().encode(row.instruction).byteLength>64*1024)throw Error('invalid-expert-task');return Object.freeze({association,instruction:row.instruction});
    },signal),
    expertSources:(recordId:string,runId:string,contentHash:string,signal?:AbortSignal)=>invoke('expert-sources',{recordId,runId,contentHash},value=>parseExpertSources(value,recordId,runId,contentHash),signal),
    expertCandidate:(association:QualityExpertAssociation,signal?:AbortSignal)=>invoke('expert-candidate',{recordId:association.recordId,runId:association.runId,contentHash:association.contentHash,sessionId:association.sessionId},value=>{
      if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==2||Object.keys(value).some(key=>!['association','candidate'].includes(key)))throw Error('invalid-expert-candidate');const row=value as Record<string,unknown>;
      const source=parseExpertSources([row.association],association.recordId,association.runId,association.contentHash)[0]!;
      if(['sessionId','expertId','expertRevisionId','compositionDigest','creationOperationId'].some(key=>source[key as keyof QualityExpertAssociation]!==association[key as keyof QualityExpertAssociation]))throw Error('invalid-expert-candidate');
      const candidate=parseCandidate(row.candidate??null,association.recordId,association.runId,association.contentHash);
      if(candidate&&candidate.sessionId!==association.sessionId)throw Error('invalid-expert-candidate');return candidate;
    },signal),
    adoptExpertInterpretation:(association:QualityExpertAssociation,candidateHash:string,signal?:AbortSignal)=>invoke('adopt-expert-interpretation',{recordId:association.recordId,runId:association.runId,contentHash:association.contentHash,sessionId:association.sessionId,candidateHash},value=>parseAdoption(value,association.recordId,association.runId,association.contentHash,candidateHash),signal),
    aiCandidate:(recordId:string,runId:string,contentHash:string,signal?:AbortSignal)=>invoke('ai-candidate',{recordId,runId,contentHash},value=>{
      return parseCandidate(value,recordId,runId,contentHash);
    },signal),
    adoptInterpretation:(recordId:string,runId:string,contentHash:string,candidateHash:string,signal?:AbortSignal)=>invoke('adopt-interpretation',{recordId,runId,contentHash,candidateHash},value=>{
      return parseAdoption(value,recordId,runId,contentHash,candidateHash);
    },signal),
    aiSession:(recordId:string,runId:string,contentHash:string,signal?:AbortSignal,reportTarget?:{reportId:string;revisionId:string}|null)=>invoke('ai-session',{recordId,runId,contentHash,...(reportTarget!==undefined?{reportTarget}:{})},value=>{
      if(!value||typeof value!=='object'||Array.isArray(value))throw Error('invalid-session-receipt');const row=value as Record<string,unknown>;
      if(Object.keys(row).length!==4||row.recordId!==recordId||row.runId!==runId||row.contentHash!==contentHash||typeof row.sessionId!=='string'||!/^session-[a-f0-9]{32}$/.test(row.sessionId))throw Error('invalid-session-receipt');
      return Object.freeze({recordId,runId,contentHash,sessionId:row.sessionId});
    },signal),
    sources:(recordId:string,signal?:AbortSignal)=>invoke('sources',{recordId},value=>parseQualitySourceViews(value,recordId),signal),
    importLibrary:(request:QualityLibraryImportRequest,signal?:AbortSignal)=>invoke('import-library',request,value=>{const result=parseQualityLibraryImportResult(value);if(request.format==='csv'&&result.status==='worksheet_required')throw new Error('invalid-import-result');return result;},signal),
    cleaningDraft:(recordId:string,signal?:AbortSignal)=>invoke('cleaning-draft',{recordId},value=>{
      if(!value||typeof value!=='object'||Array.isArray(value))throw Error('invalid-cleaning-draft');const row=value as Record<string,unknown>;
      if(!Number.isSafeInteger(row.revision)||(row.revision as number)<0)throw Error('invalid-cleaning-draft');return Object.freeze({revision:row.revision as number,draft:row.draft===null?null:qualityCleaningRequestSchema.parse(row.draft)});
    },signal),
    saveCleaningDraft:(recordId:string,draft:QualityCleaningRequest,expectedRevision:number,signal?:AbortSignal)=>invoke('save-cleaning-draft',{recordId,draft,expectedRevision},value=>{
      if(!value||typeof value!=='object'||Array.isArray(value))throw Error('invalid-cleaning-draft');const row=value as Record<string,unknown>;
      const returned=qualityCleaningRequestSchema.parse(row.draft);if(row.revision!==expectedRevision+1||JSON.stringify(returned)!==JSON.stringify(qualityCleaningRequestSchema.parse(draft)))throw Error('invalid-cleaning-draft');return Object.freeze({revision:row.revision as number,draft:returned});
    },signal),
    cleaningRows:(recordId:string,tableKind:'inspections'|'defects',offset:number,generation:number,signal?:AbortSignal)=>invoke('cleaning-rows',{recordId,tableKind,offset,limit:20,expectedGeneration:generation},value=>parseQualityCleaningPage(value,{recordId,tableKind,offset,limit:20,generation}),signal),
    configuration:(recordId:string,signal?:AbortSignal)=>invoke('configuration',{recordId},value=>parseQualityConfigurationView(value,recordId),signal),
    configure:(recordId:string,title:string,sourceNamespace:string,sourceSnapshotId:string,analysis:QualityAnalysisConfiguration,expectedGeneration:number,signal?:AbortSignal)=>invoke('configure',{recordId,title,sourceNamespace,sourceSnapshotId,analysis,expectedGeneration},value=>{
      if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('invalid-config-receipt');const row=value as Record<string,unknown>;
      if(Object.keys(row).length!==2||row.recordId!==recordId||!Number.isSafeInteger(row.generation)||![expectedGeneration,expectedGeneration+1].includes(row.generation as number))throw new Error('invalid-config-receipt');return Object.freeze({recordId,generation:row.generation as number});
    },signal),
    analyze:(recordId:string,expectedRevision:number,signal?:AbortSignal,cleaning?:QualityCleaningRequest)=>invoke('analyze',{recordId,expectedRevision,...(cleaning?{cleaning}:{})},value=>{
      if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('invalid-analysis-receipt');const row=value as Record<string,unknown>;
      if(row.status==='saved'){
        const run=row.run as Record<string,unknown>|undefined;
        if(Object.keys(row).length!==3||row.revision!==expectedRevision+1||!run||Array.isArray(run)||Object.keys(run).length!==3||typeof run.runId!=='string'||!run.runId||typeof run.createdAt!=='string'||!Number.isFinite(Date.parse(run.createdAt))||typeof run.contentHash!=='string'||! /^[a-f0-9]{64}$/.test(run.contentHash))throw new Error('invalid-analysis-receipt');
        return Object.freeze({status:'saved' as const,revision:row.revision as number,run:Object.freeze({runId:run.runId,createdAt:run.createdAt,contentHash:run.contentHash})});
      }
      if(row.status!=='blocked'||Object.keys(row).length!==3||!Array.isArray(row.issues)||row.issues.length>100||!Number.isSafeInteger(row.totalIssueCount)||(row.totalIssueCount as number)<row.issues.length)throw new Error('invalid-analysis-receipt');
      const issues=row.issues.map(value=>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('invalid-issue');const issue=value as Record<string,unknown>;
        if(Object.keys(issue).some(key=>!['table','code','row','field'].includes(key))||!['dataset','inspections','defects'].includes(issue.table as string)||typeof issue.code!=='string'||!issue.code||(issue.row!==undefined&&(!Number.isSafeInteger(issue.row)||(issue.row as number)<1))||(issue.field!==undefined&&typeof issue.field!=='string'))throw new Error('invalid-issue');
        return Object.freeze({table:issue.table as string,code:issue.code,...(issue.row!==undefined?{row:issue.row as number}:{}),...(issue.field!==undefined?{field:issue.field as string}:{})});});
      return Object.freeze({status:'blocked' as const,issues:Object.freeze(issues),totalIssueCount:row.totalIssueCount as number});
    },signal),
    projects:(signal?:AbortSignal)=>invoke('projects',{},value=>{
      if(!Array.isArray(value)||value.length>10000)throw new Error('invalid-projects');const ids=new Set<string>();
      return Object.freeze(value.map(row=>{if(!row||typeof row.id!=='string'||!row.id.trim()||typeof row.name!=='string'||!row.name.trim()||ids.has(row.id))throw new Error('invalid-projects');ids.add(row.id);return Object.freeze({id:row.id as string,name:row.name as string});}));
    },signal),
    linkReport:(recordId:string,operationId:string,projectId:string,expected:{assetId:string;revisionId:string},signal?:AbortSignal)=>invoke('link-report',{recordId,operationId,projectId},value=>{
      if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('invalid-project-reference');const row=value as Record<string,unknown>;
      if(row.projectId!==projectId||row.assetId!==expected.assetId||row.revisionId!==expected.revisionId||typeof row.id!=='string'||!row.id.trim())throw new Error('invalid-project-reference');
      return Object.freeze({id:row.id,projectId,assetId:expected.assetId,revisionId:expected.revisionId});
    },signal),
    saveStatistics:(recordId:string,runId:string,contentHash:string,title:string,kind:'trend'|'products'|'pareto',signal?:AbortSignal)=>invoke('save-statistics',{recordId,runId,contentHash,title,kind},value=>{
      if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('invalid-report-receipt');
      const row=value as Record<string,unknown>;
      if(row.runId!==runId||row.contentHash!==contentHash||row.format!=='csv'||row.detailKind!==kind||
         typeof row.sha256!=='string'||!/^[a-f0-9]{64}$/.test(row.sha256)||
         !['assetId','revisionId','nodeId','operationId'].every(key=>typeof row[key]==='string'&&(row[key] as string).trim()&&(row[key] as string).length<=256))throw new Error('invalid-report-receipt');
      return Object.freeze({runId,contentHash,sha256:row.sha256,assetId:row.assetId as string,revisionId:row.revisionId as string,nodeId:row.nodeId as string,operationId:row.operationId as string});
    },signal),
    saveReport:(recordId:string,runId:string,contentHash:string,title:string,signal?:AbortSignal)=>invoke('save-report',{recordId,runId,contentHash,title},value=>{
      if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('invalid-report-receipt');
      const row=value as Record<string,unknown>;
      if(row.runId!==runId||row.contentHash!==contentHash||row.format!=='markdown'||row.detailKind!=='markdown'||
         typeof row.sha256!=='string'||!/^[a-f0-9]{64}$/.test(row.sha256)||
         !['assetId','revisionId','nodeId','operationId'].every(key=>typeof row[key]==='string'&&(row[key] as string).trim()&&(row[key] as string).length<=256))throw new Error('invalid-report-receipt');
      return Object.freeze({runId,contentHash,sha256:row.sha256,assetId:row.assetId as string,revisionId:row.revisionId as string,nodeId:row.nodeId as string,operationId:row.operationId as string});
    },signal),
    view:(recordId:string,runId:string,contentHash:string,includeReport=false,signal?:AbortSignal)=>invoke('run-view',{recordId,runId,contentHash,includeReport},value=>parseQualityRunView(value,recordId,runId,contentHash,includeReport),signal),
    runs:(recordId:string,offset=0,limit=20,expectedRevision?:number,signal?:AbortSignal)=>invoke('runs',{recordId,offset,limit,...(expectedRevision!==undefined?{expectedRevision}:{})},value=>parseRunPage(value,offset,limit,expectedRevision),signal),
    get:(recordId:string,signal?:AbortSignal)=>invoke('get',{recordId},value=>{const detail=parseDetail(value);if(detail.id!==recordId)throw new Error('unmatched-record');return detail;},signal),
    list:(signal?:AbortSignal)=>invoke('list',{},value=>{
      if(!Array.isArray(value)||value.length>1000)throw new Error('invalid-list');const rows=value.map(parseRecord),ids=new Set<string>(),operations=new Set<string>();
      for(const row of rows){if(ids.has(row.id)||operations.has(row.operationId))throw new Error('invalid-list');ids.add(row.id);operations.add(row.operationId);}return Object.freeze(rows);
    },signal),
    // The caller retains operationId across retries; an ambiguous result must not generate a new intent.
    create:(title:string,operationId:string,signal?:AbortSignal)=>invoke('create',{title,operationId},value=>{const row=parseRecord(value);if(row.title!==title.trim()||row.operationId!==operationId)throw new Error('unmatched-create');return row;},signal),
  };
}
