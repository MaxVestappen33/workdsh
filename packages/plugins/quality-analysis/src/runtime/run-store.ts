import type {QualityExpertAssociation} from './expert-association.js';
import {qualityCleaningRequestSchema,type QualityCleaningRequest} from './configuration-request.js';
import { createHash } from 'node:crypto';
import { defineDomain, type Domain, type DomainFacility } from '@deepseek-ai/dsh-storage-domain';
import { z } from 'zod';
import { assertActorContext, type ActorContext } from 'workdsh-contracts';
import {defineQualityAnalysisConfiguration,type QualityAnalysisConfiguration} from '../domain/configuration.js';
import {qualitySourceSnapshotSchema,type QualitySourceSnapshot} from './source-snapshot.js';
import { verifyQualityAnalysisRunHash, type CompleteQualityAnalysisRun } from './analysis-run';
import {qualityStoredReportDocumentSchema,qualityReportDocumentOperationSchema,type QualityStoredReportDocument,type QualityReportDocumentOperation} from './report-document.js';
import {qualityStoredReportDraftSchema,qualityReportDraftOperationSchema,type QualityStoredReportDraft,type QualityReportDraftOperation} from './report-drafts.js';

function decodeSources(entries:readonly {id:string;json:string}[],id:string):QualitySourceSnapshot{
 const entry=entries.find(row=>row.id===id);if(!entry)throw new Error('quality/store/source-not-found');
 if(createHash('sha256').update(entry.json).digest('hex')!==entry.id)throw new Error('quality/store/corrupt-source');
 return qualitySourceSnapshotSchema.parse(JSON.parse(entry.json));
}
const configurationSchema=z.object({title:z.string().trim().min(1).max(256),sourceNamespace:z.string().min(1).max(256),
  timeZone:z.string().min(1).max(128),mappingRevision:z.string().min(1).max(128),sourceSnapshotId:z.string().min(1).max(256)}).strict();
export type QualityRecordConfiguration=z.infer<typeof configurationSchema>;
const reportSchema=z.object({runId:z.string().min(1),contentHash:z.string().regex(/^[a-f0-9]{64}$/),sha256:z.string().regex(/^[a-f0-9]{64}$/),operationId:z.string().min(1),assetId:z.string().min(1),revisionId:z.string().min(1),nodeId:z.string().min(1),format:z.enum(['markdown','csv']).optional(),detailKind:z.enum(['markdown','trend','products','pareto']).optional()}).strict();
export type QualityReportReceipt=z.infer<typeof reportSchema>;
const interpretationReceiptSchema=z.object({recordId:z.string().min(1).max(128),runId:z.string().min(1).max(128),contentHash:z.string().regex(/^[a-f0-9]{64}$/),candidateHash:z.string().regex(/^[a-f0-9]{64}$/),assetId:z.string().min(1).max(256),revisionId:z.string().min(1).max(256),operationId:z.string().min(1).max(256)}).strict();
export type QualityInterpretationReceipt=z.infer<typeof interpretationReceiptSchema>;
const expertAssociationSchema=z.object({recordId:z.string().min(1).max(128),runId:z.string().min(1).max(128),contentHash:z.string().regex(/^[a-f0-9]{64}$/),sessionId:z.string().min(1).max(256),expertId:z.string().min(1).max(256),expertRevisionId:z.string().min(1).max(256),compositionDigest:z.string().regex(/^[a-f0-9]{64}$/),creationOperationId:z.string().min(1).max(256)}).strict();
export const qualityExpertPlanSchema=z.object({recordId:z.string().min(1).max(128),runId:z.string().min(1).max(128),contentHash:z.string().regex(/^[a-f0-9]{64}$/),executionPlanId:z.string().min(1).max(256),operationId:z.string().min(1).max(256),expertId:z.string().min(1).max(256),expertRevisionId:z.string().min(1).max(256),expiresAt:z.string().datetime(),instruction:z.string().min(1).max(65536)}).strict();
export type QualityExpertPlan=z.infer<typeof qualityExpertPlanSchema>;
const projectLinkSchema=z.object({operationId:z.string().min(1),projectId:z.string().min(1),referenceId:z.string().min(1),assetId:z.string().min(1),revisionId:z.string().min(1)}).strict();
export type QualityReportProjectLink=z.infer<typeof projectLinkSchema>;
const runSummarySchema=z.object({runId:z.string().min(1),createdAt:z.string().min(1),contentHash:z.string().regex(/^[a-f0-9]{64}$/),inspectedQuantity:z.number().int().nonnegative(),nonconformingQuantity:z.number().int().nonnegative()}).strict();
function summarizeRun(run:CompleteQualityAnalysisRun){return runSummarySchema.parse({runId:run.runId,createdAt:run.createdAt,contentHash:run.contentHash,inspectedQuantity:run.content.statistics.summary.inspectedQuantity,nonconformingQuantity:run.content.statistics.summary.nonconformingQuantity});}
const stateSchema=z.object({organizationId:z.string(),principalId:z.string(),recordId:z.string(),revision:z.number().int().nonnegative(),
  cleaningDraft:qualityCleaningRequestSchema.optional(),cleaningDraftRevision:z.number().int().nonnegative().default(0),
  generation:z.number().int().nonnegative().default(0),configuration:configurationSchema.optional(),
  analysisConfigurations:z.array(z.object({id:z.string().regex(/^[a-f0-9]{64}$/),sourceSnapshotId:z.string(),json:z.string()}).strict()).default([]),
  sourceSnapshots:z.array(z.object({id:z.string().regex(/^[a-f0-9]{64}$/),json:z.string()}).strict()).default([]),
  expertPlans:z.array(qualityExpertPlanSchema).default([]),expertAssociations:z.array(expertAssociationSchema).default([]),interpretations:z.array(interpretationReceiptSchema).default([]),projectLinks:z.array(projectLinkSchema).default([]),reports:z.array(reportSchema).default([]),
  reportDocuments:z.array(qualityStoredReportDocumentSchema).max(100).default([]),reportDocumentOperations:z.array(qualityReportDocumentOperationSchema).max(2000).default([]),
  reportDrafts:z.array(qualityStoredReportDraftSchema).max(100).default([]),reportDraftOperations:z.array(qualityReportDraftOperationSchema).max(1000).default([]),
  runs:z.array(z.object({id:z.string(),json:z.string(),summary:runSummarySchema.optional()}))});
