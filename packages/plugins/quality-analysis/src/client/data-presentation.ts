import type {LibraryTreeEntry} from 'workdsh-contracts/library';
import type {QualityLibraryChoice} from './QualityLibraryImport.js';
import type {QualitySourceDescription,QualityConfigurationView} from './configuration-view.js';
import type {QualityCleaningPage} from './cleaning-rows.js';
import {reviewSourceMatches,qualityFieldNames,reviewValue} from './review-presentation.js';
import {qualityLibraryChoice} from './library-choice.js';

/** Resolve display metadata through the Library owner; the imported revision stays pinned. */
export async function qualitySourceLibraryChoice(source:QualitySourceDescription,list:(parentId?:string)=>Promise<readonly LibraryTreeEntry[]>,signal:AbortSignal,onNewRevision?:(choice:QualityLibraryChoice)=>void):Promise<QualityLibraryChoice|undefined>{
 const reference=source.provenance;if(!reference)return undefined;
 const parents:(string|undefined)[]=[undefined],visited=new Set<string>();let folders=0;
 while(parents.length&&folders++<200){
  signal.throwIfAborted();const parent=parents.shift(),rows=await list(parent);signal.throwIfAborted();
  for(const row of rows){
   if(row.kind==='asset'&&row.assetId===reference.assetId&&row.asset?.id===reference.assetId&&row.asset.status==='active'&&(row.asset.kind==='csv'||row.asset.kind==='xlsx')&&row.name.trim()){
    const format=source.format?'xlsx':'csv';if(row.asset.kind!==format)return undefined;
    const latest=qualityLibraryChoice(row);
    if(latest&&latest.assetId===reference.assetId&&latest.format===format&&latest.revisionId!==reference.revisionId&&row.asset.currentRevisionId===latest.revisionId&&row.revision?.assetId===reference.assetId)onNewRevision?.(latest);
    return Object.freeze({assetId:reference.assetId,revisionId:reference.revisionId,title:row.name,format});
   }
   if(row.kind==='folder'&&!visited.has(row.id)){visited.add(row.id);parents.push(row.id);}
  }
 }
 return undefined;
}

/** A display table must be from the same currently configured data and generation. */
export function qualityDataPreviewMatches(page:QualityCleaningPage,configuration:QualityConfigurationView):boolean{
 return reviewSourceMatches(page,configuration)&&page.total===(page.tableKind==='inspections'?configuration.inspections:configuration.defects)?.rowCount;
}
export function qualityDataColumns(page:QualityCleaningPage,configuration:QualityConfigurationView){
 const mapping=page.tableKind==='inspections'?configuration.analysis.inspectionsMapping:configuration.analysis.defectsMapping??{};
 return page.headers.map((header,index)=>{const field=Object.keys(mapping).find(key=>mapping[key as keyof typeof mapping]===header);return {header,index,field,label:field?qualityFieldNames[field]??header:header};});
}
export function qualityDataCell(field:string|undefined,value:string|number|boolean|null,configuration:QualityConfigurationView):string{
 return field?reviewValue(field,value,configuration):value===null||value===''?'—':String(value);
}
