import {createHash} from 'node:crypto';
import {z} from 'zod';
import type {ActorContext,LibraryContentDraft,LibraryService} from 'workdsh-contracts';
import {qualityReportDraftFieldsSchema,type QualityReportDraftSummary,type QualityReportDraftView} from '../domain/report-draft.js';
import {qualityReportIdentifierSchema,qualityReportRevisionIdSchema,type QualityReportFields} from '../domain/report-document.js';

const id=qualityReportIdentifierSchema,revision=qualityReportRevisionIdSchema,hash=z.string().regex(/^[a-f0-9]{64}$/);
const scope=z.string().min(1).max(128).refine(value=>Boolean(value.trim())&&!/[\u0000-\u001f\u007f]/.test(value));
const identitySchema=z.object({draftId:id,recordId:scope,runId:scope,contentHash:hash,reportId:id.optional(),baseRevisionId:revision.optional()}).strict()
  .refine(value=>Boolean(value.reportId)===Boolean(value.baseRevisionId));
const contentSchema=z.object({schemaVersion:z.literal(1),identity:identitySchema,fields:qualityReportDraftFieldsSchema}).strict();
export type QualityReportDraftIdentity=z.infer<typeof identitySchema>;
export const qualityStoredReportDraftSchema=z.object({draftId:id,recordId:scope,runId:scope,contentHash:hash,reportId:id.optional(),baseRevisionId:revision.optional(),
  draftRevision:revision,sha256:hash,updatedAt:z.string().datetime(),title:z.string().max(256),status:z.enum(['active','archived']),libraryOperationId:z.string().min(1).max(256)}).strict()
  .refine(value=>Boolean(value.reportId)===Boolean(value.baseRevisionId));
