import type { ActorContext, LibraryService } from 'workdsh-contracts';
import type { QualityCsvImporter } from './csv-import';
import type {QualityXlsxImporter} from './xlsx-import';

export interface QualityLibraryReference {readonly assetId:string;readonly revisionId:string}
/** Exact original bytes via the library owner. No text previews, latest-revision
 * fallback, library disk paths or copied library authorization logic.
 */
export async function importQualityLibraryCsv(library:Pick<LibraryService,'readOriginal'>,importer:Pick<QualityCsvImporter,'import'>,
  actor:ActorContext,reference:QualityLibraryReference,authorizeCurrent:()=>void,signal?:AbortSignal) {
  const binding=Object.freeze({...reference});
  if(!binding.assetId.trim()||!binding.revisionId.trim()||binding.assetId.length>256||binding.revisionId.length>256)throw new Error('quality/source/invalid-library-reference');
  const captured=Object.freeze({...actor});
  signal?.throwIfAborted();authorizeCurrent();
  const bytes=await library.readOriginal(captured,binding.assetId,binding.revisionId,signal);
  signal?.throwIfAborted();authorizeCurrent();
  const imported=await importer.import(bytes,signal);
  signal?.throwIfAborted();authorizeCurrent();
  return Object.freeze({imported,provenance:Object.freeze({kind:'library' as const,assetId:binding.assetId,revisionId:binding.revisionId})});
}

/** Library XLSX sources use the same exact-revision owner read as CSV.
 * A sheet-selection response is not a complete source and cannot be analyzed.
 */
export async function importQualityLibraryXlsx(library:Pick<LibraryService,'readOriginal'>,importer:Pick<QualityXlsxImporter,'import'>,
 actor:ActorContext,reference:QualityLibraryReference,selection:{readonly worksheet?:string;readonly headerRow:number},authorizeCurrent:()=>void,signal?:AbortSignal){
 const binding=Object.freeze({...reference}),chosen=Object.freeze({...selection}),captured=Object.freeze({...actor});
 if(!binding.assetId.trim()||!binding.revisionId.trim()||binding.assetId.length>256||binding.revisionId.length>256)throw new Error('quality/source/invalid-library-reference');
 if(!Number.isSafeInteger(chosen.headerRow)||chosen.headerRow<1||(chosen.worksheet!==undefined&&(!chosen.worksheet.trim()||chosen.worksheet.length>256)))throw new Error('quality/source/invalid-worksheet-selection');
 signal?.throwIfAborted();authorizeCurrent();
 const bytes=await library.readOriginal(captured,binding.assetId,binding.revisionId,signal);
 signal?.throwIfAborted();authorizeCurrent();
 const result=await importer.import({bytes,headerRow:chosen.headerRow,...(chosen.worksheet!==undefined?{worksheet:chosen.worksheet}:{})},signal);
 signal?.throwIfAborted();authorizeCurrent();
 const provenance=Object.freeze({kind:'library' as const,assetId:binding.assetId,revisionId:binding.revisionId});
 return Object.freeze({...result,provenance});
}
