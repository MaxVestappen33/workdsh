import { createHash } from 'node:crypto';
import { mapQualityTable } from '../domain/mapping';
import { normalizeQualityTable, type QualityNormalizationRules } from '../domain/normalization';
import { calculateQualityStatistics, type QualityFilter } from '../domain/statistics';
import type { QualityRawTable } from '../domain/raw-table';
import { cleanQualityTable, type QualityCleaningDecision, type CleaningActor } from '../domain/cleaning';

export interface QualityTabularSource {
  readonly imported: {readonly sha256:string;readonly table:QualityRawTable};
  readonly format?:{readonly kind:'xlsx';readonly worksheet:string;readonly headerRow:number;readonly valuePolicy:string};
  readonly mapping: Readonly<Record<string, string>>;
  readonly decisions?: readonly QualityCleaningDecision[];
  readonly provenance?: {readonly kind:'library';readonly assetId:string;readonly revisionId:string};
}
export interface CreateAnalysisInput {
  readonly runId: string;
  readonly createdAt: string;
  readonly sourceNamespace: string;
  readonly inspections: QualityTabularSource;
  readonly defects?: QualityTabularSource;
  readonly rules: QualityNormalizationRules;
  readonly filter?: QualityFilter;
  readonly cleaningActor?: CleaningActor;
  readonly projectContext?: {readonly projectId:string;readonly projectName:string;readonly configRevisionId:string};
}
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).filter(key => (value as Record<string,unknown>)[key] !== undefined).sort()
    .map(key => JSON.stringify(key) + ':' + canonical((value as Record<string,unknown>)[key])).join(',') + '}';
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}

/** Host-only snapshot builder. Sources must come from the authorized importer.
 * Caller binds owner/record and persists this snapshot; a hash is not authority.
 */
export function createQualityAnalysisRun(input: CreateAnalysisInput) {
  if (!input.runId || !Number.isFinite(Date.parse(input.createdAt))) throw new Error('quality/run/invalid-metadata');
  for (const source of [input.inspections, input.defects]) {
    if (source && (!/^[a-f0-9]{64}$/.test(source.imported.sha256) || source.imported.table.complete !== true)) throw new Error('quality/run/invalid-source');
  }
  const clean = (source: QualityTabularSource) => {
    if (source.decisions?.length && !input.cleaningActor) throw new Error('quality/run/cleaning-actor-required');
    return source.decisions?.length ? cleanQualityTable(source.imported.table,source.decisions,input.cleaningActor!) : {table:source.imported.table,audit:[],excludedCount:0,sourceRows:source.imported.table.rows.map((_,index)=>index+1)};
  };
  const cleanedInspections = clean(input.inspections), cleanedDefects = input.defects ? clean(input.defects) : undefined;
  const inspections = normalizeQualityTable(mapQualityTable(cleanedInspections.table,'inspections',input.inspections.mapping,cleanedInspections.sourceRows),input.rules);
  const defects = input.defects ? normalizeQualityTable(mapQualityTable(cleanedDefects!.table,'defects',input.defects.mapping,cleanedDefects!.sourceRows),input.rules) : undefined;
  if (inspections.issues.length || defects?.issues.length) return freeze({status:'blocked' as const,
    issues:[...inspections.issues.map(issue=>({...issue,table:'inspections' as const})), ...(defects?.issues.map(issue=>({...issue,table:'defects' as const})) ?? [])]});
  const filter = JSON.parse(JSON.stringify(input.filter ?? {})) as QualityFilter;
  const dataset = {sourceNamespace:input.sourceNamespace,timeZone:input.rules.timeZone,complete:true,
    inspections:inspections.table.rows,defects:defects?.table.rows ?? []};
  const statistics = calculateQualityStatistics(dataset,filter,{inspections:cleanedInspections.sourceRows,...(cleanedDefects?{defects:cleanedDefects.sourceRows}:{})});
  if (statistics.status === 'blocked') return statistics;
  // Clone source tables/rules: caller-owned objects cannot rewrite the saved run.
  const originalContent = {schemaVersion:1, algorithmVersion:'quality-statistics/2', dataset, filter,
    ...(input.projectContext ? {projectContext:{...input.projectContext}} : {}),
    rules:inspections.rules, sources:{inspections:input.inspections, ...(input.defects ? {defects:input.defects} : {})},
    cleaning:{inspections:cleanedInspections.audit,defects:cleanedDefects?.audit ?? []},
    transformations:{inspections:inspections.changes,defects:defects?.changes ?? []},statistics};
  const content = JSON.parse(JSON.stringify(originalContent)) as typeof originalContent;
  const contentHash = createHash('sha256').update(canonical(content)).digest('hex');
  return freeze({status:'complete' as const,runId:input.runId,createdAt:input.createdAt,contentHash,content});
}
export type CompleteQualityAnalysisRun = Extract<ReturnType<typeof createQualityAnalysisRun>, {status:'complete'}>;
export function verifyQualityAnalysisRunHash(run: CompleteQualityAnalysisRun): boolean {
  return createHash('sha256').update(canonical(run.content)).digest('hex') === run.contentHash;
}
