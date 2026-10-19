import {z} from 'zod';
const text=z.string().trim().min(1).max(256),revision=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const qualityConfigurationRequestSchema=z.object({recordId:text.max(128),title:text,sourceNamespace:text,sourceSnapshotId:z.string().regex(/^[a-f0-9]{64}$/),expectedGeneration:revision,
 analysis:z.object({inspectionsMapping:z.record(z.string().min(1).max(256),z.string().min(1).max(256)),defectsMapping:z.record(z.string().min(1).max(256),z.string().min(1).max(256)).optional(),rules:z.object({timeZone:text.max(128),dateFormat:z.enum(['yyyy-mm-dd','yyyy/mm/dd','iso-offset']),inspectionTypes:z.record(z.string().min(1).max(256),z.enum(['initial','retest']))}).strict(),filter:z.object({trendGranularity:z.enum(['day','week','month']).optional(),retestPolicy:z.enum(['include-separately','exclude']).optional(),productIds:z.array(text).max(10000).optional(),lineIds:z.array(text).max(10000).optional(),dateFrom:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),dateTo:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()}).strict()}).strict()
}).strict();
const decision=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('exclude'),row:z.number().int().positive(),reason:z.string().trim().min(1).max(2000)}).strict(),
 z.object({kind:z.literal('correct'),row:z.number().int().positive(),header:text,expected:z.union([z.string(),z.number(),z.boolean(),z.null()]),value:z.string().max(65536),reason:z.string().trim().min(1).max(2000)}).strict()
]);
export const qualityCleaningRequestSchema=z.object({sourceSnapshotId:z.string().regex(/^[a-f0-9]{64}$/),expectedGeneration:revision,inspections:z.array(decision).max(100).optional(),defects:z.array(decision).max(100).optional()}).strict();
export type QualityCleaningRequest=z.infer<typeof qualityCleaningRequestSchema>;
export const qualityAnalyzeRequestSchema=z.object({recordId:text.max(128),expectedRevision:revision,cleaning:qualityCleaningRequestSchema.optional()}).strict();

export const qualityLibraryImportRequestSchema=z.object({recordId:text.max(128),reference:z.object({assetId:text,revisionId:text}).strict(),format:z.enum(['csv','xlsx']),tableKind:z.enum(['inspections','defects']),headerRow:z.number().int().positive().max(10000),worksheet:z.string().min(1).max(256).optional(),baseSourceSnapshotId:z.string().regex(/^[a-f0-9]{64}$/).optional(),expectedGeneration:revision}).strict().refine(value=>value.format!=='csv'||(value.headerRow===1&&value.worksheet===undefined));