export type QualityStoredReportDraft=z.infer<typeof qualityStoredReportDraftSchema>;
export const qualityReportDraftOperationSchema=z.object({operationId:id,requestHash:hash,draftId:id,draftRevision:revision,sha256:hash,status:z.enum(['active','archived']),libraryOperationId:z.string().min(1).max(256)}).strict();
export type QualityReportDraftOperation=z.infer<typeof qualityReportDraftOperationSchema>;
export type QualityReportDraftLibrary=Pick<LibraryService,'readContentDraft'|'saveContentDraft'|'archiveContentDraft'>;
export const qualityReportDraftHash=(content:string)=>createHash('sha256').update(content,'utf8').digest('hex');
export function qualityReportDraftIdentity(draft:QualityReportDraftIdentity):QualityReportDraftIdentity {
  return identitySchema.parse({draftId:draft.draftId,recordId:draft.recordId,runId:draft.runId,contentHash:draft.contentHash,
    ...(draft.reportId?{reportId:draft.reportId,baseRevisionId:draft.baseRevisionId}:{})});
}
export function qualityReportDraftSummary(draft:QualityStoredReportDraft):QualityReportDraftSummary {
  const {libraryOperationId:_,...summary}=draft;return structuredClone(summary);
}
export function qualityReportLibraryDraftId(actor:ActorContext,identity:QualityReportDraftIdentity):string {
  return 'quality-report-draft-'+qualityReportDraftHash(JSON.stringify([actor.organizationId,actor.principalId,identity.recordId,identity.runId,identity.contentHash,identity.draftId]));
}
function operationId(actor:ActorContext,identity:QualityReportDraftIdentity,operation:string):string {
  return 'quality-report-draft-op-'+qualityReportDraftHash(JSON.stringify([actor.organizationId,actor.principalId,identity.recordId,identity.runId,identity.contentHash,identity.draftId,operation]));
}
function encode(identity:QualityReportDraftIdentity,fields:QualityReportFields):string {
  return JSON.stringify(contentSchema.parse({schemaVersion:1,identity:qualityReportDraftIdentity(identity),fields}));
}
function decode(value:LibraryContentDraft,actor:ActorContext,identity:QualityReportDraftIdentity,expectedOperation?:string):QualityReportFields {
  if(value.id!==qualityReportLibraryDraftId(actor,identity)||value.createdBy!==actor.principalId||!revision.safeParse(value.revision).success||
    !['active','archived'].includes(value.status)||!z.string().datetime().safeParse(value.updatedAt).success||typeof value.content!=='string'||
    Buffer.byteLength(value.content,'utf8')>16*1024||qualityReportDraftHash(value.content)!==value.sha256)throw Error('quality/report-draft/library-mismatch');
  if(expectedOperation!==undefined&&value.operationId!==expectedOperation)throw Error('quality/report-draft/operation-superseded');
  let content:z.infer<typeof contentSchema>;
  try{content=contentSchema.parse(JSON.parse(value.content));}catch{throw Error('quality/report-draft/invalid-content');}
  if(JSON.stringify(content.identity)!==JSON.stringify(qualityReportDraftIdentity(identity))||encode(identity,content.fields)!==value.content)throw Error('quality/report-draft/scope-mismatch');
  return content.fields;
}
function metadata(identity:QualityReportDraftIdentity,value:LibraryContentDraft,fields:QualityReportFields):QualityStoredReportDraft {
  return qualityStoredReportDraftSchema.parse({...qualityReportDraftIdentity(identity),draftRevision:value.revision,sha256:value.sha256,updatedAt:value.updatedAt,title:fields.title,status:value.status,libraryOperationId:value.operationId});
}
export async function readQualityReportDraft(library:QualityReportDraftLibrary,actor:ActorContext,draft:QualityStoredReportDraft,guard:()=>void,signal?:AbortSignal):Promise<QualityReportDraftView> {
  if(!library.readContentDraft)throw Error('quality/report-draft/service-unavailable');guard();
  const saved=await library.readContentDraft(Object.freeze({...actor}),qualityReportLibraryDraftId(actor,draft),signal,guard);guard();
  const fields=decode(saved,actor,draft,draft.libraryOperationId);
  if(saved.revision!==draft.draftRevision||saved.sha256!==draft.sha256||saved.status!==draft.status||saved.updatedAt!==draft.updatedAt||fields.title!==draft.title)throw Error('quality/report-draft/revision-conflict');
  return {...qualityReportDraftSummary(draft),fields};
}
export async function persistQualityReportDraft(library:QualityReportDraftLibrary,actor:ActorContext,identity:QualityReportDraftIdentity,fields:QualityReportFields,
  operation:string,expectedRevision:string|undefined,guard:()=>void,signal?:AbortSignal):Promise<QualityStoredReportDraft> {
  if(!library.saveContentDraft||!library.readContentDraft)throw Error('quality/report-draft/service-unavailable');
  const content=encode(identity,fields),libraryOperationId=operationId(actor,identity,operation);guard();
  const saved=await library.saveContentDraft(Object.freeze({...actor}),{draftId:qualityReportLibraryDraftId(actor,identity),...(expectedRevision?{expectedRevision}:{}),operationId:libraryOperationId,content},signal,guard);guard();
  const returned=decode(saved,actor,identity,libraryOperationId);
  if(saved.status!=='active'||saved.sha256!==qualityReportDraftHash(content)||JSON.stringify(returned)!==JSON.stringify(fields))throw Error('quality/report-draft/library-mismatch');
  const draft=metadata(identity,saved,returned);await readQualityReportDraft(library,actor,draft,guard,signal);return draft;
}
export async function archiveQualityReportDraft(library:QualityReportDraftLibrary,actor:ActorContext,draft:QualityStoredReportDraft,
  expectedRevision:string,operation:string,guard:()=>void,signal?:AbortSignal):Promise<QualityStoredReportDraft> {
  if(!library.archiveContentDraft||!library.readContentDraft)throw Error('quality/report-draft/service-unavailable');
  const libraryOperationId=operationId(actor,draft,operation);guard();
  const saved=await library.archiveContentDraft(Object.freeze({...actor}),{draftId:qualityReportLibraryDraftId(actor,draft),expectedRevision,operationId:libraryOperationId},signal,guard);guard();
  const fields=decode(saved,actor,draft,libraryOperationId);
  if(saved.status!=='archived'||saved.sha256!==draft.sha256||fields.title!==draft.title)throw Error('quality/report-draft/library-mismatch');
  const archived=metadata(draft,saved,fields);await readQualityReportDraft(library,actor,archived,guard,signal);return archived;
}