function spec(actor:ActorContext,recordId:string) {
  const key=createHash('sha256').update(JSON.stringify([actor.organizationId,actor.principalId,recordId])).digest('hex').slice(0,40);
  return defineDomain({name:`workdsh_quality_${key}`,version:1,global:{schema:stateSchema,initial:{organizationId:actor.organizationId,principalId:actor.principalId,recordId,revision:0,cleaningDraft:undefined as QualityCleaningRequest|undefined,cleaningDraftRevision:0,generation:0,configuration:undefined as QualityRecordConfiguration | undefined,analysisConfigurations:[] as {id:string;sourceSnapshotId:string;json:string}[],sourceSnapshots:[] as {id:string;json:string}[],expertPlans:[] as QualityExpertPlan[],expertAssociations:[] as QualityExpertAssociation[],interpretations:[] as QualityInterpretationReceipt[],projectLinks:[] as QualityReportProjectLink[],reports:[] as QualityReportReceipt[],reportDocuments:[] as QualityStoredReportDocument[],reportDocumentOperations:[] as QualityReportDocumentOperation[],reportDrafts:[] as QualityStoredReportDraft[],reportDraftOperations:[] as QualityReportDraftOperation[],runs:[]}},tables:{}});
}
type RunDomain=Domain<ReturnType<typeof spec>>;
/** One Host-owned instance per actor/record. Not a cross-process transaction lock.
 * Trusted service supplies actor and reauthorization guards; no page owner claims.
 */
