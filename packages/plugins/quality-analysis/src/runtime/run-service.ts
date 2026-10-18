import type {QualityExpertAssociation} from './expert-association.js';
import type {QualityCleaningRequest} from './configuration-request.js';
import {importQualityLibraryCsv,importQualityLibraryXlsx,type QualityLibraryReference} from './library-source.js';
import type {QualityCsvImporter} from './csv-import.js';
import type {QualityXlsxImporter} from './xlsx-import.js';
import {randomUUID,createHash} from 'node:crypto';
import type {QualityInterpretationCandidate} from './interpretation-candidate.js';
import type {QualityAnalysisConfiguration} from '../domain/configuration.js';
import type { DomainFacility } from '@deepseek-ai/dsh-storage-domain';
import { assertActorContext, type ActorContext, type IdentityService, type LibraryService, type ProjectService } from 'workdsh-contracts';
import { QualityAnalysisRunStore, type QualityExpertPlan } from './run-store';
import type { CompleteQualityAnalysisRun, CreateAnalysisInput } from './analysis-run';
import type { QualityAnalysisExecutor } from './analysis-executor';
import {saveQualityRenderedArtifactToLibrary} from './report-library';
import type {QualityArtifactExecutor} from './artifact-executor';
import {linkQualityReportToProject} from './report-project';
import type {QualitySourceSnapshot} from './source-snapshot.js';
import type {QualityFilter,QualityInspection} from '../domain/statistics.js';
import {QualityRecordIndex} from './record-index';
import {qualityMappingFields,type QualityTableKind} from '../domain/mapping.js';
import {parseQualityReportFields,qualitySaveReportDocumentInputSchema,qualityReportIdentifierSchema,qualityReportRevisionIdSchema,type QualityReportDocumentSummary,type QualityReportDocumentView,type QualitySaveReportDocumentInput} from '../domain/report-document.js';
import {encodeQualityReportDocument,qualityReportBytesHash,type QualityReportDocumentIdentity} from './report-document.js';
import {persistQualityReportDocument,readQualityReportDocument,type QualityReportDocumentLibrary} from './report-documents.js';
import {qualitySaveReportDraftInputSchema,type QualitySaveReportDraftInput,type QualityReportDraftSummary,type QualityReportDraftView} from '../domain/report-draft.js';
import {persistQualityReportDraft,readQualityReportDraft,archiveQualityReportDraft,qualityReportDraftHash,qualityReportDraftSummary,type QualityReportDraftLibrary,type QualityReportDraftOperation} from './report-drafts.js';
import {resolveQualityFocus,type QualityFocusSelection,type QualityFocusInspectionRow,type QualityFocusedInspectionPage} from '../domain/analysis-focus.js';

function runInspectionRows(run:CompleteQualityAnalysisRun):QualityFocusInspectionRow[]{
 const excluded=new Set(run.content.cleaning?.inspections.filter(row=>row.kind==='exclude').map(row=>row.row)??[]),raw=run.content.sources.inspections.imported.table;
 const sourceRows=raw.rows.map((_,index)=>index+1).filter(row=>!excluded.has(row)),inspections=run.content.dataset.inspections as unknown as readonly QualityInspection[];
 if(sourceRows.length!==inspections.length)throw Error('quality/service/run-row-mismatch');
 return inspections.map((inspection,index)=>({sourceRow:sourceRows[index]!,location:raw.locations[sourceRows[index]!-1]!,inspection}));
}

export interface QualityLibraryInputPorts {readonly library:Pick<LibraryService,'readOriginal'>;readonly csv?:Pick<QualityCsvImporter,'import'>;readonly xlsx?:Pick<QualityXlsxImporter,'import'>;}

/** A finite presentation of the immutable run, never of the record's current
 * configuration. Original rows, cleaning values/reasons and actors stay Host-side.
 * Older saved runs can lack audit arrays; absence is unknown, not a zero count. */
function qualityRunBasis(run:CompleteQualityAnalysisRun){
  const content=run.content;
  const source=(kind:QualityTableKind)=>{
    const saved=content.sources[kind];if(!saved)return;
    const mapping=Object.fromEntries(qualityMappingFields[kind].filter(field=>Object.hasOwn(saved.mapping,field)).map(field=>[field,saved.mapping[field]]));
    return {sha256:saved.imported.sha256,rowCount:saved.imported.table.rows.length,mapping,
      ...(saved.format?{format:{kind:saved.format.kind,worksheet:saved.format.worksheet,headerRow:saved.format.headerRow,valuePolicy:saved.format.valuePolicy}}:{}),
      ...(saved.provenance?{provenance:{kind:saved.provenance.kind,assetId:saved.provenance.assetId,revisionId:saved.provenance.revisionId}}:{})};
  };
  const review=(kind:QualityTableKind)=>{
    const audit=content.cleaning?.[kind],changes=content.transformations?.[kind];
    const corrections=Array.isArray(audit)?audit.filter(entry=>entry.kind==='correct'):undefined;
    return {correctedRows:corrections?new Set(corrections.map(entry=>entry.row)).size:null,correctedCells:corrections?.length??null,
      excludedRows:Array.isArray(audit)?audit.filter(entry=>entry.kind==='exclude').length:null,normalizationChanges:Array.isArray(changes)?changes.length:null};
  };
  const filter=Object.fromEntries(['trendGranularity','retestPolicy','productIds','lineIds','dateFrom','dateTo'].filter(key=>Object.hasOwn(content.filter,key))
    .map(key=>[key,structuredClone(content.filter[key as keyof typeof content.filter])]));
  const basis={algorithmVersion:content.algorithmVersion,sourceNamespace:content.dataset.sourceNamespace,
    sources:{inspections:source('inspections')!,...(content.sources.defects?{defects:source('defects')}:{})},
    rules:{timeZone:content.rules.timeZone,dateFormat:content.rules.dateFormat,inspectionTypes:{...content.rules.inspectionTypes}},filter,
    review:{inspections:review('inspections'),...(content.sources.defects?{defects:review('defects')}:{})}};
  if(Buffer.byteLength(JSON.stringify(basis))>256*1024)throw new Error('quality/service/run-basis-budget-exceeded');
  return basis;
}