export class QualityAnalysisRunStore {
  private serial:Promise<unknown>=Promise.resolve();
  private closing?:Promise<void>;
  private constructor(private readonly domain:RunDomain,private readonly actor:ActorContext,private readonly recordId:string) {}
  static async open(storage:DomainFacility,actor:ActorContext,recordId:string) {
    assertActorContext(actor);
    if (!recordId.trim() || recordId.length>128) throw new Error('quality/store/invalid-record');
    return new QualityAnalysisRunStore(await storage.open(spec(actor,recordId)),{...actor},recordId);
  }
  context() {const state=this.state();return {revision:state.revision,generation:state.generation,configuration:structuredClone(state.configuration)};}
  listRuns(offset:number,limit:number,expectedRevision?:number){
    if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>20)throw new Error('quality/request/invalid');
    const state=this.state();if(expectedRevision!==undefined&&expectedRevision!==state.revision)throw new Error('quality/store/revision-conflict');
    const entries=state.runs.slice().reverse().slice(offset,offset+limit).map(entry=>{
      if(entry.summary){if(entry.summary.runId!==entry.id)throw new Error('quality/store/corrupt-run');return structuredClone(entry.summary);}
      // Compatibility for early source-only records; only selected entries are decoded.
      const run=JSON.parse(entry.json) as CompleteQualityAnalysisRun;
      if(run.status!=='complete'||run.runId!==entry.id||!verifyQualityAnalysisRunHash(run))throw new Error('quality/store/corrupt-run');
      return summarizeRun(run);
    });return {revision:state.revision,offset,total:state.runs.length,entries};
  }
  readCleaningDraft(){
    const state=this.state();const valid=state.cleaningDraft&&state.cleaningDraft.expectedGeneration===state.generation&&state.cleaningDraft.sourceSnapshotId===state.configuration?.sourceSnapshotId;
    return {revision:state.cleaningDraftRevision,draft:valid?structuredClone(state.cleaningDraft):null};
  }
  async saveCleaningDraft(input:QualityCleaningRequest,expectedRevision:number,guard:()=>void,signal?:AbortSignal){
    this.state();const draft=qualityCleaningRequestSchema.parse(structuredClone(input));
    if(Buffer.byteLength(JSON.stringify(draft))>12*1024)throw new Error('quality/request/size-limit');
    const write=this.serial.then(async()=>{signal?.throwIfAborted();guard();const state=this.domain.global.get();this.assertOwner(state);
      if(state.cleaningDraftRevision!==expectedRevision)throw new Error('quality/store/cleaning-draft-conflict');
      if(state.generation!==draft.expectedGeneration||state.configuration?.sourceSnapshotId!==draft.sourceSnapshotId)throw new Error('quality/store/generation-conflict');
      await this.domain.global.set({...state,cleaningDraft:draft,cleaningDraftRevision:state.cleaningDraftRevision+1});return {revision:state.cleaningDraftRevision+1,draft};
    });this.serial=write.catch(()=>undefined);return write;
  }
  readRun(runId:string,expectedHash:string){
    const entry=this.state().runs.find(row=>row.id===runId);
    if(!entry)throw new Error('quality/service/run-not-found');
    const run=JSON.parse(entry.json) as CompleteQualityAnalysisRun;
    if(run.status!=='complete'||run.runId!==entry.id||!verifyQualityAnalysisRunHash(run))throw new Error('quality/store/corrupt-run');
    if(run.contentHash!==expectedHash)throw new Error('quality/store/run-hash-conflict');
    return run;
  }
  /** Trusted Host admission only; not a page-uploaded completeness claim. */
  async stageSources(input:QualitySourceSnapshot,expectedGeneration:number,authorizeBeforeWrite:()=>void,signal?:AbortSignal){
    this.state();signal?.throwIfAborted();const snapshot=qualitySourceSnapshotSchema.parse(input),json=JSON.stringify(snapshot);
    if(Buffer.byteLength(json)>32*1024*1024)throw new Error('quality/store/source-budget-exceeded');
    const id=createHash('sha256').update(json).digest('hex');
    const write=this.serial.then(async()=>{
      signal?.throwIfAborted();authorizeBeforeWrite();const state=this.domain.global.get();this.assertOwner(state);
      if(state.generation!==expectedGeneration)throw new Error('quality/store/generation-conflict');
      if(!state.sourceSnapshots.some(entry=>entry.id===id)){
        if(state.sourceSnapshots.length>=10||state.sourceSnapshots.reduce((sum,entry)=>sum+Buffer.byteLength(entry.json),Buffer.byteLength(json))>64*1024*1024)throw new Error('quality/store/source-history-budget-exceeded');
        await this.domain.global.set({...state,sourceSnapshots:[...state.sourceSnapshots,{id,json}]});
      }
      return {sourceSnapshotId:id,inspectionRows:snapshot.inspections.imported.table.rows.length,defectRows:snapshot.defects?.imported.table.rows.length??null};
    });this.serial=write.catch(()=>undefined);return write;
  }
  readSources(sourceSnapshotId:string):QualitySourceSnapshot{
    return decodeSources(this.state().sourceSnapshots,sourceSnapshotId);
  }
  sourceViews(){
    const state=this.state();
    const describe=(source:QualitySourceSnapshot['inspections'])=>({headers:[...source.imported.table.headers],rowCount:source.imported.table.rows.length,sha256:source.imported.sha256,...(source.format?{format:structuredClone(source.format)}:{}),...(source.provenance?{provenance:structuredClone(source.provenance)}:{})});
    const view={recordId:this.recordId,generation:state.generation,entries:state.sourceSnapshots.map(entry=>{
      const source=decodeSources(state.sourceSnapshots,entry.id);
      return {sourceSnapshotId:entry.id,inspections:describe(source.inspections),...(source.defects?{defects:describe(source.defects)}:{})};
    })};
    if(Buffer.byteLength(JSON.stringify(view))>256*1024)throw new Error('quality/store/source-view-budget-exceeded');
    return view;
  }
  async bindSourceConfiguration(title:string,sourceNamespace:string,sourceSnapshotId:string,input:QualityAnalysisConfiguration,expectedGeneration:number,authorizeBeforeWrite:()=>void,signal?:AbortSignal){
    this.state();signal?.throwIfAborted();const captured=structuredClone(input);
    const write=this.serial.then(async()=>{
      signal?.throwIfAborted();authorizeBeforeWrite();const state=this.domain.global.get();this.assertOwner(state);
      if(state.generation!==expectedGeneration)throw new Error('quality/store/generation-conflict');
      const sources=decodeSources(state.sourceSnapshots,sourceSnapshotId);
      let analysis:QualityAnalysisConfiguration;try{analysis=defineQualityAnalysisConfiguration(sources.inspections.imported.table.headers,sources.defects?.imported.table.headers,captured);}catch{throw new Error('quality/store/invalid-analysis-configuration');}
      const json=JSON.stringify(analysis);if(Buffer.byteLength(json)>256*1024)throw new Error('quality/store/configuration-budget-exceeded');
      const id=createHash('sha256').update(json).digest('hex');
      const configuration=configurationSchema.parse({title,sourceNamespace,sourceSnapshotId,mappingRevision:id,timeZone:analysis.rules.timeZone});
      if(JSON.stringify(state.configuration)===JSON.stringify(configuration))return state.generation;
      if(!Number.isSafeInteger(state.generation+1))throw new Error('quality/store/generation-overflow');
      const exists=state.analysisConfigurations.some(entry=>entry.id===id&&entry.sourceSnapshotId===sourceSnapshotId);
      if(!exists&&state.analysisConfigurations.length>=100)throw new Error('quality/store/configuration-history-budget-exceeded');
      await this.domain.global.set({...state,configuration,generation:state.generation+1,analysisConfigurations:exists?state.analysisConfigurations:[...state.analysisConfigurations,{id,sourceSnapshotId,json}]});
      return state.generation+1;
    });this.serial=write.catch(()=>undefined);return write;
  }
  configuredSources(){
    const state=this.state(),configuration=state.configuration;if(!configuration)throw new Error('quality/store/configuration-not-found');
    const entry=state.analysisConfigurations.find(row=>row.id===configuration.mappingRevision&&row.sourceSnapshotId===configuration.sourceSnapshotId);
    if(!entry)throw new Error('quality/store/configuration-unresolved');
    if(createHash('sha256').update(entry.json).digest('hex')!==entry.id)throw new Error('quality/store/corrupt-configuration');
    const sources=this.readSources(entry.sourceSnapshotId);
    const analysis=defineQualityAnalysisConfiguration(sources.inspections.imported.table.headers,sources.defects?.imported.table.headers,JSON.parse(entry.json));
    return {generation:state.generation,configuration:structuredClone(configuration),sources,analysis};
  }
  configurationView(){
    const {generation,configuration,sources,analysis}=this.configuredSources();
    const describe=(source:QualitySourceSnapshot['inspections'])=>({headers:[...source.imported.table.headers],rowCount:source.imported.table.rows.length,sha256:source.imported.sha256,...(source.format?{format:structuredClone(source.format)}:{}),...(source.provenance?{provenance:structuredClone(source.provenance)}:{})});
    return {recordId:this.recordId,generation,sourceSnapshotId:configuration.sourceSnapshotId,title:configuration.title,sourceNamespace:configuration.sourceNamespace,mappingRevision:configuration.mappingRevision,analysis,inspections:describe(sources.inspections),...(sources.defects?{defects:describe(sources.defects)}:{})};
  }
  history() {
    const state=this.state();
    const runs=state.runs.map(entry=> {
      const run=JSON.parse(entry.json) as CompleteQualityAnalysisRun;
      if (run.status!=='complete' || run.runId!==entry.id || !verifyQualityAnalysisRunHash(run)) throw new Error('quality/store/corrupt-run');
      return run;
    });
    return {revision:state.revision,generation:state.generation,configuration:structuredClone(state.configuration),projectLinks:structuredClone(state.projectLinks),reports:structuredClone(state.reports),runs};
  }
  listReportDrafts(runId:string,contentHash:string):readonly QualityStoredReportDraft[] {
    this.readRun(runId,contentHash);return structuredClone(this.state().reportDrafts.filter(draft=>draft.runId===runId&&draft.contentHash===contentHash));
  }
  readReportDraft(runId:string,contentHash:string,draftId:string):QualityStoredReportDraft {
    const draft=this.listReportDrafts(runId,contentHash).find(draft=>draft.draftId===draftId);
    if(!draft)throw Error('quality/report-draft/not-found');return draft;
  }
  readReportDraftOperation(operationId:string,requestHash:string):QualityReportDraftOperation|undefined {
    const operation=this.state().reportDraftOperations.find(row=>row.operationId===operationId);
    if(operation&&operation.requestHash!==requestHash)throw Error('quality/report-draft/operation-conflict');return operation?structuredClone(operation):undefined;
  }
  assertReportDraftCapacity(draftId:string):void {
    const state=this.state();
    if(state.reportDraftOperations.length>=1000||(!state.reportDrafts.some(draft=>draft.draftId===draftId)&&state.reportDrafts.length>=100))throw Error('quality/report-draft/budget-exceeded');
  }
  async rememberReportDraft(input:QualityStoredReportDraft,expectedDraftRevision:string|undefined,operationInput:QualityReportDraftOperation,guard:()=>void,signal?:AbortSignal):Promise<void> {
    const draft=qualityStoredReportDraftSchema.parse(structuredClone(input)),operation=qualityReportDraftOperationSchema.parse(operationInput);
    if(draft.recordId!==this.recordId||operation.draftId!==draft.draftId||operation.draftRevision!==draft.draftRevision||operation.sha256!==draft.sha256||operation.status!==draft.status||operation.libraryOperationId!==draft.libraryOperationId)throw Error('quality/report-draft/scope-mismatch');
    this.state();signal?.throwIfAborted();
    const write=this.serial.then(async()=>{
      signal?.throwIfAborted();guard();const state=this.domain.global.get();this.assertOwner(state);this.readRun(draft.runId,draft.contentHash);
      const prior=state.reportDraftOperations.find(row=>row.operationId===operation.operationId);
      if(prior){if(JSON.stringify(prior)!==JSON.stringify(operation))throw Error('quality/report-draft/operation-conflict');return;}
      const existing=state.reportDrafts.find(row=>row.draftId===draft.draftId);
      if(existing){
        if(existing.draftRevision!==expectedDraftRevision)throw Error('quality/report-draft/revision-conflict');
        if(existing.recordId!==draft.recordId||existing.runId!==draft.runId||existing.contentHash!==draft.contentHash||existing.reportId!==draft.reportId||existing.baseRevisionId!==draft.baseRevisionId)throw Error('quality/report-draft/scope-mismatch');
        if(existing.status==='archived'&&draft.status!=='archived')throw Error('quality/report-draft/archived');
      }else if(expectedDraftRevision!==undefined)throw Error('quality/report-draft/revision-conflict');
      this.assertReportDraftCapacity(draft.draftId);
      const drafts=existing?state.reportDrafts.map(row=>row.draftId===draft.draftId?draft:row):[...state.reportDrafts,draft],operations=[...state.reportDraftOperations,operation];
      if(Buffer.byteLength(JSON.stringify([drafts,operations]))>2*1024*1024)throw Error('quality/report-draft/budget-exceeded');
      signal?.throwIfAborted();guard();await this.domain.global.set({...state,reportDrafts:drafts,reportDraftOperations:operations});
    });this.serial=write.catch(()=>undefined);return write;
  }
  listReportDocuments(runId:string,contentHash:string):readonly QualityStoredReportDocument[] {
    this.readRun(runId,contentHash);
    return structuredClone(this.state().reportDocuments.filter(document=>document.runId===runId&&document.contentHash===contentHash));
  }
  readReportDocument(runId:string,contentHash:string,reportId:string):QualityStoredReportDocument {
    const document=this.listReportDocuments(runId,contentHash).find(document=>document.reportId===reportId);
    if(!document)throw Error('quality/report-document/not-found');return document;
  }
  readReportDocumentOperation(operationId:string,requestHash:string):QualityReportDocumentOperation|undefined {
    const prior=this.state().reportDocumentOperations.find(operation=>operation.operationId===operationId);
    if(prior&&prior.requestHash!==requestHash)throw Error('quality/report-document/operation-conflict');return prior?structuredClone(prior):undefined;
  }
  assertReportDocumentCapacity(reportId:string,changes:boolean):void {
    const state=this.state(),existing=state.reportDocuments.find(document=>document.reportId===reportId);
    if(state.reportDocumentOperations.length>=2000||(!existing&&state.reportDocuments.length>=100)||
      (changes&&(existing?.versions.length??0)>=100)|| (changes&&state.reports.length>=1000))throw Error('quality/report-document/budget-exceeded');
  }
  /** One metadata commit registers the actual Library revision both as a business
   * report version and as a legacy report receipt accepted by project linking. */
  async rememberReportDocument(input:QualityStoredReportDocument,expectedRevisionId:string|undefined,
    operationInput:QualityReportDocumentOperation,guard:()=>void,signal?:AbortSignal):Promise<void> {
    const document=qualityStoredReportDocumentSchema.parse(structuredClone(input)),operation=qualityReportDocumentOperationSchema.parse(operationInput);
    if(document.recordId!==this.recordId||operation.reportId!==document.reportId||operation.revisionId!==document.versions.at(-1)!.revisionId)throw Error('quality/report-document/identity-mismatch');
    this.state();signal?.throwIfAborted();
    const write=this.serial.then(async()=>{
      signal?.throwIfAborted();guard();const state=this.domain.global.get();this.assertOwner(state);this.readRun(document.runId,document.contentHash);
      const prior=state.reportDocumentOperations.find(row=>row.operationId===operation.operationId);
      if(prior){if(JSON.stringify(prior)!==JSON.stringify(operation))throw Error('quality/report-document/operation-conflict');return;}
      const existing=state.reportDocuments.find(row=>row.reportId===document.reportId),last=document.versions.at(-1)!;
      if(existing){
        if(existing.recordId!==document.recordId||existing.runId!==document.runId||existing.contentHash!==document.contentHash||existing.assetId!==document.assetId||existing.nodeId!==document.nodeId)throw Error('quality/report-document/identity-mismatch');
        if(existing.versions.at(-1)!.revisionId!==expectedRevisionId)throw Error('quality/report-document/revision-conflict');
        const unchanged=JSON.stringify(existing)===JSON.stringify(document),prefix=JSON.stringify(document.versions.slice(0,-1));
        if(!unchanged&&(document.versions.length!==existing.versions.length+1||prefix!==JSON.stringify(existing.versions)||last.version!==existing.versions.length+1||existing.versions.some(row=>row.revisionId===last.revisionId)))throw Error('quality/report-document/version-conflict');
      }else if(expectedRevisionId!==undefined||document.versions.length!==1||last.version!==1)throw Error('quality/report-document/revision-conflict');
      this.assertReportDocumentCapacity(document.reportId,!existing||existing.versions.at(-1)!.revisionId!==last.revisionId);
      const receipt=reportSchema.parse({runId:document.runId,contentHash:document.contentHash,sha256:last.sha256,operationId:last.libraryOperationId,
        assetId:document.assetId,revisionId:last.revisionId,nodeId:document.nodeId,format:'markdown',detailKind:'markdown'});
      const priorReceipt=state.reports.find(row=>row.operationId===receipt.operationId);
      if(priorReceipt&&JSON.stringify(priorReceipt)!==JSON.stringify(receipt))throw Error('quality/store/report-receipt-conflict');
      const documents=existing?state.reportDocuments.map(row=>row.reportId===document.reportId?document:row):[...state.reportDocuments,document];
      const operations=[...state.reportDocumentOperations,operation];
      if(Buffer.byteLength(JSON.stringify([documents,operations]))>2*1024*1024)throw Error('quality/report-document/budget-exceeded');
      signal?.throwIfAborted();guard();
      await this.domain.global.set({...state,reportDocuments:documents,reportDocumentOperations:operations,reports:priorReceipt?state.reports:[...state.reports,receipt]});
    });this.serial=write.catch(()=>undefined);return write;
  }
  async rememberProjectLink(input:QualityReportProjectLink,authorizeBeforeWrite:()=>void,signal?:AbortSignal) {
    this.state();const link=projectLinkSchema.parse(input);signal?.throwIfAborted();
    const write=this.serial.then(async()=>{
      signal?.throwIfAborted();authorizeBeforeWrite();const state=this.domain.global.get();this.assertOwner(state);
      const report=state.reports.find(report=>report.operationId===link.operationId);
      if(!report||report.assetId!==link.assetId||report.revisionId!==link.revisionId)throw new Error('quality/store/project-report-mismatch');
      const existing=state.projectLinks.find(row=>row.operationId===link.operationId&&row.projectId===link.projectId&&row.referenceId===link.referenceId);
      if(existing){if(JSON.stringify(existing)!==JSON.stringify(link))throw new Error('quality/store/project-reference-conflict');return;}
      if(state.projectLinks.length>=1000)throw new Error('quality/store/project-link-budget-exceeded');
      await this.domain.global.set({...state,projectLinks:[...state.projectLinks,link]});
    });
    this.serial=write.catch(()=>undefined);return write;
  }
  readExpertPlan(runId:string,contentHash:string,executionPlanId:string){
    this.readRun(runId,contentHash);const plan=this.state().expertPlans.find(row=>row.executionPlanId===executionPlanId&&row.runId===runId&&row.contentHash===contentHash);
    if(!plan)throw Error('quality/store/expert-plan-not-found');return structuredClone(plan);
  }
  async rememberExpertPlan(input:QualityExpertPlan,guard:()=>void,signal?:AbortSignal){
    this.state();const plan=qualityExpertPlanSchema.parse(input);
    if(plan.recordId!==this.recordId||Buffer.byteLength(plan.instruction)>64*1024)throw Error('quality/store/expert-source-mismatch');
    const write=this.serial.then(async()=>{signal?.throwIfAborted();guard();const state=this.domain.global.get();this.assertOwner(state);this.readRun(plan.runId,plan.contentHash);
      const existing=state.expertPlans.find(row=>row.executionPlanId===plan.executionPlanId||row.operationId===plan.operationId);
      if(existing){if(JSON.stringify(existing)!==JSON.stringify(plan))throw Error('quality/store/expert-plan-conflict');return;}
      if(state.expertPlans.length>=100)throw Error('quality/store/expert-plan-budget');
      await this.domain.global.set({...state,expertPlans:[...state.expertPlans,plan]});
    });this.serial=write.catch(()=>undefined);return write;
  }
  listExpertAssociations(runId:string,contentHash:string){
    this.readRun(runId,contentHash);
    return structuredClone(this.state().expertAssociations.filter(row=>row.runId===runId&&row.contentHash===contentHash));
  }
  /** Only a trusted Host-created and reverified expert task is admitted here. */
  async rememberExpertAssociation(input:QualityExpertAssociation,guard:()=>void,signal?:AbortSignal){
    this.state();const association=expertAssociationSchema.parse(input);
    if(association.recordId!==this.recordId)throw Error('quality/store/expert-source-mismatch');
    const write=this.serial.then(async()=>{signal?.throwIfAborted();guard();const state=this.domain.global.get();this.assertOwner(state);
      this.readRun(association.runId,association.contentHash);
      const existing=state.expertAssociations.find(row=>row.sessionId===association.sessionId||row.creationOperationId===association.creationOperationId);
      if(existing){if(JSON.stringify(existing)!==JSON.stringify(association))throw Error('quality/store/expert-association-conflict');return;}
      if(state.expertAssociations.length>=1000)throw Error('quality/store/expert-association-budget');
      await this.domain.global.set({...state,expertAssociations:[...state.expertAssociations,association]});
    });this.serial=write.catch(()=>undefined);return write;
  }
  listInterpretations(runId:string,contentHash:string){
    this.readRun(runId,contentHash);
    return structuredClone(this.state().interpretations.filter(row=>row.runId===runId&&row.contentHash===contentHash));
  }
  async rememberInterpretation(input:QualityInterpretationReceipt,guard:()=>void,signal?:AbortSignal){
    this.state();const receipt=interpretationReceiptSchema.parse(input);
    if(receipt.recordId!==this.recordId||receipt.operationId!=='quality-interpretation-'+receipt.candidateHash)throw Error('quality/store/interpretation-source-mismatch');
    const write=this.serial.then(async()=>{signal?.throwIfAborted();guard();const state=this.domain.global.get();this.assertOwner(state);
      const run=state.runs.find(row=>row.id===receipt.runId);
      if(!run||JSON.parse(run.json).contentHash!==receipt.contentHash)throw Error('quality/store/interpretation-source-mismatch');
      const existing=state.interpretations.find(row=>row.candidateHash===receipt.candidateHash);
      if(existing){if(JSON.stringify(existing)!==JSON.stringify(receipt))throw Error('quality/store/interpretation-receipt-conflict');return;}
      if(state.interpretations.length>=1000)throw Error('quality/store/interpretation-budget');
      await this.domain.global.set({...state,interpretations:[...state.interpretations,receipt]});
    });this.serial=write.catch(()=>undefined);return write;
  }
  async rememberReport(input:QualityReportReceipt,authorizeBeforeWrite:()=>void,signal?:AbortSignal) {
    this.state();const receipt=reportSchema.parse(input);signal?.throwIfAborted();
    const write=this.serial.then(async()=>{
      signal?.throwIfAborted();authorizeBeforeWrite();const state=this.domain.global.get();this.assertOwner(state);
      const entry=state.runs.find(run=>run.id===receipt.runId);
      if(!entry||JSON.parse(entry.json).contentHash!==receipt.contentHash)throw new Error('quality/store/report-run-mismatch');
      const existing=state.reports.find(report=>report.operationId===receipt.operationId);
      if(existing){if(JSON.stringify(existing)!==JSON.stringify(receipt))throw new Error('quality/store/report-receipt-conflict');return;}
      if(state.reports.length>=1000)throw new Error('quality/store/report-budget-exceeded');
      await this.domain.global.set({...state,reports:[...state.reports,receipt]});
    });
    this.serial=write.catch(()=>undefined);return write;
  }
  async configure(input:unknown,expectedGeneration:number,authorizeBeforeWrite:()=>void,signal?:AbortSignal) {
    this.state();signal?.throwIfAborted();
    const configuration=configurationSchema.parse(input);
    try {new Intl.DateTimeFormat('en',{timeZone:configuration.timeZone});}catch{throw new Error('quality/store/invalid-time-zone');}
    const write=this.serial.then(async()=>{
      signal?.throwIfAborted();authorizeBeforeWrite();
      const state=this.domain.global.get();this.assertOwner(state);
      if(state.generation!==expectedGeneration)throw new Error('quality/store/generation-conflict');
      if(JSON.stringify(state.configuration)===JSON.stringify(configuration))return state.generation;
      if(!Number.isSafeInteger(state.generation+1))throw new Error('quality/store/generation-overflow');
      await this.domain.global.set({...state,configuration,generation:state.generation+1});return state.generation+1;
    });
    this.serial=write.catch(()=>undefined);return write;
  }
  async append(run:CompleteQualityAnalysisRun,expectedRevision:number,authorizeBeforeWrite:()=>void,signal?:AbortSignal,expectedGeneration?:number,usedDraft?:{revision:number;draft:QualityCleaningRequest}) {
    this.state(); signal?.throwIfAborted();
    if (!run.runId || !verifyQualityAnalysisRunHash(run)) throw new Error('quality/store/invalid-run');
    const json=JSON.stringify(run),id=run.runId,summary=summarizeRun(run);
    if (Buffer.byteLength(json)>32*1024*1024) throw new Error('quality/store/run-budget-exceeded');
    const write=this.serial.then(async()=> {
      signal?.throwIfAborted();authorizeBeforeWrite();
      const state=this.domain.global.get();this.assertOwner(state);
      if(expectedGeneration!==undefined&&state.generation!==expectedGeneration)throw new Error('quality/store/generation-conflict');
      const existing=state.runs.find(entry=>entry.id===id);
      if(existing) {if(existing.json!==json) throw new Error('quality/store/run-id-conflict');return state.revision;}
      if(state.revision!==expectedRevision) throw new Error('quality/store/revision-conflict');
      if(state.runs.length>=100 || state.runs.reduce((sum,entry)=>sum+Buffer.byteLength(entry.json),Buffer.byteLength(json))>64*1024*1024) throw new Error('quality/store/history-budget-exceeded');
      const sameDecisions=(left:QualityCleaningRequest,right:QualityCleaningRequest)=>left.sourceSnapshotId===right.sourceSnapshotId&&left.expectedGeneration===right.expectedGeneration&&JSON.stringify(left.inspections??[])===JSON.stringify(right.inspections??[])&&JSON.stringify(left.defects??[])===JSON.stringify(right.defects??[]);
      const clearDraft=!!usedDraft&&state.cleaningDraftRevision===usedDraft.revision&&!!state.cleaningDraft&&sameDecisions(state.cleaningDraft,usedDraft.draft);
      await this.domain.global.set({...state,revision:state.revision+1,...(clearDraft?{cleaningDraft:undefined,cleaningDraftRevision:state.cleaningDraftRevision+1}:{}),runs:[...state.runs,{id,json,summary}]});
      return state.revision+1;
    });
    this.serial=write.catch(()=>undefined);
    return write;
  }
  close():Promise<void> {return this.closing??=this.serial.then(()=>this.domain.close());}
  private state() {if(this.closing) throw new Error('quality/store/closed');const state=this.domain.global.get();this.assertOwner(state);return state;}
  private assertOwner(state:z.infer<typeof stateSchema>) {
    if(state.organizationId!==this.actor.organizationId || state.principalId!==this.actor.principalId || state.recordId!==this.recordId) throw new Error('quality/store/owner-mismatch');
  }
}