/** Host-only run repository service. appendHostRun accepts a trusted analysis
 * result, not a page-uploaded run. Future RPC must resolve authorized sources
 * and bind record revision/generation before invoking this method.
 */
export class QualityAnalysisRunService {
  private readonly stores=new Map<string,Promise<QualityAnalysisRunStore>>();
  private readonly indexes=new Map<string,Promise<QualityRecordIndex>>();
  private closing?:Promise<void>;
  constructor(private readonly storage:DomainFacility,private readonly identity:IdentityService,private readonly artifacts?:Pick<QualityArtifactExecutor,'execute'>) {}
  async listProjects(projects:Pick<ProjectService,'list'>,signal?:AbortSignal){
    const {actor}=await this.resolveIndex(signal);this.authorize(actor);
    const rows=await projects.list(actor,undefined,signal);signal?.throwIfAborted();this.authorize(actor);
    return rows.filter(row=>row.status==='active').map(row=>({id:row.id,name:row.name}));
  }
  async listRecords(signal?:AbortSignal){const {actor,index}=await this.resolveIndex(signal);this.authorize(actor);return index.list();}
  async createRecord(title:string,operationId:string,signal?:AbortSignal){const {actor,index}=await this.resolveIndex(signal);return index.create(title,operationId,()=>this.authorize(actor),signal);}
  async getRecord(recordId:string,signal?:AbortSignal){
    if(!recordId.trim()||recordId.length>128)throw new Error('quality/request/invalid');
    const {actor,index}=await this.resolveIndex(signal);
    const record=index.list().find(row=>row.id===recordId);
    if(!record)throw new Error('quality/service/record-not-found');
    const resolved=await this.resolve(recordId,signal);
    this.authorize(actor);
    if(resolved.actor.organizationId!==actor.organizationId||resolved.actor.principalId!==actor.principalId)throw new Error('quality/service/access-denied');
    return {...record,...resolved.store.context()};
  }
  async listRuns(recordId:string,offset:number,limit:number,expectedRevision?:number,signal?:AbortSignal){
    await this.getRecord(recordId,signal);
    const {actor,store}=await this.resolve(recordId,signal);this.authorize(actor);
    // Recheck index in this resolved scope, so an account change cannot open a guessed record.
    const current=await this.resolveIndex(signal);this.authorize(actor);
    if(!current.index.list().some(row=>row.id===recordId))throw new Error('quality/service/record-not-found');
    return store.listRuns(offset,limit,expectedRevision);
  }
  async listSourceViews(recordId:string,signal?:AbortSignal){
    await this.getRecord(recordId,signal);
    const {actor,store}=await this.resolve(recordId,signal),current=await this.resolveIndex(signal);this.authorize(actor);signal?.throwIfAborted();
    if(!current.index.list().some(row=>row.id===recordId))throw new Error('quality/service/record-not-found');
    return store.sourceViews();
  }
  async readRunView(recordId:string,runId:string,expectedHash:string,includeReport:boolean,signal?:AbortSignal){
    await this.getRecord(recordId,signal);
    const {actor,store}=await this.resolve(recordId,signal),current=await this.resolveIndex(signal);this.authorize(actor);
    if(!current.index.list().some(row=>row.id===recordId))throw new Error('quality/service/record-not-found');
    const run=store.readRun(runId,expectedHash);
    let markdown:string|undefined;
    if(includeReport){
      if(!this.artifacts)throw new Error('quality/service/artifact-executor-unavailable');
      const artifact=await this.artifacts.execute({run,title:'历史质量分析',kind:'markdown'},signal);
      this.authorize(actor);signal?.throwIfAborted();if(this.closing)throw new Error('quality/service/closed');
      if(artifact.kind!=='markdown'||artifact.runId!==runId||artifact.contentHash!==expectedHash)throw new Error('quality/service/artifact-kind-mismatch');
      markdown=artifact.content;
    }
    return {recordId,interpretations:store.listInterpretations(runId,expectedHash),reports:store.history().reports.filter(report=>report.runId===runId&&report.contentHash===expectedHash),runId:run.runId,createdAt:run.createdAt,contentHash:run.contentHash,statistics:run.content.statistics,hasDefectSource:!!run.content.sources.defects,basis:qualityRunBasis(run),...(markdown!==undefined?{markdown}:{})};
  }
  /** Agent reads the authorized immutable run, never a truncated Office view or
   * the record's mutable current import. Locations still identify original rows. */
  async readRunInspections(recordId:string,runId:string,expectedHash:string,offset:number,limit:number,signal?:AbortSignal){
    if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>20)throw Error('quality/request/invalid');
    const {run,guard}=await this.reportDocumentScope(recordId,runId,expectedHash,signal);guard();
    const complete=runInspectionRows(run),rows=structuredClone(complete.slice(offset,offset+limit));
    const value={recordId,runId,contentHash:expectedHash,offset,total:complete.length,rows,nextOffset:offset+rows.length<complete.length?offset+rows.length:null};
    if(Buffer.byteLength(JSON.stringify(value))>256*1024)throw Error('quality/ai/rows-budget');guard();return value;
  }
  /** Business preview and native Agent use the same bounded evidence receipt.
   * A focus is restricted to the inspected records included in this result. */
  async readRunFocusInspections(recordId:string,runId:string,expectedHash:string,selection:QualityFocusSelection,offset:number,signal?:AbortSignal):Promise<QualityFocusedInspectionPage>{
    if(!Number.isSafeInteger(offset)||offset<0)throw Error('quality/request/invalid');
    const {run,guard}=await this.reportDocumentScope(recordId,runId,expectedHash,signal);guard();
    const resolved=resolveQualityFocus(run.content.statistics,run.content.dataset.inspections as unknown as readonly QualityInspection[],selection);
    const complete=runInspectionRows(run).filter(row=>resolved.inspectionIds.has(row.inspection.inspectionId)),rows=structuredClone(complete.slice(offset,offset+20));
    const value={recordId,runId,contentHash:expectedHash,selection:resolved.selection,range:resolved.range,offset,total:complete.length,rows,nextOffset:offset+rows.length<complete.length?offset+rows.length:null};
    if(Buffer.byteLength(JSON.stringify(value))>256*1024)throw Error('quality/ai/rows-budget');guard();return value;
  }
  /** Recalculate a full saved basis with explicit filter changes. Original files,
   * rules, cleaning decisions and historical runs are retained. */
  async analyzeSavedRunAndSave(recordId:string,runId:string,expectedHash:string,filterPatch:QualityFilter,operationId:string,
    executor:Pick<QualityAnalysisExecutor,'execute'>,signal?:AbortSignal){
    if(!/^[a-f0-9]{64}$/.test(operationId))throw Error('quality/ai/invalid-operation');
    const patch=structuredClone(filterPatch),{actor,store,run,guard}=await this.reportDocumentScope(recordId,runId,expectedHash,signal);
    const nextRunId='quality-ai-'+createHash('sha256').update(JSON.stringify([recordId,operationId])).digest('hex').slice(0,32);
    const filter={...run.content.filter,...patch};
    const prior=store.history().runs.find(row=>row.runId===nextRunId);
    if(prior){
      if(JSON.stringify(prior.content.filter)!==JSON.stringify(filter)||prior.content.sources.inspections.imported.sha256!==run.content.sources.inspections.imported.sha256||prior.content.sources.defects?.imported.sha256!==run.content.sources.defects?.imported.sha256)throw Error('quality/ai/operation-conflict');
      guard();return {status:'saved' as const,revision:store.context().revision,run:prior};
    }
    const input:CreateAnalysisInput={runId:nextRunId,createdAt:new Date().toISOString(),sourceNamespace:run.content.dataset.sourceNamespace,
      inspections:structuredClone(run.content.sources.inspections),...(run.content.sources.defects?{defects:structuredClone(run.content.sources.defects)}:{}),rules:structuredClone(run.content.rules),filter};
    const expectedRevision=store.context().revision;
    return this.analyzeAndSave(recordId,input,expectedRevision,executor,()=>{guard();this.authorize(actor);},signal,undefined,undefined,run.content.projectContext);
  }
  async listReportDrafts(recordId:string,runId:string,expectedHash:string,signal?:AbortSignal):Promise<readonly QualityReportDraftSummary[]> {
    const {store}=await this.reportDocumentScope(recordId,runId,expectedHash,signal);return store.listReportDrafts(runId,expectedHash).map(qualityReportDraftSummary);
  }
  async readReportDraft(recordId:string,runId:string,expectedHash:string,draftId:string,library:QualityReportDraftLibrary,signal?:AbortSignal):Promise<QualityReportDraftView> {
    if(!qualityReportIdentifierSchema.safeParse(draftId).success)throw Error('quality/report-draft/invalid-input');
    const {actor,store,guard}=await this.reportDocumentScope(recordId,runId,expectedHash,signal);
    return readQualityReportDraft(library,actor,store.readReportDraft(runId,expectedHash,draftId),guard,signal);
  }
  async saveReportDraft(recordId:string,runId:string,expectedHash:string,input:QualitySaveReportDraftInput,library:QualityReportDraftLibrary,signal?:AbortSignal):Promise<QualityReportDraftView> {
    const parsed=qualitySaveReportDraftInputSchema.safeParse(structuredClone(input));if(!parsed.success)throw Error('quality/report-draft/invalid-input');const request=parsed.data;
    const {actor,store,guard}=await this.reportDocumentScope(recordId,runId,expectedHash,signal);
    const draftId=request.draftId??'quality-draft-'+qualityReportDraftHash(JSON.stringify([actor.organizationId,actor.principalId,recordId,runId,expectedHash,request.operationId])).slice(0,32);
    const requestHash=qualityReportDraftHash(JSON.stringify(['save',recordId,runId,expectedHash,request.draftId??null,request.expectedDraftRevision??null,request.reportId??null,request.baseRevisionId??null,request.fields]));
    const prior=store.readReportDraftOperation(request.operationId,requestHash);
    if(prior)return this.replayReportDraft(store,prior,runId,expectedHash,library,actor,guard,signal);
    const previous=request.draftId?store.readReportDraft(runId,expectedHash,draftId):undefined;
    if(previous){
      if(previous.draftRevision!==request.expectedDraftRevision)throw Error('quality/report-draft/revision-conflict');
      if(previous.status!=='active')throw Error('quality/report-draft/archived');
      if(previous.reportId!==request.reportId||previous.baseRevisionId!==request.baseRevisionId)throw Error('quality/report-draft/scope-mismatch');
    }else if(request.reportId){
      const report=store.readReportDocument(runId,expectedHash,request.reportId);
      if(report.versions.at(-1)!.revisionId!==request.baseRevisionId)throw Error('quality/report-draft/parent-revision-conflict');
    }
    store.assertReportDraftCapacity(draftId);guard();
    const identity={draftId,recordId,runId,contentHash:expectedHash,...(request.reportId?{reportId:request.reportId,baseRevisionId:request.baseRevisionId}:{})};
    const saved=await persistQualityReportDraft(library,actor,identity,request.fields,request.operationId,request.expectedDraftRevision,guard,signal);
    await store.rememberReportDraft(saved,request.expectedDraftRevision,{operationId:request.operationId,requestHash,draftId,draftRevision:saved.draftRevision,sha256:saved.sha256,status:saved.status,libraryOperationId:saved.libraryOperationId},guard,signal);
    return readQualityReportDraft(library,actor,store.readReportDraft(runId,expectedHash,draftId),guard,signal);
  }
  async archiveReportDraft(recordId:string,runId:string,expectedHash:string,draftId:string,expectedDraftRevision:string,operationId:string,
    library:QualityReportDraftLibrary,signal?:AbortSignal):Promise<QualityReportDraftView> {
    if(!qualityReportIdentifierSchema.safeParse(draftId).success||!qualityReportIdentifierSchema.safeParse(operationId).success||!qualityReportRevisionIdSchema.safeParse(expectedDraftRevision).success)throw Error('quality/report-draft/invalid-input');
    const {actor,store,guard}=await this.reportDocumentScope(recordId,runId,expectedHash,signal);
    const requestHash=qualityReportDraftHash(JSON.stringify(['archive',recordId,runId,expectedHash,draftId,expectedDraftRevision]));
    const prior=store.readReportDraftOperation(operationId,requestHash);
    if(prior)return this.replayReportDraft(store,prior,runId,expectedHash,library,actor,guard,signal);
    const previous=store.readReportDraft(runId,expectedHash,draftId);
    if(previous.draftRevision!==expectedDraftRevision)throw Error('quality/report-draft/revision-conflict');
    store.assertReportDraftCapacity(draftId);
    const archived=await archiveQualityReportDraft(library,actor,previous,expectedDraftRevision,operationId,guard,signal);
    await store.rememberReportDraft(archived,expectedDraftRevision,{operationId,requestHash,draftId,draftRevision:archived.draftRevision,sha256:archived.sha256,status:archived.status,libraryOperationId:archived.libraryOperationId},guard,signal);
    return readQualityReportDraft(library,actor,store.readReportDraft(runId,expectedHash,draftId),guard,signal);
  }
  private replayReportDraft(store:QualityAnalysisRunStore,operation:QualityReportDraftOperation,runId:string,hash:string,library:QualityReportDraftLibrary,
    actor:ActorContext,guard:()=>void,signal?:AbortSignal):Promise<QualityReportDraftView> {
    const draft=store.readReportDraft(runId,hash,operation.draftId);
    if(draft.draftRevision!==operation.draftRevision||draft.sha256!==operation.sha256||draft.status!==operation.status||draft.libraryOperationId!==operation.libraryOperationId)throw Error('quality/report-draft/operation-superseded');
    return readQualityReportDraft(library,actor,draft,guard,signal);
  }
  async listReportDocuments(recordId:string,runId:string,expectedHash:string,signal?:AbortSignal):Promise<readonly QualityReportDocumentSummary[]> {
    const {store}=await this.reportDocumentScope(recordId,runId,expectedHash,signal);
    return store.listReportDocuments(runId,expectedHash).map(document=>{const current=document.versions.at(-1)!;
      return {reportId:document.reportId,recordId:document.recordId,runId:document.runId,contentHash:document.contentHash,title:current.title,
        currentRevisionId:current.revisionId,version:current.version,updatedAt:current.createdAt};});
  }
  async readReportDocument(recordId:string,runId:string,expectedHash:string,reportId:string,revisionId:string|undefined,
    library:Pick<LibraryService,'readOriginal'>,signal?:AbortSignal):Promise<QualityReportDocumentView> {
    if(!qualityReportIdentifierSchema.safeParse(reportId).success||(revisionId!==undefined&&!qualityReportRevisionIdSchema.safeParse(revisionId).success))throw Error('quality/request/invalid');
    const {actor,store,run,guard}=await this.reportDocumentScope(recordId,runId,expectedHash,signal);
    return readQualityReportDocument(library,actor,run,store.readReportDocument(runId,expectedHash,reportId),revisionId,guard,signal);
  }
  async saveReportDocument(recordId:string,runId:string,expectedHash:string,input:QualitySaveReportDocumentInput,
    library:QualityReportDocumentLibrary,signal?:AbortSignal):Promise<QualityReportDocumentView> {
    const captured=structuredClone(input),fields=parseQualityReportFields(captured.fields),parsed=qualitySaveReportDocumentInputSchema.safeParse({...captured,fields});
    if(!parsed.success)throw Error('quality/request/invalid');const request=parsed.data;
    const {actor,store,run,guard}=await this.reportDocumentScope(recordId,runId,expectedHash,signal);
    const reportId=request.reportId??'quality-report-'+createHash('sha256').update(JSON.stringify([actor.organizationId,actor.principalId,recordId,runId,expectedHash,request.operationId])).digest('hex').slice(0,32);
    const identity:QualityReportDocumentIdentity={recordId,runId,contentHash:expectedHash,reportId};
    const requestHash=qualityReportBytesHash(JSON.stringify([recordId,runId,expectedHash,request.reportId??null,request.expectedRevisionId??null,fields]));
    const prior=store.readReportDocumentOperation(request.operationId,requestHash);
    if(prior){
      if(prior.reportId!==reportId)throw Error('quality/report-document/operation-conflict');
      return readQualityReportDocument(library,actor,run,store.readReportDocument(runId,expectedHash,reportId),prior.revisionId,guard,signal);
    }
    const previous=request.reportId?store.readReportDocument(runId,expectedHash,reportId):undefined;
    if(previous&&previous.versions.at(-1)!.revisionId!==request.expectedRevisionId)throw Error('quality/report-document/revision-conflict');
    const markdown=encodeQualityReportDocument(identity,run,fields),sha256=qualityReportBytesHash(markdown);
    // Verify the actual previous fixed revision before accepting a no-change save
    // or creating a new one. A generic Library edit is never silently adopted.
    const before=previous?await readQualityReportDocument(library,actor,run,previous,undefined,guard,signal):undefined;
    const unchanged=!!previous&&previous.versions.at(-1)!.sha256===sha256;
    store.assertReportDocumentCapacity(reportId,!unchanged);guard();
    const document=unchanged?previous!:await persistQualityReportDocument(library,actor,run,identity,fields,request.operationId,previous,guard,signal);
    // Read back the real Library bytes before registering metadata. No generated
    // string substitutes for the file that will be reopened by the user.
    const saved=unchanged?before!:await readQualityReportDocument(library,actor,run,document,undefined,guard,signal);
    if(JSON.stringify(saved.fields)!==JSON.stringify(fields))throw Error('quality/report-document/metadata-mismatch');
    const revisionId=document.versions.at(-1)!.revisionId;
    await store.rememberReportDocument(document,request.expectedRevisionId,{operationId:request.operationId,requestHash,reportId,revisionId},guard,signal);
    guard();
    return readQualityReportDocument(library,actor,run,store.readReportDocument(runId,expectedHash,reportId),revisionId,guard,signal);
  }
  /** Host-owned importer output only. No corresponding raw-source RPC is exposed. */
  async stageHostSources(recordId:string,sources:QualitySourceSnapshot,expectedGeneration:number,signal?:AbortSignal){
    const input=structuredClone(sources);await this.getRecord(recordId,signal);
    const {actor,store}=await this.resolve(recordId,signal);this.authorize(actor);
    const current=await this.resolveIndex(signal);this.authorize(actor);
    if(!current.index.list().some(row=>row.id===recordId))throw new Error('quality/service/record-not-found');
    return store.stageSources(input,expectedGeneration,()=>this.authorize(actor),signal);
  }
  async bindSourceConfiguration(recordId:string,title:string,sourceNamespace:string,sourceSnapshotId:string,analysis:QualityAnalysisConfiguration,expectedGeneration:number,signal?:AbortSignal){
    const input=structuredClone(analysis);await this.getRecord(recordId,signal);
    const {actor,store}=await this.resolve(recordId,signal);this.authorize(actor);
    const current=await this.resolveIndex(signal);this.authorize(actor);
    if(!current.index.list().some(row=>row.id===recordId))throw new Error('quality/service/record-not-found');
    return store.bindSourceConfiguration(title,sourceNamespace,sourceSnapshotId,input,expectedGeneration,()=>this.authorize(actor),signal);
  }
  async analyzeConfiguredAndSave(recordId:string,expectedRevision:number,executor:Pick<QualityAnalysisExecutor,'execute'>,signal?:AbortSignal,cleaning?:QualityCleaningRequest){
    const decisions=cleaning?structuredClone(cleaning):undefined;
    await this.getRecord(recordId,signal);const {actor,store}=await this.resolve(recordId,signal);this.authorize(actor);
    const bound=store.configuredSources(),{sources,analysis,configuration}=bound;
    if(decisions&&(decisions.expectedGeneration!==bound.generation||decisions.sourceSnapshotId!==configuration.sourceSnapshotId))throw new Error('quality/store/generation-conflict');
    if(decisions?.defects?.length&&!sources.defects)throw new Error('quality/cleaning/invalid-source');
    const input:CreateAnalysisInput={runId:randomUUID(),createdAt:new Date().toISOString(),sourceNamespace:configuration.sourceNamespace,
      inspections:{...sources.inspections,mapping:analysis.inspectionsMapping,...(decisions?.inspections?{decisions:decisions.inspections}:{})},...(sources.defects?{defects:{...sources.defects,mapping:analysis.defectsMapping!,...(decisions?.defects?{decisions:decisions.defects}:{})}}:{}),rules:analysis.rules,filter:analysis.filter};
    return this.analyzeAndSave(recordId,input,expectedRevision,executor,()=>{this.authorize(actor);if(store.context().generation!==bound.generation)throw new Error('quality/store/generation-conflict');},signal,undefined,decisions?{revision:store.readCleaningDraft().revision,draft:decisions}:undefined);
  }
  async readCleaningDraft(recordId:string,signal?:AbortSignal){
    await this.getRecord(recordId,signal);const {actor,store}=await this.resolve(recordId,signal);this.authorize(actor);return store.readCleaningDraft();
  }
  async saveCleaningDraft(recordId:string,draft:QualityCleaningRequest,expectedRevision:number,signal?:AbortSignal){
    const input=structuredClone(draft);await this.getRecord(recordId,signal);const {actor,store}=await this.resolve(recordId,signal);this.authorize(actor);
    return store.saveCleaningDraft(input,expectedRevision,()=>{if(this.closing)throw new Error('quality/service/closed');this.authorize(actor);},signal);
  }
  async readCleaningRows(recordId:string,tableKind:'inspections'|'defects',offset:number,limit:number,expectedGeneration:number,signal?:AbortSignal){
    if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>20)throw new Error('quality/request/invalid');
    await this.getRecord(recordId,signal);const {actor,store}=await this.resolve(recordId,signal);this.authorize(actor);
    const current=await this.resolveIndex(signal);this.authorize(actor);
    if(!current.index.list().some(row=>row.id===recordId))throw new Error('quality/service/record-not-found');
    const bound=store.configuredSources();if(bound.generation!==expectedGeneration)throw new Error('quality/store/generation-conflict');
    const source=bound.sources[tableKind];if(!source)throw new Error('quality/cleaning/invalid-source');
    const table=source.imported.table;signal?.throwIfAborted();this.authorize(actor);
    return {recordId,tableKind,generation:bound.generation,sourceSnapshotId:bound.configuration.sourceSnapshotId,offset,total:table.rows.length,headers:[...table.headers],rows:table.rows.slice(offset,offset+limit).map((values,index)=>({row:offset+index+1,location:{...table.locations[offset+index]},values:[...values]}))};
  }
  async readConfiguration(recordId:string,signal?:AbortSignal){
    await this.getRecord(recordId,signal);const {actor,store}=await this.resolve(recordId,signal);this.authorize(actor);
    const current=await this.resolveIndex(signal);this.authorize(actor);
    if(!current.index.list().some(row=>row.id===recordId))throw new Error('quality/service/record-not-found');
    return store.configurationView();
  }
  async importLibrarySource(recordId:string,reference:QualityLibraryReference,selection:{format:'csv'|'xlsx';worksheet?:string;headerRow:number;tableKind:'inspections'|'defects';baseSourceSnapshotId?:string},expectedGeneration:number,ports:QualityLibraryInputPorts,signal?:AbortSignal){
    const ref={...reference},chosen={...selection};await this.getRecord(recordId,signal);
    const {actor,store}=await this.resolve(recordId,signal),current=await this.resolveIndex(signal);this.authorize(actor);
    if(!current.index.list().some(row=>row.id===recordId))throw new Error('quality/service/record-not-found');
    const guard=()=>{if(this.closing)throw new Error('quality/service/closed');this.authorize(actor);};
    if(store.context().generation!==expectedGeneration)throw new Error('quality/store/generation-conflict');
    const base=chosen.baseSourceSnapshotId?store.readSources(chosen.baseSourceSnapshotId):undefined;
    if(chosen.tableKind==='defects'&&!base)throw new Error('quality/source/inspection-source-required');
    let source:QualitySourceSnapshot['inspections'];
    if(chosen.format==='csv'){
      if(!ports.csv)throw new Error('quality/service/input-executor-unavailable');
      source=await importQualityLibraryCsv(ports.library,ports.csv,actor,ref,guard,signal);
    }else{
      if(!ports.xlsx)throw new Error('quality/service/input-executor-unavailable');
      const result=await importQualityLibraryXlsx(ports.library,ports.xlsx,actor,ref,{worksheet:chosen.worksheet,headerRow:chosen.headerRow},guard,signal);
      if(result.status==='worksheet_required')return {status:'worksheet_required' as const,worksheets:result.worksheets};
      source={imported:result.imported,format:result.format,provenance:result.provenance};
    }
    signal?.throwIfAborted();guard();
    const sources:QualitySourceSnapshot=chosen.tableKind==='defects'?{inspections:base!.inspections,defects:source}:{inspections:source,...(base?.defects?{defects:base.defects}:{})};
    const receipt=await store.stageSources(sources,expectedGeneration,guard,signal);
    return {status:'ready' as const,...receipt,inspectionHeaders:[...sources.inspections.imported.table.headers],...(sources.defects?{defectHeaders:[...sources.defects.imported.table.headers]}:{})};
  }
  async history(recordId:string,signal?:AbortSignal) {
    const {actor,store}=await this.resolve(recordId,signal);
    this.authorize(actor);return store.history();
  }
  async configure(recordId:string,configuration:unknown,expectedGeneration:number,signal?:AbortSignal) {
    const snapshot=structuredClone(configuration);
    const {actor,store}=await this.resolve(recordId,signal);
    return store.configure(snapshot,expectedGeneration,()=>this.authorize(actor),signal);
  }
  async readExpertPlan(recordId:string,runId:string,contentHash:string,executionPlanId:string,signal?:AbortSignal){
    await this.getRecord(recordId,signal);const {actor,store}=await this.resolve(recordId,signal);this.authorize(actor);return store.readExpertPlan(runId,contentHash,executionPlanId);
  }
  async rememberExpertPlan(plan:QualityExpertPlan,signal?:AbortSignal){
    await this.getRecord(plan.recordId,signal);const {actor,store}=await this.resolve(plan.recordId,signal);
    return store.rememberExpertPlan(plan,()=>{signal?.throwIfAborted();if(this.closing)throw Error('quality/service/closed');this.authorize(actor);},signal);
  }
  async listExpertAssociations(recordId:string,runId:string,contentHash:string,signal?:AbortSignal){
    await this.getRecord(recordId,signal);
    const {actor,store}=await this.resolve(recordId,signal);this.authorize(actor);
    return store.listExpertAssociations(runId,contentHash);
  }
  /** Internal Host orchestration after governed expert creation and verification. */
  async rememberExpertAssociation(association:QualityExpertAssociation,reverify:()=>Promise<unknown>,signal?:AbortSignal){
    await this.getRecord(association.recordId,signal);
    const {actor,store}=await this.resolve(association.recordId,signal);
    const guard=()=>{signal?.throwIfAborted();if(this.closing)throw Error('quality/service/closed');this.authorize(actor);};
    guard();await reverify();guard();await store.rememberExpertAssociation(association,guard,signal);
  }
  async adoptInterpretation(candidate:QualityInterpretationCandidate,library:Pick<LibraryService,'importAsset'>,signal?:AbortSignal,expert?:{association:QualityExpertAssociation;reverify:()=>Promise<unknown>}){
    const {actor,store}=await this.resolve(candidate.recordId,signal);
    const guard=()=>{signal?.throwIfAborted();if(this.closing)throw Error('quality/service/closed');this.authorize(actor);};
    guard();const run=store.history().runs.find(row=>row.runId===candidate.runId);
    if(!run||run.contentHash!==candidate.contentHash)throw Error('quality/store/run-hash-conflict');
    const sessionId=`session-${createHash('sha256').update(JSON.stringify(['workdsh-quality-analysis',actor.organizationId,actor.principalId,candidate.recordId,candidate.runId,candidate.contentHash])).digest('hex').slice(0,32)}`;
    if(expert){
      const association=store.listExpertAssociations(candidate.runId,candidate.contentHash).find(row=>row.sessionId===candidate.sessionId);
      if(!association||JSON.stringify(association)!==JSON.stringify(expert.association))throw Error('quality/service/access-denied');
      await expert.reverify();guard();
    }else if(candidate.sessionId!==sessionId)throw Error('quality/service/access-denied');
    const {candidateHash,...content}=candidate;
    if(createHash('sha256').update(JSON.stringify(content)).digest('hex')!==candidateHash)throw Error('quality/interpretation/candidate-conflict');
    const provenance=JSON.stringify({recordId:candidate.recordId,runId:candidate.runId,contentHash:candidate.contentHash,sessionId:candidate.sessionId,...(expert?{expertId:expert.association.expertId,expertRevisionId:expert.association.expertRevisionId,compositionDigest:expert.association.compositionDigest,creationOperationId:expert.association.creationOperationId}:{}),eventSeq:candidate.eventSeq,turn:candidate.turn,candidateHash},null,2);
    const bytes=new TextEncoder().encode(['# 已采纳的 AI 质量解读','由用户确认保存的独立解读；统计与历史报告以原分析运行为准。','## 来源','```json',provenance,'```','## 解读正文',candidate.text].join('\n\n'));
    if(bytes.byteLength>72*1024)throw Error('quality/interpretation/text-budget');
    const sha256=createHash('sha256').update(bytes).digest('hex');
    const operationId='quality-interpretation-'+candidateHash;
    const entry=await library.importAsset(actor,{name:`AI质量解读-${candidateHash.slice(0,12)}.md`,bytes,mediaType:'text/markdown',source:'task',sourceTaskId:candidate.sessionId,operationId},signal);
    guard();if(!entry.asset||!entry.revision||entry.revision.assetId!==entry.asset.id||entry.revision.originalSha256!==sha256)throw Error('quality/report/invalid-library-receipt');
    const receipt={recordId:candidate.recordId,runId:candidate.runId,contentHash:candidate.contentHash,candidateHash,assetId:entry.asset.id,revisionId:entry.revision.id,operationId};
    if(expert){await expert.reverify();guard();}
    await store.rememberInterpretation(receipt,guard,signal);return receipt;
  }
  async saveReport(recordId:string,runId:string,title:string,library:Pick<LibraryService,'importAsset'>,signal?:AbortSignal) {
    const {actor,store}=await this.resolve(recordId,signal);
    const run=store.history().runs.find(run=>run.runId===runId);
    if(!run)throw new Error('quality/service/run-not-found');
    const guard=()=>{if(this.closing)throw new Error('quality/service/closed');this.authorize(actor);};
    if(!this.artifacts)throw new Error('quality/service/artifact-executor-unavailable');
    const artifact=await this.artifacts.execute({run,title,kind:'markdown'},signal);
    if(artifact.kind!=='markdown')throw new Error('quality/service/artifact-kind-mismatch');
    guard();signal?.throwIfAborted();
    const receipt=await saveQualityRenderedArtifactToLibrary(library,actor,run,title,artifact,guard,signal);
    await store.rememberReport(receipt,guard,signal);
    return receipt;
  }
  async linkReport(recordId:string,operationId:string,projectId:string,library:Pick<LibraryService,'readOriginal'|'list'>,
    projects:Pick<ProjectService,'get'|'addAsset'>,signal?:AbortSignal) {
    const {actor,store}=await this.resolve(recordId,signal);
    const receipt=store.history().reports.find(report=>report.operationId===operationId);
    if(!receipt)throw new Error('quality/service/report-not-found');
    const guard=()=>{
      if(this.closing)throw new Error('quality/service/closed');this.authorize(actor);
    };
    const reference=await linkQualityReportToProject(library,projects,actor,receipt,projectId,guard,signal);
    await store.rememberProjectLink({operationId,projectId,referenceId:reference.id,assetId:reference.assetId,revisionId:reference.revisionId},guard,signal);
    return reference;
  }
  async saveStatistics(recordId:string,runId:string,title:string,kind:'trend'|'products'|'pareto',library:Pick<LibraryService,'importAsset'>,signal?:AbortSignal) {
    const {actor,store}=await this.resolve(recordId,signal);
    const run=store.history().runs.find(run=>run.runId===runId);
    if(!run)throw new Error('quality/service/run-not-found');
    const guard=()=>{if(this.closing)throw new Error('quality/service/closed');this.authorize(actor);};
    if(!this.artifacts)throw new Error('quality/service/artifact-executor-unavailable');
    const artifact=await this.artifacts.execute({run,title,kind},signal);
    if(artifact.kind!==kind)throw new Error('quality/service/artifact-kind-mismatch');
    guard();signal?.throwIfAborted();
    const receipt=await saveQualityRenderedArtifactToLibrary(library,actor,run,title,artifact,guard,signal);
    await store.rememberReport(receipt,guard,signal);return receipt;
  }
  async appendHostRun(recordId:string,run:CompleteQualityAnalysisRun,expectedRevision:number,signal?:AbortSignal) {
    // Snapshot before resolving identity asynchronously.
    const snapshot=structuredClone(run);
    const {actor,store}=await this.resolve(recordId,signal);
    return store.append(snapshot,expectedRevision,()=>this.authorize(actor),signal);
  }
  /** Host coordinator supplies authorized source snapshots and a current-record
   * guard binding revision/generation/project. Actor is captured BEFORE execution.
   * This does not expose input paths, sources or actor claims to page RPC.
   */
  async analyzeAndSave(recordId:string,input:Omit<CreateAnalysisInput,'cleaningActor'|'projectContext'>,expectedRevision:number,
    executor:Pick<QualityAnalysisExecutor,'execute'>,assertRecordCurrent:()=>void,signal?:AbortSignal,
    projectSelection?:{readonly projectId:string;readonly projects:Pick<ProjectService,'get'>},usedCleaningDraft?:{revision:number;draft:QualityCleaningRequest},fixedProjectContext?:CreateAnalysisInput['projectContext']) {
    const snapshot=structuredClone(input);
    const usedDraft=usedCleaningDraft?structuredClone(usedCleaningDraft):undefined;
    const selection=projectSelection?{...projectSelection}:undefined;
    const {actor,store}=await this.resolve(recordId,signal);
    assertRecordCurrent();
    const generation=store.context().generation;
    const project=selection?await selection.projects.get(actor,selection.projectId,signal):undefined;
    if(project&&(project.project.status!=='active'||project.project.id!==selection!.projectId||project.config.projectId!==project.project.id||project.config.id!==project.project.configRevisionId))throw new Error('quality/service/invalid-project-context');
    this.authorize(actor);assertRecordCurrent();signal?.throwIfAborted();
    // A recalculation retains the previously authorized immutable project basis;
    // a new live project association still requires ProjectService validation.
    const projectContext=project?{projectId:project.project.id,projectName:project.project.name,configRevisionId:project.config.id}:fixedProjectContext?structuredClone(fixedProjectContext):undefined;
    const result=await executor.execute({...snapshot,projectContext,cleaningActor:{principalId:actor.principalId,decidedAt:new Date().toISOString()}},signal);
    signal?.throwIfAborted();
    if(this.closing)throw new Error('quality/service/closed');
    this.authorize(actor);assertRecordCurrent();
    if(result.status==='blocked')return result;
    if(selection){
      const current=await selection.projects.get(actor,selection.projectId,signal);
      if(current.project.status!=='active')throw new Error('quality/service/project-unavailable');
      this.authorize(actor);assertRecordCurrent();signal?.throwIfAborted();
    }
    const revision=await store.append(result,expectedRevision,()=>{this.authorize(actor);assertRecordCurrent();},signal,generation,usedDraft);
    return {status:'saved' as const,revision,run:result};
  }
  close():Promise<void> {
    return this.closing??=Promise.allSettled([...this.stores.values(),...this.indexes.values()].map(async pending=>(await pending).close())).then(results=> {
      const failures=results.filter(result=>result.status==='rejected');
      if(failures.length) throw new AggregateError(failures.map(result=>(result as PromiseRejectedResult).reason),'quality/service/close-failed');
    });
  }
  private async resolveIndex(signal?:AbortSignal){
    if(this.closing)throw new Error('quality/service/closed');signal?.throwIfAborted();
    const actor=await this.identity.resolve(undefined,signal);assertActorContext(actor);this.authorize(actor);
    if(this.closing)throw new Error('quality/service/closed');
    const key=JSON.stringify([actor.organizationId,actor.principalId]);let pending=this.indexes.get(key);
    if(!pending){pending=QualityRecordIndex.open(this.storage,actor);this.indexes.set(key,pending);pending.catch(()=>{if(this.indexes.get(key)===pending)this.indexes.delete(key);});}
    const index=await pending;signal?.throwIfAborted();if(this.closing)throw new Error('quality/service/closed');this.authorize(actor);return {actor,index};
  }
  private async reportDocumentScope(recordId:string,runId:string,expectedHash:string,signal?:AbortSignal){
    await this.getRecord(recordId,signal);
    const {actor,store}=await this.resolve(recordId,signal),current=await this.resolveIndex(signal);
    const guard=()=>{signal?.throwIfAborted();if(this.closing)throw Error('quality/service/closed');this.authorize(actor);};
    guard();
    if(current.actor.organizationId!==actor.organizationId||current.actor.principalId!==actor.principalId||!current.index.list().some(row=>row.id===recordId))throw Error('quality/service/record-not-found');
    const run=store.readRun(runId,expectedHash);return {actor,store,run,guard};
  }
  private async resolve(recordId:string,signal?:AbortSignal) {
    if(this.closing) throw new Error('quality/service/closed');
    signal?.throwIfAborted();
    const actor=await this.identity.resolve(undefined,signal);assertActorContext(actor);this.authorize(actor);
    if(this.closing) throw new Error('quality/service/closed');
    const key=JSON.stringify([actor.organizationId,actor.principalId,recordId]);
    let pending=this.stores.get(key);
    if(!pending) {
      pending=QualityAnalysisRunStore.open(this.storage,actor,recordId);this.stores.set(key,pending);
      pending.catch(()=>{if(this.stores.get(key)===pending)this.stores.delete(key);});
    }
    const store=await pending;signal?.throwIfAborted();
    if(this.closing) throw new Error('quality/service/closed');
    this.authorize(actor);return {actor,store};
  }
  private authorize(actor:ActorContext) {
    const profile=this.identity.profile();
    if(profile.principalId!==actor.principalId || profile.organization.id!==actor.organizationId || profile.resolvedBy!==actor.resolvedBy || this.identity.membership(actor.organizationId,actor.principalId)?.state!=='active') throw new Error('quality/service/access-denied');
  }
}
